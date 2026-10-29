SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_posts (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ NULL,
    author_id BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_posts_status ON cms_posts(status);
CREATE INDEX IF NOT EXISTS idx_cms_posts_updated_at ON cms_posts(updated_at DESC);
