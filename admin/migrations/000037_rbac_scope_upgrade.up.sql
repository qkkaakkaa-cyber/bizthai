SET search_path TO woocms, public;

ALTER TABLE IF EXISTS auth_roles
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_editable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS is_deletable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS site_scope_mode VARCHAR(16) NOT NULL DEFAULT 'global',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE auth_roles
SET type = CASE WHEN code IN ('admin', 'editor', 'demo_viewer') THEN 'system' ELSE 'custom' END,
    is_builtin = CASE WHEN code IN ('admin', 'editor', 'demo_viewer') THEN TRUE ELSE is_builtin END,
    is_editable = CASE WHEN code = 'admin' THEN FALSE ELSE is_editable END,
    is_deletable = CASE WHEN code IN ('admin', 'editor') THEN FALSE ELSE is_deletable END,
    updated_at = NOW();

ALTER TABLE IF EXISTS auth_permissions
    ADD COLUMN IF NOT EXISTS label VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS perm_group VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS domain VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS resource VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS action VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(16) NOT NULL DEFAULT 'low',
    ADD COLUMN IF NOT EXISTS supported_scopes JSONB NOT NULL DEFAULT '["site"]'::jsonb,
    ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE auth_permissions
SET label = CASE WHEN label = '' THEN name ELSE label END,
    perm_group = CASE
        WHEN perm_group <> '' THEN perm_group
        WHEN code LIKE 'dashboard.%' THEN '控制台'
        WHEN code LIKE 'content.%' OR code IN ('manage_content_model', 'manage_taxonomy', 'manage_field_group') THEN '内容'
        WHEN code LIKE 'media.%' THEN '媒体'
        WHEN code LIKE 'system.user.%' OR code LIKE 'system.role.%' OR code = 'rbac.manage' THEN '用户与角色'
        WHEN code LIKE 'system.audit.%' OR code = 'audit.read' THEN '审计'
        WHEN code LIKE 'system.settings.%' OR code = 'settings.write' THEN '系统设置'
        WHEN code LIKE 'system.theme.%' THEN '主题'
        ELSE '其他'
    END,
    domain = CASE WHEN domain = '' THEN split_part(code, '.', 1) ELSE domain END,
    resource = CASE WHEN resource = '' THEN split_part(code, '.', 2) ELSE resource END,
    action = CASE WHEN action = '' THEN split_part(code, '.', 3) ELSE action END,
    updated_at = NOW();

ALTER TABLE IF EXISTS auth_role_permissions
    ADD COLUMN IF NOT EXISTS scope_level VARCHAR(16) NOT NULL DEFAULT 'site',
    ADD COLUMN IF NOT EXISTS scope_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS extra_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE auth_role_permissions
SET scope_level = CASE WHEN scope_level IN ('self', 'site', 'all') THEN scope_level ELSE 'site' END,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS auth_user_role_bindings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    site_id BIGINT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_user_role_bindings_global
    ON auth_user_role_bindings (user_id, role_id)
    WHERE site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_user_role_bindings_site
    ON auth_user_role_bindings (user_id, role_id, site_id)
    WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_user_role_bindings_site_user
    ON auth_user_role_bindings (site_id, user_id, role_id);

INSERT INTO auth_user_role_bindings (user_id, role_id, site_id, created_at, updated_at)
SELECT ur.user_id, ur.role_id, NULL, ur.created_at, NOW()
FROM auth_user_roles ur
ON CONFLICT (user_id, role_id) WHERE site_id IS NULL DO NOTHING;

INSERT INTO auth_user_role_bindings (user_id, role_id, site_id, created_at, updated_at)
SELECT usr.user_id, usr.role_id, usr.site_id, usr.created_at, NOW()
FROM auth_user_site_roles usr
ON CONFLICT (user_id, role_id, site_id) WHERE site_id IS NOT NULL DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_user_permission_overrides (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    permission_code VARCHAR(128) NOT NULL,
    effect VARCHAR(16) NOT NULL DEFAULT 'allow',
    scope_level VARCHAR(16) NOT NULL DEFAULT 'site',
    scope_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_auth_user_permission_overrides_effect CHECK (effect IN ('allow')),
    CONSTRAINT chk_auth_user_permission_overrides_scope CHECK (scope_level IN ('self', 'site', 'all'))
);

