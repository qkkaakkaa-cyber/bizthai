SET search_path TO woocms, public;

-- 多语言内容 SEO 关键词：与源表 cms_*_seo 的 seo_title / seo_keywords / seo_description 三字段对齐。
-- 既有译文行默认空关键词，前台渲染时会继续回退源语言 SEO，不破坏现有站点。
ALTER TABLE cms_post_translations
    ADD COLUMN IF NOT EXISTS seo_keywords VARCHAR(512) NOT NULL DEFAULT '';

ALTER TABLE cms_page_translations
    ADD COLUMN IF NOT EXISTS seo_keywords VARCHAR(512) NOT NULL DEFAULT '';

ALTER TABLE cms_entry_translations
    ADD COLUMN IF NOT EXISTS seo_keywords VARCHAR(512) NOT NULL DEFAULT '';
