-- 体检发现:resolver/analytics/directors 三个 sidecar 全部只读查询,却复用了 WooCMS
-- 建库/迁移用的主账号(dbdadmin_woocms,可写)——任一 sidecar 被 SQL 注入/RCE 突破,
-- 拿到的就是可写权限,能改/删百万级业务表。三者本就该用独立的只读角色(最小权限原则)。
--
-- 用法(生产按需替换密码,不要复用本地这份):
--   psql -h <DB_HOST> -p <DB_PORT> -U <有权限的账号> -d <DB_NAME> -v ON_ERROR_STOP=1 \
--     -v ro_password='SET_AT_DEPLOY_TIME'
-- 或直接把下面 :'ro_password' 替换成字面量密码后手动执行。
--
-- ALTER DEFAULT PRIVILEGES 确保以后 WooCMS 迁移新建的表,只读角色自动也能 SELECT,
-- 不需要每次加迁移都手动补一次 GRANT。
SET search_path TO woocms, public;

-- DO $$ $$ 块是给 PL/pgSQL 引擎的字面量字符串,psql 的 :'变量' 替换在里面不生效;
-- 改成"先尝试裸建(已存在则报错但不中断),再统一 ALTER 密码"这种更简单可靠的写法。
\set ON_ERROR_STOP off
CREATE ROLE dbd_readonly WITH LOGIN;
\set ON_ERROR_STOP on
ALTER ROLE dbd_readonly WITH LOGIN PASSWORD :'ro_password';

GRANT CONNECT ON DATABASE dbdadmin_woocms TO dbd_readonly;
GRANT USAGE ON SCHEMA woocms TO dbd_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA woocms TO dbd_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA woocms GRANT SELECT ON TABLES TO dbd_readonly;

-- resolver 的 bumpCompanyViews 会在请求路径里 CREATE TABLE IF NOT EXISTS thaicompany_views
-- (见 resolver/src/db.js ensureViewsTable)——只读角色本不该有建表权限,这张表应该纳入迁移
-- 预建;在迁移补齐前,先保留这张表的读写权限,避免一刀切成只读后浏览量统计直接报错。
GRANT SELECT, INSERT, UPDATE ON woocms.thaicompany_views TO dbd_readonly;
