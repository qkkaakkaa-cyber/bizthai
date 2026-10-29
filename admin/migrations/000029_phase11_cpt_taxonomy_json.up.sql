SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_content_models (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    public_status BOOLEAN NOT NULL DEFAULT TRUE,
    has_archive BOOLEAN NOT NULL DEFAULT TRUE,
    supports_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code),
    UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_custom_taxonomies (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    hierarchical BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code),
    UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_content_model_taxonomies (
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    content_model_id BIGINT NOT NULL REFERENCES cms_content_models(id) ON DELETE CASCADE,
    taxonomy_id BIGINT NOT NULL REFERENCES cms_custom_taxonomies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (content_model_id, taxonomy_id)
);

CREATE TABLE IF NOT EXISTS cms_custom_terms (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    taxonomy_id BIGINT NOT NULL REFERENCES cms_custom_taxonomies(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    parent_id BIGINT NULL REFERENCES cms_custom_terms(id) ON DELETE SET NULL,
    sort_order INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, taxonomy_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_content_entries (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    content_model_id BIGINT NOT NULL REFERENCES cms_content_models(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(128) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ NULL,
    author_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, content_model_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_content_entry_terms (
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    entry_id BIGINT NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    taxonomy_id BIGINT NOT NULL REFERENCES cms_custom_taxonomies(id) ON DELETE CASCADE,
    term_id BIGINT NOT NULL REFERENCES cms_custom_terms(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entry_id, term_id)
);

CREATE TABLE IF NOT EXISTS cms_field_groups (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL,
    title VARCHAR(128) NOT NULL,
    content_model_id BIGINT NOT NULL REFERENCES cms_content_models(id) ON DELETE CASCADE,
    rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code)
);

CREATE TABLE IF NOT EXISTS cms_field_defs (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL REFERENCES cms_field_groups(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cms_content_models_site_status ON cms_content_models (site_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_custom_taxonomies_site_status ON cms_custom_taxonomies (site_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_content_model_taxonomies_taxonomy ON cms_content_model_taxonomies (taxonomy_id, content_model_id);
CREATE INDEX IF NOT EXISTS idx_cms_custom_terms_taxonomy_slug ON cms_custom_terms (taxonomy_id, slug);
CREATE INDEX IF NOT EXISTS idx_cms_custom_terms_site_taxonomy_status ON cms_custom_terms (site_id, taxonomy_id, status, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_cms_content_entries_site_model_status ON cms_content_entries (site_id, content_model_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_content_entries_site_model_slug ON cms_content_entries (site_id, content_model_id, slug);
CREATE INDEX IF NOT EXISTS idx_cms_content_entry_terms_taxonomy_term ON cms_content_entry_terms (taxonomy_id, term_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_cms_field_groups_site_model_status ON cms_field_groups (site_id, content_model_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_field_defs_group_sort ON cms_field_defs (group_id, sort_order, id);

INSERT INTO auth_permissions (code, name)
VALUES
    ('manage_content_model', '管理内容模型'),
    ('manage_taxonomy', '管理自定义分类法'),
    ('manage_field_group', '管理字段组')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code IN ('manage_content_model', 'manage_taxonomy', 'manage_field_group')
ON CONFLICT (role_id, permission_id) DO NOTHING;
