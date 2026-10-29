SET search_path TO woocms, public;

ALTER TABLE media_files
    ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS alt_text VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS tags VARCHAR(512) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS copyright_info VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_media_id BIGINT NULL REFERENCES media_files(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_media_files_source_media_id ON media_files (source_media_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_files_site_created_with_meta ON media_files (site_id, created_at DESC);
