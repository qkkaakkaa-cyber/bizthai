-- 泰国企业(thaicompany, content_model_id=2)区域 + 业务分类自动关联
-- (1) 区域:从 meta_json 的 province(府泰文名)/ ampurcode(县码)/ tumboncode(分区码)
--     解析并写入 province 分类法(taxonomy_id=1)。
-- (2) 业务分类:从 raw.profile.setupObjType 的 objGrpCode(大类)/ objCode(TSIC经营目的)
--     解析并写入 industry 分类法(taxonomy_id=3)。
-- (3) 资本来源:依据 raw.committees[].ntCode(董事国籍)+ mainnatcode 兜底,
--     写入 capital 分类法(taxonomy_id=4):纯泰资 / 外资企业(+各国家,可多选)。
-- 幂等:ON CONFLICT(entry_id,term_id) DO NOTHING。最深一级标 is_primary。
-- 全量幂等(对当前数据量为毫秒级):不能按"已有府关联"跳过,
-- 因为外部进程只建府级,跳过会导致县/分区永远补不上。
BEGIN;

-- 分类法 1 的 term + 层级 + 末段官方编码
CREATE TEMP TABLE _t ON COMMIT DROP AS
SELECT id AS term_id, parent_id, name,
  (regexp_replace(slug,'^.*-',''))::text AS code,
  CASE WHEN parent_id IS NULL THEN 1
       WHEN parent_id IN (SELECT id FROM woocms.cms_custom_terms WHERE parent_id IS NULL AND taxonomy_id=1) THEN 2
       ELSE 3 END AS lvl
FROM woocms.cms_custom_terms WHERE taxonomy_id=1;
CREATE INDEX ON _t(lvl, code);
CREATE INDEX ON _t(lvl, name);

-- model=2、未删除、非探针的企业,解析三级 term id
CREATE TEMP TABLE _r ON COMMIT DROP AS
SELECT e.id AS entry_id, e.site_id,
  p.term_id AS prov_tid, d.term_id AS dist_tid, s.term_id AS sub_tid
FROM woocms.cms_content_entries e
LEFT JOIN _t p ON p.lvl=1 AND p.name=NULLIF(e.meta_json->>'province','')
LEFT JOIN _t d ON d.lvl=2 AND d.code=NULLIF(e.meta_json->>'ampurcode','')
LEFT JOIN _t s ON s.lvl=3 AND s.code=NULLIF(e.meta_json->>'tumboncode','')
WHERE e.content_model_id=2 AND e.deleted_at IS NULL
  AND COALESCE(e.meta_json->>'_probe','')<>'true';

INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,1,prov_tid,(dist_tid IS NULL AND sub_tid IS NULL),now() FROM _r WHERE prov_tid IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,1,dist_tid,(sub_tid IS NULL),now() FROM _r WHERE dist_tid IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,1,sub_tid,true,now() FROM _r WHERE sub_tid IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;

-- ===== 业务分类(industry, taxonomy_id=3, TSIC 经营目的)=====
-- term 末段:大类 slug=tsic-<字母>;经营目的 slug=...-<5位码>。按原始 raw 字段匹配。
CREATE TEMP TABLE _i ON COMMIT DROP AS
SELECT id AS term_id, parent_id, slug,
  lower(regexp_replace(slug,'^.*-','')) AS code
FROM woocms.cms_custom_terms WHERE taxonomy_id=3;
CREATE INDEX ON _i(code);
CREATE INDEX ON _i(slug);

CREATE TEMP TABLE _ri ON COMMIT DROP AS
SELECT e.id AS entry_id, e.site_id,
  obj.term_id AS obj_tid, sec.term_id AS sec_tid
FROM woocms.cms_content_entries e
LEFT JOIN _i obj ON obj.parent_id IS NOT NULL
   AND obj.code = lower(NULLIF(e.meta_json->'raw'->'profile'->'setupObjType'->>'objCode',''))
LEFT JOIN _i sec ON sec.parent_id IS NULL
   AND sec.slug = 'tsic-'||lower(NULLIF(e.meta_json->'raw'->'profile'->'setupObjType'->>'objGrpCode',''))
WHERE e.content_model_id=2 AND e.deleted_at IS NULL
  AND COALESCE(e.meta_json->>'_probe','')<>'true';

-- 仅清除与当前大类/细类不一致的旧行业关联，再补入当前关联。仅 ON CONFLICT 插入会永久
-- 保留旧大类，上游经营代码发生变化后就会同时挂在多个互相冲突的行业下。
DELETE FROM woocms.cms_content_entry_terms et
USING _ri r
WHERE et.entry_id=r.entry_id AND et.taxonomy_id=3
  AND et.term_id IS DISTINCT FROM r.sec_tid
  AND et.term_id IS DISTINCT FROM r.obj_tid;

INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,3,sec_tid,false,now() FROM _ri WHERE sec_tid IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,3,obj_tid,true,now() FROM _ri WHERE obj_tid IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;

-- ===== 资本来源(capital, taxonomy_id=4)=====
-- 依据董事(committees[].ntCode)国籍 + mainnatcode 兜底。
-- 有外籍董事 或 mainnatcode=FRN -> 外资企业(+各国家);否则(含无数据)-> 纯泰资企业。
-- 注:股东 jpNations 在源数据中仅汇总占位(无分国别明细),故国别只取董事。
CREATE TEMP TABLE _cap ON COMMIT DROP AS
SELECT e.id AS entry_id, e.site_id,
  (SELECT array_agg(DISTINCT lower(c->>'ntCode'))
     FROM jsonb_array_elements(COALESCE(e.meta_json->'raw'->'committees','[]'::jsonb)) c
     WHERE c->>'ntCode' NOT IN ('TH','XX') AND NULLIF(c->>'ntCode','') IS NOT NULL) AS fcodes,
  (COALESCE(e.meta_json->>'mainnatcode','')='FRN') AS frn
FROM woocms.cms_content_entries e
WHERE e.content_model_id=2 AND e.deleted_at IS NULL AND COALESCE(e.meta_json->>'_probe','')<>'true';

-- 外资顶层
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,4,(SELECT id FROM woocms.cms_custom_terms WHERE taxonomy_id=4 AND slug='foreign-capital'),true,now()
FROM _cap WHERE (fcodes IS NOT NULL AND array_length(fcodes,1)>0) OR frn
ON CONFLICT (entry_id,term_id) DO NOTHING;
-- 纯泰资顶层(其余全部,含无国籍数据)
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT site_id,entry_id,4,(SELECT id FROM woocms.cms_custom_terms WHERE taxonomy_id=4 AND slug='thai-capital'),true,now()
FROM _cap WHERE NOT ((fcodes IS NOT NULL AND array_length(fcodes,1)>0) OR frn)
ON CONFLICT (entry_id,term_id) DO NOTHING;
-- 各外资国家(展开董事国籍码,按 slug=国码 匹配 外资企业 下的国家 term)
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT c.site_id, c.entry_id, 4, ct.id, false, now()
FROM _cap c
CROSS JOIN LATERAL unnest(c.fcodes) AS fc(code)
JOIN woocms.cms_custom_terms ct
  ON ct.taxonomy_id=4 AND ct.slug=fc.code
  AND ct.parent_id=(SELECT id FROM woocms.cms_custom_terms WHERE taxonomy_id=4 AND slug='foreign-capital')
WHERE c.fcodes IS NOT NULL
ON CONFLICT (entry_id,term_id) DO NOTHING;

COMMIT;
