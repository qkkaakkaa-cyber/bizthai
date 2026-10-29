SET search_path TO woocms, public;

ALTER TABLE media_files
    ADD COLUMN IF NOT EXISTS width  INT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS height INT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sizes_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_media_files_site_dimensions
    ON media_files (site_id) WHERE width > 0;
