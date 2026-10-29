-- 支持「正常经营状态优先」统一排序的索引。
--
-- 背景:WooCMS 核心(闭源二进制)的 <wc-data source="cpt:thaicompany" sort="..."> 与其
-- REST 接口 /api/site/v1/models/thaicompany/entries?sort=... 均已实测确认是 no-op ——
-- 换任何 sort 取值,返回顺序完全不变(见 woocms-upstream-bugs.md)。因此“正常经营优先”
-- 的统一排序无法通过核心实现,只能走 analytics 边车直连 DB(与 crossCompanies 绕过
-- WooCMS 不支持多 taxonomy AND 是同一手法)。这张索引让该边车按状态排序做到毫秒级,
-- 不必对 195 万行做无索引排序。
--
-- 不在任何部署流程里自动跑,变更 thaicompany_facts 定义或重建视图后需手动重跑一次
-- (REFRESH MATERIALIZED VIEW 不会清掉已存在的索引,只有 DROP/重建视图才需要)。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcf_statusrank_id
  ON woocms.thaicompany_facts (
    (CASE WHEN jpstatcode = '1' THEN 0 ELSE 1 END),
    entry_id DESC
  );

-- 供 /api/site/v1/analytics/company-list 用 taxonomy(province/industry/capital)筛选时,
-- 从 entry_terms 命中的 entry_id 集合 JOIN 回 cms_content_entries 取 meta_json 三语字段 +
-- 状态排序。命中集合本身已经过 taxonomy 索引筛选、体量远小于全表,这里只需要 id 有索引
-- 支撑 JOIN,不需要额外的状态表达式索引。
