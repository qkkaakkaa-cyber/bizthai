-- 回填 woocms.cms_entry_translations(thaicompany 企业三语条目档案)。
-- 路线A:前端实际走企业 meta 扁平字段;此表为权威档案 + 后台可视化 + 未来 API locale 支持。
-- 公司名三语来自 meta(jpname=泰、jpnamee=英、zh-CN 本期兜底泰文,公司名中文不强求)。
-- 幂等:ON CONFLICT(entry_id,locale)。只写译文旁表,不动主表/关联。
-- 可单独跑,或挂 associate_regions 同款 timer。
BEGIN;
INSERT INTO woocms.cms_entry_translations
  (entry_id, site_id, locale, title, slug, summary, body,
   translation_status, seo_title, seo_description, source_hash, created_at, updated_at)
SELECT e.id, e.site_id, loc.locale,
  CASE loc.locale
    WHEN 'en' THEN COALESCE(NULLIF(e.meta_json->>'jpnamee',''), NULLIF(e.meta_json->>'jpname',''), e.title, e.slug)
    ELSE            COALESCE(NULLIF(e.meta_json->>'jpname',''), e.title, e.slug)   -- th / zh-CN:公司名兜底泰文
  END,
  e.slug, COALESCE(e.summary,''), '',
  'published', '', '', '', now(), now()
FROM woocms.cms_content_entries e
CROSS JOIN (VALUES ('th'),('en'),('zh-CN')) AS loc(locale)
WHERE e.content_model_id=2 AND e.deleted_at IS NULL
  AND COALESCE(e.meta_json->>'_probe','')<>'true'
ON CONFLICT (entry_id, locale) DO UPDATE SET title=EXCLUDED.title, slug=EXCLUDED.slug, updated_at=now();
COMMIT;
