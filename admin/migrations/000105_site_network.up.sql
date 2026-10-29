-- 000105: 多站点网络管理权限码 network.manage
-- 站点 CRUD、设为默认、跨站成员分配等网络级操作的统一权限闸门。
-- admin 角色持有 '*' 通配权限，天然拥有该能力；此处显式授予以便在权限矩阵中可见，
-- 并支持授予自定义角色。整文件单事务执行（runner 负责）。

INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action, risk_level, supported_scopes, dependencies, is_builtin, created_at, updated_at)
VALUES
    ('network.manage', '网络管理', '网络管理', '管理站点网络：创建/编辑/删除站点、设为默认、跨站成员分配', '系统设置', 'system', 'network', 'manage', 'critical', '["all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

-- 授予 admin（WHERE r.code='admin' 天然保护空库——admin 不存在则不插入）。
INSERT INTO auth_role_permissions (role_id, permission_id, scope_level, created_at, updated_at)
SELECT r.id, p.id, 'all', NOW(), NOW()
FROM auth_roles r
JOIN auth_permissions p ON p.code = 'network.manage'
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
