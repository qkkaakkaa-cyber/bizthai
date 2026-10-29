SET search_path TO woocms, public;

-- B-02: add is-hot-sale and hot-sale-order fields to products field group
WITH group_settings AS (
    SELECT fg.site_id, fg.id AS group_id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
SELECT group_settings.site_id, group_settings.group_id,
       'is-hot-sale', '首页热销标记', 'text', FALSE, '{}'::jsonb, 440, 'active', NOW(), NOW()
FROM group_settings
WHERE NOT EXISTS (
    SELECT 1 FROM cms_field_defs fd WHERE fd.group_id = group_settings.group_id AND fd.name = 'is-hot-sale'
);

WITH group_settings AS (
    SELECT fg.site_id, fg.id AS group_id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
SELECT group_settings.site_id, group_settings.group_id,
       'hot-sale-order', '热销排序权重(数字越小越靠前)', 'number', FALSE, '{}'::jsonb, 441, 'active', NOW(), NOW()
FROM group_settings
WHERE NOT EXISTS (
    SELECT 1 FROM cms_field_defs fd WHERE fd.group_id = group_settings.group_id AND fd.name = 'hot-sale-order'
);

-- B-04: seed default site contact settings (placeholder values – operators update via admin)
WITH default_site AS (SELECT id as site_id FROM cms_sites WHERE code = 'default')
INSERT INTO system_settings (site_id, key, value, updated_at)
SELECT default_site.site_id, seed.key, seed.value, NOW()
FROM default_site
CROSS JOIN (VALUES
    ('contact_whatsapp',  '+1 443-845-2969'),
    ('contact_messenger', ''),
    ('contact_wechat',    ''),
    ('contact_phone',     '+1 443-845-2969'),
    ('contact_email',     'sales@seastock88.com')
) as seed(key, value)
ON CONFLICT (site_id, key) DO NOTHING;
