-- per-instance AI 覆盖增加「是否多模态」标记：发布端为某实例指定自定义模型(custom/byo)时，
-- 可声明该上游模型是否支持图片输入。网关 /models 据此对客户端下发 vision 标，前端才允许传图。
ALTER TABLE woocms.update_clients
    ADD COLUMN IF NOT EXISTS ai_vision BOOLEAN NOT NULL DEFAULT FALSE;
