SET search_path TO woocms, public;

-- 前台用户邮箱验证状态：NULL=未验证；非空记录验证时间戳，供审计/合规。
-- 默认不强制验证（由站点配置 auth.email_verification.required 控制），存量用户为 NULL 不受影响。
ALTER TABLE system_users
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;
