SET search_path TO woocms, public;

ALTER TABLE cms_content_models
    ADD COLUMN IF NOT EXISTS single_template VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS archive_template VARCHAR(255) NULL;
