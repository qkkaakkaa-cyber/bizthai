SET search_path TO woocms, public;

-- 会员等级体系：等级 + 能力点 + 等级-能力关联。
-- 能力(Capability)是三处门禁(内容/区块/前台 API)的唯一判定货币：
-- 等级只是能力的载体，门禁只问「用户是否具备某能力」。删/改等级不留悬空引用。

CREATE TABLE IF NOT EXISTS membership_levels (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    is_default  BOOLEAN      NOT NULL DEFAULT FALSE,   -- 默认/免费/回落等级，每站至多一个
    sort_order  INT          NOT NULL DEFAULT 0,       -- 等级高低/展示顺序
    status      SMALLINT     NOT NULL DEFAULT 1,       -- 1 启用 / 0 停用（软删）
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code)
);
-- 每站至多一个「启用的默认等级」。换默认等级须先把旧默认置 false（service 层事务处理）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_levels_default
    ON membership_levels (site_id) WHERE is_default = TRUE AND status = 1;
CREATE INDEX IF NOT EXISTS idx_membership_levels_site_sort
    ON membership_levels (site_id, sort_order);

CREATE TABLE IF NOT EXISTS membership_capabilities (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code        VARCHAR(64)  NOT NULL,                 -- download_files / view_premium / api_access
    name        VARCHAR(128) NOT NULL,
    description TEXT         NOT NULL DEFAULT '',
    status      SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code)
);

CREATE TABLE IF NOT EXISTS membership_level_capabilities (
    level_id      BIGINT      NOT NULL REFERENCES membership_levels(id) ON DELETE CASCADE,
    capability_id BIGINT      NOT NULL REFERENCES membership_capabilities(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (level_id, capability_id)
);
CREATE INDEX IF NOT EXISTS idx_mlc_capability ON membership_level_capabilities (capability_id);

-- 用户当前等级（1:1，带可选有效期）。过期由读时判定回落默认等级，不用 cron。
-- ON DELETE SET NULL：等级被删时用户回落到「无显式等级」，读时按默认等级兜底。
ALTER TABLE system_users
    ADD COLUMN IF NOT EXISTS current_tier_id BIGINT NULL REFERENCES membership_levels(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_system_users_tier ON system_users (current_tier_id);

-- 内容访问控制：access 列是内容属性（非用户态），随内容本体进缓存是安全的。
-- access_mode: public=公开 / logged_in=任意登录会员 / capability=需 required_capability 指定能力。
ALTER TABLE cms_posts
    ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS required_capability VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE cms_pages
    ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS required_capability VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE cms_content_entries
    ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS required_capability VARCHAR(64) NOT NULL DEFAULT '';

-- 后台权限码：会员等级查看 / 管理。
INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action)
VALUES
    ('membership.read',  '会员等级查看', '会员等级查看', '查看会员等级与能力点配置', '会员', 'membership', 'membership', 'read'),
    ('membership.write', '会员等级管理', '会员等级管理', '增删改会员等级、能力点与用户等级分配', '会员', 'membership', 'membership', 'write')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code IN ('membership.read', 'membership.write')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 空库种子：为每个已存在站点插默认免费等级；空库（无 cms_sites 行）则不插。
INSERT INTO membership_levels (site_id, code, name, description, is_default, sort_order, status)
SELECT s.id, 'free', '免费会员', '默认等级，注册用户自动归属', TRUE, 0, 1
FROM cms_sites s
WHERE NOT EXISTS (
    SELECT 1 FROM membership_levels m WHERE m.site_id = s.id AND m.is_default = TRUE
);
