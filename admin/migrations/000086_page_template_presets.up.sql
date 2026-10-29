SET search_path TO woocms, public;

-- 可复用的页面自定义模板库:把一段模板源码存为命名预设,可套用到任意页面。
CREATE TABLE IF NOT EXISTS cms_page_template_presets (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    name VARCHAR(255) NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    full_page BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_template_presets_site ON cms_page_template_presets (site_id, updated_at DESC);
