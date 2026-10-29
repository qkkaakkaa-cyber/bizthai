SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_page_seo (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    page_id BIGINT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    seo_keywords VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_page_seo_site_page ON cms_page_seo (site_id, page_id);

INSERT INTO auth_permissions (code, name)
VALUES ('rbac.manage', '用户与权限管理')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code = 'rbac.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
