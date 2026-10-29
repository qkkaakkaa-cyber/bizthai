SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_sales_profiles (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    sales_code VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    title VARCHAR(128) NOT NULL DEFAULT '',
    public_email VARCHAR(255) NOT NULL DEFAULT '',
    public_phone VARCHAR(128) NOT NULL DEFAULT '',
    public_whatsapp VARCHAR(128) NOT NULL DEFAULT '',
    public_wechat VARCHAR(128) NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    landing_note TEXT NOT NULL DEFAULT '',
    is_public_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_manager BOOLEAN NOT NULL DEFAULT FALSE,
    priority INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_sales_profiles_site_user UNIQUE (site_id, user_id),
    CONSTRAINT uq_cms_sales_profiles_site_code UNIQUE (site_id, sales_code)
);

CREATE INDEX IF NOT EXISTS idx_cms_sales_profiles_site_enabled
    ON cms_sales_profiles (site_id, is_public_enabled, priority ASC, id ASC);

CREATE TABLE IF NOT EXISTS cms_customers (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    customer_key VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255) NOT NULL DEFAULT '',
    contact_email VARCHAR(255) NOT NULL DEFAULT '',
    contact_phone VARCHAR(128) NOT NULL DEFAULT '',
    company VARCHAR(255) NOT NULL DEFAULT '',
    country VARCHAR(128) NOT NULL DEFAULT '',
    owner_user_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    source_sales_profile_id BIGINT NULL REFERENCES cms_sales_profiles(id) ON DELETE SET NULL,
    source_sales_code VARCHAR(64) NOT NULL DEFAULT '',
    attribution_mode VARCHAR(32) NOT NULL DEFAULT 'direct',
    attribution_locked_until TIMESTAMPTZ NULL,
    first_touch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_touch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_landing_url TEXT NOT NULL DEFAULT '',
    last_landing_url TEXT NOT NULL DEFAULT '',
    first_referrer_url TEXT NOT NULL DEFAULT '',
    last_referrer_url TEXT NOT NULL DEFAULT '',
    first_utm_source VARCHAR(255) NOT NULL DEFAULT '',
    first_utm_medium VARCHAR(255) NOT NULL DEFAULT '',
    first_utm_campaign VARCHAR(255) NOT NULL DEFAULT '',
    last_utm_source VARCHAR(255) NOT NULL DEFAULT '',
    last_utm_medium VARCHAR(255) NOT NULL DEFAULT '',
    last_utm_campaign VARCHAR(255) NOT NULL DEFAULT '',
    stage VARCHAR(32) NOT NULL DEFAULT 'lead',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_customers_site_key UNIQUE (site_id, customer_key)
);

