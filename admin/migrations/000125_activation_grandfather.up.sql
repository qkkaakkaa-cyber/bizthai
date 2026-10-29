SET search_path TO woocms, public;

-- 「功能开关」从默认全开改为部分模块需激活码解锁后，已在运行的旧站不应因这次升级
-- 出现能力回退。信号选用「是否已有真实内容」而非逐模块查表——命中任意一项即判定为
-- 非全新安装，一次性豁免当前全部 premium 模块（豁免值直接落 feature 包的 PremiumKeys()
-- 清单，见 internal/domain/feature/registry.go；两处需保持同步）。
-- 过度豁免只是少收一次激活费，漏豁免则是线上功能骤然消失——故意选保守的一侧。
-- 全新安装届时这些表均为空，has_content=false，不豁免，走「默认仅文章/页面」新规则。
DO $$
DECLARE
    has_content BOOLEAN := FALSE;
BEGIN
    SELECT
        EXISTS (SELECT 1 FROM cms_posts)
        OR EXISTS (SELECT 1 FROM cms_pages)
        OR EXISTS (SELECT 1 FROM cms_content_entries)
        OR EXISTS (SELECT 1 FROM cms_forms)
        OR EXISTS (SELECT 1 FROM media_files)
        OR (SELECT COUNT(*) FROM system_users) > 1
    INTO has_content;

    IF has_content THEN
        INSERT INTO system_settings (site_id, key, value, updated_at)
        VALUES (
            1,
            'license.grandfathered_features',
            '["cpt","cpt_taxonomies","cpt_entries","fields","custom_template","data_sources","accounts","membership","favorites","claims","forms","stores","newsletter","i18n","api_docs"]',
            NOW()
        )
        ON CONFLICT (site_id, key) DO NOTHING;
    END IF;
END $$;
