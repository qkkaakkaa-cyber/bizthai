SET search_path TO woocms, public;

WITH settings AS (
    SELECT s.id AS site_id, m.id AS model_id
    FROM cms_sites s
    JOIN cms_content_models m ON m.site_id = s.id
    WHERE s.code = 'default'
      AND m.code = 'products'
),
facet_defs(code, label, slug, hierarchical, field_name) AS (
    VALUES
        ('fob', 'FOB', 'fob', FALSE, 'facet-product-page'),
        ('product-condition', 'Condition', 'product-condition', FALSE, 'facet-condition'),
        ('sales-unit', 'Unit', 'sales-unit', FALSE, 'facet-unit')
)
INSERT INTO cms_custom_taxonomies (site_id, code, label, slug, hierarchical, status, created_at, updated_at)
SELECT settings.site_id, facet_defs.code, facet_defs.label, facet_defs.slug, facet_defs.hierarchical, 'active', NOW(), NOW()
FROM settings
CROSS JOIN facet_defs
ON CONFLICT (site_id, code) DO UPDATE
SET label = EXCLUDED.label,
    slug = EXCLUDED.slug,
    hierarchical = EXCLUDED.hierarchical,
    status = 'active',
    updated_at = NOW();

WITH settings AS (
    SELECT s.id AS site_id, m.id AS model_id
    FROM cms_sites s
    JOIN cms_content_models m ON m.site_id = s.id
    WHERE s.code = 'default'
      AND m.code = 'products'
),
facet_defs(code) AS (
    VALUES ('fob'), ('product-condition'), ('sales-unit')
)
INSERT INTO cms_content_model_taxonomies (site_id, content_model_id, taxonomy_id, created_at)
SELECT settings.site_id, settings.model_id, tax.id, NOW()
FROM settings
JOIN facet_defs ON TRUE
JOIN cms_custom_taxonomies tax ON tax.site_id = settings.site_id AND tax.code = facet_defs.code
ON CONFLICT (content_model_id, taxonomy_id) DO NOTHING;

DELETE FROM cms_field_defs
WHERE group_id = (
    SELECT fg.id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
AND name IN ('facet-product-page', 'facet-condition', 'facet-unit');

WITH settings AS (
    SELECT s.id AS site_id, m.id AS model_id
    FROM cms_sites s
    JOIN cms_content_models m ON m.site_id = s.id
    WHERE s.code = 'default'
      AND m.code = 'products'
),
facet_defs(code, field_name) AS (
    VALUES
        ('fob', 'facet-product-page'),
        ('product-condition', 'facet-condition'),
        ('sales-unit', 'facet-unit')
),
raw_terms AS (
    SELECT DISTINCT
        facet_defs.code,
        btrim(value_item.value) AS term_name,
        CASE
            WHEN btrim(regexp_replace(lower(btrim(value_item.value)), '[^a-z0-9]+', '-', 'g'), '-') = ''
                THEN 'term-' || substr(md5(btrim(value_item.value)), 1, 12)
            ELSE btrim(regexp_replace(lower(btrim(value_item.value)), '[^a-z0-9]+', '-', 'g'), '-')
        END AS slug
    FROM settings
    JOIN cms_content_entries entry ON entry.site_id = settings.site_id AND entry.content_model_id = settings.model_id
    CROSS JOIN facet_defs
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
            WHEN jsonb_typeof(entry.meta_json -> facet_defs.field_name) = 'array' THEN entry.meta_json -> facet_defs.field_name
            ELSE '[]'::jsonb
        END
    ) AS value_item(value)
    WHERE btrim(value_item.value) <> ''
),
ranked_terms AS (
    SELECT code, term_name, slug, row_number() OVER (PARTITION BY code ORDER BY term_name) * 10 AS sort_order
    FROM raw_terms
)
INSERT INTO cms_custom_terms (site_id, taxonomy_id, name, slug, parent_id, sort_order, status, created_at, updated_at)
SELECT settings.site_id, tax.id, ranked_terms.term_name, ranked_terms.slug, NULL, ranked_terms.sort_order, 'active', NOW(), NOW()
FROM settings
JOIN ranked_terms ON TRUE
JOIN cms_custom_taxonomies tax ON tax.site_id = settings.site_id AND tax.code = ranked_terms.code
ON CONFLICT (site_id, taxonomy_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    status = 'active',
    updated_at = NOW();

WITH settings AS (
    SELECT s.id AS site_id, m.id AS model_id
    FROM cms_sites s
    JOIN cms_content_models m ON m.site_id = s.id
    WHERE s.code = 'default'
      AND m.code = 'products'
),
facet_defs(code, field_name) AS (
    VALUES
        ('fob', 'facet-product-page'),
        ('product-condition', 'facet-condition'),
        ('sales-unit', 'facet-unit')
),
entry_terms AS (
    SELECT DISTINCT
        entry.id AS entry_id,
        facet_defs.code,
        CASE
            WHEN btrim(regexp_replace(lower(btrim(value_item.value)), '[^a-z0-9]+', '-', 'g'), '-') = ''
                THEN 'term-' || substr(md5(btrim(value_item.value)), 1, 12)
            ELSE btrim(regexp_replace(lower(btrim(value_item.value)), '[^a-z0-9]+', '-', 'g'), '-')
        END AS term_slug
    FROM settings
    JOIN cms_content_entries entry ON entry.site_id = settings.site_id AND entry.content_model_id = settings.model_id
    CROSS JOIN facet_defs
    CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
            WHEN jsonb_typeof(entry.meta_json -> facet_defs.field_name) = 'array' THEN entry.meta_json -> facet_defs.field_name
            ELSE '[]'::jsonb
        END
    ) AS value_item(value)
    WHERE btrim(value_item.value) <> ''
)
INSERT INTO cms_content_entry_terms (site_id, entry_id, taxonomy_id, term_id, is_primary, created_at)
SELECT settings.site_id, entry_terms.entry_id, tax.id, term.id, FALSE, NOW()
FROM settings
JOIN entry_terms ON TRUE
JOIN cms_custom_taxonomies tax ON tax.site_id = settings.site_id AND tax.code = entry_terms.code
JOIN cms_custom_terms term ON term.site_id = settings.site_id AND term.taxonomy_id = tax.id AND term.slug = entry_terms.term_slug
ON CONFLICT (entry_id, term_id) DO NOTHING;