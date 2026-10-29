SET search_path TO woocms, public;

-- 页面「自定义模板」渲染模式:
-- 在现有 cms_pages 上增加一种与区块编辑器独立的内容形态——AI 生成的模板源码,
-- 前台访问时由后端 pagetpl 引擎解析 <wc-data> 数据标签、取真实系统数据填充后输出(可含任意 JS)。
--   render_mode        'blocks'(区块,默认) | 'template'(自定义模板)
--   template_source    模板源码,原样存储(不过 bluemonday;写入受 settings.write 权限闸门保护)
--   template_full_page  true=模板自带 <html>/<head> 整页接管;false=只写 body,套站点页头/页脚/SEO 壳
ALTER TABLE cms_pages
  ADD COLUMN IF NOT EXISTS render_mode VARCHAR(32) NOT NULL DEFAULT 'blocks',
  ADD COLUMN IF NOT EXISTS template_source TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_full_page BOOLEAN NOT NULL DEFAULT FALSE;
