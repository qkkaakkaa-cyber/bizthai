-- BizThai 增量同步接收端:批次审计/幂等日志表
-- 只新增这 2 张小表;core 大表 cms_content_entries 零改动(meta_json 是 jsonb,补采 5 字段 +
-- _patch_meta 写入即生效,无需 ALTER)。
--
-- 安装:
--   psql "$DSN" -f ingest/deploy/schema.sql
-- 幂等:可重复执行(IF NOT EXISTS)。
--
-- 说明:不新建 spec §4 的 jpno 函数索引 —— slug 恒等于 meta_json->>'jpno',
-- (site_id, content_model_id, slug) 已是唯一索引,manifest/upsert/patch 全走它。

SET search_path TO woocms, public;

-- 批次头:batch_id 作 PK = 幂等锚点 + 批次核对来源
CREATE TABLE IF NOT EXISTS woocms.dbd_sync_batches (
  batch_id        text PRIMARY KEY,
  kind            text NOT NULL,              -- upsert | patch_fields
  status          text NOT NULL,              -- processing | completed | failed
  source          text,                       -- 调用方标识(payload.source)
  received_count  integer DEFAULT 0,
  inserted_count  integer DEFAULT 0,
  updated_count   integer DEFAULT 0,
  patched_count   integer DEFAULT 0,
  skipped_count   integer DEFAULT 0,
  conflict_count  integer DEFAULT 0,          -- conflict_same_date_changed(spec §2.2)
  missing_count   integer DEFAULT 0,          -- patch 时公司不存在(spec §2.3)
  failed_count    integer DEFAULT 0,
  error_json      jsonb,
  started_at      timestamptz DEFAULT now(),
  finished_at     timestamptz
);

-- 批次明细:逐条记录 action + 旧值(source_update_date / content_hash),供回滚与审计
CREATE TABLE IF NOT EXISTS woocms.dbd_sync_batch_items (
  batch_id            text NOT NULL,
  jpno                text NOT NULL,
  action              text NOT NULL,          -- inserted|updated|skipped_not_newer|conflict_same_date_changed|patched|missing_company|failed
  entry_id            bigint,
  old_source_update_date text,                -- 写入前库内 updatedate(回滚用)
  old_content_hash    text,                   -- 写入前 _sync.content_hash(回滚用)
  error               text,
  processed_at        timestamptz DEFAULT now(),
  PRIMARY KEY (batch_id, jpno)
);

-- 按批次拉明细(核对/回滚)
CREATE INDEX IF NOT EXISTS idx_dbd_sync_batch_items_batch
  ON woocms.dbd_sync_batch_items (batch_id);
