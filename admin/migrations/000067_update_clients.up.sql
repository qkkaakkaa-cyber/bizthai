CREATE TABLE IF NOT EXISTS woocms.update_clients (
    instance_id VARCHAR(64)  PRIMARY KEY,
    hostname    VARCHAR(255) NOT NULL DEFAULT '',
    version     VARCHAR(50)  NOT NULL DEFAULT '',
    channel     VARCHAR(20)  NOT NULL DEFAULT 'stable',
    platform    VARCHAR(50)  NOT NULL DEFAULT '',
    ip          VARCHAR(64)  NOT NULL DEFAULT '',
    first_seen  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    check_count BIGINT       NOT NULL DEFAULT 1
);
