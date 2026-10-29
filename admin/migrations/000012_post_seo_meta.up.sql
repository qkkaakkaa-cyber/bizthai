SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_post_seo (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description VARCHAR(512) NOT NULL DEFAULT '',
    seo_keywords VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_post_seo_site_post ON cms_post_seo (site_id, post_id);
