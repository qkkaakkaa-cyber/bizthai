SET search_path TO woocms, public;

-- CPT 索引旁表(docs/architecture-scalability-assessment-2026-07-01.md 阶段 2 第 1 条)：
-- meta_json->>'field' 过滤在千万级 cms_content_entries 上没有可用的类型化索引(JSONB 文本
-- 提取只能靠表达式索引逐字段手工建,且天然不支持数值/日期的范围比较)。这里新增一张类型化、
-- 窄行、只存"被显式标记为 indexed 的字段"的旁表,写路径(CreateEntry/UpdateEntry/
-- UpdateEntryMetaWithSnapshot)与 meta_json 同步维护,读路径按(entry_id, field_name)
-- 精确匹配,不逐 meta 键枚举扫描。
--
-- 本迁移只建空表结构,不做任何数据回填——存量千万行环境如果在迁移里同步回填,等于超长
-- 启动 + 大事务 + WAL 洪峰(AGENTS.md/报告 7.2 第 2 条明确禁止)。真正的回填由新增的后台
-- worker(RunEntryIndexBackfillBatch,FOR UPDATE SKIP LOCKED 同款分批模式)异步完成,完成前
-- 查询自动降级回 meta_json 路径(双读,见 buildListEntriesFilters)。新表全新且为空,行内建
-- 索引无需 CONCURRENTLY(CONCURRENTLY 只在给已有数据的大表建索引时才需要)。
CREATE TABLE IF NOT EXISTS cms_entry_index_values (
    id             BIGSERIAL PRIMARY KEY,
    entry_id       BIGINT NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    site_id        BIGINT NOT NULL,
    model_id       BIGINT NOT NULL,
    field_name     VARCHAR(64) NOT NULL,
    value_text     TEXT,
    value_numeric  NUMERIC,
    value_date     TIMESTAMPTZ,
    value_bool     BOOLEAN,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entry_id, field_name)
);

-- 每种类型各一个部分索引(只覆盖该类型实际有值的行),按(site_id, model_id, field_name, value)
-- 排列——匹配 buildListEntriesFilters 双读路径生成的 EXISTS 子查询列序,支撑等值过滤走索引;
-- 数值/日期部分额外为未来的范围比较(> < BETWEEN)预留了可复用的列序,不需要再迁移一次。
CREATE INDEX IF NOT EXISTS idx_cms_entry_index_values_text
    ON cms_entry_index_values (site_id, model_id, field_name, value_text)
    WHERE value_text IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cms_entry_index_values_numeric
    ON cms_entry_index_values (site_id, model_id, field_name, value_numeric)
    WHERE value_numeric IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cms_entry_index_values_date
    ON cms_entry_index_values (site_id, model_id, field_name, value_date)
    WHERE value_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cms_entry_index_values_bool
    ON cms_entry_index_values (site_id, model_id, field_name, value_bool)
    WHERE value_bool IS NOT NULL;

-- entry_id 上的索引主要服务 syncEntryIndexValues 的"先删该 entry 全部旧行再插入"模式
-- (每次 Create/Update 一次点查+删除),FK 外键校验与 ON DELETE CASCADE 级联删除也依赖它。
CREATE INDEX IF NOT EXISTS idx_cms_entry_index_values_entry
    ON cms_entry_index_values (entry_id);

-- 字段定义新增 indexed 标记:管理员在字段编辑器里勾选后,该字段的值才会被写入上面的旁表。
-- 默认 FALSE——存量字段定义、存量站点不受任何影响,索引旁表整体是 opt-in 的加法特性。
ALTER TABLE cms_field_defs
    ADD COLUMN IF NOT EXISTS indexed BOOLEAN NOT NULL DEFAULT FALSE;

-- 每个内容模型的旁表回填进度:completed_at 为空 = 该模型尚未完成(或从未需要)回填,查询侧
-- 必须走 meta_json 双读兜底;非空 = 该模型当前 indexed 的字段值已在旁表中完整可信,查询侧
-- 可以放心只走旁表 join。字段定义的 indexed 集合发生变化时(见 CreateFieldGroup/
-- UpdateFieldGroupByCode)会把对应模型的这一行重置为待回填,worker 之后会重新扫描一遍——
-- 幂等操作,重复扫描只是多花时间,不会产生错误数据。
CREATE TABLE IF NOT EXISTS cms_entry_index_backfill (
    model_id     BIGINT PRIMARY KEY REFERENCES cms_content_models(id) ON DELETE CASCADE,
    site_id      BIGINT NOT NULL,
    cursor_id    BIGINT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_entry_index_backfill_pending
    ON cms_entry_index_backfill (updated_at)
    WHERE completed_at IS NULL;
