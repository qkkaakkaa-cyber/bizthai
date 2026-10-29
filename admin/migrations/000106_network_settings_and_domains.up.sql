-- 000106: 网络级设置 + 站点多域名（档2 完整网络管理）
-- network_settings: 网络范围键值配置，与站点级 system_settings(site_id,key) 区分。
-- cms_site_domains: 站点额外域名；主域名仍在 cms_sites.domain，前台 GetByDomain 两处都查。
-- 整文件单事务执行（runner 负责）。

CREATE TABLE IF NOT EXISTS network_settings (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_site_domains (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_site_domains_domain UNIQUE (domain)
);
CREATE INDEX IF NOT EXISTS idx_cms_site_domains_site ON cms_site_domains (site_id);

-- 回填：现有 cms_sites.domain 非空的迁为 primary 额外域名（幂等，按域名去重）。
INSERT INTO cms_site_domains (site_id, domain, is_primary, created_at)
SELECT id, LOWER(TRIM(domain)), true, NOW()
FROM cms_sites
WHERE TRIM(domain) <> ''
ON CONFLICT (domain) DO NOTHING;
