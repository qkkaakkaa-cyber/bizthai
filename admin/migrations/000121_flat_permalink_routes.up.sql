SET search_path TO woocms, public;

-- 全站扁平 SEO URL 索引表。
-- 兼容原则：不改写任何历史 slug / permalink_pattern；启动迁移只为已发布内容生成可选的新扁平 URL。
-- 冲突时保留先写入者，后续由后台工具/人工修正，避免升级老站时因历史重复 slug 阻断启动。
CREATE TABLE IF NOT EXISTS cms_permalink_routes (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    locale VARCHAR(32) NOT NULL DEFAULT '',
    path VARCHAR(512) NOT NULL,
    slug VARCHAR(255) NOT NULL DEFAULT '',
    entity_type VARCHAR(32) NOT NULL,
    entity_id BIGINT NOT NULL,
    model_code VARCHAR(64) NOT NULL DEFAULT '',
    taxonomy_code VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'active', -- active / redirect / disabled
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    redirect_to VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_permalink_routes_site_locale_path
    ON cms_permalink_routes (site_id, locale, path);

CREATE INDEX IF NOT EXISTS idx_cms_permalink_routes_entity
    ON cms_permalink_routes (site_id, entity_type, entity_id, locale, is_primary);

CREATE INDEX IF NOT EXISTS idx_cms_permalink_routes_status
    ON cms_permalink_routes (site_id, status, updated_at DESC);

-- 页面：默认语言/源表 slug → /slug.html
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, status, is_primary)
SELECT p.site_id,
       '',
       '/' || regexp_replace(trim(both '/' from lower(trim(p.slug))), '\.html$', '') || '.html',
       regexp_replace(trim(both '/' from lower(trim(p.slug))), '\.html$', ''),
       'page',
       p.id,
       'active',
       TRUE
FROM cms_pages p
WHERE p.status = 'published'
  AND trim(p.slug) <> ''
  AND trim(both '/' from p.slug) !~ '/'
  AND lower(trim(both '/' from p.slug)) NOT IN ('admin','api','assets','uploads','theme-assets','console','login','logout','healthz','livez','readyz','metrics','sitemap','sitemap.xml','robots','robots.txt','favicon.ico','search','search.html')
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- 页面翻译 slug：locale 维度下 /slug.html。语言前缀由现有 localeMiddleware 负责剥离。
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, status, is_primary)
SELECT t.site_id,
       lower(trim(t.locale)),
       '/' || regexp_replace(trim(both '/' from lower(trim(t.slug))), '\.html$', '') || '.html',
       regexp_replace(trim(both '/' from lower(trim(t.slug))), '\.html$', ''),
       'page',
       t.page_id,
       'active',
       TRUE
FROM cms_page_translations t
JOIN cms_pages p ON p.id = t.page_id AND p.site_id = t.site_id
WHERE p.status = 'published'
  AND t.translation_status = 'published'
  AND trim(t.locale) <> ''
  AND trim(t.slug) <> ''
  AND trim(both '/' from t.slug) !~ '/'
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- 文章：/slug.html
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, status, is_primary)
SELECT p.site_id,
       '',
       '/' || regexp_replace(lower(trim(p.slug)), '\.html$', '') || '.html',
       regexp_replace(lower(trim(p.slug)), '\.html$', ''),
       'post',
       p.id,
       'active',
       TRUE
FROM cms_posts p
WHERE p.status = 'published'
  AND p.deleted_at IS NULL
  AND trim(p.slug) <> ''
  AND lower(trim(p.slug)) NOT IN ('admin','api','assets','uploads','theme-assets','console','login','logout','healthz','livez','readyz','metrics','sitemap','sitemap.xml','robots','robots.txt','favicon.ico','search','search.html')
ON CONFLICT (site_id, locale, path) DO NOTHING;

INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, status, is_primary)
SELECT t.site_id,
       lower(trim(t.locale)),
       '/' || regexp_replace(lower(trim(t.slug)), '\.html$', '') || '.html',
       regexp_replace(lower(trim(t.slug)), '\.html$', ''),
       'post',
       t.post_id,
       'active',
       TRUE
