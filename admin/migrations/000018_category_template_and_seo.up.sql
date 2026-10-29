SET search_path TO woocms, public;

ALTER TABLE cms_categories
  ADD COLUMN IF NOT EXISTS template_key VARCHAR(64) NOT NULL DEFAULT 'category';

CREATE TABLE IF NOT EXISTS cms_category_seo (
    site_id BIGINT NOT NULL DEFAULT 1,
    category_id BIGINT NOT NULL,
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    seo_keywords VARCHAR(255) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, category_id),
    CONSTRAINT fk_cms_category_seo_category FOREIGN KEY (category_id) REFERENCES cms_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cms_category_seo_site_category ON cms_category_seo(site_id, category_id);
CREATE INDEX IF NOT EXISTS idx_cms_categories_template_key ON cms_categories(template_key);
