SET search_path TO woocms, public;

-- 每个站点 + 主题包 的当前激活风格变体
CREATE TABLE IF NOT EXISTS cms_theme_active_style_variation (
    id              BIGSERIAL    PRIMARY KEY,
    site_id         BIGINT       NOT NULL DEFAULT 1,
    package_id      BIGINT       NOT NULL REFERENCES cms_theme_packages(id) ON DELETE CASCADE,
    variation_slug  VARCHAR(128) NOT NULL,
    css_file        VARCHAR(512) NOT NULL DEFAULT '',
    updated_by      BIGINT       NULL,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, package_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_theme_active_style_variation_site
    ON cms_theme_active_style_variation (site_id);
