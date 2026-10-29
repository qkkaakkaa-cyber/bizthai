SET search_path TO woocms, public;

-- 前台用户认证临时凭证（邮箱验证 / 密码重置）。
-- 仅存 token 的 sha256(hex)，明文只出现在发给用户的邮件链接里；库泄露也无法直接使用。
CREATE TABLE IF NOT EXISTS auth_user_tokens (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL,
    user_id     BIGINT       NOT NULL,
    token_hash  CHAR(64)     NOT NULL,
    token_type  VARCHAR(16)  NOT NULL,
    expires_at  TIMESTAMPTZ  NOT NULL,
    used_at     TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT auth_user_tokens_type_check CHECK (token_type IN ('verify_email', 'reset_password'))
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_user_tokens_hash_uidx ON auth_user_tokens (token_hash);
CREATE INDEX IF NOT EXISTS auth_user_tokens_user_idx ON auth_user_tokens (site_id, user_id, token_type);
CREATE INDEX IF NOT EXISTS auth_user_tokens_expires_idx ON auth_user_tokens (expires_at) WHERE used_at IS NULL;
