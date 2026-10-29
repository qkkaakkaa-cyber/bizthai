-- OpenCode Go 的 Anthropic 端点模型(MiniMax/Qwen,走 /messages)价格入表,与 8 个 OpenAI 端点模型
-- 同口径计费。ai.Service 已能按模型自动改走 Anthropic 协议(internal/domain/ai/anthropic.go)。
-- 价格单位 nanoUSD/token = ($/1M tokens) 乘 1000;markup 30%(3000bps);provider=opencode。
INSERT INTO ai_model_pricing (model, provider, input_nano, output_nano, markup_bps, active) VALUES
    ('minimax-m3',   'opencode',  300, 1200, 3000, true),
    ('minimax-m2.7', 'opencode',  300, 1200, 3000, true),
    ('qwen3.7-plus', 'opencode',  400, 1600, 3000, true),
    ('qwen3.6-plus', 'opencode',  500, 3000, 3000, true),
    ('qwen3.7-max',  'opencode', 2500, 7500, 3000, true)
ON CONFLICT (model) DO UPDATE SET
    provider    = EXCLUDED.provider,
    input_nano  = EXCLUDED.input_nano,
    output_nano = EXCLUDED.output_nano,
    markup_bps  = EXCLUDED.markup_bps,
    active      = EXCLUDED.active,
    updated_at  = NOW();
