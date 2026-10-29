-- 精确成本计费:把 AI 配额从「平均 token 数」升级为「按模型真实成本」计量。
-- 核心原则:记账时即冻结成本快照(费率快照 + cost_nano),价格表此后随意调价
-- 都不影响历史账单与对账。单位一律 nanoUSD(1e-9 USD)整数,杜绝浮点累加误差。

-- 1) 模型价格表(全局,不分 site;发布端维护)。input/output 分开计价——几乎所有
--    模型 output 都比 input 贵数倍,只看 total_tokens 会系统性低估长输出场景的成本。
--    数值为示意量级(nanoUSD/token),以各供应商官网价目为准,发布端可在后台调整。
CREATE TABLE IF NOT EXISTS ai_model_pricing (
    model       VARCHAR(100) PRIMARY KEY,
    provider    VARCHAR(32)  NOT NULL DEFAULT '',
    input_nano  BIGINT       NOT NULL DEFAULT 0,   -- 每 input token 采购成本(nanoUSD)
    output_nano BIGINT       NOT NULL DEFAULT 0,   -- 每 output token 采购成本(nanoUSD)
    markup_bps  INT          NOT NULL DEFAULT 0,   -- 加价率(万分比),计入客户配额时叠加
    active      BOOLEAN      NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- '*' 为兜底通配行:命中不到精确模型时按它计费(偏高),防止新接入模型漏计费。
-- markup 默认 5000bps(=50%),覆盖发布端毛利 + 估算误差 + 缓存波动。
INSERT INTO ai_model_pricing (model, provider, input_nano, output_nano, markup_bps) VALUES
    ('*',                 '',         2000, 8000, 5000),
    ('deepseek-v4-flash', 'deepseek',  270, 1100, 5000),
    ('deepseek-chat',     'deepseek',  270, 1100, 5000),
    ('deepseek-reasoner', 'deepseek',  550, 2190, 5000)
ON CONFLICT (model) DO NOTHING;

-- 2) ai_usage(发布端网关计量):加成本快照列。input/output_rate_nano 冻结当时采购单价,
--    cost_nano 为计入客户配额的最终成本(含 markup)。毛利 = cost_nano - 采购成本可对账还原。
ALTER TABLE woocms.ai_usage
    ADD COLUMN IF NOT EXISTS input_rate_nano  BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS output_rate_nano BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost_nano        BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS markup_bps       INT    NOT NULL DEFAULT 0;

-- 3) ai_usage_records(站内分析计量):加成本列,让站长也能看「AI 花了多少钱」而非仅 token。
ALTER TABLE ai_usage_records
    ADD COLUMN IF NOT EXISTS cost_nano BIGINT NOT NULL DEFAULT 0;

-- 4) licenses:配额单位从 token 升级为成本。新增月度成本额度(nanoUSD,0=不限)。
--    保留旧 ai_monthly_token_limit 列做兼容回退,不破坏存量。
ALTER TABLE woocms.licenses
    ADD COLUMN IF NOT EXISTS ai_monthly_cost_limit_nano BIGINT NOT NULL DEFAULT 0;

-- 5) 存量回填:把旧 token 额度按一个保守的综合单价(≈800 nanoUSD/token,偏 output 取值,
--    宁可高估额度也不误伤老客户)折算成成本额度。仅对已设 token 额度且未设成本额度的行生效。
UPDATE woocms.licenses
    SET ai_monthly_cost_limit_nano = ai_monthly_token_limit * 800
    WHERE ai_monthly_token_limit > 0 AND ai_monthly_cost_limit_nano = 0;
