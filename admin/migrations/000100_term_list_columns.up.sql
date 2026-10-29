SET search_path TO woocms, public;

-- 分类法术语列表「可配置展示列」。
-- 每项沿用内容模型列表列结构: {"field":"translation:en:name","label":"English","width":180}。
ALTER TABLE IF EXISTS cms_custom_taxonomies
    ADD COLUMN IF NOT EXISTS list_columns_json JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 术语自定义字段/扩展属性。当前列表先按配置读取 meta_json，后续术语表单可直接复用。
ALTER TABLE IF EXISTS cms_custom_terms
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;
