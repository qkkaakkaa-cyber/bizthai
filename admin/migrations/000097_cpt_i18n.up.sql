SET search_path TO woocms, public;

-- CPT 定义层多语言:为内容模型/分类法/术语/字段定义补「定义文本」译文旁表(对齐 cms_form_translations 模式)。
-- 守「默认语言只读源表」契约:默认语言读 cms_content_models 等源表,非默认语言前台渲染时取本表译文覆盖。
-- AI 翻译走 cms_translation_jobs 队列(新增 content_model/taxonomy/term/field_def 四个 entity_type)。

-- 1a. 扩充内容模型主表:补 描述 / 单数名 / 复数名(对齐 WordPress CPT 习惯),再纳入多语言。
ALTER TABLE cms_content_models
    ADD COLUMN IF NOT EXISTS description    TEXT         NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS singular_label VARCHAR(128) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS plural_label   VARCHAR(128) NOT NULL DEFAULT '';

-- 1b. 内容模型定义文本译文。
CREATE TABLE IF NOT EXISTS cms_content_model_translations (
    id               BIGSERIAL PRIMARY KEY,
    site_id          BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    content_model_id BIGINT NOT NULL REFERENCES cms_content_models(id) ON DELETE CASCADE,
    locale           VARCHAR(16) NOT NULL,
    label            VARCHAR(128) NOT NULL DEFAULT '',
    description      TEXT NOT NULL DEFAULT '',
    singular_label   VARCHAR(128) NOT NULL DEFAULT '',
    plural_label     VARCHAR(128) NOT NULL DEFAULT '',
    status           VARCHAR(16) NOT NULL DEFAULT 'draft', -- draft/published,前台只读 published
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (content_model_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_cms_content_model_translations_site
    ON cms_content_model_translations (site_id, content_model_id);

-- 1c. 分类法定义文本译文。
CREATE TABLE IF NOT EXISTS cms_taxonomy_translations (
    id          BIGSERIAL PRIMARY KEY,
    site_id     BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    taxonomy_id BIGINT NOT NULL REFERENCES cms_custom_taxonomies(id) ON DELETE CASCADE,
    locale      VARCHAR(16) NOT NULL,
    label       VARCHAR(128) NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'draft',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (taxonomy_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_cms_taxonomy_translations_site
    ON cms_taxonomy_translations (site_id, taxonomy_id);

-- 1d. 术语译文:展示名 + 多语言 slug。taxonomy_id 冗余存,用于 (taxonomy,locale,slug) 唯一与前台反查。
CREATE TABLE IF NOT EXISTS cms_term_translations (
    id          BIGSERIAL PRIMARY KEY,
    site_id     BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    taxonomy_id BIGINT NOT NULL REFERENCES cms_custom_taxonomies(id) ON DELETE CASCADE,
    term_id     BIGINT NOT NULL REFERENCES cms_custom_terms(id) ON DELETE CASCADE,
    locale      VARCHAR(16) NOT NULL,
    name        VARCHAR(128) NOT NULL DEFAULT '',
    slug        VARCHAR(128) NOT NULL DEFAULT '',
    status      VARCHAR(16) NOT NULL DEFAULT 'draft',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (term_id, locale),
    UNIQUE (taxonomy_id, locale, slug)
);
CREATE INDEX IF NOT EXISTS idx_cms_term_translations_site
    ON cms_term_translations (site_id, term_id);
CREATE INDEX IF NOT EXISTS idx_cms_term_translations_slug
    ON cms_term_translations (site_id, locale, slug);

-- 1e. 字段定义文本译文:label/instructions/placeholder + 选项 label(JSONB {value:label})。
CREATE TABLE IF NOT EXISTS cms_field_def_translations (
    id                  BIGSERIAL PRIMARY KEY,
    site_id             BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    field_def_id        BIGINT NOT NULL REFERENCES cms_field_defs(id) ON DELETE CASCADE,
    locale              VARCHAR(16) NOT NULL,
    label               VARCHAR(128) NOT NULL DEFAULT '',
    instructions        TEXT NOT NULL DEFAULT '',
    placeholder         VARCHAR(255) NOT NULL DEFAULT '',
    options_labels_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status              VARCHAR(16) NOT NULL DEFAULT 'draft',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (field_def_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_cms_field_def_translations_site
    ON cms_field_def_translations (site_id, field_def_id);
