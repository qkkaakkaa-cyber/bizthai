ALTER TABLE cms_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_cms_posts_deleted_at ON cms_posts(site_id, deleted_at) WHERE deleted_at IS NOT NULL;
