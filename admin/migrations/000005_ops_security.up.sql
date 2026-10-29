SET search_path TO woocms, public;

INSERT INTO auth_permissions (code, name)
VALUES ('audit.read', '查看操作日志')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code = 'audit.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
