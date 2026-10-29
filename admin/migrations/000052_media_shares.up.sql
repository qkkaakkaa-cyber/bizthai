CREATE TABLE IF NOT EXISTS media_shares (
    id           BIGSERIAL    PRIMARY KEY,
    site_id      BIGINT       NOT NULL,
    token        VARCHAR(64)  NOT NULL,
    share_type   VARCHAR(16)  NOT NULL DEFAULT 'file',
    media_id     BIGINT       NULL,
    folder_path  VARCHAR(512) NOT NULL DEFAULT '',
    share_name   VARCHAR(255) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    expires_at   TIMESTAMPTZ  NULL,
    view_count   BIGINT       NOT NULL DEFAULT 0,
    created_by   BIGINT       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT media_shares_type_check CHECK (share_type IN ('file', 'folder'))
);

CREATE UNIQUE INDEX IF NOT EXISTS media_shares_token_uidx ON media_shares (token);
CREATE INDEX IF NOT EXISTS media_shares_site_idx ON media_shares (site_id, created_by);
CREATE INDEX IF NOT EXISTS media_shares_expires_idx ON media_shares (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_shares_media_idx ON media_shares (site_id, media_id) WHERE media_id IS NOT NULL;
