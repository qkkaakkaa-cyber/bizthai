ALTER TABLE cms_post_translations ADD COLUMN IF NOT EXISTS meta_json JSONB NULL;
ALTER TABLE cms_page_translations ADD COLUMN IF NOT EXISTS meta_json JSONB NULL;
