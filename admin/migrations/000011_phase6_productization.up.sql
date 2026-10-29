SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_templates (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    body_html TEXT NOT NULL DEFAULT '',
    version_no INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    rollback_source_id BIGINT NULL REFERENCES cms_templates(id) ON DELETE SET NULL,
    created_by BIGINT NOT NULL REFERENCES system_users(id),
    updated_by BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code, version_no)
);

CREATE INDEX IF NOT EXISTS idx_cms_templates_site_code ON cms_templates (site_id, code, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_cms_templates_site_active ON cms_templates (site_id, is_active, code);

CREATE TABLE IF NOT EXISTS cms_pages (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    template_id BIGINT NULL REFERENCES cms_templates(id) ON DELETE SET NULL,
    author_id BIGINT NOT NULL REFERENCES system_users(id),
    published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_cms_pages_site_status_updated ON cms_pages (site_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_pages_site_template ON cms_pages (site_id, template_id);
