SET search_path TO woocms, public;

-- Seed Core Admin Navigation Menus

-- 1. Dashboard
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(1, 0, 'core', 'admin', 'dashboard', '仪表盘', 'Dashboard', '/admin', 'fas fa-tachometer-alt', 10, true)
ON CONFLICT DO NOTHING;

-- 2. Content
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(2, 0, 'core', 'admin', 'content', '内容管理', '', '', 'fas fa-file-alt', 20, true)
ON CONFLICT DO NOTHING;

INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(3, 2, 'core', 'admin', 'pages', '页面', 'Pages', '/admin/pages', 'fas fa-file', 1, true),
(4, 2, 'core', 'admin', 'posts', '文章', 'Posts', '/admin/posts', 'fas fa-newspaper', 2, true),
(5, 2, 'core', 'admin', 'taxonomy', '分类目录', 'Taxonomy', '/admin/taxonomy', 'fas fa-folder', 3, true),
(6, 2, 'core', 'admin', 'tags', '标签', 'Tags', '/admin/tags', 'fas fa-tags', 4, true)
ON CONFLICT DO NOTHING;

-- 3. Media
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(7, 0, 'core', 'admin', 'media', '媒体库', 'Media', '/admin/media', 'fas fa-images', 30, true)
ON CONFLICT DO NOTHING;

-- 4. Frontend Menus
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(8, 0, 'core', 'admin', 'frontend_menus', '前台菜单', 'FrontendMenus', '/admin/menu', 'fas fa-bars', 40, true)
ON CONFLICT DO NOTHING;

-- 5. Appearance / Themes
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(9, 0, 'core', 'admin', 'appearance', '外观与主题', 'Themes', '/admin/themes', 'fas fa-paint-brush', 50, true)
ON CONFLICT DO NOTHING;

-- 6. Users
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(11, 0, 'core', 'admin', 'users_root', '用户与权限', '', '', 'fas fa-users', 70, true)
ON CONFLICT DO NOTHING;

INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(12, 11, 'core', 'admin', 'users', '用户', 'Users', '/admin/users', 'fas fa-user', 1, true),
(13, 11, 'core', 'admin', 'roles', '角色', 'Roles', '/admin/roles', 'fas fa-user-shield', 2, true),
(14, 11, 'core', 'admin', 'permissions', '权限节点', 'Permissions', '/admin/permissions', 'fas fa-key', 3, true)
ON CONFLICT DO NOTHING;

-- 8. System Settings
INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(15, 0, 'core', 'admin', 'settings_root', '系统设置', '', '', 'fas fa-cog', 80, true)
ON CONFLICT DO NOTHING;

INSERT INTO cms_admin_menus (id, parent_id, namespace, scope_type, menu_code, menu_name, route_name, route_path, icon, sort_no, is_system) VALUES 
(16, 15, 'core', 'admin', 'settings_general', '常规设置', 'Settings', '/admin/settings', 'fas fa-sliders-h', 1, true),
(17, 15, 'core', 'admin', 'settings_sites', '多站点', 'Sites', '/admin/sites', 'fas fa-sitemap', 2, true),
(18, 15, 'core', 'admin', 'settings_config', '配置中心', 'Config', '/admin/config', 'fas fa-cogs', 3, true),
(19, 15, 'core', 'admin', 'settings_webhooks', 'Webhooks', 'Webhooks', '/admin/webhooks', 'fas fa-exchange-alt', 4, true),
(20, 15, 'core', 'admin', 'settings_cpt', '内容模型', 'CPTModels', '/admin/cpt/models', 'fas fa-cubes', 5, true),
(21, 15, 'core', 'admin', 'settings_taxonomies', '自定义分类', 'CPTTaxonomies', '/admin/cpt/taxonomies', 'fas fa-folder-tree', 6, true),
(22, 15, 'core', 'admin', 'settings_fields', '字段组', 'FieldGroups', '/admin/field-groups', 'fas fa-list-alt', 7, true),
(23, 15, 'core', 'admin', 'settings_adminmenus', '后台菜单', 'AdminMenus', '/admin/settings/menus', 'fas fa-list-ul', 8, true)
ON CONFLICT DO NOTHING;

SELECT setval('cms_admin_menus_id_seq', COALESCE((SELECT MAX(id) FROM cms_admin_menus), 1), true);
