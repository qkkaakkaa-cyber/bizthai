SET search_path TO woocms, public;

-- 前端菜单（WordPress 风格）：命名菜单 + 菜单位置分配 + 菜单项高级属性。
-- site_menus 继续作为菜单项表（保持 i18n 界面文案收集、旧版渲染兼容），
-- 新增 cms_nav_menus 命名菜单与 cms_nav_menu_locations 位置映射。

CREATE TABLE IF NOT EXISTS cms_nav_menus (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_nav_menu_locations (
    site_id BIGINT NOT NULL,
    location VARCHAR(64) NOT NULL,
    menu_id BIGINT NOT NULL REFERENCES cms_nav_menus(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, location)
);

ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS menu_id BIGINT NULL REFERENCES cms_nav_menus(id) ON DELETE CASCADE;
ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS target VARCHAR(16) NOT NULL DEFAULT '';
ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS rel VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS title_attr VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS link_type VARCHAR(16) NOT NULL DEFAULT 'custom';
ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS ref_id BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_site_menus_menu ON site_menus (menu_id, sort_order);

-- 回填：把既有 (site_id, name) 菜单数据升级为命名菜单
INSERT INTO cms_nav_menus (site_id, name, slug)
SELECT DISTINCT site_id,
       CASE name WHEN 'main' THEN '主菜单' WHEN 'footer' THEN '页脚菜单' ELSE name END,
       name
FROM site_menus
ON CONFLICT (site_id, slug) DO NOTHING;

-- 每个站点保证有主菜单（即使尚无任何菜单项）
INSERT INTO cms_nav_menus (site_id, name, slug)
SELECT id, '主菜单', 'main' FROM cms_sites
ON CONFLICT (site_id, slug) DO NOTHING;

UPDATE site_menus m SET menu_id = n.id
FROM cms_nav_menus n
WHERE m.menu_id IS NULL AND n.site_id = m.site_id AND n.slug = m.name;

-- 与历史行为一致：name=main/footer 的菜单默认占据同名位置
INSERT INTO cms_nav_menu_locations (site_id, location, menu_id)
SELECT n.site_id, n.slug, n.id FROM cms_nav_menus n WHERE n.slug IN ('main', 'footer')
ON CONFLICT (site_id, location) DO NOTHING;
