-- 选项页(Options Page)字段值的多语言译文旁表。
-- 守「默认语言只读源表」契约:源值仍存 cms_options_pages.values_json,
-- 非默认语言的译文值整页存于本表 values_json(与源同构,缺失字段前台回退源值)。
CREATE TABLE IF NOT EXISTS cms_options_page_translations (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL,
    page_code VARCHAR(150) NOT NULL,
    locale VARCHAR(35) NOT NULL,
    values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by BIGINT,
    CONSTRAINT uq_options_page_tr UNIQUE (site_id, page_code, locale)
);

CREATE INDEX IF NOT EXISTS idx_options_page_tr_site_code
    ON cms_options_page_translations (site_id, page_code);
