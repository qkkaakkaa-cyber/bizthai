SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    slug VARCHAR(128) NOT NULL UNIQUE,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_post_categories (
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    category_id BIGINT NOT NULL REFERENCES cms_categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, category_id)
);

CREATE TABLE IF NOT EXISTS cms_post_tags (
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES cms_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_categories_deleted_at ON cms_categories(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cms_tags_deleted_at ON cms_tags(deleted_at);
CREATE INDEX IF NOT EXISTS idx_cms_post_categories_category_id ON cms_post_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_cms_post_tags_tag_id ON cms_post_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_cms_posts_status_updated_at ON cms_posts(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_posts_title_lower ON cms_posts((lower(title)));
CREATE INDEX IF NOT EXISTS idx_cms_posts_slug_lower ON cms_posts((lower(slug)));
