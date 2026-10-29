SET search_path TO woocms, public;

-- 门店「控货数量」:每个门店一个手填整数(后台维护),前台「附近门店」按点位展示该数字。
-- 与 form_slots 的时段容量无关,纯门店属性。列名须与 internal/domain/store/service.go 的 storeColumns/scanStore 对齐。
ALTER TABLE cms_stores
    ADD COLUMN IF NOT EXISTS control_count INTEGER NOT NULL DEFAULT 0;

-- 附近门店查询(haversine)对已定位门店做全扫 + 距离计算;此偏索引把「有坐标且可展示」的门店预过滤出来。
CREATE INDEX IF NOT EXISTS idx_cms_stores_site_geo
    ON cms_stores (site_id)
    WHERE deleted_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;
