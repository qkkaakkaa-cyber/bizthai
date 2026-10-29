SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS auth_roles (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_permissions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
    role_id BIGINT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES auth_permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

INSERT INTO auth_roles (code, name)
VALUES
    ('admin', '系统管理员'),
    ('editor', '内容编辑')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_permissions (code, name)
VALUES
    ('dashboard.view', '查看控制台'),
    ('content.read', '查看内容'),
    ('content.write', '编辑内容'),
    ('content.publish', '发布内容'),
    ('*', '超级权限')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code = '*'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'editor' AND p.code IN ('dashboard.view', 'content.read', 'content.write')
ON CONFLICT (role_id, permission_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_auth_user_roles_role_id ON auth_user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_auth_role_permissions_permission_id ON auth_role_permissions(permission_id);
