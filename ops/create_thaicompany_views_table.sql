-- 公司详情页浏览量计数表。原先由 resolver/src/db.js 的 ensureViewsTable() 在请求路径里
-- CREATE TABLE IF NOT EXISTS 建(表很小,已看过的公司才有一行,按 jpno 主键自增)。
--
-- 体检发现:给 resolver 切换独立只读 DB 角色(ops/create_readonly_role.sql)后,这个
-- "请求路径里建表"的设计直接报错 permission denied for schema——建表需要 schema 级
-- CREATE 权限,而只读角色不应该有(否则"只读"名不副实)。正确做法是把建表挪到这份
-- 一次性脚本里,resolver 只做 UPSERT(INSERT ... ON CONFLICT),只需 SELECT/INSERT/UPDATE
-- 这张表的权限,不需要 CREATE。
--
-- 用法:psql -h <DB_HOST> -p <DB_PORT> -U <有建表权限的账号> -d <DB_NAME> -v ON_ERROR_STOP=1 \
--   -f ops/create_thaicompany_views_table.sql
SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS thaicompany_views (
  jpno text PRIMARY KEY,
  views bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
