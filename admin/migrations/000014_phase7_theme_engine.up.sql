SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_theme_packages (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(128) NOT NULL,
    version VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    root_path TEXT NOT NULL,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    checksum VARCHAR(128) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'installed',
    installed_by BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, version)
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_packages_code_status ON cms_theme_packages (code, status, installed_at DESC);

CREATE TABLE IF NOT EXISTS cms_theme_presets (
    id BIGSERIAL PRIMARY KEY,
    package_id BIGINT NOT NULL REFERENCES cms_theme_packages(id) ON DELETE CASCADE,
    template_key VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    layout_file VARCHAR(255) NOT NULL,
    schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (package_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_presets_package ON cms_theme_presets (package_id, template_key);

CREATE TABLE IF NOT EXISTS cms_theme_activations (
    id BIGSERIAL PRIMARY KEY,
    package_id BIGINT NOT NULL REFERENCES cms_theme_packages(id) ON DELETE RESTRICT,
    theme_code VARCHAR(128) NOT NULL,
    theme_version VARCHAR(64) NOT NULL,
    previous_activation_id BIGINT NULL REFERENCES cms_theme_activations(id) ON DELETE SET NULL,
    activated_by BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_theme_activations_single_active
    ON cms_theme_activations ((is_active))
    WHERE is_active = TRUE;

ALTER TABLE cms_templates
    ADD COLUMN IF NOT EXISTS template_key VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'published',
    ADD COLUMN IF NOT EXISTS theme_code VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS theme_version VARCHAR(64) NOT NULL DEFAULT '';

UPDATE cms_templates SET template_key = code WHERE COALESCE(template_key, '') = '';

CREATE INDEX IF NOT EXISTS idx_cms_templates_template_key_status
    ON cms_templates (site_id, template_key, source_type, status, is_active, updated_at DESC);

ALTER TABLE cms_pages
    ADD COLUMN IF NOT EXISTS template_key VARCHAR(128) NOT NULL DEFAULT 'page_default';

UPDATE cms_pages p
SET template_key = COALESCE(NULLIF(t.code, ''), 'page_default')
FROM cms_templates t
WHERE p.template_id = t.id
  AND COALESCE(p.template_key, '') IN ('', 'page_default');

CREATE INDEX IF NOT EXISTS idx_cms_pages_site_template_key ON cms_pages (site_id, template_key);
