-- 客户端实例：备注 + 实例级 AI 覆盖配置
-- note        管理员给实例打的备注，用于区分客户
-- ai_mode     inherit=继承发布端上游(默认计费) | custom=我方专属 key/模型(照价计费留痕,不限额)
--             | byo=客户自带 key(仅记录 token 用量,不计成本/不限额)
-- ai_api_key  覆盖上游密钥(custom/byo 模式生效；明文存发布端自有库)
-- ai_base_url 覆盖上游地址，留空回退发布端默认上游
-- ai_model    覆盖模型，留空回退请求体/默认模型
ALTER TABLE woocms.update_clients
    ADD COLUMN IF NOT EXISTS note        TEXT         NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ai_mode     VARCHAR(16)  NOT NULL DEFAULT 'inherit',
    ADD COLUMN IF NOT EXISTS ai_api_key  TEXT         NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ai_base_url TEXT         NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS ai_model    VARCHAR(100) NOT NULL DEFAULT '';
