SET search_path TO woocms, public;

ALTER TABLE IF EXISTS cms_field_groups
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 10;

ALTER TABLE IF EXISTS cms_field_groups
    ALTER COLUMN content_model_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS cms_field_group_locations (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL REFERENCES cms_field_groups(id) ON DELETE CASCADE,
    group_index INT NOT NULL DEFAULT 0,
    field VARCHAR(64) NOT NULL,
    operator VARCHAR(16) NOT NULL DEFAULT 'eq',
    value VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_field_group_locations_group_rule
    ON cms_field_group_locations (group_id, group_index, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_cms_field_group_locations_site_field
    ON cms_field_group_locations (site_id, field, value);

ALTER TABLE IF EXISTS cms_field_defs
    ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS placeholder VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS default_val TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS conditional_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS parent_field_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_cms_field_defs_parent_field_id'
    ) THEN
        ALTER TABLE cms_field_defs
            ADD CONSTRAINT fk_cms_field_defs_parent_field_id
            FOREIGN KEY (parent_field_id) REFERENCES cms_field_defs(id) ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE IF EXISTS system_users
    ADD COLUMN IF NOT EXISTS meta_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS cms_site_option_values (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    group_code VARCHAR(64) NOT NULL,
    value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, group_code)
);

CREATE INDEX IF NOT EXISTS idx_cms_site_option_values_site_group
    ON cms_site_option_values (site_id, group_code);

CREATE TABLE IF NOT EXISTS cms_field_query_indexes (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES cms_sites(id) ON DELETE CASCADE,
    group_code VARCHAR(64) NOT NULL,
    field_name VARCHAR(64) NOT NULL,
    index_name VARCHAR(128) NOT NULL,
    index_expression TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site_id, group_code, field_name),
    UNIQUE (index_name)
);

CREATE INDEX IF NOT EXISTS idx_cms_field_query_indexes_site_group
    ON cms_field_query_indexes (site_id, group_code, enabled);

INSERT INTO cms_field_group_locations (site_id, group_id, group_index, field, operator, value, sort_order)
SELECT fg.site_id,
       fg.id,
       0,
       'model_code',
       'eq',
       cm.code,
       0
FROM cms_field_groups fg
JOIN cms_content_models cm ON cm.id = fg.content_model_id
LEFT JOIN cms_field_group_locations l ON l.group_id = fg.id
WHERE l.id IS NULL;

INSERT INTO cms_field_group_locations (site_id, group_id, group_index, field, operator, value, sort_order)
SELECT fg.site_id,
       fg.id,
       0,
       'edit_mode',
       'eq',
       CASE
           WHEN lower(coalesce(fg.rule_json->>'scope', 'all')) IN ('create', 'edit') THEN lower(fg.rule_json->>'scope')
           ELSE 'all'
       END,
       1
FROM cms_field_groups fg
LEFT JOIN cms_field_group_locations l
    ON l.group_id = fg.id
   AND l.field = 'edit_mode'
WHERE l.id IS NULL;
