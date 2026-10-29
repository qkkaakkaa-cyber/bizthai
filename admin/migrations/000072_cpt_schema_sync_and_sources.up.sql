SET search_path TO woocms, public;

ALTER TABLE IF EXISTS cms_content_models
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;

ALTER TABLE IF EXISTS cms_field_defs
    ADD COLUMN IF NOT EXISTS field_key VARCHAR(96) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS previous_names_json JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE cms_field_defs
SET field_key = 'field_' || md5(site_id::text || ':' || group_id::text || ':' || name)
WHERE TRIM(COALESCE(field_key, '')) = '';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cms_field_defs_site_field_key_key'
    ) THEN
        ALTER TABLE cms_field_defs
            ADD CONSTRAINT cms_field_defs_site_field_key_key UNIQUE (site_id, field_key);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cms_content_models_site_source
    ON cms_content_models (site_id, source_type, status);
