-- thaicompany 按真实 jpno 去重(同一 jpno 多行 = WooCMS API slug 冲突自动加 -N 产生的副本)。
-- 大数据优化:一次扫描提取标量列到临时表(只 detoast 一次 meta_json),其余全在小临时表上集合化完成。
-- 保留规则:slug=jpno(干净注册号)优先 → published 优先 → 最早 id。子表全 ON DELETE CASCADE,自动清理。
\timing on
SET search_path TO woocms, public;

BEGIN;

-- ① 一次扫描:抽取 (id, jpno, slug, status) → 临时表(避免后续重复解压 meta_json)
CREATE TEMP TABLE _ent ON COMMIT DROP AS
SELECT id, meta_json->>'jpno' AS jpno, slug, status
FROM cms_content_entries
WHERE content_model_id = 2;
CREATE INDEX ON _ent (jpno);

-- ② 在小临时表上:找出每个重复 jpno 组里要删的行(rn>1)
CREATE TEMP TABLE _del ON COMMIT DROP AS
SELECT id FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY jpno
           ORDER BY (slug = jpno) DESC, (status = 'published') DESC, id ASC
         ) AS rn
  FROM _ent
  WHERE jpno IN (SELECT jpno FROM _ent GROUP BY jpno HAVING count(*) > 1)
) x
WHERE rn > 1;

SELECT '待删重复行 = ' || count(*) AS info FROM _del;

-- ③ 批量删主行(FK 全 CASCADE → terms/versions/translations/claims/revisions 自动清)
DELETE FROM cms_content_entries WHERE id IN (SELECT id FROM _del);

COMMIT;

-- ④ 验证
SELECT '去重后: 总行=' || count(*)
    || ' | 去重jpno=' || count(DISTINCT meta_json->>'jpno')
    || ' | 残余重复=' || (count(*) - count(DISTINCT meta_json->>'jpno')) AS result
FROM cms_content_entries WHERE content_model_id = 2;
