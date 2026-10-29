SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_sites (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    domain VARCHAR(255) NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    default_locale VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
    fallback_locales JSONB NOT NULL DEFAULT '["zh-CN"]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cms_sites (code, name, domain, enabled, is_default, default_locale, fallback_locales)
VALUES ('default', '默认站点', '', TRUE, TRUE, 'zh-CN', '["zh-CN"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    default_site_id BIGINT;
BEGIN
    SELECT id INTO default_site_id FROM cms_sites WHERE code = 'default' LIMIT 1;

    ALTER TABLE cms_posts ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE cms_posts SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE cms_posts ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE cms_categories ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE cms_categories SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE cms_categories ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE cms_tags ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE cms_tags SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE cms_tags ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE media_files SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE media_files ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE site_menus ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE site_menus SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE site_menus ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE system_settings SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE system_settings ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE cms_post_versions ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE cms_post_versions v
    SET site_id = p.site_id
    FROM cms_posts p
    WHERE v.post_id = p.id AND v.site_id IS NULL;
    UPDATE cms_post_versions SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE cms_post_versions ALTER COLUMN site_id SET NOT NULL;

    ALTER TABLE cms_publish_jobs ADD COLUMN IF NOT EXISTS site_id BIGINT;
    UPDATE cms_publish_jobs j
    SET site_id = p.site_id
    FROM cms_posts p
    WHERE j.post_id = p.id AND j.site_id IS NULL;
    UPDATE cms_publish_jobs SET site_id = default_site_id WHERE site_id IS NULL;
    ALTER TABLE cms_publish_jobs ALTER COLUMN site_id SET NOT NULL;
END $$;

ALTER TABLE cms_posts DROP CONSTRAINT IF EXISTS cms_posts_slug_key;
ALTER TABLE cms_categories DROP CONSTRAINT IF EXISTS cms_categories_slug_key;
ALTER TABLE cms_tags DROP CONSTRAINT IF EXISTS cms_tags_slug_key;
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_posts_site_slug ON cms_posts (site_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_categories_site_slug ON cms_categories (site_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_tags_site_slug ON cms_tags (site_id, slug);
ALTER TABLE system_settings ADD PRIMARY KEY (site_id, key);

CREATE INDEX IF NOT EXISTS idx_cms_posts_site_id ON cms_posts (site_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_categories_site_id ON cms_categories (site_id, name);
CREATE INDEX IF NOT EXISTS idx_cms_tags_site_id ON cms_tags (site_id, name);
CREATE INDEX IF NOT EXISTS idx_media_files_site_id ON media_files (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_menus_site_name_sort ON site_menus (site_id, name, sort_order);
CREATE INDEX IF NOT EXISTS idx_cms_post_versions_site_post ON cms_post_versions (site_id, post_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_cms_publish_jobs_site_due ON cms_publish_jobs (site_id, status, run_at ASC);

CREATE TABLE IF NOT EXISTS auth_user_site_roles (
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, site_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_user_site_roles_site_id ON auth_user_site_roles (site_id, user_id);

INSERT INTO auth_user_site_roles (user_id, site_id, role_id)
SELECT ur.user_id, s.id, ur.role_id
FROM auth_user_roles ur
CROSS JOIN cms_sites s
WHERE s.code = 'default'
ON CONFLICT (user_id, site_id, role_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cms_post_translations (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    translation_status VARCHAR(16) NOT NULL DEFAULT 'draft',
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description VARCHAR(512) NOT NULL DEFAULT '',
    seo_og_image VARCHAR(512) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, locale),
    UNIQUE (site_id, locale, slug)
);

CREATE INDEX IF NOT EXISTS idx_cms_post_translations_site_locale_status
    ON cms_post_translations (site_id, locale, translation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS seo_redirect_rules (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    from_path VARCHAR(512) NOT NULL,
    to_path VARCHAR(1024) NOT NULL,
    status_code INT NOT NULL DEFAULT 301,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    hit_count BIGINT NOT NULL DEFAULT 0,
    last_hit_at TIMESTAMPTZ NULL,
    created_by BIGINT NOT NULL REFERENCES system_users(id),
    updated_by BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, from_path)
);

CREATE INDEX IF NOT EXISTS idx_seo_redirect_rules_site_enabled
    ON seo_redirect_rules (site_id, enabled, from_path);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    event_type VARCHAR(128) NOT NULL,
    endpoint_url VARCHAR(1024) NOT NULL,
    secret VARCHAR(255) NOT NULL,
    timeout_seconds INT NOT NULL DEFAULT 5,
    max_retries INT NOT NULL DEFAULT 5,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT NOT NULL REFERENCES system_users(id),
    updated_by BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_site_event
    ON webhook_subscriptions (site_id, event_type, enabled);

CREATE TABLE IF NOT EXISTS platform_events (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    event_type VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_site_type ON platform_events (site_id, event_type, id DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES platform_events(id) ON DELETE CASCADE,
    subscription_id BIGINT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_status INT NULL,
    response_body TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    delivered_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
    ON webhook_deliveries (status, next_retry_at ASC);
