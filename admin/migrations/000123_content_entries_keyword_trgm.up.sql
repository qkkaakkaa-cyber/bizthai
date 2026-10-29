SET search_path TO woocms, public;

-- entries 关键词搜索(cpt.ListEntryQuery.Keyword)对 title/summary/body 做前后通配的
-- "(title ILIKE '%kw%' OR summary ILIKE '%kw%' OR body ILIKE '%kw%')"匹配。这类任意位置子串匹配
-- 普通 B-tree 索引完全无法加速；OR 条件里只要有一列没有可用索引，规划器就必须对整表做顺序扫描
-- 才能保证正确性(无法仅凭其它列的索引证明"没有其它行经 body 匹配")——百万行规模下这正是关键词
-- 搜索稳定要 3~6 秒甚至更久的根因，且与该表是否膨胀(见 000122)无关，加什么索引到无关字段都不会
-- 生效。trigram GIN 索引可加速任意位置的子串匹配，且对中文/泰文等没有天然分词边界的语言比全文
-- 检索(tsvector，按词切分)更合适——这也是本反馈自行诊断时选择 pg_trgm 而非全文检索的原因。
-- 在已有数据的大表上建索引不能用 CONCURRENTLY(要求不在事务块内，而迁移整文件单事务执行)，
-- 会短暂持有 SHARE 锁阻塞写入(不阻塞读)，百万行规模下可能耗时数十秒到数分钟，属一次性升级成本。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cms_content_entries_title_trgm ON cms_content_entries USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cms_content_entries_summary_trgm ON cms_content_entries USING gin (summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cms_content_entries_body_trgm ON cms_content_entries USING gin (body gin_trgm_ops);
