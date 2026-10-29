-- 公司"搜索命中"计数表。用户在站内搜关键词,公司出现在搜索结果第一页时,该公司 +1。
-- 与 thaicompany_views(详情页浏览量,见 create_thaicompany_views_table.sql)是两个独立指标,
-- 不要合并:一个衡量"搜索时被看见/曝光",一个衡量"详情页被真实访问"。
--
-- 沿用 thaicompany_views 的既有模式,做成独立小表,不往 21GB 的 cms_content_entries 主表加列。
-- 与 thaicompany_views 的一处差异:这张表从一开始就带 entry_id——thaicompany_views 当初只存了
-- jpno,后续要按行业/地区聚合时,jpno 在 thaicompany_facts/cms_content_entries 上都只有 trigram
-- GIN 索引、没有普通等值索引,join 效率差。这张表直接存 entry_id,可以直接 join
-- thaicompany_facts.entry_id(已有唯一索引 idx_tcf_entry),不需要再补索引。
--
-- hits DESC 索引现在(空表)建的代价几乎为零,提前建好,后面做"热门搜索排行"不用再补一次。
--
-- 用法:psql -h <DB_HOST> -p <DB_PORT> -U <有建表权限的账号> -d <DB_NAME> -v ON_ERROR_STOP=1 \
--   -f ops/create_thaicompany_search_hits_table.sql
SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS thaicompany_search_hits (
  jpno text PRIMARY KEY,
  entry_id integer,
  hits bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_thaicompany_search_hits_hits ON thaicompany_search_hits (hits DESC);
CREATE INDEX IF NOT EXISTS idx_thaicompany_search_hits_entry ON thaicompany_search_hits (entry_id);

-- 只读角色 dbd_readonly 默认只有 SELECT(见 ops/create_readonly_role.sql),这张表跟
-- thaicompany_views 一样需要额外的写权限。【不要重跑 create_readonly_role.sql 整个文件】——
-- 那个文件里的 ALTER ROLE ... PASSWORD 会把 dbd_readonly 的密码重置成脚本参数,而生产环境
-- 3 个 sidecar 已经在用当前密码连接,盲目重跑会导致密码不一致、三个 sidecar 全部连不上库。
-- 只需要单独执行下面这一条 GRANT。
GRANT SELECT, INSERT, UPDATE ON woocms.thaicompany_search_hits TO dbd_readonly;
