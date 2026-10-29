SET search_path TO woocms, public;

-- 历史问题：000045 编号重复（crm_sales_attribution 与 remove_crm_feature），
-- 迁移 runner 按版本号去重导致 remove 脚本从未执行，全新安装会带上已废弃的
-- CRM（客户与询盘）角色、权限与菜单。此迁移以新编号重新执行完整清理。

-- 1. 废弃菜单
DELETE FROM cms_admin_menus
WHERE route_path IN ('/admin/customers', '/admin/inquiries', '/admin/sales-reps')
   OR menu_code  IN ('customers', 'inquiries', 'sales_reps')
   OR menu_name  IN ('客户与询盘', '客户管理', '询盘管理', '业务员管理');

-- 2. 角色-权限关联（先于权限/角色删除）
DELETE FROM auth_role_permissions
WHERE permission_id IN (
    SELECT id FROM auth_permissions
    WHERE code IN ('crm.sales.manage', 'crm.lead.read', 'crm.customer.update', 'crm.lead.assign')
)
OR role_id IN (
    SELECT id FROM auth_roles WHERE code IN ('sales_manager', 'sales_rep')
);

-- 3. 用户-角色关联
DELETE FROM auth_user_roles
WHERE role_id IN (SELECT id FROM auth_roles WHERE code IN ('sales_manager', 'sales_rep'));

-- 4. CRM 权限节点
DELETE FROM auth_permissions
WHERE code IN ('crm.sales.manage', 'crm.lead.read', 'crm.customer.update', 'crm.lead.assign');

-- 5. CRM 角色（销售主管/业务员）
DELETE FROM auth_roles WHERE code IN ('sales_manager', 'sales_rep');