CREATE INDEX IF NOT EXISTS idx_cms_customers_site_owner
    ON cms_customers (site_id, owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_customers_stage
    ON cms_customers (site_id, stage, updated_at DESC);

ALTER TABLE IF EXISTS cms_inquiries
    ADD COLUMN IF NOT EXISTS customer_id BIGINT NULL REFERENCES cms_customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS owner_user_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sales_profile_id BIGINT NULL REFERENCES cms_sales_profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_sales_code VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS attribution_mode VARCHAR(32) NOT NULL DEFAULT 'direct',
    ADD COLUMN IF NOT EXISTS referrer_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cms_inquiries_site_owner_created
    ON cms_inquiries (site_id, owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_inquiries_site_customer_created
    ON cms_inquiries (site_id, customer_id, created_at DESC);

ALTER TABLE IF EXISTS auth_roles
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'custom',
    ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_editable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS is_deletable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS site_scope_mode VARCHAR(16) NOT NULL DEFAULT 'global',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS auth_permissions
    ADD COLUMN IF NOT EXISTS label VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS perm_group VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS domain VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS resource VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS action VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS risk_level VARCHAR(16) NOT NULL DEFAULT 'low',
    ADD COLUMN IF NOT EXISTS supported_scopes JSONB NOT NULL DEFAULT '["site"]'::jsonb,
    ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS auth_role_permissions
    ADD COLUMN IF NOT EXISTS scope_level VARCHAR(16) NOT NULL DEFAULT 'site',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

WITH base AS (
    SELECT
        i.site_id,
        CASE
            WHEN COALESCE(NULLIF(LOWER(TRIM(i.contact_email)), ''), '') <> '' THEN LOWER(TRIM(i.contact_email))
            WHEN COALESCE(NULLIF(TRIM(i.contact_phone), ''), '') <> '' THEN 'phone:' || LOWER(TRIM(i.contact_phone))
            ELSE 'inquiry:' || i.id::text
        END AS customer_key,
        MAX(COALESCE(i.contact_name, '')) AS contact_name,
        MAX(COALESCE(i.contact_email, '')) AS contact_email,
        MAX(COALESCE(i.contact_phone, '')) AS contact_phone,
        MAX(COALESCE(i.company, '')) AS company,
        MAX(COALESCE(i.country, '')) AS country,
        MIN(i.created_at) AS first_touch_at,
        MAX(i.created_at) AS last_touch_at,
        MAX(COALESCE(i.page_url, '')) AS last_landing_url,
        MAX(COALESCE(i.referrer_url, '')) AS last_referrer_url
    FROM cms_inquiries i
    GROUP BY i.site_id,
        CASE
            WHEN COALESCE(NULLIF(LOWER(TRIM(i.contact_email)), ''), '') <> '' THEN LOWER(TRIM(i.contact_email))
            WHEN COALESCE(NULLIF(TRIM(i.contact_phone), ''), '') <> '' THEN 'phone:' || LOWER(TRIM(i.contact_phone))
            ELSE 'inquiry:' || i.id::text
        END
)
INSERT INTO cms_customers (
    site_id, customer_key, contact_name, contact_email, contact_phone, company, country,
    first_touch_at, last_touch_at, first_landing_url, last_landing_url, first_referrer_url, last_referrer_url,
    created_at, updated_at
)
SELECT
    b.site_id,
    b.customer_key,
    b.contact_name,
    b.contact_email,
    b.contact_phone,
    b.company,
    b.country,
    b.first_touch_at,
    b.last_touch_at,
    b.last_landing_url,
    b.last_landing_url,
    b.last_referrer_url,
    b.last_referrer_url,
    NOW(),
    NOW()
FROM base b
ON CONFLICT (site_id, customer_key) DO NOTHING;

WITH mapping AS (
    SELECT
        i.id AS inquiry_id,
        c.id AS customer_id
    FROM cms_inquiries i
    JOIN cms_customers c
      ON c.site_id = i.site_id
     AND c.customer_key = CASE
        WHEN COALESCE(NULLIF(LOWER(TRIM(i.contact_email)), ''), '') <> '' THEN LOWER(TRIM(i.contact_email))
        WHEN COALESCE(NULLIF(TRIM(i.contact_phone), ''), '') <> '' THEN 'phone:' || LOWER(TRIM(i.contact_phone))
        ELSE 'inquiry:' || i.id::text
     END
)
UPDATE cms_inquiries i
SET customer_id = m.customer_id
FROM mapping m
WHERE i.id = m.inquiry_id
  AND COALESCE(i.customer_id, 0) <> m.customer_id;

INSERT INTO auth_roles (code, name, description, type, is_builtin, is_editable, is_deletable, site_scope_mode, created_at, updated_at)
VALUES
    ('sales_manager', '销售主管', '负责全站客户与询盘分配、业务员档案维护和转派', 'system', TRUE, TRUE, TRUE, 'site', NOW(), NOW()),
    ('sales_rep', '业务员', '仅查看并跟进归属到自己的客户与询盘', 'system', TRUE, TRUE, TRUE, 'site', NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action, risk_level, supported_scopes, dependencies, is_builtin, created_at, updated_at)
VALUES
    ('crm.lead.read', '查看客户与询盘', '查看客户与询盘', '查看客户档案、询盘池与归属数据', '客户与询盘', 'crm', 'lead', 'read', 'medium', '["self","site","all"]'::jsonb, '[]'::jsonb, TRUE, NOW(), NOW()),
    ('crm.lead.assign', '分配客户与询盘', '分配客户与询盘', '调整客户、询盘的归属业务员', '客户与询盘', 'crm', 'lead', 'assign', 'high', '["site","all"]'::jsonb, '["crm.lead.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('crm.customer.update', '更新客户资料', '更新客户资料', '维护客户阶段、备注与基础档案', '客户与询盘', 'crm', 'customer', 'update', 'medium', '["self","site","all"]'::jsonb, '["crm.lead.read"]'::jsonb, TRUE, NOW(), NOW()),
    ('crm.sales.manage', '管理销售档案', '管理销售档案', '维护业务员公开联系方式、分享链接与展示优先级', '客户与询盘', 'crm', 'sales', 'manage', 'high', '["site","all"]'::jsonb, '["crm.lead.read"]'::jsonb, TRUE, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id, scope_level, created_at, updated_at)
SELECT r.id, p.id, 'site', NOW(), NOW()
FROM auth_roles r
JOIN auth_permissions p ON p.code IN ('dashboard.view', 'dashboard.dashboard.view', 'crm.lead.read', 'crm.lead.assign', 'crm.customer.update', 'crm.sales.manage')
WHERE r.code = 'sales_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id, scope_level, created_at, updated_at)
SELECT r.id, p.id,
    CASE WHEN p.code IN ('dashboard.view', 'dashboard.dashboard.view') THEN 'site' ELSE 'self' END,
    NOW(), NOW()
FROM auth_roles r
JOIN auth_permissions p ON p.code IN ('dashboard.view', 'dashboard.dashboard.view', 'crm.lead.read', 'crm.customer.update')
WHERE r.code = 'sales_rep'
ON CONFLICT (role_id, permission_id) DO NOTHING;