SET search_path TO woocms, public;

ALTER TABLE site_menus
    ADD COLUMN IF NOT EXISTS icon_class VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE site_menus
    ADD COLUMN IF NOT EXISTS custom_css VARCHAR(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_site_menus_site_name_sort_with_icon
    ON site_menus (site_id, name, sort_order, id);
