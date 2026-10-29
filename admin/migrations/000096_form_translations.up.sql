SET search_path TO woocms, public;

-- 表单多语言:旁表存每语言译文(对齐 cms_*_translations 模式)。默认语言只读源表 cms_forms,
-- 非默认语言前台渲染时取此表译文合并覆盖。译文字段值(label/placeholder/options label)存 fields_json。

CREATE TABLE IF NOT EXISTS cms_form_translations (
    id              BIGSERIAL PRIMARY KEY,
    site_id         BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    form_id         BIGINT NOT NULL REFERENCES cms_forms(id) ON DELETE CASCADE,
    locale          VARCHAR(16) NOT NULL,
    title           VARCHAR(255) NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    submit_label    VARCHAR(128) NOT NULL DEFAULT '',
    success_message TEXT NOT NULL DEFAULT '',
    fields_json     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{name,label,placeholder,options:{value:label}}]
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (form_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_cms_form_translations_form ON cms_form_translations(site_id, form_id);
