SET search_path TO woocms, public;

INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action, risk_level, supported_scopes, dependencies, is_builtin, created_at, updated_at)
VALUES
	('content.product.read', '查看产品', '查看产品', '查看产品内容', '内容', 'content', 'product', 'read', 'low', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id, scope_level, created_at, updated_at)
SELECT r.id, p.id, 'site', NOW(), NOW()
FROM auth_roles r
JOIN auth_permissions p ON p.code = 'content.product.read'
WHERE r.code IN ('sales_manager', 'sales_rep')
ON CONFLICT (role_id, permission_id) DO NOTHING;