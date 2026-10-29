-- resolver 英文名 slug 反查(resolveSlug,~1ms)依赖的函数索引。
--
-- 2026-07-01 体检发现:本地数据库里这个索引其实已经存在(idx_scan>0,确认在被使用),
-- 但仓库全部 113 个迁移 + ops/*.sql 里都没有任何 CREATE INDEX 语句创建它——纯靠某次人工
-- 在 psql 里手敲创建,从未落地成可复现脚本。本文件把它的精确定义(已用
-- `\d+ woocms.cms_content_entries` / pg_indexes.indexdef 核对过,与 resolver/src/db.js
-- 的 WHERE 表达式逐字一致)固化下来,供生产环境核实/补建。
--
-- 生产环境必须先确认是否已存在同款索引(很可能同样是历史人工操作,已经建过):
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='woocms' AND indexname='idx_thaicompany_nameslug';
-- 若不存在,在低峰期执行本文件(CONCURRENTLY 不锁表,但仍占用 I/O,194 万行规模建议错峰跑):
--   psql -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 -f ops/add_nameslug_index.sql
-- 建完用 resolver 健康检查确认:curl http://127.0.0.1:8186/api/site/v1/resolver/health
-- 应返回 {"ok":true,"index":"idx_thaicompany_nameslug",...}。
--
-- 必须用 CONCURRENTLY(避免锁死承载全站内容的核心表)且不能包在事务/迁移文件里跑
-- (CONCURRENTLY 要求不在事务块内,而 WooCMS 的 migrations 整文件是单事务执行,见
-- 000123_content_entries_keyword_trgm.up.sql 的同款限制说明)。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_thaicompany_nameslug
  ON woocms.cms_content_entries
  USING btree (
    trim(both '-' from regexp_replace(lower(meta_json->>'jpnamee'), '[^a-z0-9]+', '-', 'g'))
  )
  WHERE content_model_id = 2 AND coalesce(meta_json->>'jpnamee','') <> '';
