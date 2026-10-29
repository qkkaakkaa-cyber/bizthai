// DB 访问:通过 psql CLI 按 英文名slug 反查 jpNo,走函数索引 idx_thaicompany_nameslug(精确查 ~1ms)。
// 只读、不写库(与 analytics / directors sidecar 同手法,零依赖)。
//
// 索引表达式(必须与下面 WHERE 中的 slug 表达式逐字一致,planner 才会用索引):
//   trim(both '-' from regexp_replace(lower(meta_json->>'jpnamee'), '[^a-z0-9]+', '-', 'g'))
// 与前端 theme.js 的 slugify 规则完全一致(lower → 连续非[a-z0-9]→'-' → 去首尾'-')。
import pg from 'pg'
import { config } from './config.js'

const SCHEMA = '"' + config.db.schema.replace(/"/g, '""') + '"'
const sqlLiteral = (v) => `'${String(v).replace(/'/g, "''")}'`

// 经营状态「正常/运营中」——与 analytics/src/db.js 的 operatingCondExpr 同口径。
// sitemap 只收录这类公司(注销/停业等不进 XML)。
function operatingCondExpr(alias = 'f') {
  const statusText = `COALESCE(NULLIF(${alias}.statuszh, ''), NULLIF(${alias}.jpstatdesce, ''), NULLIF(${alias}.jpstatdesc, ''))`
  return `(${alias}.jpstatcode = '1' OR ${statusText} IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating'))`
}

// sitemap 用的「可收录」事实行:字段完整度 + 经营状态正常
function sitemapCompanyFactsWhere(alias = 'f') {
  return `num_nonnulls(NULLIF(${alias}.province_th, ''), NULLIF(${alias}.setupobjgrpdesc, ''), ${alias}.capamt, NULLIF(${alias}.regdate, '')) >= 2
    AND ${operatingCondExpr(alias)}`
}

// 每列原样返回 wire 协议文本值,对齐旧版 `psql -A -t -F '\t'` 纯文本输出,
// samePeers/entryTopTerms 的 .split('\t') 解析逻辑不用跟着改。
const identityTypes = { getTypeParser: () => value => value }
const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  max: 8,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'dbd-resolver',
  types: identityTypes,
})
// 空闲连接被 PG 端断开(重启/睡眠恢复/网络抖动)会 emit 'error';不监听时 Node 会把它
// 升级为 uncaughtException 直接杀进程,配合 systemd Restart=always 变成 crash-loop。
pool.on('error', err => console.error('[resolver] 空闲连接错误(已忽略,不影响后续请求):', err.message))

