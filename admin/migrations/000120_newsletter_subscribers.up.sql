SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_subscribers (
    id              BIGSERIAL    PRIMARY KEY,
    site_id         BIGINT       NOT NULL DEFAULT 1,
    email           TEXT         NOT NULL,
    name            TEXT         NOT NULL DEFAULT '',
    status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
    source          TEXT         NOT NULL DEFAULT '',
    token           TEXT         NOT NULL,
    ip_address      TEXT         NOT NULL DEFAULT '',
    subscribed_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_subscribers_site_email
    ON cms_subscribers (site_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_subscribers_token
    ON cms_subscribers (token);

CREATE INDEX IF NOT EXISTS idx_cms_subscribers_site_status
    ON cms_subscribers (site_id, status);
