SET search_path TO woocms, public;

-- 清理老项目（Sea Stock）随迁移种入的演示内容：
-- 000047 的 3 篇博客文章、facet 字段；000051 的 Buyer FAQ 内容模型及条目。
-- 仅按种子 slug 精确删除；若站点自建过 FAQ 条目，模型会被保留。

-- 1. 老项目种子博客文章（FK 均为 ON DELETE CASCADE）
DELETE FROM cms_posts
WHERE slug IN (
    'how-sea-stock-classifies-inventory-confidence',
    'three-steps-to-screen-liquidation-lots-faster',
    'why-product-search-now-excludes-pages-and-posts'
);

-- 2. FAQ 种子条目（按种子 slug 精确匹配）
DELETE FROM cms_content_entries
WHERE slug IN (
    'verify-warehouse-or-live-stock-before-payment',
    'typical-moq-for-liquidation-or-excess-inventory',
    'request-photos-video-or-stock-sheet-first',
    'how-long-stock-can-be-held-or-reserved',
    'how-mixed-lots-or-closeout-bundles-are-quoted',
    'prepare-before-sending-rfq-or-contact-request'
)
AND content_model_id IN (SELECT id FROM cms_content_models WHERE code = 'faq');

-- 3. FAQ 字段组（仅当 faq 模型已无任何条目时整体移除）
DELETE FROM cms_field_group_locations
WHERE group_id IN (SELECT id FROM cms_field_groups WHERE code = 'faq-public-fields')
  AND NOT EXISTS (
      SELECT 1 FROM cms_content_entries e
      JOIN cms_content_models m ON m.id = e.content_model_id
      WHERE m.code = 'faq'
  );

DELETE FROM cms_field_defs
WHERE group_id IN (SELECT id FROM cms_field_groups WHERE code = 'faq-public-fields')
  AND NOT EXISTS (
      SELECT 1 FROM cms_content_entries e
      JOIN cms_content_models m ON m.id = e.content_model_id
      WHERE m.code = 'faq'
  );

DELETE FROM cms_field_groups
WHERE code = 'faq-public-fields'
  AND NOT EXISTS (
      SELECT 1 FROM cms_content_entries e
      JOIN cms_content_models m ON m.id = e.content_model_id
      WHERE m.code = 'faq'
  );

-- 4. FAQ 内容模型本体（仅当无剩余条目）
DELETE FROM cms_content_models m
WHERE m.code = 'faq'
  AND NOT EXISTS (SELECT 1 FROM cms_content_entries e WHERE e.content_model_id = m.id);

-- 5. 老项目 facet 字段（products-import-fields 组下的 stock confidence 筛选字段）
DELETE FROM cms_field_defs
WHERE name = 'facet-stock-confidence'
  AND group_id IN (SELECT id FROM cms_field_groups WHERE code = 'products-import-fields');
