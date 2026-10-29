SET search_path TO woocms, public;

CREATE TABLE IF NOT EXISTS homepage_seo_settings_backup_20260625 AS
SELECT *
FROM system_settings
WHERE site_id = 1
  AND key IN (
    'site_title',
    'site_name',
    'site_description',
    'seo_site_name',
    'seo_title_separator',
    'seo_default_description',
    'home_page_slug'
  );

CREATE TABLE IF NOT EXISTS homepage_page_backup_20260625 AS
SELECT *
FROM cms_pages
WHERE site_id = 1
  AND slug = 'home';

CREATE TABLE IF NOT EXISTS homepage_page_seo_backup_20260625 AS
SELECT s.*
FROM cms_page_seo s
JOIN cms_pages p ON p.id = s.page_id AND p.site_id = s.site_id
WHERE p.site_id = 1
  AND p.slug = 'home';

CREATE TABLE IF NOT EXISTS homepage_page_translations_backup_20260625 AS
SELECT t.*
FROM cms_page_translations t
JOIN cms_pages p ON p.id = t.page_id AND p.site_id = t.site_id
WHERE p.site_id = 1
  AND p.slug = 'home';

WITH page_upsert AS (
    INSERT INTO cms_pages (
        site_id,
        title,
        slug,
        summary,
        body,
        status,
        author_id,
        published_at,
        template_key,
        meta_json,
        render_mode,
        template_source,
        template_full_page,
        access_mode,
        required_capability,
        created_at,
        updated_at
    )
    VALUES (
        1,
        'BizThai',
        'home',
        'Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.',
        '',
        'published',
        1,
        now(),
        'page_default',
        '{}'::jsonb,
        'blocks',
        '',
        false,
        'public',
        '',
        now(),
        now()
    )
    ON CONFLICT (site_id, slug) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        status = EXCLUDED.status,
        published_at = COALESCE(cms_pages.published_at, EXCLUDED.published_at),
        template_key = EXCLUDED.template_key,
        render_mode = EXCLUDED.render_mode,
        template_source = EXCLUDED.template_source,
        template_full_page = EXCLUDED.template_full_page,
        access_mode = EXCLUDED.access_mode,
        required_capability = EXCLUDED.required_capability,
        updated_at = now()
    RETURNING id
),
home_page AS (
    SELECT id FROM page_upsert
    UNION
    SELECT id FROM cms_pages WHERE site_id = 1 AND slug = 'home'
    LIMIT 1
),
seo_defaults AS (
    SELECT
        'BizThai - ค้นหาบริษัทไทย_ตรวจสอบข้อมูลบริษัท_แพลตฟอร์มข้อมูลธุรกิจ'::varchar(255) AS seo_title,
        'BizThai, BizThai.com, ค้นหาบริษัทไทย, ตรวจสอบบริษัทไทย, ข้อมูลบริษัทไทย, แพลตฟอร์มข้อมูลธุรกิจ'::varchar(512) AS seo_keywords,
        'BizThai.com คือแพลตฟอร์มค้นหาบริษัทไทยและข้อมูลธุรกิจ สำหรับตรวจสอบบริษัท โปรไฟล์บริษัท ค้นหาคู่ค้า วิจัยตลาด และตรวจสอบข้อมูล'::text AS seo_description
)
INSERT INTO cms_page_seo (site_id, page_id, seo_title, seo_keywords, seo_description, created_at, updated_at)
SELECT 1, hp.id, d.seo_title, d.seo_keywords, d.seo_description, now(), now()
FROM home_page hp
CROSS JOIN seo_defaults d
ON CONFLICT (site_id, page_id) DO UPDATE SET
    seo_title = EXCLUDED.seo_title,
    seo_keywords = EXCLUDED.seo_keywords,
    seo_description = EXCLUDED.seo_description,
    updated_at = now();

CREATE TEMP TABLE tmp_homepage_i18n (
    locale varchar(16) PRIMARY KEY,
    title varchar(255) NOT NULL,
    slug varchar(255) NOT NULL,
    summary text NOT NULL,
    seo_title varchar(255) NOT NULL,
    seo_keywords varchar(512) NOT NULL,
    seo_description varchar(512) NOT NULL
);

INSERT INTO tmp_homepage_i18n (locale, title, slug, summary, seo_title, seo_keywords, seo_description) VALUES
('en',
 'BizThai',
 'home',
 'Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.',
 'BizThai - Thai Company Search_Company Lookup_Business Intelligence Platform',
 'BizThai, BizThai.com, Thai company search, Thai company lookup, Thailand company information, business intelligence Thailand',
 'BizThai.com is a Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.'),
