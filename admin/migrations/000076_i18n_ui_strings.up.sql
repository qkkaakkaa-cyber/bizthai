-- 界面文案翻译（String Translation）：
-- 导航菜单 label、页头/页脚区块模板文本、内置 UI 文案（"暂无内容"等）按
-- 「原文精确匹配 → 译文」在前台渲染时替换。原文即 key，无需开发者维护 key 表。
CREATE TABLE IF NOT EXISTS cms_ui_strings (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL,
    locale VARCHAR(16) NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, locale, source_text)
);
CREATE INDEX IF NOT EXISTS idx_cms_ui_strings_lookup ON cms_ui_strings (site_id, locale);
