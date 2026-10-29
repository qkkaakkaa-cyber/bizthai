SET search_path TO woocms, public;

ALTER TABLE IF EXISTS cms_field_groups
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 10;

ALTER TABLE IF EXISTS cms_field_defs
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS placeholder VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS system_users
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO auth_roles (code, name, description, type, is_builtin, is_editable, is_deletable, site_scope_mode, created_at, updated_at)
VALUES
    ('customer', '客户', '前台注册会员默认角色，用于买家中心与分级价格访问', 'system', TRUE, TRUE, TRUE, 'site', NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

WITH group_settings AS (
    SELECT fg.site_id, fg.id AS group_id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
INSERT INTO cms_field_defs (
    site_id, group_id, name, label, type, required, options_json, sort_order, status, description, placeholder, created_at, updated_at
)
SELECT group_settings.site_id,
       group_settings.group_id,
       'price-unit',
       '价格单位',
       'text',
       FALSE,
       '{}'::jsonb,
       442,
       'active',
       '用于前台价格展示的单位，如 unit、case、pallet。',
       'unit',
       NOW(),
       NOW()
FROM group_settings
WHERE NOT EXISTS (
    SELECT 1
    FROM cms_field_defs fd
    WHERE fd.group_id = group_settings.group_id
      AND fd.name = 'price-unit'
);

WITH group_settings AS (
    SELECT fg.site_id, fg.id AS group_id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
INSERT INTO cms_field_defs (
    site_id, group_id, name, label, type, required, options_json, sort_order, status, description, placeholder, created_at, updated_at
)
SELECT group_settings.site_id,
       group_settings.group_id,
       'tier-pricing',
       '阶梯价',
       'textarea',
       FALSE,
       '{}'::jsonb,
       443,
       'active',
       '每行一档，支持“1-10 | 2.5”或“1-10: 2.5”格式。',
       '1-10 | 2.5\n11-50 | 2.2',
       NOW(),
       NOW()
FROM group_settings
WHERE NOT EXISTS (
    SELECT 1
    FROM cms_field_defs fd
    WHERE fd.group_id = group_settings.group_id
      AND fd.name = 'tier-pricing'
);