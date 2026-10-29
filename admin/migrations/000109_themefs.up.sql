SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_theme_file_versions (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    theme_code VARCHAR(128) NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_by BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_file_versions_lookup
    ON cms_theme_file_versions (site_id, theme_code, path, created_at DESC);

