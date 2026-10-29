-- 000107: audit_logs 补 site_id（可空，历史行 NULL），支持按站点维度审计。
-- 既有 Log 调用经 LogInSite(0) 委托，site_id 存 NULL；站级操作显式传 site_id。
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS site_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_audit_logs_site ON audit_logs (site_id, id DESC);
