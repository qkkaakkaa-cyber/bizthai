-- woocms.thaicompany_facts 的建表 DDL(灾难恢复参考,非自动执行脚本)。
--
-- 背景:这张物化视图此前只存在于线上/本地数据库的实际状态里,仓库里没有任何地方
-- CREATE 过它 —— 如果数据库从迁移脚本重建,这张视图和它的 7 个索引都不会自动出现,
-- 而 analytics/directors/ai 多处代码硬依赖它(见 analytics/src/db.js 里 thaicompany_facts
-- 的用法)。本文件是从当前数据库 pg_matviews.definition / \d+ / pg_indexes 反向抄录的记录,
-- 供重建时参考,不在任何部署流程里自动跑。
--
-- 刷新:见 ops/refresh_facts.sh(REFRESH MATERIALIZED VIEW CONCURRENTLY,需要 idx_tcf_entry
-- 这个 unique 索引才能不阻塞读;目前该脚本仍是手动执行,未接 cron/systemd timer)。

CREATE MATERIALIZED VIEW woocms.thaicompany_facts AS
SELECT
  id AS entry_id,
  slug,
  meta_json->>'jpno' AS jpno,
  meta_json->>'jpnamee' AS jpnamee,
  meta_json->>'jpname' AS jpname,
  meta_json->>'jpnamezh' AS jpnamezh,
  meta_json->>'provincezh' AS provincezh,
  meta_json->>'province' AS province_th,
  meta_json->>'provincee' AS provincee,
  meta_json->>'businesstypedesc' AS businesstypedesc,
  meta_json->>'businesstypedesce' AS businesstypedesce,
  meta_json->>'businesstypedesczh' AS businesstypedesczh,
  meta_json->>'setupobjgrpdesc' AS setupobjgrpdesc,
  meta_json->>'jpstatcode' AS jpstatcode,
  meta_json->>'jpstatdesc' AS jpstatdesc,
  meta_json->>'jpstatdesce' AS jpstatdesce,
  meta_json->>'statuszh' AS statuszh,
  CASE WHEN (meta_json->>'capamt') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (meta_json->>'capamt')::numeric ELSE NULL END AS capamt,
  CASE WHEN (meta_json->>'paidamt') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (meta_json->>'paidamt')::numeric ELSE NULL END AS paidamt,
  meta_json->>'regdate' AS regdate,
  CASE
    WHEN left(meta_json->>'regdate', 4) ~ '^[0-9]{4}$' AND left(meta_json->>'regdate', 4)::int >= 1800
    THEN left(meta_json->>'regdate', 4)::int
    ELSE NULL
  END AS regyear,
  upper(meta_json->>'mainnatcode') AS mainnatcode
FROM woocms.cms_content_entries e
WHERE content_model_id = 2
  AND deleted_at IS NULL
  AND site_id = 1
  AND status = 'published'
  AND COALESCE(meta_json->>'_probe', '') <> 'true'
WITH DATA;

CREATE UNIQUE INDEX idx_tcf_entry      ON woocms.thaicompany_facts (entry_id);          -- REFRESH CONCURRENTLY 必需
CREATE INDEX        idx_tcf_slug       ON woocms.thaicompany_facts (slug);
CREATE INDEX        idx_tcf_capamt     ON woocms.thaicompany_facts (capamt DESC NULLS LAST);
CREATE INDEX        idx_tcf_regdate    ON woocms.thaicompany_facts (regdate DESC NULLS LAST);
CREATE INDEX        idx_tcf_provincezh ON woocms.thaicompany_facts (provincezh);
CREATE INDEX        idx_tcf_jpstatcode ON woocms.thaicompany_facts (jpstatcode);
CREATE INDEX        idx_tcf_regyear    ON woocms.thaicompany_facts (regyear);
