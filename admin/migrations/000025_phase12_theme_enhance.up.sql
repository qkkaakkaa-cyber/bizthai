SET search_path TO woocms, public;

-- 主题设置表：存储主题级别的配置（类似 WordPress 的 theme.json）
CREATE TABLE IF NOT EXISTS cms_theme_settings (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    package_id BIGINT NOT NULL REFERENCES cms_theme_packages(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    styles_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    custom_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_settings_site_package ON cms_theme_settings (site_id, package_id);

-- 子主题支持：添加 parent 字段到 packages 表
ALTER TABLE cms_theme_packages 
    ADD COLUMN IF NOT EXISTS parent_code VARCHAR(128) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cms_theme_packages_parent ON cms_theme_packages (parent_code) WHERE parent_code != '';

-- 小工具/区块注册表
CREATE TABLE IF NOT EXISTS cms_theme_widgets (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    widget_code VARCHAR(128) NOT NULL,
    widget_name VARCHAR(255) NOT NULL,
    widget_type VARCHAR(64) NOT NULL DEFAULT 'block',
    description TEXT NOT NULL DEFAULT '',
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    template_html TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, widget_code)
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_widgets_site_active ON cms_theme_widgets (site_id, is_active);

-- 小工具实例表：将小工具放置到特定区域
CREATE TABLE IF NOT EXISTS cms_theme_widget_instances (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    widget_id BIGINT NOT NULL REFERENCES cms_theme_widgets(id) ON DELETE CASCADE,
    area_code VARCHAR(128) NOT NULL DEFAULT 'sidebar',
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_widget_instances_area ON cms_theme_widget_instances (site_id, area_code, sort_order);

-- 主题区域注册表（sidebar, footer-1, header-nav 等）
CREATE TABLE IF NOT EXISTS cms_theme_areas (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    area_code VARCHAR(128) NOT NULL,
    area_name VARCHAR(255) NOT NULL,
    area_type VARCHAR(64) NOT NULL DEFAULT 'widget_area',
    description TEXT NOT NULL DEFAULT '',
    max_widgets INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, area_code)
);

-- 菜单位置注册表
CREATE TABLE IF NOT EXISTS cms_theme_menu_locations (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    location_code VARCHAR(128) NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    menu_id BIGINT NULL REFERENCES site_menus(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, location_code)
);

-- 钩子注册表
CREATE TABLE IF NOT EXISTS cms_theme_hooks (
    id BIGSERIAL PRIMARY KEY,
    hook_name VARCHAR(255) NOT NULL,
    hook_type VARCHAR(32) NOT NULL DEFAULT 'action',
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hook_name)
);

-- 钩子回调表
CREATE TABLE IF NOT EXISTS cms_theme_hook_callbacks (
    id BIGSERIAL PRIMARY KEY,
    hook_id BIGINT NOT NULL REFERENCES cms_theme_hooks(id) ON DELETE CASCADE,
    callback_type VARCHAR(32) NOT NULL DEFAULT 'function',
    callback_name VARCHAR(255) NOT NULL,
    priority INT NOT NULL DEFAULT 10,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hook_id, callback_name)
);

-- 主题自定义器设置历史
CREATE TABLE IF NOT EXISTS cms_theme_customizer_history (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    package_id BIGINT NOT NULL REFERENCES cms_theme_packages(id) ON DELETE CASCADE,
    settings_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    styles_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    custom_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    applied_by BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_published BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_customizer_history ON cms_theme_customizer_history (site_id, package_id, applied_at DESC);
