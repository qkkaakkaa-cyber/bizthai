SET search_path TO woocms, public;

-- 全站模板区块（页头/页脚/侧栏/内容模板等），blocks_json 采用 Puck Data 形态 {root, content, zones}
CREATE TABLE IF NOT EXISTS cms_block_templates (
    id            BIGSERIAL PRIMARY KEY,
    site_id       BIGINT       NOT NULL DEFAULT 1,
    template_type VARCHAR(64)  NOT NULL,           -- header|footer|sidebar|front-page|index|single-post|archive-post|single-page|search|single-<cpt>|archive-<cpt>
    template_key  VARCHAR(128) NOT NULL DEFAULT '',-- 细分键（对应 page.template_key / CPT code），默认空
    name          VARCHAR(255) NOT NULL DEFAULT '',
    blocks_json   JSONB        NOT NULL DEFAULT '{"root":{"props":{}},"content":[],"zones":{}}'::jsonb,
    status        VARCHAR(32)  NOT NULL DEFAULT 'published', -- draft|published
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    version_no    INT          NOT NULL DEFAULT 1,
    created_by    BIGINT       NULL,
    updated_by    BIGINT       NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, template_type, template_key)
);

CREATE INDEX IF NOT EXISTS idx_cms_block_templates_lookup
    ON cms_block_templates (site_id, template_type, template_key, is_active);

-- 模板 JSON 版本快照（回滚用）
CREATE TABLE IF NOT EXISTS cms_block_template_versions (
    id          BIGSERIAL PRIMARY KEY,
    template_id BIGINT       NOT NULL REFERENCES cms_block_templates(id) ON DELETE CASCADE,
    version_no  INT          NOT NULL,
    blocks_json JSONB        NOT NULL DEFAULT '{}'::jsonb,
    operator_id BIGINT       NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (template_id, version_no)
);

-- 内容正文区块：与既有 body(HTML) 并存，空则渲染时回退为 Html 区块承载旧 HTML
ALTER TABLE IF EXISTS cms_posts           ADD COLUMN IF NOT EXISTS body_blocks JSONB NULL;
ALTER TABLE IF EXISTS cms_pages           ADD COLUMN IF NOT EXISTS body_blocks JSONB NULL;
ALTER TABLE IF EXISTS cms_content_entries ADD COLUMN IF NOT EXISTS body_blocks JSONB NULL;
