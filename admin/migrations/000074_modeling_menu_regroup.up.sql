SET search_path TO woocms, public;

-- 菜单重组：内容模型/模型分类/字段组并入新的顶级「内容建模」入口（/admin/modeling，
-- 由代码内置菜单提供）。删除系统设置组下的旧 DB 种子项，避免与代码菜单合并后重复出现。
DELETE FROM cms_admin_menus
WHERE menu_code IN ('settings_cpt', 'settings_taxonomies', 'settings_fields')
   OR route_path IN ('/admin/cpt/models', '/admin/cpt/taxonomies', '/admin/field-groups');
