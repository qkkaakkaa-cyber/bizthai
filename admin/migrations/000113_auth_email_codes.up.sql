SET search_path TO woocms, public;

-- 邮箱验证码(OTP)：注册前先发 6 位数字码到邮箱，校验通过才允许注册。
-- 按 email 关联(注册时用户尚不存在，故不挂 system_users 外键)；恒带 site_id 多租户维度。
-- 仅存验证码的 sha256(明文只出现在邮件里)；attempts 记错误尝试次数(超限即作废)。
CREATE TABLE IF NOT EXISTS auth_email_codes (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL,
    email       VARCHAR(255) NOT NULL,
    purpose     VARCHAR(16)  NOT NULL DEFAULT 'register',
    code_hash   CHAR(64)     NOT NULL,
    attempts    SMALLINT     NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ  NOT NULL,
    consumed_at TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_email_codes_purpose_check CHECK (purpose IN ('register'))
);

-- 取某邮箱某用途最新一枚码 + 冷却判定。
CREATE INDEX IF NOT EXISTS idx_auth_email_codes_lookup
    ON auth_email_codes (site_id, lower(email), purpose, created_at DESC);