('th',
 'BizThai',
 'home',
 'แพลตฟอร์มค้นหาบริษัทไทยและข้อมูลธุรกิจ สำหรับตรวจสอบบริษัท โปรไฟล์บริษัท ค้นหาคู่ค้า วิจัยตลาด และตรวจสอบข้อมูล',
 'BizThai - ค้นหาบริษัทไทย_ตรวจสอบข้อมูลบริษัท_แพลตฟอร์มข้อมูลธุรกิจ',
 'BizThai, BizThai.com, ค้นหาบริษัทไทย, ตรวจสอบบริษัทไทย, ข้อมูลบริษัทไทย, แพลตฟอร์มข้อมูลธุรกิจ',
 'BizThai.com คือแพลตฟอร์มค้นหาบริษัทไทยและข้อมูลธุรกิจ สำหรับตรวจสอบบริษัท โปรไฟล์บริษัท ค้นหาคู่ค้า วิจัยตลาด และตรวจสอบข้อมูล'),
('zh-CN',
 'BizThai',
 'home',
 '泰国企业查询和商业情报平台，提供公司查询、企业档案、合作伙伴搜索、市场研究和商业尽调入口。',
 'BizThai - 泰国企业查询_公司查询_企业信息查询平台',
 'BizThai, BizThai.com, 泰国企业查询, 泰国公司查询, 泰国企业信息, 泰国商业情报平台',
 'BizThai.com 是泰国企业查询和商业情报平台，提供公司查询、企业档案、合作伙伴搜索、市场研究和商业尽调入口。');

DO $$
DECLARE
    too_long_count integer;
    banned_count integer;
BEGIN
    SELECT count(*) INTO too_long_count
    FROM tmp_homepage_i18n
    WHERE length(seo_title) > 255
       OR length(seo_keywords) > 512
       OR length(seo_description) > 512;

    IF too_long_count > 0 THEN
        RAISE EXCEPTION 'homepage SEO text exceeds column limits';
    END IF;

    SELECT count(*) INTO banned_count
    FROM tmp_homepage_i18n
    WHERE seo_title ILIKE '%DBD%'
       OR seo_keywords ILIKE '%DBD%'
       OR seo_description ILIKE '%DBD%'
       OR seo_title ILIKE '%DataWarehouse%'
       OR seo_keywords ILIKE '%DataWarehouse%'
       OR seo_description ILIKE '%DataWarehouse%';

    IF banned_count > 0 THEN
        RAISE EXCEPTION 'homepage SEO text contains banned source-brand wording';
    END IF;
END $$;

WITH home_page AS (
    SELECT id
    FROM cms_pages
    WHERE site_id = 1
      AND slug = 'home'
    LIMIT 1
)
INSERT INTO cms_page_translations (
    page_id,
    site_id,
    locale,
    title,
    slug,
    summary,
    body,
    body_blocks,
    translation_status,
    seo_title,
    seo_keywords,
    seo_description,
    source_hash,
    segment_hashes,
    meta_json,
    created_at,
    updated_at
)
SELECT
    hp.id,
    1,
    i.locale,
    i.title,
    i.slug,
    i.summary,
    '',
    NULL,
    'published',
    i.seo_title,
    i.seo_keywords,
    i.seo_description,
    '',
    NULL,
    '{}'::jsonb,
    now(),
    now()
FROM home_page hp
JOIN tmp_homepage_i18n i ON true
ON CONFLICT (page_id, locale) DO UPDATE SET
    title = EXCLUDED.title,
    slug = EXCLUDED.slug,
    summary = EXCLUDED.summary,
    translation_status = EXCLUDED.translation_status,
    seo_title = EXCLUDED.seo_title,
    seo_keywords = EXCLUDED.seo_keywords,
    seo_description = EXCLUDED.seo_description,
    meta_json = COALESCE(cms_page_translations.meta_json, '{}'::jsonb),
    updated_at = now();

INSERT INTO system_settings (site_id, key, value, updated_at) VALUES
(1, 'site_title', 'BizThai', now()),
(1, 'site_name', 'BizThai', now()),
(1, 'site_description', 'BizThai.com is a Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.', now()),
(1, 'seo_site_name', 'BizThai', now()),
(1, 'seo_title_separator', ' - ', now()),
(1, 'seo_default_description', 'BizThai.com is a Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.', now()),
(1, 'home_page_slug', 'home', now())
ON CONFLICT (site_id, key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = now();

SELECT
    p.id,
    p.title,
    p.slug,
    p.status,
    p.published_at IS NOT NULL AS published,
    seo.seo_title AS default_seo_title,
    seo.seo_keywords AS default_seo_keywords,
    seo.seo_description AS default_seo_description
FROM cms_pages p
LEFT JOIN cms_page_seo seo ON seo.site_id = p.site_id AND seo.page_id = p.id
WHERE p.site_id = 1
  AND p.slug = 'home';

SELECT
    locale,
    seo_title,
    seo_keywords,
    seo_description
FROM cms_page_translations
WHERE site_id = 1
  AND page_id = (SELECT id FROM cms_pages WHERE site_id = 1 AND slug = 'home')
ORDER BY locale;
