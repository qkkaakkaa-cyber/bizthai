SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_post_versions (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL,
    published_at TIMESTAMPTZ NULL,
    change_summary VARCHAR(255) NOT NULL DEFAULT '',
    operator_id BIGINT NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, version_no)
);

CREATE TABLE IF NOT EXISTS cms_publish_jobs (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,
    run_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_by BIGINT NOT NULL REFERENCES system_users(id),
    executed_at TIMESTAMPTZ NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_post_versions_post_id_version_no ON cms_post_versions(post_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_cms_publish_jobs_due ON cms_publish_jobs(status, run_at ASC);
