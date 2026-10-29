-- 切换 AI 供应商:DeepSeek 官方直连 → OpenCode Go(Zen API,OpenAI 兼容端点
-- https://opencode.ai/zen/go/v1)。按 OpenCode 官方 token 价(opencode.ai/docs/go)重设价格表。
-- 仅收录走 OpenAI /chat/completions 端点的 8 个模型;MiniMax/Qwen 走 Anthropic /messages
-- 端点,本网关(OpenAI 格式)暂不支持,故不收录。markup 用户定为 30%(3000bps)。
-- 价格单位 nanoUSD/token = ($/1M tokens) × 1000。

-- 1) 删除 DeepSeek 官方专属模型(OpenCode 不提供同名直连)
DELETE FROM ai_model_pricing WHERE model IN ('deepseek-chat', 'deepseek-reasoner');

-- 2) 写入 OpenCode 8 个 OpenAI 兼容模型 + 兜底行(deepseek-v4-flash 由官方 270/1100 降为 OpenCode 140/280)
INSERT INTO ai_model_pricing (model, provider, input_nano, output_nano, markup_bps, active) VALUES
    ('*',                 'opencode', 2000, 5000, 3000, true),  -- 兜底:高于全部在售模型,防新模型漏计
    ('mimo-v2.5',         'opencode',  140,  280, 3000, true),
    ('deepseek-v4-flash', 'opencode',  140,  280, 3000, true),
    ('kimi-k2.6',         'opencode',  950, 4000, 3000, true),
    ('kimi-k2.7',         'opencode',  950, 4000, 3000, true),
    ('glm-5',             'opencode', 1000, 3200, 3000, true),
    ('glm-5.1',           'opencode', 1400, 4400, 3000, true),
    ('deepseek-v4-pro',   'opencode', 1740, 3480, 3000, true),
    ('mimo-v2.5-pro',     'opencode', 1740, 3480, 3000, true)
ON CONFLICT (model) DO UPDATE SET
    provider    = EXCLUDED.provider,
    input_nano  = EXCLUDED.input_nano,
    output_nano = EXCLUDED.output_nano,
    markup_bps  = EXCLUDED.markup_bps,
    active      = EXCLUDED.active,
    updated_at  = NOW();
