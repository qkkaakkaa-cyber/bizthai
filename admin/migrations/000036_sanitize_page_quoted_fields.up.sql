-- 清理 cms_pages 历史标题/slug/summary 引号污染。
DO $$
DECLARE
  r RECORD;
  v_title TEXT;
  v_slug TEXT;
  v_summary TEXT;
  prev TEXT;
  i INT;
BEGIN
  FOR r IN SELECT id, title, slug, summary FROM cms_pages LOOP
    v_title := COALESCE(r.title, '');
    v_slug := COALESCE(r.slug, '');
    v_summary := COALESCE(r.summary, '');

    FOR i IN 1..8 LOOP
      prev := v_title;
      v_title := trim(v_title);
      v_title := replace(v_title, '&quot;', '"');
      v_title := regexp_replace(v_title, '^\\"(.*)\\"$', '\1');
      v_title := regexp_replace(v_title, '^(["''“”‘’])(.*)(["''“”‘’])$', '\2');
      EXIT WHEN prev = v_title;
    END LOOP;

    FOR i IN 1..8 LOOP
      prev := v_slug;
      v_slug := trim(v_slug);
      v_slug := replace(v_slug, '&quot;', '"');
      v_slug := regexp_replace(v_slug, '^\\"(.*)\\"$', '\1');
      v_slug := regexp_replace(v_slug, '^(["''“”‘’])(.*)(["''“”‘’])$', '\2');
      EXIT WHEN prev = v_slug;
    END LOOP;

    FOR i IN 1..8 LOOP
      prev := v_summary;
      v_summary := trim(v_summary);
      v_summary := replace(v_summary, '&quot;', '"');
      v_summary := regexp_replace(v_summary, '^\\"(.*)\\"$', '\1');
      v_summary := regexp_replace(v_summary, '^(["''“”‘’])(.*)(["''“”‘’])$', '\2');
      EXIT WHEN prev = v_summary;
    END LOOP;

    UPDATE cms_pages
    SET title = v_title,
        slug = v_slug,
        summary = v_summary
    WHERE id = r.id;
  END LOOP;
END $$;
