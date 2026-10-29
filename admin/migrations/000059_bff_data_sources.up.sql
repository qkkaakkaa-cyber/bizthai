SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS bff_data_sources (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    source_code VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    kind VARCHAR(32) NOT NULL,
    base_url VARCHAR(1024) NOT NULL DEFAULT '',
    headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    cache_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cache_ttl_seconds INT NOT NULL DEFAULT 300,
    stale_while_revalidate_seconds INT NOT NULL DEFAULT 300,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, source_code)
);

CREATE INDEX IF NOT EXISTS idx_bff_data_sources_site_enabled
    ON bff_data_sources (site_id, enabled, source_code);
