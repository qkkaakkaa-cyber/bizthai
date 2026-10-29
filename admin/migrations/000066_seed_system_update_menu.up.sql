SET search_path TO woocms, public;

-- 在「系统设置」(menu_code='settings_root') 下添加「系统更新」菜单入口
INSERT INTO cms_admin_menus (parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system)
SELECT m.id, 'core', 'admin', 'settings_system_update', '系统更新', 'SystemUpdate', '/admin/system/update', 'fas fa-cloud-download-alt', 9, true
FROM cms_admin_menus m
WHERE m.menu_code = 'settings_root'
  AND NOT EXISTS (
    SELECT 1 FROM cms_admin_menus WHERE menu_code = 'settings_system_update'
  );
