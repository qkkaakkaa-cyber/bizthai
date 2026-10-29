SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS cms_operation_notifications (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    actor_id BIGINT NULL,
    source VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    method VARCHAR(16) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL,
    message TEXT NOT NULL,
    error_reason TEXT NOT NULL DEFAULT '',
    request_id VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_op_notifications_site_id_id
    ON cms_operation_notifications (site_id, id);

CREATE INDEX IF NOT EXISTS idx_op_notifications_created_at
    ON cms_operation_notifications (created_at DESC);
