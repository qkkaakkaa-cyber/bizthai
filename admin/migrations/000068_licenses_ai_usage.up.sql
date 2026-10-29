CREATE TABLE IF NOT EXISTS woocms.licenses (
    id            BIGSERIAL PRIMARY KEY,
    license_key   VARCHAR(64)  NOT NULL UNIQUE,
    customer_name VARCHAR(200) NOT NULL DEFAULT '',
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    ai_enabled    BOOLEAN      NOT NULL DEFAULT true,
    ai_monthly_token_limit BIGINT NOT NULL DEFAULT 0,
    expires_at    TIMESTAMPTZ,
    notes         TEXT         NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS woocms.ai_usage (
    id                BIGSERIAL PRIMARY KEY,
    license_key       VARCHAR(64)  NOT NULL,
    instance_id       VARCHAR(64)  NOT NULL DEFAULT '',
    model             VARCHAR(100) NOT NULL DEFAULT '',
    prompt_tokens     BIGINT       NOT NULL DEFAULT 0,
    completion_tokens BIGINT       NOT NULL DEFAULT 0,
    total_tokens      BIGINT       NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_license_created_idx
ON woocms.ai_usage (license_key, created_at);
