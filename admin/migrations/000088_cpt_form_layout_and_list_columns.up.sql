SET search_path TO woocms, public;

-- 需求一：内容模型「表单外观自定义」
--   字段组布局方式：block(默认竖排) / tab(选项卡) / accordion(折叠面板) / card(卡片)
ALTER TABLE IF EXISTS cms_field_groups
    ADD COLUMN IF NOT EXISTS layout VARCHAR(16) NOT NULL DEFAULT 'block';

--   字段栅格宽度(24 栅格制：24=全宽，12=半宽，8=1/3，6=1/4)，默认全宽=现状
ALTER TABLE IF EXISTS cms_field_defs
    ADD COLUMN IF NOT EXISTS col_span SMALLINT NOT NULL DEFAULT 24;

-- 需求二：条目列表「可配置列」
--   每项形如 {"field":"communityref","label":"所属小区","width":180}，空数组=现有固定列
ALTER TABLE IF EXISTS cms_content_models
    ADD COLUMN IF NOT EXISTS list_columns_json JSONB NOT NULL DEFAULT '[]'::jsonb;
