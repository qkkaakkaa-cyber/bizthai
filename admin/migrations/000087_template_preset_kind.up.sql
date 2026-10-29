SET search_path TO woocms, public;

-- 模板预设区分整页模板与可复用区块片段：
--   kind='page'  整页/body 模板（套用=替换整页源码）
--   kind='block' 区块片段（含自包含 html/css/js，套用=插入到当前源码）
ALTER TABLE cms_page_template_presets
  ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'page';
