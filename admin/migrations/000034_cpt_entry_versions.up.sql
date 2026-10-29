SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_content_entry_versions (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    entry_id BIGINT NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL,
    published_at TIMESTAMPTZ NULL,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    change_summary VARCHAR(255) NOT NULL DEFAULT '',
    operator_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, entry_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_cms_content_entry_versions_site_entry_ver
    ON cms_content_entry_versions (site_id, entry_id, version_no DESC);
