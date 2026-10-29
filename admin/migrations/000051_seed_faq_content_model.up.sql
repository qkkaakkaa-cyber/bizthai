SET search_path TO woocms, public;

INSERT INTO cms_content_models (
    site_id,
    code,
    label,
    slug,
    single_template,
    archive_template,
    public_status,
    has_archive,
    supports_json,
    status,
    created_at,
    updated_at
)
SELECT s.id,
       'faq',
       'Buyer FAQ',
       'faq',
       '',
       'archive-faq.tmpl',
       TRUE,
       TRUE,
       '["title","summary","body"]'::jsonb,
       'active',
       NOW(),
       NOW()
FROM cms_sites s
WHERE s.code = 'default'
ON CONFLICT (site_id, code) DO UPDATE
SET label = EXCLUDED.label,
    slug = EXCLUDED.slug,
    single_template = EXCLUDED.single_template,
    archive_template = EXCLUDED.archive_template,
    public_status = EXCLUDED.public_status,
    has_archive = EXCLUDED.has_archive,
    supports_json = EXCLUDED.supports_json,
    status = 'active',
    updated_at = NOW();

INSERT INTO cms_field_groups (
    site_id,
    code,
    title,
    content_model_id,
    rule_json,
    status,
    created_at,
    updated_at
)
SELECT s.id,
       'faq-public-fields',
       'FAQ 扩展字段',
       m.id,
       '{}'::jsonb,
       'active',
       NOW(),
       NOW()
FROM cms_sites s
JOIN cms_content_models m
  ON m.site_id = s.id
 AND m.code = 'faq'
WHERE s.code = 'default'
ON CONFLICT (site_id, code) DO UPDATE
SET title = EXCLUDED.title,
    content_model_id = EXCLUDED.content_model_id,
    rule_json = EXCLUDED.rule_json,
    status = 'active',
    updated_at = NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'cms_field_group_locations'
    ) THEN
        DELETE FROM cms_field_group_locations
        WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default')
          AND group_id = (
              SELECT id
              FROM cms_field_groups
              WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default')
                AND code = 'faq-public-fields'
          );

        INSERT INTO cms_field_group_locations (site_id, group_id, group_index, field, operator, value, sort_order, created_at)
        VALUES (
            (SELECT id FROM cms_sites WHERE code = 'default'),
            (SELECT id FROM cms_field_groups WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq-public-fields'),
            0,
            'entity',
            'eq',
            'entry',
            0,
            NOW()
        );

        INSERT INTO cms_field_group_locations (site_id, group_id, group_index, field, operator, value, sort_order, created_at)
        VALUES (
            (SELECT id FROM cms_sites WHERE code = 'default'),
            (SELECT id FROM cms_field_groups WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq-public-fields'),
            0,
            'model_code',
            'eq',
            'faq',
            1,
            NOW()
        );
    END IF;
END $$;

DELETE FROM cms_field_defs
WHERE group_id = (
    SELECT id
    FROM cms_field_groups
    WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default')
      AND code = 'faq-public-fields'
);

INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_field_groups WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq-public-fields'),
    'faq-sort-order',
    'FAQ 排序',
    'number',
    FALSE,
    '{}'::jsonb,
    5,
    'active',
    NOW(),
    NOW()
);

INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_field_groups WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq-public-fields'),
    'faq-tag',
    'FAQ 标签',
    'text',
    FALSE,
    '{}'::jsonb,
    10,
    'active',
    NOW(),
    NOW()
);

INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_field_groups WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq-public-fields'),
    'faq-answer',
    'FAQ 详细答案',
    'textarea',
    TRUE,
    '{}'::jsonb,
    20,
    'active',
    NOW(),
    NOW()
);

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'Can I verify warehouse location or live stock before I pay?',
    'verify-warehouse-or-live-stock-before-payment',
    'Yes. We can align warehouse notes, live stock checks, and confirmation timing before you release payment for the lot.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":10,"faq-tag":"Verification","faq-answer":"Yes. For many closeout and overstock deals, buyers first want confirmation on where the goods are sitting, whether the lot is still open, and what kind of pickup or dispatch timing is realistic. Before payment, we can usually help confirm warehouse notes, stock-sheet status, and the current verification path so you reduce avoidable back-and-forth before committing."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'Can I ask for photos, video, or a stock sheet first?',
    'request-photos-video-or-stock-sheet-first',
    'Usually yes. Buyers often review stock sheets, photos, or a short video before deciding whether to move forward.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":20,"faq-tag":"Proof","faq-answer":"Usually yes. For selected lots, we can help arrange a stock sheet, warehouse pictures, or a short video confirmation before the deal moves deeper. This step is especially useful for mixed liquidation inventory, customer-return lots, and fast-moving closeout deals where buyers want a practical snapshot rather than a long formal presentation."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'What MOQ should I expect on liquidation or excess inventory?',
    'typical-moq-for-liquidation-or-excess-inventory',
    'MOQ depends on the lot. Some deals move by case or pallet, while others require taking a mixed truckload or the full closeout batch.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":30,"faq-tag":"MOQ","faq-answer":"MOQ depends on the seller, the warehouse setup, and how the lot is packed. Some closeout deals can move by case or pallet, while others are only practical as a mixed truckload or full lot take-over. If MOQ is the main decision point for you, review that first before spending time on detailed pricing, because it usually determines whether the deal fits your channel at all."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'How are mixed lots or closeout bundles usually quoted?',
    'how-mixed-lots-or-closeout-bundles-are-quoted',
    'Mixed lots are normally quoted from the lot structure first: unit, quantity range, condition, and how complete the inventory list is.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":40,"faq-tag":"Pricing","faq-answer":"Mixed closeout lots are usually quoted from the lot structure first, not just from a single product price. Buyers normally need to understand the sales unit, condition, quantity range, and whether the stock sheet is complete. If the inventory is mixed or fast-moving, the quickest path is to narrow the lot type first and request a quote with those assumptions already clear."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'How long can stock usually be held or reserved?',
    'how-long-stock-can-be-held-or-reserved',
    'Reservation windows vary. Fast-moving deals may need same-day confirmation, while more stable lots can allow a short hold after alignment.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":50,"faq-tag":"Timing","faq-answer":"Reservation windows depend on how quickly the inventory is moving and how many parties are watching the same lot. Some deals need same-day confirmation, while more stable inventory can sometimes allow a short hold period. If timing matters, ask about reservation rules early because it affects whether you should go straight into verification, pricing, or shipping alignment."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();

INSERT INTO cms_content_entries (
    site_id,
    content_model_id,
    title,
    slug,
    summary,
    body,
    status,
    published_at,
    author_id,
    meta_json,
    created_at,
    updated_at
)
VALUES (
    (SELECT id FROM cms_sites WHERE code = 'default'),
    (SELECT id FROM cms_content_models WHERE site_id = (SELECT id FROM cms_sites WHERE code = 'default') AND code = 'faq'),
    'What should I prepare before sending RFQ or buyer contact details?',
    'prepare-before-sending-rfq-or-contact-request',
    'Have your target lot type, quantity range, destination, and verification request ready first. That makes the first reply much more useful.',
    '',
    'published',
    NOW(),
    NULL,
    '{"faq-sort-order":60,"faq-tag":"Start Fast","faq-answer":"Before you send RFQ or start direct contact, it helps to have four basics ready: lot type, quantity range, destination or pickup region, and your preferred verification method. When those four points are clear, the first buyer-support reply is usually faster and more actionable."}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (site_id, content_model_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    meta_json = EXCLUDED.meta_json,
    updated_at = NOW();