SET search_path TO woocms, public;

ALTER TABLE cms_block_templates
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rules_json JSONB NOT NULL DEFAULT '{"mode":"all","conditions":[]}'::jsonb;

UPDATE cms_block_templates
   SET is_default = TRUE
 WHERE template_key = ''
   AND is_default = FALSE;

CREATE INDEX IF NOT EXISTS idx_cms_block_templates_rules
    ON cms_block_templates (site_id, template_type, status, is_active, priority, is_default);
