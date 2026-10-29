-- 董事反查倒排索引 build —— 由 systemd timer 周期调用(全量重建)。
-- 把每家公司 meta_json.raw.committees[] 展开成「一董事任职 = 一行」,以 cmt_no 为反查键。
-- 数据来源:woocms.cms_content_entries(content_model_id=2 = thaicompany),由外部入库进程持续写入。
--
-- 设计:build-new + 原子 swap。重建在 director_index_build 上进行(~100s,不锁 live 表),
--       仅在末尾一个极短事务里 DROP 旧表 + RENAME 新表,读取几乎不停机。
--
-- cmt_no 有效性:DBD 源数据里约 6.8% 的董事 cmtNo 为空,另有 "1"/"00"/"fff" 等占位垃圾值。
--   这些不能聚合(会把无关的人错并到一起),故索引只收 [A-Za-z0-9]{6,} 且非单字符重复的 cmt_no。
--   被排除者:前端按 jpNo+cmtSeq 兜底,不走反查(详见 directors/README.md)。

\set ON_ERROR_STOP on

-- ── 1) 在 _build 表上全量重建(不触碰 live 表) ──────────────────────────────
DROP TABLE IF EXISTS woocms.director_index_build;

CREATE TABLE woocms.director_index_build AS
SELECT
  c->>'cmtNo'                                                              AS cmt_no,
  COALESCE(NULLIF(e.slug,''), NULLIF(e.meta_json->>'jpno',''), e.id::text) AS jp_no,
  NULLIF(c->>'cmtSeq','')                                                  AS cmt_seq,
  NULLIF(c->>'cmtTypeCode','')                                             AS cmt_type_code,
  upper(NULLIF(c->>'ntCode',''))                                          AS nt_code,
  NULLIF(trim(both ' ' from
    COALESCE(c->>'titleName','')||' '||COALESCE(c->>'firstName','')||' '||COALESCE(c->>'lastName','')), '') AS name_th,
  NULLIF(trim(both ' ' from
    COALESCE(c->>'firstNameE','')||' '||COALESCE(c->>'lastNameE','')), '') AS name_en,
  CASE WHEN c->>'investAmt' ~ '^[0-9]+(\.[0-9]+)?$' THEN (c->>'investAmt')::numeric END AS invest_amt,
  NULLIF(c->>'investType','')                                             AS invest_type,
  CASE WHEN jsonb_typeof(c->'updateDate') = 'array' AND jsonb_array_length(c->'updateDate') >= 3
       THEN lpad(c->'updateDate'->>0, 4, '0')||'-'||lpad(c->'updateDate'->>1, 2, '0')||'-'||lpad(c->'updateDate'->>2, 2, '0')
  END                                                                     AS update_date,  -- 源为公历 [y,m,d] 数组,格式化为 ISO(亦利于按字典序排序)
  COALESCE(NULLIF(e.meta_json->>'jpname',''), NULLIF(e.title,''))         AS company_name_th,
  NULLIF(e.meta_json->>'jpnamee','')                                     AS company_name_en,
  NULLIF(e.meta_json->>'province','')                                    AS province,
  COALESCE(e.meta_json->'i18n'->'th'->>'status', NULLIF(e.meta_json->>'jpstatdesc','')) AS company_status,
  NULLIF(e.meta_json->>'capamt','')::numeric                             AS cap_amt  -- 注册资金(泰铢),= profile.capAmt 的扁平化,同 province/status 反规范化
FROM woocms.cms_content_entries e
CROSS JOIN LATERAL jsonb_array_elements(e.meta_json->'raw'->'committees') c
WHERE e.content_model_id = 2
  AND e.deleted_at IS NULL
  AND e.site_id = 1
  AND e.status = 'published'
  AND COALESCE(e.meta_json->>'_probe', '') <> 'true'
  AND jsonb_typeof(e.meta_json->'raw'->'committees') = 'array'
  AND c->>'cmtNo' ~ '^[A-Za-z0-9]{6,}$'   -- 仅收形似真实证件号的 key
  AND c->>'cmtNo' !~ '^(.)\1+$';          -- 排除 "000000"/"ffffff" 等单字符重复占位

CREATE INDEX director_index_build_cmt_no_idx  ON woocms.director_index_build (cmt_no);
CREATE INDEX director_index_build_cmt_no_trgm ON woocms.director_index_build USING gin (cmt_no gin_trgm_ops); -- 证件号模糊查询
CREATE INDEX director_index_build_jp_no_idx  ON woocms.director_index_build (jp_no);  -- 公司视角反查(/related)按 jp_no 取该司董事
-- 姓名模糊搜索(按姓名搜股东/老板):pg_trgm 三元组 GIN,支持 name_en/name_th 任意子串 ILIKE。需 pg_trgm 扩展(已装)。
CREATE INDEX director_index_build_name_en_trgm ON woocms.director_index_build USING gin (name_en gin_trgm_ops);
CREATE INDEX director_index_build_name_th_trgm ON woocms.director_index_build USING gin (name_th gin_trgm_ops);
-- 公司名模糊搜索(mode=company):按公司名查其所有董事,走 GIN trigram 索引。
CREATE INDEX director_index_build_company_name_th_trgm ON woocms.director_index_build USING gin (company_name_th gin_trgm_ops);
CREATE INDEX director_index_build_company_name_en_trgm ON woocms.director_index_build USING gin (company_name_en gin_trgm_ops);
-- 外资按国家筛选公司(/foreign-companies-<国>):按董事/股东国籍 nt_code 取关联公司
CREATE INDEX director_index_build_nt_code_idx ON woocms.director_index_build (nt_code);

-- ── 2) build meta(供 sidecar /health 读取) ─────────────────────────────────
DROP TABLE IF EXISTS woocms.director_index_meta_build;
CREATE TABLE woocms.director_index_meta_build AS
SELECT
  now()                              AS built_at,
  COUNT(*)                           AS total_rows,
  COUNT(DISTINCT cmt_no)             AS distinct_people
FROM woocms.director_index_build;

-- ── 3) 原子 swap(极短事务,读取不停机) ────────────────────────────────────
BEGIN;
DROP TABLE IF EXISTS woocms.director_index;
ALTER TABLE woocms.director_index_build       RENAME TO director_index;
ALTER INDEX woocms.director_index_build_cmt_no_idx  RENAME TO director_index_cmt_no_idx;
ALTER INDEX woocms.director_index_build_cmt_no_trgm RENAME TO director_index_cmt_no_trgm;
ALTER INDEX woocms.director_index_build_jp_no_idx  RENAME TO director_index_jp_no_idx;
ALTER INDEX woocms.director_index_build_name_en_trgm RENAME TO director_index_name_en_trgm;
ALTER INDEX woocms.director_index_build_name_th_trgm RENAME TO director_index_name_th_trgm;
ALTER INDEX woocms.director_index_build_company_name_th_trgm RENAME TO director_index_company_name_th_trgm;
ALTER INDEX woocms.director_index_build_company_name_en_trgm RENAME TO director_index_company_name_en_trgm;
ALTER INDEX woocms.director_index_build_nt_code_idx RENAME TO director_index_nt_code_idx;
DROP TABLE IF EXISTS woocms.director_index_meta;
ALTER TABLE woocms.director_index_meta_build  RENAME TO director_index_meta;
COMMIT;

\echo 'director_index rebuilt:'
SELECT total_rows, distinct_people, built_at FROM woocms.director_index_meta;
