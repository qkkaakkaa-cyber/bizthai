SET search_path TO woocms, public;

-- CPT 条目认领 + Owner 字段级授权编辑(通用核心能力)。
-- 目录类网站(企业黄页/医生目录/房产/招聘…)通用:前台用户认领某条 CPT 条目(如「企业」),
-- 后台人工审批通过后成为该条目 owner,可在前台编辑「管理员授权的字段」。
-- 授权粒度=模型级统一(模型上配置白名单,全模型条目共享);改后是否复核由模型开关决定。

-- 1) 条目归属:owner_id 指向前台用户(与 author_id 同表 system_users)。
-- ON DELETE SET NULL:owner 注销则条目自动脱离归属,不留悬空。
ALTER TABLE cms_content_entries
    ADD COLUMN IF NOT EXISTS owner_id BIGINT NULL REFERENCES system_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_content_entries_owner
    ON cms_content_entries (site_id, owner_id) WHERE owner_id IS NOT NULL;

-- 2) 模型级认领配置。默认 allow_claim=FALSE:对既有模型零破坏(条目不可被认领,直到模型显式开启)。
--    claim_requires_review 默认 TRUE(安全优先:owner 改动先入待审);owner_editable_fields 存字段 name 白名单。
ALTER TABLE cms_content_models
    ADD COLUMN IF NOT EXISTS allow_claim           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS claim_requires_review BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS owner_editable_fields JSONB   NOT NULL DEFAULT '[]'::jsonb;

-- 3) 认领申请表。状态机 pending/approved/rejected。evidence_json 留扩展余地(凭证附件/邮箱域名等)。
CREATE TABLE IF NOT EXISTS cms_entry_claims (
    id            BIGSERIAL    PRIMARY KEY,
    site_id       BIGINT       NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    entry_id      BIGINT       NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    user_id       BIGINT       NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',   -- pending / approved / rejected
    note          TEXT         NOT NULL DEFAULT '',           -- 申请人留言
    reject_reason TEXT         NOT NULL DEFAULT '',
    evidence_json JSONB        NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by   BIGINT       NULL REFERENCES system_users(id) ON DELETE SET NULL,
    reviewed_at   TIMESTAMPTZ  NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- 同一条目同一用户至多一条 pending(被拒/通过后可重新申请)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_claims_pending
    ON cms_entry_claims (entry_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_entry_claims_site_status
    ON cms_entry_claims (site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entry_claims_user
    ON cms_entry_claims (site_id, user_id);

-- 4) Owner 待审改动暂存表(claim_requires_review=TRUE 时使用)。
--    不复用 cms_content_entry_versions:版本表是「已生效历史快照/rollback」语义,未生效草稿混入会污染时间线。
--    proposed_meta_json 只存白名单字段子集(含被清空字段的 null 标记);批准时合并进 entry.meta_json。
CREATE TABLE IF NOT EXISTS cms_entry_field_revisions (
    id                 BIGSERIAL   PRIMARY KEY,
    site_id            BIGINT      NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    entry_id           BIGINT      NOT NULL REFERENCES cms_content_entries(id) ON DELETE CASCADE,
    owner_id           BIGINT      NOT NULL REFERENCES system_users(id) ON DELETE CASCADE,
    status             VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending / approved / rejected
    proposed_meta_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
    reject_reason      TEXT        NOT NULL DEFAULT '',
    reviewed_by        BIGINT      NULL REFERENCES system_users(id) ON DELETE SET NULL,
    reviewed_at        TIMESTAMPTZ NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 每个条目至多一条待审改动(后提交覆盖前一条,由 service 层 UPSERT 保证)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_field_revisions_pending
    ON cms_entry_field_revisions (entry_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_entry_field_revisions_site_status
    ON cms_entry_field_revisions (site_id, status, created_at DESC);

-- 5) 后台权限码:认领审批查看 / 处理。
INSERT INTO auth_permissions (code, name, label, description, perm_group, domain, resource, action)
VALUES
    ('claim.read',  '认领审批查看', '认领审批查看', '查看企业认领申请与 owner 字段改动待审', '内容', 'claim', 'claim', 'read'),
    ('claim.write', '认领审批处理', '认领审批处理', '批准/拒绝认领申请与 owner 字段改动', '内容', 'claim', 'claim', 'write')
ON CONFLICT (code) DO NOTHING;

INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM auth_roles r, auth_permissions p
WHERE r.code = 'admin' AND p.code IN ('claim.read', 'claim.write')
ON CONFLICT (role_id, permission_id) DO NOTHING;
