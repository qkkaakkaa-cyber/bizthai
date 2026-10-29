SET search_path TO woocms, public;

-- 卸载整套旧主题(theme)体系：表与列。
-- 注意：历史迁移文件保留（迁移 runner 按版本增量执行），这里统一 DROP。

-- 主题相关表（000014 / 000025 / 000053 引入）
DROP TABLE IF EXISTS cms_theme_customizer_history CASCADE;
DROP TABLE IF EXISTS cms_theme_hook_callbacks CASCADE;
DROP TABLE IF EXISTS cms_theme_hooks CASCADE;
DROP TABLE IF EXISTS cms_theme_menu_locations CASCADE;
DROP TABLE IF EXISTS cms_theme_areas CASCADE;
DROP TABLE IF EXISTS cms_theme_widget_instances CASCADE;
DROP TABLE IF EXISTS cms_theme_widgets CASCADE;
DROP TABLE IF EXISTS cms_theme_settings CASCADE;
DROP TABLE IF EXISTS cms_theme_active_style_variation CASCADE;
DROP TABLE IF EXISTS cms_theme_activations CASCADE;
DROP TABLE IF EXISTS cms_theme_presets CASCADE;
DROP TABLE IF EXISTS cms_theme_packages CASCADE;

-- 内容/模板表上的 theme 列
ALTER TABLE IF EXISTS cms_pages     DROP COLUMN IF EXISTS theme_code, DROP COLUMN IF EXISTS theme_version;
ALTER TABLE IF EXISTS cms_templates DROP COLUMN IF EXISTS theme_code, DROP COLUMN IF EXISTS theme_version;
