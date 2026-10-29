-- 多语言系统核心（i18n）：
-- 1) 扩展文章翻译表（区块正文 + 来源指纹，用于过期检测与增量翻译）
-- 2) 新建页面/自定义模型条目翻译表（与文章翻译同构，每语言一行，独立 slug/状态/SEO）
-- 3) 字段定义可翻译标注（AI 翻译据此抽取 meta_json 文本）
-- 4) AI 翻译任务队列（异步 worker 消费，记录 token 用量 = 商业计费依据）
-- 5) 站点术语表（glossary，注入翻译 prompt 保证品牌/专有名词一致）
-- 6) AI 用量流水（所有 AI 场景统一计量地基）

ALTER TABLE cms_post_translations ADD COLUMN IF NOT EXISTS body_blocks JSONB NULL;
ALTER TABLE cms_post_translations ADD COLUMN IF NOT EXISTS source_hash VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE cms_post_translations ADD COLUMN IF NOT EXISTS segment_hashes JSONB NULL;

CREATE TABLE IF NOT EXISTS cms_page_translations (
    id BIGSERIAL PRIMARY KEY,
    page_id BIGINT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    body_blocks JSONB NULL,
    translation_status VARCHAR(16) NOT NULL DEFAULT 'draft',
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description VARCHAR(512) NOT NULL DEFAULT '',
    source_hash VARCHAR(64) NOT NULL DEFAULT '',
    segment_hashes JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_cms_page_translations_site_locale_slug
    ON cms_page_translations (site_id, locale, slug);

CREATE TABLE IF NOT EXISTS cms_entry_translations (
    id BIGSERIAL PRIMARY KEY,
    entry_id BIGINT NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    locale VARCHAR(16) NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    body_blocks JSONB NULL,
    meta_json JSONB NULL,
    translation_status VARCHAR(16) NOT NULL DEFAULT 'draft',
    seo_title VARCHAR(255) NOT NULL DEFAULT '',
    seo_description VARCHAR(512) NOT NULL DEFAULT '',
    source_hash VARCHAR(64) NOT NULL DEFAULT '',
    segment_hashes JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entry_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_cms_entry_translations_site_locale_slug
    ON cms_entry_translations (site_id, locale, slug);

ALTER TABLE cms_field_defs ADD COLUMN IF NOT EXISTS translatable BOOLEAN NOT NULL DEFAULT FALSE;
-- 文本类字段默认可翻译；数字/日期/关系/媒体等保持不可翻译
UPDATE cms_field_defs SET translatable = TRUE WHERE type IN ('text', 'textarea', 'wysiwyg', 'richtext', 'editor');

CREATE TABLE IF NOT EXISTS cms_translation_jobs (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL,
    entity_type VARCHAR(16) NOT NULL,         -- post | page | entry
    entity_id BIGINT NOT NULL,
    source_locale VARCHAR(16) NOT NULL,
    target_locale VARCHAR(16) NOT NULL,
    mode VARCHAR(16) NOT NULL DEFAULT 'full', -- full | incremental
    status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending | running | done | failed
    segments_total INT NOT NULL DEFAULT 0,
    segments_done INT NOT NULL DEFAULT 0,
    segments_reused INT NOT NULL DEFAULT 0,
    tokens_input BIGINT NOT NULL DEFAULT 0,
    tokens_output BIGINT NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    created_by BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_cms_translation_jobs_pending
    ON cms_translation_jobs (status, id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_cms_translation_jobs_entity
    ON cms_translation_jobs (site_id, entity_type, entity_id, id DESC);

CREATE TABLE IF NOT EXISTS cms_translation_terms (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL,
    source_term VARCHAR(255) NOT NULL,
    target_locale VARCHAR(16) NOT NULL,
    target_term VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, source_term, target_locale)
);

CREATE TABLE IF NOT EXISTS ai_usage_records (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL DEFAULT 1,
    user_id BIGINT NOT NULL DEFAULT 0,
    scene VARCHAR(32) NOT NULL,               -- complete | complete_stream | translation | image
    action VARCHAR(64) NOT NULL DEFAULT '',
    provider VARCHAR(32) NOT NULL DEFAULT '',
    model VARCHAR(64) NOT NULL DEFAULT '',
    tokens_input BIGINT NOT NULL DEFAULT 0,
    tokens_output BIGINT NOT NULL DEFAULT 0,
    tokens_total BIGINT NOT NULL DEFAULT 0,
    estimated BOOLEAN NOT NULL DEFAULT FALSE, -- 上游未返回 usage 时按字数估算
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_records_site_time
    ON ai_usage_records (site_id, created_at DESC);
