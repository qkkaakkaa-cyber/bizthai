SET search_path TO woocms, public;

-- 短信验证码(OTP)：手机号注册/登录前先发 6 位数字码到手机，校验通过才放行。
-- 按 phone 关联(注册时用户尚不存在，故不挂 system_users 外键)；恒带 site_id 多租户维度。
-- 仅存验证码的 sha256(明文只发往短信)；attempts 记错误尝试次数(超限即作废)。
CREATE TABLE IF NOT EXISTS auth_sms_codes (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL,
    phone       VARCHAR(32)  NOT NULL,
    purpose     VARCHAR(16)  NOT NULL DEFAULT 'register',
    code_hash   CHAR(64)     NOT NULL,
    attempts    SMALLINT     NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ  NOT NULL,
    consumed_at TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_sms_codes_purpose_check CHECK (purpose IN ('register', 'login'))
);

-- 取某手机号某用途最新一枚码 + 冷却判定。
CREATE INDEX IF NOT EXISTS idx_auth_sms_codes_lookup
    ON auth_sms_codes (site_id, phone, purpose, created_at DESC);
