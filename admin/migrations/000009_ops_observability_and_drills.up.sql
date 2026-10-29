CREATE TABLE IF NOT EXISTS cms_release_drills (
    id BIGSERIAL PRIMARY KEY,
    scenario TEXT NOT NULL,
    result TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_drills_created_at ON cms_release_drills (created_at DESC);
