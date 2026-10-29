SET search_path TO woocms, public;

-- Remove retired core admin menus that have been decommissioned.
DELETE FROM cms_admin_menus
WHERE namespace = 'core'
  AND scope_type = 'admin'
  AND (route_path IN ('/admin/sites', '/admin/webhooks') OR menu_code IN ('settings_sites', 'settings_webhooks'));
