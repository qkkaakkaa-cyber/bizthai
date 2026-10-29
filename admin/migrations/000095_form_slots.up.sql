SET search_path TO woocms, public;

-- 预约时段(L2):为 kind=appointment 的表单定义可预约时段,带容量与已订计数,
-- 提交时在事务内行锁递增 booked_count 防止超额预订。

CREATE TABLE IF NOT EXISTS cms_form_slots (
    id           BIGSERIAL PRIMARY KEY,
    site_id      BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    form_id      BIGINT NOT NULL REFERENCES cms_forms(id) ON DELETE CASCADE,
    start_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ NOT NULL,
    capacity     INT NOT NULL DEFAULT 1,
    booked_count INT NOT NULL DEFAULT 0,
    status       VARCHAR(16) NOT NULL DEFAULT 'open', -- open | closed
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (form_id, start_at, end_at)
);

CREATE INDEX IF NOT EXISTS idx_cms_form_slots_form ON cms_form_slots(site_id, form_id, start_at);

-- 提交关联具体时段(无时段的简单预约该列为 NULL,appointment_at 仍从 data_json 投影)
ALTER TABLE cms_form_submissions
    ADD COLUMN IF NOT EXISTS slot_id BIGINT NULL REFERENCES cms_form_slots(id) ON DELETE SET NULL;
