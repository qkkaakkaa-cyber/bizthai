SET search_path TO woocms, public;

-- 手机号身份：把手机号提升为可登录/可注册的正式标识（与 username/email 并存）。
-- system_users 跨站点共享，phone 与 email 一样按全局唯一处理。

-- 1) 新增 phone 列（此前手机号只散落在 meta_json->>'phone' 作为联系电话资料）。
ALTER TABLE system_users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

-- 2) 回填历史 meta_json 中的手机号到 phone 列（仅非空者）。
UPDATE system_users
SET phone = NULLIF(TRIM(meta_json->>'phone'), '')
WHERE phone IS NULL
  AND NULLIF(TRIM(meta_json->>'phone'), '') IS NOT NULL;

-- 3) 去重：历史 meta_json 里手机号无唯一约束，同号可能重复。
--    建唯一索引前，同一手机号仅保留 id 最小者，其余置 NULL，避免唯一索引建失败阻断启动。
UPDATE system_users u
SET phone = NULL
WHERE u.phone IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM system_users u2
      WHERE u2.phone = u.phone AND u2.id < u.id
  );

-- 4) email 改为可空（手机号注册的用户可以没有邮箱）。
ALTER TABLE system_users ALTER COLUMN email DROP NOT NULL;

-- 5) 原 email 列级 UNIQUE 约束 → 部分唯一索引（允许多行 NULL，非空时仍唯一，等价于原约束）。
ALTER TABLE system_users DROP CONSTRAINT IF EXISTS system_users_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_users_email
    ON system_users (email) WHERE email IS NOT NULL;

-- 6) phone 部分唯一索引（一个手机号唯一对应一个账号；NULL 不参与）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_users_phone
    ON system_users (phone) WHERE phone IS NOT NULL;
