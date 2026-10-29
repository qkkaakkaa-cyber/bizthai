SET search_path TO woocms, public;

-- 短信发送流水：手动群发/单发、测试发送、验证码等所有发送动作留痕，便于排障与审计。
-- 恒带 site_id 多租户维度；scene 区分场景，status 记成败，provider_msgid 存上游回执 id。
CREATE TABLE IF NOT EXISTS sms_send_logs (
    id             BIGSERIAL    PRIMARY KEY,
    site_id        BIGINT       NOT NULL,
    phone          VARCHAR(32)  NOT NULL,
    provider       VARCHAR(16)  NOT NULL DEFAULT '',
    sign_name      VARCHAR(64)  NOT NULL DEFAULT '',
    template_code  VARCHAR(64)  NOT NULL DEFAULT '',
    params_json    JSONB        NULL,
    scene          VARCHAR(24)  NOT NULL DEFAULT 'manual',
    status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
    provider_msgid VARCHAR(128) NOT NULL DEFAULT '',
    error          TEXT         NOT NULL DEFAULT '',
    operator_id    BIGINT       NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 后台发送记录列表：按站点倒序翻页。
CREATE INDEX IF NOT EXISTS idx_sms_send_logs_site_created
    ON sms_send_logs (site_id, created_at DESC);
