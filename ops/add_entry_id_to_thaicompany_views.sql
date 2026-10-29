-- thaicompany_views 补 entry_id 列(一次性迁移)。当初建表时只存了 jpno,后续要按行业/地区
-- 聚合(人气排行)需要 join thaicompany_facts,但 jpno 在两边都只有 trigram GIN 索引、没有
-- 普通等值索引,join 效率差,而且每次排行查询都重新 join 一遍是浪费。这张表本身很小
-- (只有被真实访问过的公司才有行,2026-07-02 实测 119 行),一次性回填成本可忽略不计;
-- 之后 resolver 的 bumpCompanyViews 写入时会顺带带上 entry_id(与 thaicompany_search_hits
-- 建表时就有 entry_id 的做法一致),不需要再回填第二次。
--
-- 用法:psql -h <DB_HOST> -p <DB_PORT> -U <有权限的账号> -d <DB_NAME> -v ON_ERROR_STOP=1 \
--   -f ops/add_entry_id_to_thaicompany_views.sql
SET search_path TO woocms, public;

ALTER TABLE thaicompany_views ADD COLUMN IF NOT EXISTS entry_id integer;

UPDATE thaicompany_views v
SET entry_id = f.entry_id
FROM thaicompany_facts f
WHERE f.jpno = v.jpno AND v.entry_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_thaicompany_views_entry ON thaicompany_views (entry_id);
CREATE INDEX IF NOT EXISTS idx_thaicompany_views_views ON thaicompany_views (views DESC);
