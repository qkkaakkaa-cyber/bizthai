SET search_path TO woocms, public;

ALTER TABLE site_menus
    ADD COLUMN IF NOT EXISTS parent_id BIGINT NULL REFERENCES site_menus(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_site_menus_site_name_parent_sort
    ON site_menus (site_id, name, parent_id, sort_order);
