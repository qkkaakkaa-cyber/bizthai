SET search_path TO woocms, public;

-- 自定义设置页(ACF 风格 Options Page):
-- 定义后台侧边栏中的站点设置入口,字段组通过位置规则(entity=options_page / site_options=<code>)挂载,
-- 字段值整页存于 values_json(站点级单例数据,无多行语义,不需要独立值表)。
CREATE TABLE IF NOT EXISTS cms_options_pages (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    code VARCHAR(120) NOT NULL,
    title VARCHAR(255) NOT NULL,
    menu_title VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    icon VARCHAR(120) NOT NULL DEFAULT '',
    parent_code VARCHAR(120) NOT NULL DEFAULT '',
    public_read BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 10,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    values_updated_at TIMESTAMPTZ,
    values_updated_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_options_pages_site_code UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_options_pages_site_parent ON cms_options_pages (site_id, parent_code);
