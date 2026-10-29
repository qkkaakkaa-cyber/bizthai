SET search_path TO woocms, public;

ALTER TABLE cms_posts
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cms_pages
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;