CREATE INDEX IF NOT EXISTS idx_auth_user_permission_overrides_user
    ON auth_user_permission_overrides (user_id, permission_code, scope_level);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    action VARCHAR(128) NOT NULL,
    before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    site_id BIGINT NULL REFERENCES cms_sites(id) ON DELETE SET NULL,
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_target
    ON auth_audit_logs (target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_permission_aliases (
    id BIGSERIAL PRIMARY KEY,
    legacy_code VARCHAR(128) NOT NULL,
    canonical_code VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (legacy_code, canonical_code)
);

INSERT INTO auth_permission_aliases (legacy_code, canonical_code)
VALUES
    ('dashboard.view', 'dashboard.dashboard.view'),
    ('content.read', 'content.article.read'),
    ('content.read', 'content.page.read'),
    ('content.read', 'content.product.read'),
    ('content.read', 'content.model.read'),
    ('content.read', 'content.taxonomy.read'),
    ('content.read', 'content.field_group.read'),
    ('content.write', 'content.article.create'),
    ('content.write', 'content.article.update'),
    ('content.write', 'content.page.create'),
    ('content.write', 'content.page.update'),
    ('content.write', 'content.product.create'),
    ('content.write', 'content.product.update'),
    ('content.write', 'content.model.update'),
    ('content.write', 'content.taxonomy.update'),
    ('content.write', 'content.field_group.update'),
    ('content.write', 'content.menu.update'),
    ('content.publish', 'content.article.submit'),
    ('content.publish', 'content.article.review'),
    ('content.publish', 'content.article.publish'),
    ('content.publish', 'content.page.publish'),
    ('content.publish', 'content.product.publish'),
    ('media.read', 'media.asset.read'),
    ('media.write', 'media.asset.upload'),
    ('media.write', 'media.asset.update'),
    ('media.write', 'media.asset.delete'),
    ('settings.write', 'system.settings.update'),
    ('settings.write', 'system.theme.update'),
    ('menu.write', 'content.menu.update'),
    ('audit.read', 'system.audit.read'),
    ('rbac.manage', 'system.user.read'),
    ('rbac.manage', 'system.user.assign_role'),
    ('rbac.manage', 'system.role.read'),
    ('rbac.manage', 'system.role.assign'),
    ('manage_content_model', 'content.model.update'),
    ('manage_taxonomy', 'content.taxonomy.update'),
    ('manage_field_group', 'content.field_group.update')
ON CONFLICT (legacy_code, canonical_code) DO NOTHING;

INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action, risk_level, supported_scopes, dependencies, is_builtin, created_at, updated_at)
VALUES
    ('dashboard.dashboard.view', '控制台访问', '查看控制台', '访问管理后台控制台', '控制台', 'dashboard', 'dashboard', 'view', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.read', '查看用户', '查看用户', '查看用户列表与详情', '用户与角色', 'system', 'user', 'read', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.create', '创建用户', '创建用户', '创建后台用户账号', '用户与角色', 'system', 'user', 'create', 'high', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.update', '更新用户', '更新用户', '编辑用户资料与状态', '用户与角色', 'system', 'user', 'update', 'high', '["site","all"]'::jsonb, '["system.user.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.disable', '停用用户', '停用用户', '停用后台用户账号', '用户与角色', 'system', 'user', 'disable', 'high', '["site","all"]'::jsonb, '["system.user.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.delete', '删除用户', '删除用户', '删除后台用户账号', '用户与角色', 'system', 'user', 'delete', 'critical', '["site","all"]'::jsonb, '["system.user.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.user.assign_role', '分配用户角色', '分配用户角色', '为用户分配或移除角色', '用户与角色', 'system', 'user', 'assign_role', 'critical', '["site","all"]'::jsonb, '["system.user.read","system.role.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.role.read', '查看角色', '查看角色', '查看角色列表和详情', '用户与角色', 'system', 'role', 'read', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.role.create', '创建角色', '创建角色', '创建自定义角色', '用户与角色', 'system', 'role', 'create', 'high', '["site","all"]'::jsonb, '["system.role.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.role.update', '更新角色', '更新角色', '编辑角色元信息', '用户与角色', 'system', 'role', 'update', 'high', '["site","all"]'::jsonb, '["system.role.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.role.delete', '删除角色', '删除角色', '删除自定义角色', '用户与角色', 'system', 'role', 'delete', 'critical', '["site","all"]'::jsonb, '["system.role.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.role.assign', '配置角色权限', '配置角色权限', '调整角色权限矩阵', '用户与角色', 'system', 'role', 'assign', 'critical', '["site","all"]'::jsonb, '["system.role.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.audit.read', '查看审计日志', '查看审计日志', '查看权限与账户审计日志', '审计', 'system', 'audit', 'read', 'high', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.settings.read', '查看系统设置', '查看系统设置', '查看系统设置页面', '系统设置', 'system', 'settings', 'read', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.settings.update', '更新系统设置', '更新系统设置', '更新系统级配置', '系统设置', 'system', 'settings', 'update', 'critical', '["site","all"]'::jsonb, '["system.settings.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('media.asset.read', '查看媒体', '查看媒体', '查看媒体资源', '媒体', 'media', 'asset', 'read', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('media.asset.upload', '上传媒体', '上传媒体', '上传媒体资源', '媒体', 'media', 'asset', 'upload', 'medium', '["self","site","all"]'::jsonb, '["media.asset.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('media.asset.update', '编辑媒体', '编辑媒体', '编辑媒体元信息', '媒体', 'media', 'asset', 'update', 'medium', '["self","site","all"]'::jsonb, '["media.asset.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('media.asset.delete', '删除媒体', '删除媒体', '删除媒体资源', '媒体', 'media', 'asset', 'delete', 'high', '["self","site","all"]'::jsonb, '["media.asset.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.read', '查看文章', '查看文章', '查看文章内容', '内容', 'content', 'article', 'read', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.create', '创建文章', '创建文章', '创建文章草稿', '内容', 'content', 'article', 'create', 'medium', '["self","site","all"]'::jsonb, '["content.article.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.update', '编辑文章', '编辑文章', '编辑文章内容', '内容', 'content', 'article', 'update', 'medium', '["self","site","all"]'::jsonb, '["content.article.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.submit', '提交审核', '提交审核', '提交文章到审核流程', '内容', 'content', 'article', 'submit', 'medium', '["self","site","all"]'::jsonb, '["content.article.update"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.review', '审核文章', '审核文章', '审核并处理提审文章', '内容', 'content', 'article', 'review', 'high', '["site","all"]'::jsonb, '["content.article.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.article.publish', '发布文章', '发布文章', '发布和下线文章', '内容', 'content', 'article', 'publish', 'high', '["site","all"]'::jsonb, '["content.article.read","content.article.update"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.page.read', '查看页面', '查看页面', '查看页面内容', '内容', 'content', 'page', 'read', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.page.create', '创建页面', '创建页面', '创建页面草稿', '内容', 'content', 'page', 'create', 'medium', '["self","site","all"]'::jsonb, '["content.page.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.page.update', '编辑页面', '编辑页面', '编辑页面内容', '内容', 'content', 'page', 'update', 'medium', '["self","site","all"]'::jsonb, '["content.page.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.page.publish', '发布页面', '发布页面', '发布和下线页面', '内容', 'content', 'page', 'publish', 'high', '["site","all"]'::jsonb, '["content.page.read","content.page.update"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.product.read', '查看产品', '查看产品', '查看产品内容', '内容', 'content', 'product', 'read', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.product.create', '创建产品', '创建产品', '创建产品内容', '内容', 'content', 'product', 'create', 'medium', '["self","site","all"]'::jsonb, '["content.product.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.product.update', '编辑产品', '编辑产品', '编辑产品内容', '内容', 'content', 'product', 'update', 'medium', '["self","site","all"]'::jsonb, '["content.product.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.product.publish', '发布产品', '发布产品', '发布和下线产品', '内容', 'content', 'product', 'publish', 'high', '["site","all"]'::jsonb, '["content.product.read","content.product.update"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.menu.update', '菜单管理', '菜单管理', '管理导航菜单', '内容', 'content', 'menu', 'update', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.taxonomy.read', '查看分类法', '查看分类法', '查看分类法定义和术语', '内容', 'content', 'taxonomy', 'read', 'low', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.taxonomy.update', '管理分类法', '管理分类法', '管理分类法和术语', '内容', 'content', 'taxonomy', 'update', 'high', '["site","all"]'::jsonb, '["content.taxonomy.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.model.read', '查看内容模型', '查看内容模型', '查看自定义内容模型', '内容', 'content', 'model', 'read', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.model.update', '管理内容模型', '管理内容模型', '管理自定义内容模型', '内容', 'content', 'model', 'update', 'high', '["site","all"]'::jsonb, '["content.model.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('content.field_group.read', '查看字段组', '查看字段组', '查看字段组配置', '内容', 'content', 'field_group', 'read', 'medium', '["site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('content.field_group.update', '管理字段组', '管理字段组', '管理字段组配置', '内容', 'content', 'field_group', 'update', 'high', '["site","all"]'::jsonb, '["content.field_group.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('system.theme.read', '查看主题', '查看主题', '查看主题中心', '主题', 'system', 'theme', 'read', 'medium', '["all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('system.theme.update', '管理主题', '管理主题', '上传、启用、回滚主题', '主题', 'system', 'theme', 'update', 'critical', '["all"]'::jsonb, '["system.theme.read"]'::jsonb, TRUE, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id, scope_level, created_at, updated_at)
SELECT r.id, p.id, 'all', NOW(), NOW()
FROM auth_roles r
JOIN auth_permissions p ON p.code IN (
    'dashboard.dashboard.view',
    'system.user.read',
    'system.user.create',
    'system.user.update',
    'system.user.disable',
    'system.user.delete',
    'system.user.assign_role',
    'system.role.read',
    'system.role.create',
    'system.role.update',
    'system.role.delete',
    'system.role.assign',
    'system.audit.read',
    'system.settings.read',
    'system.settings.update',
    'system.theme.read',
    'system.theme.update',
    'media.asset.read',
    'media.asset.upload',
    'media.asset.update',
    'media.asset.delete',
    'content.article.read',
    'content.article.create',
    'content.article.update',
    'content.article.submit',
    'content.article.review',
    'content.article.publish',
    'content.page.read',
    'content.page.create',
    'content.page.update',
    'content.page.publish',
    'content.product.read',
    'content.product.create',
    'content.product.update',
    'content.product.publish',
    'content.menu.update',
    'content.taxonomy.read',
    'content.taxonomy.update',
    'content.model.read',
    'content.model.update',
    'content.field_group.read',
    'content.field_group.update'
)
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
