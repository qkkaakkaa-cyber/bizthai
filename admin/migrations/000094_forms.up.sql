SET search_path TO woocms, public;

-- 表单管理:通用自定义表单(联系/预约/报名/问卷…)。
-- 字段定义内联存 fields_json(snake_case,镜像 cpt 字段 DTO),复用 cpt 字段运行时做校验;
-- 提交值存 data_json(对齐 cms_content_entries.meta_json,不开旁表)。

-- 表单定义
CREATE TABLE IF NOT EXISTS cms_forms (
    id                BIGSERIAL PRIMARY KEY,
    site_id           BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    code              VARCHAR(128) NOT NULL,                  -- 站内唯一别名(slug 风格,前台/短代码引用)
    title             VARCHAR(255) NOT NULL DEFAULT '',
    kind              VARCHAR(32)  NOT NULL DEFAULT 'form',   -- form | appointment
    description       TEXT NOT NULL DEFAULT '',
    fields_json       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- []FormField(name/label/type/options/conditional/sub_fields…)
    settings_json     JSONB NOT NULL DEFAULT '{}'::jsonb,     -- submit_label/success_message/redirect_url/appointment_date_field/notify_*/captcha_provider/_form_style
    list_columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,     -- []ListColumnDef,后台提交列表动态列
    status            VARCHAR(32) NOT NULL DEFAULT 'active',  -- active | disabled
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cms_forms_site ON cms_forms(site_id, status, updated_at DESC);

-- 表单提交记录
CREATE TABLE IF NOT EXISTS cms_form_submissions (
    id             BIGSERIAL PRIMARY KEY,
    site_id        BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    form_id        BIGINT NOT NULL REFERENCES cms_forms(id) ON DELETE CASCADE,
    data_json      JSONB NOT NULL DEFAULT '{}'::jsonb,    -- 字段值(事实来源)
    appointment_at TIMESTAMPTZ NULL,                      -- 预约投影列(kind=appointment 时从 data_json 投影,便于排序/筛选)
    status         VARCHAR(32) NOT NULL DEFAULT 'new',    -- form: new|read|archived; appointment: pending|confirmed|completed|cancelled
    is_read        BOOLEAN NOT NULL DEFAULT FALSE,        -- 后台未读 badge
    ip             VARCHAR(64) NOT NULL DEFAULT '',
    user_agent     VARCHAR(512) NOT NULL DEFAULT '',
    referer        TEXT NOT NULL DEFAULT '',
    deleted_at     TIMESTAMPTZ NULL,                      -- 软删(回收站契约:读查询须带 deleted_at IS NULL)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_form_subs_form_created ON cms_form_submissions(site_id, form_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_form_subs_status       ON cms_form_submissions(site_id, form_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_form_subs_appointment  ON cms_form_submissions(site_id, appointment_at) WHERE appointment_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_form_subs_unread       ON cms_form_submissions(site_id, form_id) WHERE NOT is_read AND deleted_at IS NULL;
