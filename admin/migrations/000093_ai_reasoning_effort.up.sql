-- 推理强度（reasoning_effort）：为支持推理的模型在 /chat/completions 请求体加 reasoning_effort
-- 参数（low/medium/high/xhigh；空=不发，沿用上游默认）。两处可配：
--   1) per-instance 覆盖模型（update_clients）——发行版客户端经网关调用时由网关注入；
--   2) 临时自定义模型（ai_custom_models）——网关与发布端直连均注入。
ALTER TABLE woocms.update_clients
    ADD COLUMN IF NOT EXISTS ai_reasoning_effort VARCHAR(16) NOT NULL DEFAULT '';

ALTER TABLE woocms.ai_custom_models
    ADD COLUMN IF NOT EXISTS reasoning_effort VARCHAR(16) NOT NULL DEFAULT '';