FROM cms_post_translations t
JOIN cms_posts p ON p.id = t.post_id AND p.site_id = t.site_id
WHERE p.status = 'published'
  AND p.deleted_at IS NULL
  AND t.translation_status = 'published'
  AND trim(t.locale) <> ''
  AND trim(t.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- 文章分类/标签：/slug.html
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, taxonomy_code, status, is_primary)
SELECT c.site_id, '', '/' || lower(trim(c.slug)) || '.html', lower(trim(c.slug)), 'category', c.id, 'category', 'active', TRUE
FROM cms_categories c
WHERE c.deleted_at IS NULL AND trim(c.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, taxonomy_code, status, is_primary)
SELECT t.site_id, '', '/' || lower(trim(t.slug)) || '.html', lower(trim(t.slug)), 'tag', t.id, 'tag', 'active', TRUE
FROM cms_tags t
WHERE t.deleted_at IS NULL AND trim(t.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- CPT 模型归档：/model-slug.html；CPT 详情默认用 {model_slug}-{entry_slug}.html，减少与页面/文章冲突。
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, model_code, status, is_primary)
SELECT m.site_id, '', '/' || lower(trim(m.slug)) || '.html', lower(trim(m.slug)), 'cpt_archive', m.id, m.code, 'active', TRUE
FROM cms_content_models m
WHERE m.status = 'active' AND m.public_status = TRUE AND m.has_archive = TRUE AND trim(m.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, model_code, status, is_primary)
SELECT e.site_id,
       '',
       '/' || lower(trim(m.slug)) || '-' || lower(trim(e.slug)) || '.html',
       lower(trim(m.slug)) || '-' || lower(trim(e.slug)),
       'cpt_entry',
       e.id,
       m.code,
       'active',
       TRUE
FROM cms_content_entries e
JOIN cms_content_models m ON m.id = e.content_model_id AND m.site_id = e.site_id
WHERE e.status = 'published'
  AND e.deleted_at IS NULL
  AND m.status = 'active'
  AND m.public_status = TRUE
  AND trim(m.slug) <> ''
  AND trim(e.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, model_code, status, is_primary)
SELECT t.site_id,
       lower(trim(t.locale)),
       '/' || lower(trim(m.slug)) || '-' || regexp_replace(lower(trim(t.slug)), '\.html$', '') || '.html',
       lower(trim(m.slug)) || '-' || regexp_replace(lower(trim(t.slug)), '\.html$', ''),
       'cpt_entry',
       t.entry_id,
       m.code,
       'active',
       TRUE
FROM cms_entry_translations t
JOIN cms_content_entries e ON e.id = t.entry_id AND e.site_id = t.site_id
JOIN cms_content_models m ON m.id = e.content_model_id AND m.site_id = e.site_id
WHERE e.status = 'published'
  AND e.deleted_at IS NULL
  AND m.status = 'active'
  AND m.public_status = TRUE
  AND t.translation_status = 'published'
  AND trim(t.locale) <> ''
  AND trim(t.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- CPT 术语：/{taxonomy-slug}-{term-slug}.html
INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, taxonomy_code, status, is_primary)
SELECT term.site_id,
       '',
       '/' || lower(trim(tax.slug)) || '-' || lower(trim(term.slug)) || '.html',
       lower(trim(tax.slug)) || '-' || lower(trim(term.slug)),
       'cpt_term',
       term.id,
       tax.code,
       'active',
       TRUE
FROM cms_custom_terms term
JOIN cms_custom_taxonomies tax ON tax.id = term.taxonomy_id AND tax.site_id = term.site_id
WHERE term.status = 'active'
  AND tax.status = 'active'
  AND trim(tax.slug) <> ''
  AND trim(term.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;

INSERT INTO cms_permalink_routes (site_id, locale, path, slug, entity_type, entity_id, taxonomy_code, status, is_primary)
SELECT tr.site_id,
       lower(trim(tr.locale)),
       '/' || lower(trim(tax.slug)) || '-' || regexp_replace(lower(trim(tr.slug)), '\.html$', '') || '.html',
       lower(trim(tax.slug)) || '-' || regexp_replace(lower(trim(tr.slug)), '\.html$', ''),
       'cpt_term',
       tr.term_id,
       tax.code,
       'active',
       TRUE
FROM cms_term_translations tr
JOIN cms_custom_terms term ON term.id = tr.term_id AND term.site_id = tr.site_id
JOIN cms_custom_taxonomies tax ON tax.id = term.taxonomy_id AND tax.site_id = term.site_id
WHERE term.status = 'active'
  AND tax.status = 'active'
  AND tr.status = 'published'
  AND trim(tr.locale) <> ''
  AND trim(tr.slug) <> ''
ON CONFLICT (site_id, locale, path) DO NOTHING;
