-- 把"公司扁平 URL"从 nginx+resolver 反查迁移到 WooCMS 原生 cms_permalink_routes。
-- 策略:有英文名 → /{英文名slug}.html(不带 jpNo);无英文名/重名落选 → /{jpNo}.html。
-- slug 公式与 resolver / idx_thaicompany_nameslug 完全一致,URL 与生产保持不变(零 SEO 影响)。
-- 服务器执行时建议整体包在事务里(BEGIN; ... COMMIT;)避免中途旧路由已删、新路由未全的窗口。
\timing on
SET search_path TO woocms, public;

-- 0) 清旧的 thaicompany cpt_entry 路由(WooCMS 默认 /thaicompany-{jpNo}.html 形态,生产未使用)
DELETE FROM cms_permalink_routes WHERE entity_type='cpt_entry' AND model_code='thaicompany';

-- 1) 有英文名 → /{英文名slug}.html(主 URL;重名先到先得,落选者由步骤2兜底)
--    2026-07-01 修复:泰文回填的 jpnamee(无真实英文名的 stub 公司)经正则 strip 泰文后,
--    可能只剩嵌入数字或短占位符残留(如"1"、"NON."→"non"),非空判断(ns<>'')不够严格,
--    会被误判成"有英文名"提前占坑,导致步骤2的 jpNo 兜底永远轮不到——改为要求 ns 至少含一个字母。
--    注意:仍无法拦截"NA"/"NO"/"NONE"这类本身就是英文占位符的残留,那类需要额外的名单式清理。
INSERT INTO cms_permalink_routes
  (site_id, locale, path, slug, entity_type, entity_id, model_code, status, is_primary)
SELECT 1, '', '/'||ns||'.html', ns, 'cpt_entry', id, 'thaicompany', 'active', true
FROM (
  SELECT id, trim(both '-' from regexp_replace(lower(meta_json->>'jpnamee'),
                                               '[^a-z0-9]+','-','g')) AS ns
  FROM cms_content_entries
  WHERE content_model_id=2 AND status='published' AND deleted_at IS NULL
    AND coalesce(meta_json->>'jpnamee','') <> ''
) s
WHERE ns ~ '[a-z]'
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- 2) 无英文名 或 重名落选 → /{jpNo}.html(给所有还没有任何路由的已发布公司)
--    2026-07-01 修复:改用 meta_json->>'jpno' 而不是 e.slug——核实发现 e.slug 并非总等于 jpno
--    (个别记录历史遗留成了 name-slug 或数字残留本身),直接读权威字段更可靠,并加 13 位数字校验兜底。
INSERT INTO cms_permalink_routes
  (site_id, locale, path, slug, entity_type, entity_id, model_code, status, is_primary)
SELECT 1, '', '/'||(e.meta_json->>'jpno')||'.html', e.meta_json->>'jpno', 'cpt_entry', e.id, 'thaicompany', 'active', true
FROM cms_content_entries e
WHERE e.content_model_id=2 AND e.status='published' AND e.deleted_at IS NULL
  AND e.meta_json->>'jpno' ~ '^[0-9]{13}$'
  AND NOT EXISTS (
    SELECT 1 FROM cms_permalink_routes r
    WHERE r.entity_type='cpt_entry' AND r.entity_id=e.id AND r.locale=''
  )
ON CONFLICT (site_id, locale, path) DO NOTHING;

-- 统计
SELECT 'name路由(/{slug}.html)' AS kind, count(*) FROM cms_permalink_routes
  WHERE entity_type='cpt_entry' AND model_code='thaicompany' AND slug !~ '^[0-9]+$'
UNION ALL
SELECT 'jpNo路由(/{jpNo}.html)', count(*) FROM cms_permalink_routes
  WHERE entity_type='cpt_entry' AND model_code='thaicompany' AND slug ~ '^[0-9]+$';
