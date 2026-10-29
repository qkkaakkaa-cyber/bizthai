SET search_path TO woocms, public;

ALTER TABLE cms_pages
    ADD COLUMN IF NOT EXISTS parent_id BIGINT NULL REFERENCES cms_pages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cms_pages_site_parent_updated
    ON cms_pages (site_id, parent_id, updated_at DESC);
