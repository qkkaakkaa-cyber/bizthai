-- migrate:no-transaction
SET search_path TO woocms, public;

-- posts 关键词搜索(content.ListQuery.Keyword)对 title/summary/body 做前后通配的
-- "(title ILIKE '%kw%' OR summary ILIKE '%kw%' OR body ILIKE '%kw%')"匹配——与 000123 给
-- cms_content_entries 加装的机制是同一个问题、同一个根因:任意位置子串匹配普通 B-tree 索引
-- 无法加速,OR 条件里只要有一列没有可用索引,规划器就必须整表顺序扫描才能保证正确性,千万级
-- cms_posts 上这是稳定要秒级甚至更久的根因。
--
-- 选 pg_trgm 而不是 tsvector+GIN 全文检索,是延续 000123 当时的诊断结论,而非另起一套机制:
-- 中文/泰文等语言没有天然分词边界,PostgreSQL 内置的 'simple'/'english' text search 配置
-- 无法有效切分这类文本,要切分到位需要 zhparser/pg_jieba 这类扩展——存量环境大概率没装,
-- 写进强制迁移一旦装不上就阻断该库全部后续迁移(见报告 7.3 第 3 条护栏,与 000047 事故同一
-- 教训);trigram 索引不依赖分词边界,对中文/泰文原生适配,且不需要额外扩展。中文分词方案本身
-- 仍是待产品/运维拍板的独立决策点(见报告第六节),真需要时可以运行时探测扩展是否可用再叠加
-- FTS,不影响这里先用 trgm 解决"完全没有可用索引"这个更紧迫的问题。
--
-- 与 000123 的一处改进:当时 runner 还不支持 no-transaction 迁移文件,只能接受 CREATE INDEX
-- 的 SHARE 锁阻塞写入;现在 runner 已支持(eafcbf5),这里改用 CONCURRENTLY,千万行级存量站点
-- 升级时不阻塞写入。pg_trgm 扩展已被 000123 安装过,这里的 CREATE EXTENSION 只是幂等兜底
-- (给从未跑过 000123 的环境,理论上不会发生,但 IF NOT EXISTS 兜底不增加风险)。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_title_trgm ON cms_posts USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_summary_trgm ON cms_posts USING gin (summary gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_body_trgm ON cms_posts USING gin (body gin_trgm_ops);
