SET search_path TO woocms, public;

ALTER TABLE IF EXISTS cms_content_models
    ADD COLUMN IF NOT EXISTS permalink_pattern VARCHAR(255) NOT NULL DEFAULT '/c/{model}/{slug}';

UPDATE cms_content_models
SET permalink_pattern = '/c/{model}/{slug}'
WHERE TRIM(COALESCE(permalink_pattern, '')) = '';
