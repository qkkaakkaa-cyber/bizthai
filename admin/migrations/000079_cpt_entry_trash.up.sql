-- CPT 条目回收站:软删标记。NULL = 正常;非 NULL = 在回收站。
ALTER TABLE cms_content_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_content_entries_deleted ON cms_content_entries (site_id, deleted_at) WHERE deleted_at IS NOT NULL;
