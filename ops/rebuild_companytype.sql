-- 规范化重建 companytype(法人类型, taxonomy_id=2)。
-- 背景:DBD 数据当前法人类型只有"有限公司"(บริษัทจำกัด)一类;旧 term 名是笼统中文"有限责任公司"。
-- 重构:按 jptypedesc(法人类型泰文,稳定粒度)建 term(slug=ctype+md5,与 sync.ensure_term 同口径),
--       补三语译文(已知类型 CASE 映射,未知兜底泰文),重绑企业,并补存量 meta 的 companytypezh/companytypee。
-- 幂等:每次全删重建。只动 companytype(tax2),不碰 province/industry/capital 关联。
BEGIN;

-- 1) 清旧 companytype:关联 / 译文 / term
DELETE FROM woocms.cms_content_entry_terms WHERE taxonomy_id=2;
DELETE FROM woocms.cms_term_translations    WHERE taxonomy_id=2;
DELETE FROM woocms.cms_custom_terms         WHERE taxonomy_id=2;

-- 2) 按企业 jptypedesc 集合建 term(slug=ctype+md5[:10])
INSERT INTO woocms.cms_custom_terms(site_id,taxonomy_id,name,slug,status,sort_order,created_at,updated_at)
SELECT DISTINCT 1,2,jt,'ctype'||left(md5(jt),10),'active',0,now(),now()
FROM (SELECT NULLIF(meta_json->>'jptypedesc','') jt
      FROM woocms.cms_content_entries WHERE content_model_id=2 AND deleted_at IS NULL) s
WHERE jt IS NOT NULL;

-- 3) 三语译文(th=泰文名;en/zh 按已知法人类型映射,未知兜底泰文)
INSERT INTO woocms.cms_term_translations(site_id,taxonomy_id,term_id,locale,name,slug,status,updated_at)
SELECT 1,2,t.id,loc.locale,
  CASE loc.locale
    WHEN 'th' THEN t.name
    WHEN 'en' THEN CASE t.name
        WHEN 'บริษัทจำกัด' THEN 'Company Limited'
        WHEN 'บริษัทมหาชนจำกัด' THEN 'Public Company Limited'
        WHEN 'ห้างหุ้นส่วนจำกัด' THEN 'Limited Partnership'
        WHEN 'ห้างหุ้นส่วนสามัญนิติบุคคล' THEN 'Registered Ordinary Partnership'
        WHEN 'ห้างหุ้นส่วนสามัญ' THEN 'Ordinary Partnership' ELSE t.name END
    ELSE CASE t.name
        WHEN 'บริษัทจำกัด' THEN '有限公司'
        WHEN 'บริษัทมหาชนจำกัด' THEN '大众有限公司'
        WHEN 'ห้างหุ้นส่วนจำกัด' THEN '有限合伙'
        WHEN 'ห้างหุ้นส่วนสามัญนิติบุคคล' THEN '注册普通合伙'
        WHEN 'ห้างหุ้นส่วนสามัญ' THEN '普通合伙' ELSE t.name END
  END, t.slug, 'published', now()
FROM woocms.cms_custom_terms t
CROSS JOIN (VALUES ('th'),('en'),('zh-CN')) AS loc(locale)
WHERE t.taxonomy_id=2;

-- 4) 重绑企业 -> companytype term(按 jptypedesc 精确匹配)
INSERT INTO woocms.cms_content_entry_terms(site_id,entry_id,taxonomy_id,term_id,is_primary,created_at)
SELECT e.site_id, e.id, 2, t.id, false, now()
FROM woocms.cms_content_entries e
JOIN woocms.cms_custom_terms t ON t.taxonomy_id=2 AND t.name = NULLIF(e.meta_json->>'jptypedesc','')
WHERE e.content_model_id=2 AND e.deleted_at IS NULL AND COALESCE(e.meta_json->>'_probe','')<>'true'
ON CONFLICT (entry_id,term_id) DO NOTHING;

-- 5) 存量 meta 补 companytypezh / companytypee
UPDATE woocms.cms_content_entries e
SET meta_json = e.meta_json || jsonb_strip_nulls(jsonb_build_object(
  'companytypee', COALESCE(NULLIF(e.meta_json->>'jptypedesce',''),
    CASE e.meta_json->>'jptypedesc'
      WHEN 'บริษัทจำกัด' THEN 'Company Limited' WHEN 'บริษัทมหาชนจำกัด' THEN 'Public Company Limited'
      WHEN 'ห้างหุ้นส่วนจำกัด' THEN 'Limited Partnership' WHEN 'ห้างหุ้นส่วนสามัญนิติบุคคล' THEN 'Registered Ordinary Partnership'
      WHEN 'ห้างหุ้นส่วนสามัญ' THEN 'Ordinary Partnership' ELSE NULLIF(e.meta_json->>'jptypedesc','') END),
  'companytypezh',
    CASE e.meta_json->>'jptypedesc'
      WHEN 'บริษัทจำกัด' THEN '有限公司' WHEN 'บริษัทมหาชนจำกัด' THEN '大众有限公司'
      WHEN 'ห้างหุ้นส่วนจำกัด' THEN '有限合伙' WHEN 'ห้างหุ้นส่วนสามัญนิติบุคคล' THEN '注册普通合伙'
      WHEN 'ห้างหุ้นส่วนสามัญ' THEN '普通合伙' ELSE NULLIF(e.meta_json->>'typezh','') END
))
WHERE content_model_id=2 AND deleted_at IS NULL AND NULLIF(e.meta_json->>'jptypedesc','') IS NOT NULL;

COMMIT;
