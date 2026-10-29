SET search_path TO woocms, public;

DELETE FROM cms_field_defs
WHERE group_id IN (
    SELECT fg.id
    FROM cms_field_groups fg
    JOIN cms_content_models cm ON cm.id = fg.content_model_id
    WHERE fg.code = 'products-import-fields'
      AND cm.code = 'products'
)
AND name IN (
    'is-hot-sale',
    'hot-sale-order',
    'bound-product-ids',
    'crosssell-ids',
    'crp-related-ids',
    'crp-related-product-cats',
    'facebook-sync-enabled',
    'facebook-visibility',
    'legacy-product-id',
    'source-guid',
    'product-attributes',
    'legacy-raw-meta'
);