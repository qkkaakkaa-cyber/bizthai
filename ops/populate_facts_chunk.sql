\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET synchronous_commit = off;

INSERT INTO woocms.thaicompany_facts_build (
  entry_id,
  slug,
  jpno,
  jpnamee,
  jpname,
  jpnamezh,
  provincezh,
  province_th,
  provincee,
  businesstypedesc,
  businesstypedesce,
  businesstypedesczh,
  setupobjgrpdesc,
  jpstatcode,
  jpstatdesc,
  jpstatdesce,
  statuszh,
  capamt,
  paidamt,
  regdate,
  regyear,
  mainnatcode
)
SELECT
  e.id AS entry_id,
  e.slug,
  e.meta_json ->> 'jpno' AS jpno,
  e.meta_json ->> 'jpnamee' AS jpnamee,
  e.meta_json ->> 'jpname' AS jpname,
  e.meta_json ->> 'jpnamezh' AS jpnamezh,
  e.meta_json ->> 'provincezh' AS provincezh,
  e.meta_json ->> 'province' AS province_th,
  e.meta_json ->> 'provincee' AS provincee,
  e.meta_json ->> 'businesstypedesc' AS businesstypedesc,
  e.meta_json ->> 'businesstypedesce' AS businesstypedesce,
  e.meta_json ->> 'businesstypedesczh' AS businesstypedesczh,
  e.meta_json ->> 'setupobjgrpdesc' AS setupobjgrpdesc,
  e.meta_json ->> 'jpstatcode' AS jpstatcode,
  e.meta_json ->> 'jpstatdesc' AS jpstatdesc,
  e.meta_json ->> 'jpstatdesce' AS jpstatdesce,
  e.meta_json ->> 'statuszh' AS statuszh,
  CASE
    WHEN (e.meta_json ->> 'capamt') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (e.meta_json ->> 'capamt')::numeric
    ELSE NULL::numeric
  END AS capamt,
  CASE
    WHEN (e.meta_json ->> 'paidamt') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (e.meta_json ->> 'paidamt')::numeric
    ELSE NULL::numeric
  END AS paidamt,
  e.meta_json ->> 'regdate' AS regdate,
  CASE
    WHEN left(e.meta_json ->> 'regdate', 4) ~ '^[0-9]{4}$'
      AND left(e.meta_json ->> 'regdate', 4)::integer >= 1800
    THEN left(e.meta_json ->> 'regdate', 4)::integer
    ELSE NULL::integer
  END AS regyear,
  upper(e.meta_json ->> 'mainnatcode') AS mainnatcode
FROM woocms.cms_content_entries e
WHERE e.id >= :start_id
  AND e.id < :end_id
  AND e.content_model_id = 2
  AND e.deleted_at IS NULL
  AND e.site_id = 1
  AND e.status = 'published'
  AND COALESCE(e.meta_json ->> '_probe', '') <> 'true'
ON CONFLICT DO NOTHING;
