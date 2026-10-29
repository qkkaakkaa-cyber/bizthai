SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS media_files (
    id BIGSERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    path VARCHAR(512) NOT NULL UNIQUE,
    mime_type VARCHAR(128) NOT NULL,
    size BIGINT NOT NULL,
    uploader_id BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_menus (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    label VARCHAR(128) NOT NULL,
    url VARCHAR(512) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_permissions_code_key'
          AND conrelid = 'auth_permissions'::regclass
    ) THEN
        ALTER TABLE auth_permissions
            ADD CONSTRAINT auth_permissions_code_key UNIQUE (code);
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'system_settings_pkey'
          AND conrelid = 'system_settings'::regclass
    ) THEN
        ALTER TABLE system_settings
            ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);
    END IF;
END $$;

INSERT INTO auth_permissions (code, name)
VALUES
    ('media.read', '查看媒体库'),
    ('media.write', '上传媒体文件'),
    ('settings.write', '修改系统设置'),
    ('menu.write', '修改站点菜单')
ON CONFLICT (code) DO NOTHING;

DELETE FROM auth_role_permissions a
USING auth_role_permissions b
WHERE a.role_id = b.role_id
  AND a.permission_id = b.permission_id
  AND a.ctid < b.ctid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auth_role_permissions_pkey'
          AND conrelid = 'auth_role_permissions'::regclass
    ) THEN
        ALTER TABLE auth_role_permissions
            ADD CONSTRAINT auth_role_permissions_pkey PRIMARY KEY (role_id, permission_id);
    END IF;
END $$;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'editor' AND p.code IN ('media.read', 'media.write')
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE
    default_site_id BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'system_settings'
          AND column_name = 'site_id'
    ) THEN
        SELECT id INTO default_site_id FROM cms_sites ORDER BY id LIMIT 1;
        IF default_site_id IS NOT NULL THEN
            INSERT INTO system_settings (site_id, key, value)
            VALUES (default_site_id, 'site_title', 'WooCMS')
            ON CONFLICT (site_id, key) DO NOTHING;
        END IF;
    ELSE
        INSERT INTO system_settings (key, value)
        VALUES ('site_title', 'WooCMS')
        ON CONFLICT (key) DO NOTHING;
    END IF;
END $$;

DO $$
DECLARE
    default_site_id BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'site_menus'
          AND column_name = 'site_id'
    ) THEN
        SELECT id INTO default_site_id FROM cms_sites ORDER BY id LIMIT 1;
        IF default_site_id IS NOT NULL THEN
            INSERT INTO site_menus (site_id, name, label, url, sort_order, enabled)
            SELECT default_site_id, item.name, item.label, item.url, item.sort_order, item.enabled
            FROM (VALUES
                ('main', '首页', '/', 10, TRUE),
                ('main', '管理后台', '/admin/login', 20, TRUE)
            ) AS item(name, label, url, sort_order, enabled)
            WHERE NOT EXISTS (
                SELECT 1 FROM site_menus existing
                WHERE existing.site_id = default_site_id
                  AND existing.name = item.name
                  AND existing.url = item.url
            );
        END IF;
    ELSE
        INSERT INTO site_menus (name, label, url, sort_order, enabled)
        VALUES
            ('main', '首页', '/', 10, TRUE),
            ('main', '管理后台', '/admin/login', 20, TRUE)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_media_files_uploader_id ON media_files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_site_menus_name_sort ON site_menus(name, sort_order);
