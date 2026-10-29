-- Migration 000033: 字段类型强制重命名，对齐标准规范
-- richtext    → wysiwyg
-- user_ref    → user
-- post_ref    → post_object
-- page_ref    → page_link
-- taxonomy_ref→ taxonomy
-- term_ref    → term
-- relation    → relationship

SET search_path TO woocms, public;

UPDATE cms_field_defs SET type = 'wysiwyg'       WHERE type = 'richtext';
UPDATE cms_field_defs SET type = 'user'          WHERE type = 'user_ref';
UPDATE cms_field_defs SET type = 'post_object'   WHERE type = 'post_ref';
UPDATE cms_field_defs SET type = 'page_link'     WHERE type = 'page_ref';
UPDATE cms_field_defs SET type = 'taxonomy'      WHERE type = 'taxonomy_ref';
UPDATE cms_field_defs SET type = 'term'          WHERE type = 'term_ref';
UPDATE cms_field_defs SET type = 'relationship'  WHERE type = 'relation';