async function runPsql(sql, { timeout = 8000 } = {}) {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(timeout))}`)
    const { rows } = await client.query({ text: sql, rowMode: 'array' })
    return rows.map(row => row.map(v => (v === null ? '' : v)).join('\t')).join('\n')
  } catch (err) {
    broken = true
    throw err
  } finally {
    if (!broken) {
      try { await client.query('SET statement_timeout = 0') } catch { broken = true }
    }
    client.release(broken)
  }
}

// 给定(已校验的)英文名 slug,返回规范家 jpNo(碰撞取字典序最小 jpNo),无则 null。
export async function resolveSlug(slug) {
  const lit = sqlLiteral(slug)
  const sql = `
    SELECT meta_json->>'jpno'
    FROM ${SCHEMA}.cms_content_entries
    WHERE content_model_id = 2
      AND deleted_at IS NULL
      AND status = 'published'
      AND coalesce(meta_json->>'jpnamee','') <> ''
      AND trim(both '-' from regexp_replace(lower(meta_json->>'jpnamee'), '[^a-z0-9]+', '-', 'g')) = ${lit}
    ORDER BY meta_json->>'jpno'
    LIMIT 1
  `
  const out = (await runPsql(sql)).trim()
  return out || null
}

// 2026-07-11:曾在这里加过 resolveKeyByJpno(jpNo→WooCMS 路由 key 的反查),已撤掉——
// meta_json->>'jpno' 在这张表上没有可用索引,全表扫描(~190万行)必超 statement_timeout。
// resolveSlug() 那个方向(slug→jpNo)之所以快,是因为专门建了 idx_thaicompany_nameslug 函数索引;
// 反方向要做同样的事得新建一个索引,但 resolver 的库账号是只读的,没有 DDL 权限。改成在
// server.js 里维护一个"顺路"内存缓存(jpnoKeyCache,见 resolveJpNo() 里的 jpnoKeySet 调用),
// 不再查库。以后如果真的拿到了 DDL 权限、想把这条查询做成可靠的兜底,再照这个注释里的 SQL
// 加一个 `(content_model_id, (meta_json->>'jpno'))` 的部分索引即可恢复。

// 健康检查:确认索引存在(避免索引缺失时退化为全表扫)。
export async function indexPresent() {
  const out = (await runPsql(
    `SELECT 1 FROM pg_indexes WHERE schemaname=${sqlLiteral(config.db.schema)} AND indexname='idx_thaicompany_nameslug' LIMIT 1`
  )).trim()
  return out === '1'
}

// 同府(provSlug)+ 同行业大类(sectionSlug 如 tsic-g)的企业,按 id 倒序取 limit 条。
// 用 EXISTS+term_id 子查询(~13ms);JOIN 方式会慢到 20s+。供公司详情页 SEO 内链模块。
export async function samePeers(indTermId, provTermId, limit, excludeJpno) {
  const iid = parseInt(indTermId, 10), pid = parseInt(provTermId, 10)
  if (!iid || !pid) return []
  const lim = Math.max(1, Math.min(Number(limit) || 20, 40))
  const cols = ['jpno', 'jpnamee', 'jpname', 'jpnamezh', 'provincee', 'province', 'provincezh', 'setupobjdesce', 'setupobjdesc', 'setupobjdesczh', 'capamt']
  const sel = cols.map(c => `e.meta_json->>${sqlLiteral(c)}`).join(', ')
  const sql = `
    SELECT ${sel}
    FROM ${SCHEMA}.cms_content_entries e
    WHERE e.content_model_id = 2 AND e.deleted_at IS NULL
      AND coalesce(e.meta_json->>'jpno','') <> ${sqlLiteral(excludeJpno || '')}
      AND EXISTS (SELECT 1 FROM ${SCHEMA}.cms_content_entry_terms x WHERE x.entry_id = e.id AND x.term_id = ${iid})
      AND EXISTS (SELECT 1 FROM ${SCHEMA}.cms_content_entry_terms y WHERE y.entry_id = e.id AND y.term_id = ${pid})
    ORDER BY e.id DESC
    LIMIT ${lim}
  `
  let out = ''
  try { out = await runPsql(sql, { timeout: 6000 }) } catch { return [] }
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const f = line.split('\t')
    const m = {}; cols.forEach((c, i) => { m[c] = f[i] === undefined ? '' : f[i] })
    return m
  })
}

// 公司自身挂的顶层(parent_id IS NULL)province + industry term slug(走 entry_id 索引,~5ms)。
// 比依赖 analytics /regions 稳:府=prov<hash>、行业=段 tsic-x,直接喂给 samePeers。
export async function entryTopTerms(entryId) {
  const id = parseInt(entryId, 10)
  if (!id) return {}
  const sql = `
    SELECT tx.code, t.id FROM ${SCHEMA}.cms_content_entry_terms et
    JOIN ${SCHEMA}.cms_custom_terms t ON t.id = et.term_id AND t.parent_id IS NULL
    JOIN ${SCHEMA}.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id AND tx.code IN ('province', 'industry')
    WHERE et.entry_id = ${id}
  `
  let out = ''
  try { out = await runPsql(sql, { timeout: 4000 }) } catch { return {} }
  const res = {}
  out.split('\n').filter(l => l.length > 0).forEach(line => { const parts = line.split('\t'); if (parts[0] && parts[1] && !res[parts[0]]) res[parts[0]] = parts[1] })
  return res
}

// ── sitemap:已发布公司总数(供 sitemap 索引算分页数)。只数单表,不 JOIN cms_permalink_routes。
// 实测二者返回值分毫不差(1,947,420)——每家已发布公司当前都有 flat 路由,JOIN 一条都没滤掉;
// 但 JOIN 版是两张 80 万+ 大表并行全表扫 + Hash Join,实测 ~25s,直接撑爆 statement_timeout,让整个
// /sitemap.xml 索引 500(这个函数还是唯一没 try/catch 兜底的 sitemap 查询,超时即冒泡成 500);
// 单表 count 仅 ~0.2s。历史:2026-07-02 曾为消除末页 sitemap-companies-N.xml 的 404 死链改成 JOIN
// 口径,但那个「有已发布公司却无路由」的前提当前不成立(两个 count 相等即证明),JOIN 纯属拖累,已回退。
// 极端情况下若新公司路由生成滞后使单表数略大,最坏只是末页少几条(不会整页空→404),可接受。──
export async function countPublishedCompanies() {
  const sql = `SELECT count(*) FROM ${SCHEMA}.thaicompany_facts f
    WHERE ${sitemapCompanyFactsWhere('f')}`
  const out = (await runPsql(sql, { timeout: 15000 })).trim()
  return parseInt(out, 10) || 0
}

// ── 人类可读 /sitemap 落地页展示用的"公司档案总数"——跟上面那个不同口径:这里要展示真实总量
// (不管有没有 flat URL 路由),不能因为部分公司还没生成路由就显得数字变小。──
export async function countAllPublishedCompanies() {
  const sql = `SELECT count(*) FROM ${SCHEMA}.cms_content_entries WHERE site_id = 1 AND content_model_id = 2 AND status = 'published' AND deleted_at IS NULL`
  const out = (await runPsql(sql, { timeout: 8000 })).trim()
  return parseInt(out, 10) || 0
}

// ── sitemap:分页取一批已发布公司的 flat URL(来自 cms_permalink_routes,与公司详情页实际 canonical 一致)+ 更新时间。
// keyset 游标分页(2026-07-03 由 OFFSET 改):旧的 `JOIN ... LIMIT n OFFSET off` 是 O(off)——要到第 N 页
// 得顺着 id 走完 (N-1)×4000 行再丢弃(merge join),深页实测 6s+,随数据增长早晚越过 15s 超时 → 该
// sitemap-companies-N.xml 变 404。改成两步:①单表 index 扫定位这一页起始 id(不 JOIN,深页也 ~0.6s);
// ②keyset 从游标顺取 lim 条,entry(pkey)和 permalink(entity 索引)两侧都加 `>= 游标`,各自 seek 到
// 游标只读 lim 行 → 恒定 O(lim),任意页深都 ~5ms。off 越界 → 无游标 → 空页(与旧行为一致,调用方 404)。
// 输出与旧 OFFSET 写法逐字节一致(md5 对拍验证过:每家已发布公司都有路由,单表游标位与 JOIN 结果位重合)。
export async function fetchCompanyPage(offset, limit) {
  const off = Math.max(0, parseInt(offset, 10) || 0)
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50000, 50000))
  try {
    const cur = (await runPsql(
      `SELECT f.entry_id FROM ${SCHEMA}.thaicompany_facts f
       WHERE ${sitemapCompanyFactsWhere('f')}
       ORDER BY f.entry_id ASC LIMIT 1 OFFSET ${off}`,
      { timeout: 15000 }
    )).trim()
    const cursorId = parseInt(cur, 10)
    if (!Number.isFinite(cursorId)) return []
    const sql = `
      SELECT pr.path, e.updated_at
      FROM ${SCHEMA}.thaicompany_facts f
      JOIN ${SCHEMA}.cms_content_entries e ON e.id = f.entry_id
      JOIN ${SCHEMA}.cms_permalink_routes pr
        ON pr.site_id = e.site_id AND pr.entity_type = 'cpt_entry' AND pr.entity_id = e.id
        AND pr.model_code = 'thaicompany' AND pr.locale = ''
      WHERE e.site_id = 1 AND e.content_model_id = 2 AND e.status = 'published' AND e.deleted_at IS NULL
        AND ${sitemapCompanyFactsWhere('f')}
        AND e.id >= ${cursorId} AND pr.entity_id >= ${cursorId}
      ORDER BY e.id ASC
      LIMIT ${lim}
    `
    const out = await runPsql(sql, { timeout: 15000 })
    return out.split('\n').filter(l => l.length > 0).map(line => {
      const [path, updatedAt] = line.split('\t')
      return { path, updatedAt }
    })
  } catch { return [] }
}

// 公司详情唯一规范路径。用 permalink_routes 的实体索引按 entry_id 精确查，供 resolver
// 将注册号、旧 name-jpno、/company/、/c/thaicompany/ 等别名 301 收敛到同一个 flat URL。
export async function companyCanonicalPath(entryId) {
  const id = parseInt(entryId, 10)
  if (!Number.isFinite(id) || id <= 0) return ''
  const sql = `SELECT path FROM ${SCHEMA}.cms_permalink_routes
    WHERE site_id = 1 AND entity_type = 'cpt_entry' AND entity_id = ${id}
      AND model_code = 'thaicompany' AND locale = ''
    ORDER BY id ASC LIMIT 1`
  try { return (await runPsql(sql, { timeout: 4000 })).trim() } catch { return '' }
}

// ── sitemap:已发布文章数(cms_posts;当前站点 0 篇,查询按将来会有文章设计)──
export async function countPublishedPosts() {
  const sql = `SELECT count(*) FROM ${SCHEMA}.cms_posts WHERE site_id = 1 AND status = 'published' AND deleted_at IS NULL`
  const out = (await runPsql(sql, { timeout: 5000 })).trim()
  return parseInt(out, 10) || 0
}

// ── sitemap:分页取已发布文章的 slug + 更新时间 ──
export async function fetchPostPage(offset, limit) {
  const off = Math.max(0, parseInt(offset, 10) || 0)
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50000, 50000))
  const sql = `
    SELECT slug, updated_at FROM ${SCHEMA}.cms_posts
    WHERE site_id = 1 AND status = 'published' AND deleted_at IS NULL
    ORDER BY id ASC LIMIT ${lim} OFFSET ${off}
  `
  let out = ''
  try { out = await runPsql(sql, { timeout: 10000 }) } catch { return [] }
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const [slug, updatedAt] = line.split('\t')
    return { slug, updatedAt }
  })
}

// ── sitemap:全部已发布静态页(仅 30 余条,一次取全,slug 用于拼真实 URL `/{slug}`——
// 注意 cms_permalink_routes 对 entity_type='page' 存的是历史遗留的 `{slug}.html` 形态,不是页面真实路由,不能用)。
export async function fetchAllPages() {
  const sql = `SELECT slug, title, updated_at FROM ${SCHEMA}.cms_pages WHERE site_id = 1 AND status = 'published' ORDER BY id ASC`
  let out = ''
  try { out = await runPsql(sql, { timeout: 5000 }) } catch { return [] }
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const [slug, title, updatedAt] = line.split('\t')
    return { slug, title, updatedAt }
  })
}

// ── sitemap:industry/capital/companytype 分类归档页(直接用 cms_permalink_routes 已验证有效的 flat URL;
// province 分类不走这里——其 permalink_routes.path 是失效的哈希路径,真实友好 URL 需走 industry.js 的 allProvinces())──
export async function fetchTaxonomyRoutes() {
  const sql = `
    SELECT pr.taxonomy_code, pr.path, pr.updated_at,
      max(tt.name) FILTER (WHERE tt.locale = 'en') AS name_en,
      max(tt.name) FILTER (WHERE tt.locale = 'th') AS name_th,
      max(tt.name) FILTER (WHERE tt.locale = 'zh-CN') AS name_zh
    FROM ${SCHEMA}.cms_permalink_routes pr
    LEFT JOIN ${SCHEMA}.cms_term_translations tt ON tt.term_id = pr.entity_id
    WHERE pr.site_id = 1 AND pr.entity_type = 'cpt_term' AND pr.locale = ''
      AND pr.taxonomy_code IN ('industry', 'capital', 'companytype')
    GROUP BY pr.taxonomy_code, pr.path, pr.updated_at
    ORDER BY pr.taxonomy_code, pr.path
  `
  let out = ''
  try { out = await runPsql(sql, { timeout: 8000 }) } catch { return [] }
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const [taxonomyCode, path, updatedAt, nameEn, nameTh, nameZh] = line.split('\t')
    return { taxonomyCode, path, updatedAt, name: { en: nameEn, th: nameTh, zh: nameZh } }
  })
}

// ── 公司详情浏览量(累计浏览次数;真实访客 +1,爬虫/空 UA 不计,见 server.js)──
// 表很小(只有被看过的公司才有行),按 jpno 主键自增。建表挪到 ops/create_thaicompany_views_table.sql
// 一次性执行(resolver 现在只用只读角色,没有 schema 级 CREATE 权限,不能再在请求路径里建表)。
// 原子自增并返回新值(UPSERT)。失败抛错,调用方兜底。entryId 可选:调用方(serveCompanyPage)
// 在同一请求里已经 resolve 出 entryId,顺带存下来,后续人气排行按行业/地区聚合时可以直接
// join thaicompany_facts.entry_id,不用再靠 jpno 的 trigram 索引凑合(2026-07-02 迁移历史
// 数据见 ops/add_entry_id_to_thaicompany_views.sql)。
export async function bumpCompanyViews(jpno, entryId) {
  const lit = sqlLiteral(String(jpno))
  const eid = Number.isFinite(entryId) ? entryId : 'NULL'
  const sql = `INSERT INTO ${SCHEMA}.thaicompany_views (jpno, entry_id, views, updated_at) VALUES (${lit}, ${eid}, 1, now())
    ON CONFLICT (jpno) DO UPDATE SET views = ${SCHEMA}.thaicompany_views.views + 1,
      entry_id = COALESCE(EXCLUDED.entry_id, ${SCHEMA}.thaicompany_views.entry_id), updated_at = now()
    RETURNING views`
  const out = (await runPsql(sql, { timeout: 4000 })).trim()
  // 按天汇总桶(/trending-companies 时间窗口用,见 ops/create_thaicompany_views_daily_table.sql),
  // 失败不影响上面已经拿到的累计浏览量返回值——这张表只是聚合用的旁路,不是这个函数的主职责。
  try {
    const dailySql = `INSERT INTO ${SCHEMA}.thaicompany_views_daily (jpno, entry_id, day, views, updated_at) VALUES (${lit}, ${eid}, CURRENT_DATE, 1, now())
      ON CONFLICT (jpno, day) DO UPDATE SET views = ${SCHEMA}.thaicompany_views_daily.views + 1,
        entry_id = COALESCE(EXCLUDED.entry_id, ${SCHEMA}.thaicompany_views_daily.entry_id), updated_at = now()`
    await runPsql(dailySql, { timeout: 4000 })
  } catch (e) { console.error('[resolver] thaicompany_views_daily 写入失败(已忽略):', e.message) }
  return out ? parseInt(out, 10) : null
}

// 认领会员编辑记录(cms_entry_field_revisions,WooCMS 核心表,本函数只读):取某个 entry 全部
// 已通过(status='approved')的编辑记录,按时间倒序,给"认领后 X 修改"提示用。entryId 是内部数字
// 主键(非用户输入),直接拼数字安全。用 json_agg 把多行结果收进一列返回,不用 runPsql 那套
// tab/换行分隔解析——proposed_meta_json 里可能有会员自己填的多行文本(如经营范围简介),
// 用 \t/\n 分隔行列会被这些字段值里偶然出现的同样字符搞乱。
export async function lookupApprovedRevisions(entryId) {
  const eid = Number.isFinite(entryId) ? entryId : null
  if (eid == null) return []
  const sql = `SELECT json_agg(json_build_object('meta', proposed_meta_json, 'editedAt', reviewed_at) ORDER BY reviewed_at DESC NULLS LAST)::text
    FROM ${SCHEMA}.cms_entry_field_revisions WHERE entry_id = ${eid} AND status = 'approved'`
  const out = (await runPsql(sql, { timeout: 4000 })).trim()
  if (!out) return []
  try {
    const rows = JSON.parse(out)
    return Array.isArray(rows) ? rows.map(r => ({ meta: (r && r.meta) || {}, editedAt: (r && r.editedAt) || '' })) : []
  } catch {
    return []
  }
}
