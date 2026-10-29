SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_forum_replies (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    parent_reply_id BIGINT NULL REFERENCES cms_forum_replies(id) ON DELETE CASCADE,
    user_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    author_name VARCHAR(128) NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'published',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_forum_replies_site_post_created
    ON cms_forum_replies (site_id, post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_forum_replies_site_status_created
    ON cms_forum_replies (site_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS cms_forum_online_sessions (
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    session_key VARCHAR(128) NOT NULL,
    user_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL,
    client_ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(255) NOT NULL DEFAULT '',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_cms_forum_online_sessions_site_last_seen
    ON cms_forum_online_sessions (site_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_cms_forum_online_sessions_site_user
    ON cms_forum_online_sessions (site_id, user_id);
