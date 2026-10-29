-- 000111: 站点额外域名绑定展示语言（一个语言绑一个子域名，便于独立 SEO）。
-- locale 为空字符串 = 该域名走站点默认语言（即纯别名，与历史行为一致）；
-- locale 非空 = 访问该域名时强制以对应语言渲染（域名级多语言模式）。
-- 主域名(cms_sites.domain)恒等于站点默认语言，故无需在此表标注。
-- 整文件单事务执行（runner 负责）。幂等：列已存在则跳过。
ALTER TABLE cms_site_domains ADD COLUMN IF NOT EXISTS locale VARCHAR(16) NOT NULL DEFAULT '';
