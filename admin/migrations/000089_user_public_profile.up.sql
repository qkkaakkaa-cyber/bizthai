-- 给用户表增加「公开作者资料」列：显示名、头像、简介。
-- 供页面自定义模板的 users（作者）数据源与文章/条目作者信息展示使用；均可空，默认回退到 username。
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS display_name VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS avatar_url   TEXT        NOT NULL DEFAULT '';
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS bio          TEXT        NOT NULL DEFAULT '';
