-- migrate:no-transaction
SET search_path TO woocms, public;

-- 千万级内容可扩展性评估（docs/architecture-scalability-assessment-2026-07-01.md P0-5）
-- 发现的关键索引缺口：cms_posts 没有任何覆盖 (site_id, status, published_at) 的组合索引，
-- published_at 完全无索引；cms_content_entries 的站内列表索引只按 updated_at 排序，
-- 定时发布/前台按发布时间排序两类查询都要回退到顺序扫描 + 排序；author_id 外键列
-- 与 cms_content_entry_terms.site_id 外键列均无索引支撑。
--
-- 本文件标了 no-transaction，因此 runner 会把下面每条 CREATE INDEX CONCURRENTLY
-- 语句单独发送、不包一个事务——这是在已有数据的大表上建索引不阻塞写入的唯一方式
-- （对比 000123：当时选择接受 SHARE 锁阻塞写入正是因为 runner 尚不支持这种模式）。
-- 代价：CONCURRENTLY 建索引失败时不会自动清理，可能残留 INVALID 索引，需要运维手动
-- DROP INDEX 后重跑；正常路径下每条语句都带 IF NOT EXISTS，文件本身可安全重复执行。

-- cms_posts：站内已发布列表最常见的两种排序键（updated_at 默认排序 / published_at
-- 定时发布与前台"最新"排序）各建一个部分索引，只覆盖未软删的行。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_site_status_published
    ON cms_posts (site_id, status, published_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_site_status_updated
    ON cms_posts (site_id, status, updated_at DESC)
    WHERE deleted_at IS NULL;

-- 前台已发布列表实际排序表达式是 COALESCE(published_at, updated_at) DESC（未设定发布时间
-- 的记录退回更新时间），普通列索引无法命中这个表达式，需要单独的表达式索引；带 id DESC
-- 作为并列排序的确定性 tie-breaker，为后续 keyset 分页游标提供可命中的索引顺序。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_site_status_coalesce_pub
    ON cms_posts (site_id, status, COALESCE(published_at, updated_at) DESC, id DESC)
    WHERE deleted_at IS NULL;

-- author_id 外键列此前无索引，按作者筛选/删除用户时的关联查询需要顺序扫描。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_posts_author_id
    ON cms_posts (author_id);

-- cms_content_entries：镜像 idx_cms_content_entries_site_model_status（000029），
-- 补一份按 published_at 排序的版本，供 PublishDueEntries 定时任务与前台"最新条目"
-- 排序使用；避免 published_at 列完全无索引导致的顺序扫描 + 排序。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_content_entries_site_model_status_published
    ON cms_content_entries (site_id, content_model_id, status, published_at DESC)
    WHERE deleted_at IS NULL;

-- author_id 外键列（可空）此前无索引；沿用 000108 owner_id 的部分索引写法。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_content_entries_author_id
    ON cms_content_entries (site_id, author_id)
    WHERE author_id IS NOT NULL;

-- cms_content_entry_terms：site_id 外键列此前无索引，级联删除站点时需要顺序扫描
-- 该表定位待删行。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cms_content_entry_terms_site_id
    ON cms_content_entry_terms (site_id);
