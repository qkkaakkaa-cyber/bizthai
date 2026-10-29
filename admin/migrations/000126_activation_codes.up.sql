-- 激活码注册表：仅发行端（RELEASE_DIR 已配）有意义地读写，但表在每个实例都创建
-- （与 000068 的 woocms.licenses / woocms.ai_usage 同一惯例），未启用发行端的实例上
-- 这张表始终为空，不产生任何影响。
--
-- 一码一站、永久授权（不设 expires_at）：status 从 active 经原子 CAS
-- （UPDATE ... WHERE status='active'）转为 redeemed，天然防止同一码被多个实例并发兑换；
-- 无需单独的多对多兑换记录表。
CREATE TABLE IF NOT EXISTS woocms.activation_codes (
    id                   BIGSERIAL PRIMARY KEY,
    code                 VARCHAR(48)  NOT NULL UNIQUE,
    features             TEXT[]       NOT NULL DEFAULT '{}',
    status               VARCHAR(20)  NOT NULL DEFAULT 'active', -- active | redeemed | revoked
    customer_name        VARCHAR(200) NOT NULL DEFAULT '',
    notes                TEXT         NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    redeemed_at          TIMESTAMPTZ,
    redeemed_by_instance VARCHAR(64)  NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_activation_codes_instance
    ON woocms.activation_codes (redeemed_by_instance)
    WHERE redeemed_by_instance <> '';
