CREATE TABLE IF NOT EXISTS woocms.releases (
    id          BIGSERIAL PRIMARY KEY,
    version     VARCHAR(50)  NOT NULL,
    channel     VARCHAR(20)  NOT NULL DEFAULT 'stable',
    title       VARCHAR(200) NOT NULL DEFAULT '',
    changelog   TEXT         NOT NULL DEFAULT '',
    platform    VARCHAR(50)  NOT NULL DEFAULT 'linux-amd64',
    archive_name   VARCHAR(255) NOT NULL DEFAULT '',
    archive_sha256 CHAR(64)     NOT NULL DEFAULT '',
    archive_size   BIGINT       NOT NULL DEFAULT 0,
    published      BOOLEAN      NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    published_at   TIMESTAMPTZ,
    CONSTRAINT releases_version_unique UNIQUE (version)
);
