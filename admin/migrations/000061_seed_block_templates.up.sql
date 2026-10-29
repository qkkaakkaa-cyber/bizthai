SET search_path TO woocms, public;

-- 为默认站点 (site_id=1) 种入开箱即用的全站模板区块。
-- blocks_json 为 Puck Data：{root, content, zones}。所有区块 props 带唯一 id。

INSERT INTO cms_block_templates (site_id, template_type, template_key, name, blocks_json) VALUES
(1, 'header', '', '默认页头', '{
  "root": {"props": {}},
  "content": [
    {"type": "SiteLogo", "props": {"id": "SiteLogo-seed", "size": "md"}},
    {"type": "NavMenu", "props": {"id": "NavMenu-seed", "location": "main"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'footer', '', '默认页脚', '{
  "root": {"props": {}},
  "content": [
    {"type": "Html", "props": {"id": "Html-footer", "content": "<div style=\"text-align:center;padding:24px;color:#64748b\">© WooCMS · Powered by WooCMS</div>"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'sidebar', '', '默认侧栏', '{
  "root": {"props": {}},
  "content": [
    {"type": "Heading", "props": {"id": "Heading-sb", "level": 3, "text": "关于本站", "align": "left"}},
    {"type": "Paragraph", "props": {"id": "Para-sb", "text": "使用 WooCMS 区块系统搭建。", "align": "left"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'front-page', '', '首页模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostContent", "props": {"id": "PostContent-front"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'index', '', '通用列表模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostContent", "props": {"id": "PostContent-index"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'archive-post', '', '文章归档模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostContent", "props": {"id": "PostContent-archive"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'search', '', '搜索结果模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostContent", "props": {"id": "PostContent-search"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'single-post', '', '文章详情模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostTitle", "props": {"id": "PostTitle-sp", "tag": "h1"}},
    {"type": "PostContent", "props": {"id": "PostContent-sp"}}
  ],
  "zones": {}
}'::jsonb),

(1, 'single-page', '', '独立页面模板', '{
  "root": {"props": {}},
  "content": [
    {"type": "PostContent", "props": {"id": "PostContent-pg"}}
  ],
  "zones": {}
}'::jsonb)
ON CONFLICT (site_id, template_type, template_key) DO NOTHING;

-- 复用现有"外观与主题"菜单项，改指向新的区块模板编辑器入口
UPDATE cms_admin_menus
   SET menu_name = '外观/模板',
       route_name = 'Appearance',
       route_path = '/admin/templates',
       icon = 'fas fa-paint-brush'
 WHERE menu_code = 'appearance';
