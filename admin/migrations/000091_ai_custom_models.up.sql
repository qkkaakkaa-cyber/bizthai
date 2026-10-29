-- AI 临时自定义模型：发布端可临时挂接任意 OpenAI 兼容上游（自定义 model id / base_url /
-- api_key），无需改代码或重启。客户端经 AI 网关 /models 动态拉取，临时模型在下拉里带
-- 【限时】标记；网关 /chat/completions 命中临时模型时改路由到其自带 base_url/key，且免计费
-- （仅留痕 token 用量，类同客户自带 key）。该表只在发布端写入，发行版实例保持为空即可。

CREATE TABLE IF NOT EXISTS ai_custom_models (
    id          SERIAL PRIMARY KEY,
    model_id    VARCHAR(160) NOT NULL UNIQUE,         -- 请求体里的 model 值（调用方选用的 id）
    name        VARCHAR(200) NOT NULL DEFAULT '',     -- 下拉展示名（留空回退 model_id）
    base_url    VARCHAR(500) NOT NULL DEFAULT '',     -- 上游 OpenAI 兼容地址（到 /v1 为止，不含 /chat/completions）
    api_key     TEXT         NOT NULL DEFAULT '',      -- 上游密钥
    vision      BOOLEAN      NOT NULL DEFAULT FALSE,   -- 是否多模态（可读图）
    temporary   BOOLEAN      NOT NULL DEFAULT TRUE,    -- 是否标记为【限时】
    active      BOOLEAN      NOT NULL DEFAULT TRUE,    -- 下线即停用（不出现在列表、网关拒绝）
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- glm-5.2（OpenCode Go 新增）价格种子：暂沿用 glm-5.1 费率档（1400/4400，markup 30%），
-- 上线后如官方价不同可在「模型价格」Tab 调整。
INSERT INTO ai_model_pricing (model, provider, input_nano, output_nano, markup_bps, active) VALUES
    ('glm-5.2', 'opencode', 1400, 4400, 3000, true)
ON CONFLICT (model) DO UPDATE SET
    provider    = EXCLUDED.provider,
    input_nano  = EXCLUDED.input_nano,
    output_nano = EXCLUDED.output_nano,
    markup_bps  = EXCLUDED.markup_bps,
    active      = EXCLUDED.active,
    updated_at  = NOW();
