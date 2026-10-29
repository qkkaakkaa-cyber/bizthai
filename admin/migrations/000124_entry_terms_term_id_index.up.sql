SET search_path TO woocms, public;

-- 支撑多 taxonomy AND(交集)筛选(entries?taxonomy=&term= 重复传参 / <wc-data term="a:x,b:y">):
-- 每个维度各自按字面量 term_id 生成一条 EXISTS 子句。现有 (taxonomy_id, term_id, entry_id) 复合
-- 索引要求先按 taxonomy_id 定位才能命中索引前导列，而联合筛选只按 term_id 过滤，用不上该索引的
-- 前导列；主键 (entry_id, term_id) 则要求已知 entry_id。两者都无法让规划器直接"给定 term_id，
-- 取命中该术语的 entry 集合"。补一个 term_id 领头的索引，让占比很大的类目(如实测占比 40% 的
-- 省份)也能走批量索引扫描，避免退化成对候选表逐行回表(此前已实测踩过：请求可能挂起 15 秒以上)。
CREATE INDEX IF NOT EXISTS idx_cms_content_entry_terms_term_entry ON cms_content_entry_terms (term_id, entry_id);
