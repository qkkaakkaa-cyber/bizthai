SET search_path TO woocms, public;

WITH group_settings AS (
    SELECT fg.site_id, fg.id AS group_id
    FROM cms_field_groups fg
    JOIN cms_sites s ON s.id = fg.site_id
    WHERE s.code = 'default'
      AND fg.code = 'products-import-fields'
)
INSERT INTO cms_field_defs (site_id, group_id, name, label, type, required, options_json, sort_order, status, created_at, updated_at)
SELECT group_settings.site_id,
       group_settings.group_id,
       'facet-stock-confidence',
       '筛选字段 Stock Confidence',
       'json',
       FALSE,
       '{}'::jsonb,
       430,
       'active',
       NOW(),
       NOW()
FROM group_settings
WHERE NOT EXISTS (
    SELECT 1
    FROM cms_field_defs fd
    WHERE fd.group_id = group_settings.group_id
      AND fd.name = 'facet-stock-confidence'
);

WITH default_site AS (
    SELECT id AS site_id
    FROM cms_sites
    WHERE code = 'default'
),
seed_posts(slug, title, summary, body_html, published_at) AS (
    VALUES
        (
            'how-sea-stock-classifies-inventory-confidence',
            'How Sea Stock Classifies Inventory Confidence',
            'A practical explanation of A/B/C inventory confidence so buyers can understand when stock is confirmed, pending, or still volatile.',
            '<p>Sea Stock now labels products with three inventory confidence levels so buyers can evaluate speed versus uncertainty before sending an RFQ.</p><p><strong>A类 可控强</strong> means the team has stronger control over the lot and can usually confirm quantity quickly. <strong>B类 需确认库存</strong> means the listing is active but quantity or warehouse hold still needs manual confirmation. <strong>C类 库存不确定</strong> means the opportunity is real, but availability can change faster and requires direct verification.</p><p>These labels are intended to shorten back-and-forth communication. Buyers who need stable programs can prioritize A类 products first, while opportunistic buyers can still monitor B类 and C类 lots for margin-driven opportunities.</p>',
            TIMESTAMP '2026-04-02 09:00:00+00'
        ),
        (
            'three-steps-to-screen-liquidation-lots-faster',
            'Three Steps to Screen Liquidation Lots Faster',
            'Use warehouse, condition, and confidence labels together to reduce wasted inquiry cycles and focus on actionable inventory.',
            '<p>When reviewing liquidation inventory, speed comes from deciding what to ignore first. Sea Stock recommends a simple three-step screen.</p><p>Step one: narrow by <strong>warehouse</strong> so freight assumptions stay realistic. Step two: narrow by <strong>condition</strong> so your resale model matches the goods. Step three: narrow by <strong>stock confidence</strong> so the sales team can align response speed with the certainty you require.</p><p>This workflow is now reflected directly on the product archive and product search pages, making it easier to review dozens of items without jumping between unrelated content.</p>',
            TIMESTAMP '2026-04-02 09:10:00+00'
        ),
        (
            'why-product-search-now-excludes-pages-and-posts',
            'Why Product Search Now Excludes Pages And Posts',
            'The public search page has been simplified to product search only so buyers reach live inventory faster.',
            '<p>Public search is now product-only. The previous mixed search experience could surface informational pages or blog posts when buyers actually needed available inventory.</p><p>By limiting the search page to products, the results are cleaner, the filters are more useful, and every visible result can move directly into an RFQ or product detail workflow. Informational content remains available under the blog and page navigation, but no longer interrupts sourcing searches.</p>',
            TIMESTAMP '2026-04-02 09:20:00+00'
        )
)
INSERT INTO cms_posts (site_id, title, slug, summary, body, status, published_at, author_id, created_at, updated_at)
SELECT default_site.site_id,
       seed_posts.title,
       seed_posts.slug,
       seed_posts.summary,
       seed_posts.body_html,
       'published',
       seed_posts.published_at,
       1,
       NOW(),
       NOW()
FROM default_site
CROSS JOIN seed_posts
-- 全新安装时尚无用户（管理员账号在迁移之后才创建），跳过演示文章避免外键失败
WHERE EXISTS (SELECT 1 FROM system_users WHERE id = 1)
ON CONFLICT (site_id, slug) DO UPDATE
SET title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    body = EXCLUDED.body,
    status = 'published',
    published_at = EXCLUDED.published_at,
    updated_at = NOW();