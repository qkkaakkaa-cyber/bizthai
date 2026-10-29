CREATE TABLE IF NOT EXISTS cms_admin_menus (
    id BIGSERIAL PRIMARY KEY,
    parent_id BIGINT DEFAULT 0,
    site_id BIGINT NULL,
    namespace VARCHAR(32) DEFAULT 'admin',
    scope_type VARCHAR(32) DEFAULT 'platform',
    menu_code VARCHAR(100) NOT NULL,
    menu_name VARCHAR(100) NOT NULL,
    menu_type VARCHAR(32) DEFAULT 'route',
    route_name VARCHAR(100),
    route_path VARCHAR(255),
    external_url VARCHAR(500),
    open_mode VARCHAR(32) DEFAULT 'internal',
    icon VARCHAR(100),
    permission_code VARCHAR(100),
    sort_no INT DEFAULT 0,
    visible BOOLEAN DEFAULT true,
    enabled BOOLEAN DEFAULT true,
    is_system BOOLEAN DEFAULT false,
    system_key VARCHAR(100),
    remark VARCHAR(255),
    meta_json JSONB,
    created_by BIGINT,
    updated_by BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_cms_admin_menus_site_id ON cms_admin_menus(site_id);
CREATE INDEX IF NOT EXISTS idx_cms_admin_menus_parent_id ON cms_admin_menus(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_admin_menus_code_scope ON cms_admin_menus(namespace, scope_type, COALESCE(site_id, 0), menu_code) WHERE deleted_at IS NULL;
