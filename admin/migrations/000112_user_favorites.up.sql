SET search_path TO woocms, public;

-- 前台登录用户的内容收藏。entity_type 区分 post / page / entry(CPT 条目);
-- 多租户隔离恒带 site_id;同一站点同一用户同一内容只允许一条(UNIQUE)。
-- 用户被删 → 级联清收藏;站点被删 → 级联清收藏。
CREATE TABLE IF NOT EXISTS cms_user_favorites (
    id          BIGSERIAL    PRIMARY KEY,
    site_id     BIGINT       NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    user_id     BIGINT       NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    entity_type VARCHAR(16)  NOT NULL,
    entity_id   BIGINT       NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT cms_user_favorites_type_check CHECK (entity_type IN ('post', 'page', 'entry')),
    UNIQUE (site_id, user_id, entity_type, entity_id)
);

-- 「我的收藏」按用户取列表,按收藏时间倒序。
CREATE INDEX IF NOT EXISTS idx_cms_user_favorites_user
    ON cms_user_favorites (site_id, user_id, created_at DESC);

-- 后台统计/某内容被谁收藏:按内容聚合。
CREATE INDEX IF NOT EXISTS idx_cms_user_favorites_entity
    ON cms_user_favorites (site_id, entity_type, entity_id);
