-- 给 WooCMS 原生关键词搜索(闭源,内部 SQL 不可见)提供 trigram 索引候选。
--
-- 2026-07-01 实测结论(已删除,本文件仅作记录,不要直接重跑):两个候选都建成功过
-- (jpnamee 125MB / jpname 99MB,各花 20+ 分钟),但用 pg_stat_user_indexes.idx_scan
-- 在建索引前后各打了 5 次真实关键词(英文+泰文)反复验证,两个索引的 idx_scan 均未增长。
-- 用 EXPLAIN (ANALYZE, BUFFERS) 查证原因:索引本身有效(去掉 LIMIT 单独测,COUNT(*) 查询
-- 确实会走 Bitmap Index Scan),但 WooCMS 关键词接口自带分页 LIMIT,这种"少量结果+提前
-- 终止"的场景下 planner 认为顺序扫描更便宜,是合理的规划器决策,不是索引失效或表达式写
-- 错。结论:这条路线对 WooCMS 当前的关键词查询模式无效,两个索引已用 DROP INDEX
-- CONCURRENTLY 移除,不留占用空间和拖慢写入的无用索引。以后要真正提速关键词搜索,可能
-- 得绕开 WooCMS 核心走自建搜索(参考 analytics 边车绕过 sort/taxonomy AND 限制的既有手法),
-- 而不是指望单纯加索引让闭源查询自己变快。
--
-- pg_trgm 已装(v1.6,与 director_index 的 trgm 索引同库同手法,见 ops/build_director_index.sql)。
-- 必须用 CONCURRENTLY(避免锁死承载全站内容的核心表),且不能包在同一事务/同一次 -f 里跑。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_thaicompany_jpnamee_trgm
  ON woocms.cms_content_entries
  USING gin ((meta_json->>'jpnamee') gin_trgm_ops)
  WHERE content_model_id = 2;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_thaicompany_jpname_trgm
  ON woocms.cms_content_entries
  USING gin ((meta_json->>'jpname') gin_trgm_ops)
  WHERE content_model_id = 2;
