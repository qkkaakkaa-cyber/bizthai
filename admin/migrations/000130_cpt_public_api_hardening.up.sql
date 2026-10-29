-- migrate:no-transaction
SET search_path TO woocms, public;

-- 通用模型公开接口(/api/site/v1/models/:model/entries)大数据量性能与安全加固：
-- 1) cms_field_defs 新增 sensitive 标记——字段被勾选后，公开 API(列表/详情/聚合/过滤/排序)
--    永远不会吐出该字段的值，只有后台管理接口仍可见完整数据。默认 FALSE，存量字段/站点
--    行为不变。用法与既有 indexed 列（000128）完全对称，同为 opt-in 加法特性。
-- 2) cms_content_entries 补一条覆盖 (site_id, content_model_id, status, updated_at DESC, id DESC)
--    的部分索引，为公开列表 API 新增的 keyset/游标分页提供可命中的索引顺序——现有
--    idx_cms_content_entries_site_model_status（000029）缺 id 尾列（keyset 分页需要它做
--    确定性 tie-breaker）也缺 WHERE deleted_at IS NULL 部分谓词，无法被新查询形态复用。
-- 本文件标 no-transaction：CREATE INDEX CONCURRENTLY 不能在事务块内执行；ALTER TABLE ADD
-- COLUMN 混在同一批语句里逐条单独发送也完全安全（no-transaction 只是不再打包成一个事务）。

ALTER TABLE cms_field_defs
    ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_content_entries_site_model_status_updated_keyset
    ON cms_content_entries (site_id, content_model_id, status, updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;
