SET search_path TO woocms, public;

ALTER TABLE cms_categories
  ADD COLUMN IF NOT EXISTS parent_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_cms_categories_parent_id'
      AND conrelid = 'woocms.cms_categories'::regclass
  ) THEN
    ALTER TABLE cms_categories
      ADD CONSTRAINT fk_cms_categories_parent_id
      FOREIGN KEY (parent_id) REFERENCES cms_categories(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cms_categories_parent_not_self'
      AND conrelid = 'woocms.cms_categories'::regclass
  ) THEN
    ALTER TABLE cms_categories
      ADD CONSTRAINT chk_cms_categories_parent_not_self
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cms_categories_site_parent_sort
  ON cms_categories (site_id, parent_id, sort_order ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_cms_categories_parent_id
  ON cms_categories (parent_id);
