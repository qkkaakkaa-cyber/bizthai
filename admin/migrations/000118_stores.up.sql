SET search_path TO woocms, public;

-- 门店管理:实体网点(名称/地址/地图坐标/营业信息/相册),前台「门店地图」展示并复用 form 模块发起预约。
-- 列名与类型须与 internal/domain/store/service.go 的 storeColumns / scanStore 严格对齐。
-- 站点维度 site_id;软删 deleted_at(回收以 deleted_at IS NULL 过滤);坐标可空(允许先建店后定位)。
CREATE TABLE IF NOT EXISTS cms_stores (
    id                    BIGSERIAL PRIMARY KEY,
    site_id               BIGINT       NOT NULL DEFAULT 1,
    code                  VARCHAR(160) NOT NULL,
    name                  VARCHAR(255) NOT NULL DEFAULT '',
    status                VARCHAR(32)  NOT NULL DEFAULT 'active',
    address               TEXT         NOT NULL DEFAULT '',
    lat                   DOUBLE PRECISION,
    lng                   DOUBLE PRECISION,
    phone                 VARCHAR(64)  NOT NULL DEFAULT '',
    business_hours        TEXT         NOT NULL DEFAULT '',
    cover_image           TEXT         NOT NULL DEFAULT '',
    gallery_json          JSONB        NOT NULL DEFAULT '[]'::jsonb,
    description           TEXT         NOT NULL DEFAULT '',
    category              VARCHAR(120) NOT NULL DEFAULT '',
    tags_json             JSONB        NOT NULL DEFAULT '[]'::jsonb,
    appointment_form_code VARCHAR(160) NOT NULL DEFAULT '',
    notify_json           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    extra_json            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    sort_no               INTEGER      NOT NULL DEFAULT 0,
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 同站点 code 唯一(仅未软删),冲突走 service.ErrDuplicateCode(23505)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_cms_stores_site_code
    ON cms_stores (site_id, code) WHERE deleted_at IS NULL;

-- 后台列表/前台展示常用过滤。
CREATE INDEX IF NOT EXISTS idx_cms_stores_site_status
    ON cms_stores (site_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cms_stores_site_category
    ON cms_stores (site_id, category) WHERE deleted_at IS NULL;
-- 预约提交后按表单 code 反查门店做门店级通知。
CREATE INDEX IF NOT EXISTS idx_cms_stores_form_code
    ON cms_stores (site_id, appointment_form_code) WHERE deleted_at IS NULL;
