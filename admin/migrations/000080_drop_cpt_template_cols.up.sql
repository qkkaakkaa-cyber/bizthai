ALTER TABLE cms_content_models
    DROP COLUMN IF EXISTS single_template,
    DROP COLUMN IF EXISTS archive_template;
