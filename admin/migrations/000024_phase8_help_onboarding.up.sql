SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_user_help_states (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_announcement VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_user_help_states_site_user ON cms_user_help_states(site_id, user_id);
