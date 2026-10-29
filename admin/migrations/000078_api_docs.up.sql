-- 智能接口文档:overlay 富集层 / AI 富集任务队列 / 版本快照 / 4xx 反馈统计
-- 文档骨架由源码生成并嵌入二进制,库中只存"血肉"与历史——全局数据,不分站点。

CREATE TABLE IF NOT EXISTS api_doc_overlays (
    operation_id  VARCHAR(160) PRIMARY KEY,
    content       TEXT         NOT NULL DEFAULT '',
    status        VARCHAR(16)  NOT NULL DEFAULT 'ai_draft', -- ai_draft=AI 草稿待审 / human=人工已审
    updated_by    BIGINT,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_doc_jobs (
    id            BIGSERIAL    PRIMARY KEY,
    operation_id  VARCHAR(160) NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending/running/done/failed
    attempts      INT          NOT NULL DEFAULT 0,
    error         TEXT         NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_doc_jobs_status ON api_doc_jobs (status, id);

CREATE TABLE IF NOT EXISTS api_doc_snapshots (
    version     VARCHAR(32)  PRIMARY KEY,
    spec_hash   VARCHAR(64)  NOT NULL DEFAULT '',
    spec        JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_doc_error_stats (
    operation_id  VARCHAR(160) NOT NULL,
    error_code    VARCHAR(64)  NOT NULL,
    status_code   INT          NOT NULL DEFAULT 0,
    hits          BIGINT       NOT NULL DEFAULT 0,
    last_seen     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (operation_id, error_code)
);
