-- 存量回填:给已入库 thaicompany 企业的 meta_json 补三语扁平字段(provincezh/addresszh 等)。
-- 从现有 meta + cms_term_translations(zh-CN)派生,不重取 DBD。与 sync/mapping.py 逻辑一致(新入库走 mapping,存量走此 SQL)。
-- 幂等:meta_json || 覆盖同名键。只加字段,不动 raw/主表/关联。
-- 县/分区中文用英文兜底(产品决策);公司名中文不补。
BEGIN;
WITH calc AS (
  SELECT e.id,
    ptz.name AS provincezh,
    otz.name AS objzh
  FROM woocms.cms_content_entries e
  LEFT JOIN woocms.cms_custom_terms pt
    ON pt.taxonomy_id=1 AND pt.parent_id IS NULL AND pt.name = NULLIF(e.meta_json->>'province','')
  LEFT JOIN woocms.cms_term_translations ptz
    ON ptz.term_id=pt.id AND ptz.locale='zh-CN'
  LEFT JOIN woocms.cms_term_translations otz
    ON otz.taxonomy_id=3 AND otz.locale='zh-CN'
   AND regexp_replace(otz.slug,'^.*-','') = NULLIF(e.meta_json->>'setupobjcode','')
  WHERE e.content_model_id=2 AND e.deleted_at IS NULL
    AND COALESCE(e.meta_json->>'_probe','')<>'true'
)
UPDATE woocms.cms_content_entries e
SET meta_json = e.meta_json || jsonb_strip_nulls(jsonb_build_object(
  'provincezh',  COALESCE(c.provincezh, NULLIF(e.meta_json->>'provincee',''), e.meta_json->>'province'),
  'ampurdesczh', COALESCE(NULLIF(e.meta_json->>'ampurdesce',''), e.meta_json->>'ampurdesc'),
  'tumbondesczh',COALESCE(NULLIF(e.meta_json->>'tumbondesce',''), e.meta_json->>'tumbondesc'),
  'businesstypedesce', CASE e.meta_json->>'businesstypedesc'
      WHEN 'บริการ' THEN 'Service' WHEN 'ขายส่ง' THEN 'Wholesale' WHEN 'ผลิต' THEN 'Manufacturing'
      WHEN 'ขายปลีก' THEN 'Retail' WHEN 'อื่นๆ' THEN 'Others' ELSE NULLIF(e.meta_json->>'businesstypedesce','') END,
  'businesstypedesczh', CASE e.meta_json->>'businesstypedesc'
      WHEN 'บริการ' THEN '服务' WHEN 'ขายส่ง' THEN '批发' WHEN 'ผลิต' THEN '制造'
      WHEN 'ขายปลีก' THEN '零售' WHEN 'อื่นๆ' THEN '其他' ELSE NULLIF(e.meta_json->>'businesstypedesc','') END,
  'setupobjdesczh', COALESCE(c.objzh, NULLIF(e.meta_json->>'setupobjdesce',''), e.meta_json->>'setupobjdesc'),
  'addresszh', NULLIF(trim(both ' ' from concat_ws(' ',
      CASE WHEN COALESCE(e.meta_json->>'addresse','') ~ '[0-9]'
           THEN e.meta_json->>'addresse'
           ELSE COALESCE(NULLIF(e.meta_json->>'address',''), e.meta_json->>'addresse') END,
      NULLIF(e.meta_json->>'tumbondesce',''),
      NULLIF(e.meta_json->>'ampurdesce',''),
      COALESCE(c.provincezh, NULLIF(e.meta_json->>'provincee',''), e.meta_json->>'province'),
      NULLIF(e.meta_json->>'zipcode',''))), '')
))
FROM calc c
WHERE e.id = c.id;
COMMIT;
