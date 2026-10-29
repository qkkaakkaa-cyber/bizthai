// 财报排行榜内存快照——对齐 cache.js 的「离线建好、在线只读内存」模式。
//
// 背景:rankCompaniesByFinancials 在请求路径对 thaicompany_financial_facts 做
// WITH ... AS MATERIALIZED 百万级扫描,爬虫打 /business-leaderboards 时会拖死 PG
// 与 WooCMS 连接池。本模块在定时刷新窗口从 DB 拉一次,建成进程内索引;HTTP 读路径
// 只做 Set 过滤 + 预排序数组切片,**禁止**再跑那条重 SQL。
//
// 刷新失败保留上一份快照;首份就绪前请求 await 进行中的构建(与 getGlobalSnapshot 一致)。

import pg from 'pg'
import { config } from './config.js'

const identityTypes = { getTypeParser: () => value => value }
const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  max: 2,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  application_name: 'dbd-analytics-rankings',
  types: identityTypes,
})
pool.on('error', err => console.error('[rankings-cache] 空闲连接错误:', err.message))

const schema = () => `"${String(config.db.schema || 'woocms').replace(/"/g, '""')}"`
const MAX_OFFSET = 96000
const GROWTH_PREV_MIN = 10000000
// 与 ranking_config 口径一致:覆盖量 >= 最大年份 30% 才进可选年并载入内存
const YEAR_COVERAGE_FLOOR = 0.3
const SIZE_MAP = { S: 1, M: 2, L: 3 }

let snapshot = null
let inflight = null
let refreshTimer = null

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function query(sql, timeoutMs = 120000) {
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
    await client.query(`SET search_path TO ${schema()}, public`)
    return await client.query({ text: sql, rowMode: 'array' })
  } finally {
    client.release()
  }
}

async function loadYearConfig() {
  const { rows } = await query(
    `SELECT value::text, updated_at::text FROM ranking_config WHERE key = 'financial_ranking_year'`,
    10000,
  )
  if (!rows.length || !rows[0][0]) return null
  try {
    const cfg = JSON.parse(rows[0][0])
    cfg._updatedAt = String(rows[0][1] || '')
    return cfg
  } catch { return null }
}

function yearsToLoad(cfg) {
  const byYear = Array.isArray(cfg?.byYear) ? cfg.byYear : []
  const maxCov = byYear.reduce((m, y) => Math.max(m, num(y.revenueCoverage), num(y.profitCoverage)), 0)
  const floor = maxCov * YEAR_COVERAGE_FLOOR
  const picked = byYear
    .filter(y => Math.max(num(y.revenueCoverage), num(y.profitCoverage)) >= floor)
    .map(y => num(y.fiscalYearBe))
    .filter(y => y > 0)
  const def = num(cfg?.fiscalYearBe)
  if (def && !picked.includes(def)) picked.unshift(def)
  return [...new Set(picked)].sort((a, b) => b - a)
}

function availableYears(cfg) {
  // 返回裸 fiscalYearBe 数字数组,与 db.js 排行路径一致。
  // 若返回 {fiscalYearBe,...} 对象,resolver rankingYearSelect 会 String(y) → "[object Object]"。
  const byYear = Array.isArray(cfg?.byYear) ? cfg.byYear : []
  const maxCov = byYear.reduce((m, y) => Math.max(m, num(y.revenueCoverage), num(y.profitCoverage)), 0)
  const floor = maxCov * YEAR_COVERAGE_FLOOR
  return byYear
    .filter(y => Math.max(num(y.revenueCoverage), num(y.profitCoverage)) >= floor)
    .map(y => num(y.fiscalYearBe))
    .filter(y => y > 0)
    .sort((a, b) => b - a)
}

function sortIndices(n, scoreAt, activeOnly, statusAt) {
  const idx = []
  for (let i = 0; i < n; i++) {
    const s = scoreAt(i)
    if (!Number.isFinite(s)) continue
    if (activeOnly && statusAt[i] !== 0) continue
    idx.push(i)
  }
  idx.sort((a, b) => {
    const sa = statusAt[a] - statusAt[b]
    if (sa) return sa
    const va = scoreAt(b) - scoreAt(a)
    if (va) return va
    return a - b
  })
  return Uint32Array.from(idx)
}

async function loadOneYear(year, sharedCorps) {
  const t0 = Date.now()
  const fin = await query(`
    SELECT f.entry_id,
           f.revenue,
           f.profitloss,
           COALESCE(f.business_size_code, ''),
           COALESCE(f.status_rank, 1),
           COALESCE(NULLIF(tf.slug, ''), NULLIF(tf.jpno, ''), f.entry_id::text),
           COALESCE(tf.jpno, ''),
           COALESCE(tf.jpname, ''),
           COALESCE(tf.jpnamee, ''),
           COALESCE(tf.jpnamezh, ''),
           COALESCE(tf.province_th, ''),
           COALESCE(tf.provincee, ''),
           COALESCE(tf.provincezh, ''),
           COALESCE(tf.jpstatdesc, ''),
           COALESCE(NULLIF(tf.jpstatdesce, ''), ''),
           COALESCE(NULLIF(tf.statuszh, ''), '')
    FROM thaicompany_financial_facts f
    JOIN thaicompany_facts tf ON tf.entry_id = f.entry_id
    WHERE f.fiscal_year_be = ${year}
      AND (f.revenue IS NOT NULL OR f.profitloss IS NOT NULL)
  `, 300000)

  const n = fin.rows.length
  const entryIds = new Uint32Array(n)
  const revenue = new Float64Array(n)
  const profitloss = new Float64Array(n)
  const growth = new Float64Array(n)
  const sizeCode = new Uint8Array(n)
  const statusRank = new Uint8Array(n)
  // 公司展示资料来自当前 thaicompany_facts，同一 entry 在五个财年里完全相同。
  // 旧实现每年各存一份约 60 万个对象，五年合计近 300 万个对象，是快照 2.6GB
  // 常驻内存的主要来源。改为跨财年共享一份 Map；各 block 仍保留相同的 .corps API。
  const corps = sharedCorps

  for (let i = 0; i < n; i++) {
    const r = fin.rows[i]
    const id = num(r[0])
    entryIds[i] = id
    const rev = r[1] === null || r[1] === '' ? NaN : num(r[1])
    const pl = r[2] === null || r[2] === '' ? NaN : num(r[2])
    revenue[i] = rev
    profitloss[i] = pl
    growth[i] = NaN
    sizeCode[i] = SIZE_MAP[String(r[3]).toUpperCase()] || 0
    statusRank[i] = num(r[4]) === 0 ? 0 : 1
    // r[5]=slug(优先),r[6]=jpno。id 用 slug 供链接降级;code 必须是注册号,给表格 <small> 展示。
    // 此前 code 也取了 slug,首屏会出现 y-l-g-bullion-... 这种“假注册号”。
    const slug = String(r[5] || r[6] || id)
    const jpno = String(r[6] || '').trim()
    if (!corps.has(id)) {
      corps.set(id, {
        id: slug,
        code: jpno || slug,
        name: { th: String(r[7] || jpno || slug), en: String(r[8] || r[7] || jpno || slug), zh: String(r[9] || r[8] || r[7] || jpno || slug) },
        province: { th: String(r[10] || ''), en: String(r[11] || ''), zh: String(r[12] || '') },
        status: { th: String(r[13] || ''), en: String(r[14] || r[13] || ''), zh: String(r[15] || r[14] || r[13] || '') },
      })
    }
  }

  const prev = await query(`
    SELECT entry_id, revenue
    FROM thaicompany_financial_facts
    WHERE fiscal_year_be = ${year - 1}
      AND revenue IS NOT NULL AND revenue >= ${GROWTH_PREV_MIN}
  `, 180000)
  const prevMap = new Map()
  for (const r of prev.rows) prevMap.set(num(r[0]), num(r[1]))
  for (let i = 0; i < n; i++) {
    const cur = revenue[i]
    const p = prevMap.get(entryIds[i])
    if (Number.isFinite(cur) && cur >= 0 && p > 0) growth[i] = ((cur - p) / p) * 100
  }

  const orderRev = sortIndices(n, i => (revenue[i] >= 0 ? revenue[i] : NaN), false, statusRank)
  const orderPl = sortIndices(n, i => profitloss[i], false, statusRank)
  const orderGrowth = sortIndices(n, i => growth[i], false, statusRank)
  const orderRevActive = sortIndices(n, i => (revenue[i] >= 0 ? revenue[i] : NaN), true, statusRank)
  const orderPlActive = sortIndices(n, i => profitloss[i], true, statusRank)
  const orderGrowthActive = sortIndices(n, i => growth[i], true, statusRank)

  console.error(`[rankings-cache] year ${year}: ${n} rows in ${Date.now() - t0}ms`)
  return {
    year, n, entryIds, revenue, profitloss, growth, sizeCode, statusRank, corps,
    orderRev, orderPl, orderGrowth, orderRevActive, orderPlActive, orderGrowthActive,
  }
}

async function loadFacets(idUniverse) {
  const t0 = Date.now()
  const indBySlug = new Map()
  const provBySlug = new Map()
  const natByCode = new Map()
  const foreignSet = new Set()

  const terms = await query(`
    SELECT tx.code, t.slug, et.entry_id
    FROM cms_content_entry_terms et
    JOIN cms_custom_terms t ON t.id = et.term_id
    JOIN cms_custom_taxonomies tx ON tx.id = t.taxonomy_id
    WHERE tx.code IN ('industry', 'province')
  `, 300000)

  for (const r of terms.rows) {
    const id = num(r[2])
    if (!idUniverse.has(id)) continue
    const code = String(r[0])
    const slug = String(r[1] || '')
    if (!slug) continue
    const map = code === 'industry' ? indBySlug : provBySlug
    let set = map.get(slug)
    if (!set) { set = new Set(); map.set(slug, set) }
    set.add(id)
  }

  const nats = await query(`
    SELECT entry_id, nat_code FROM thaicompany_nationality_facts
  `, 180000)
  for (const r of nats.rows) {
    const id = num(r[0])
    if (!idUniverse.has(id)) continue
    const code = String(r[1] || '').toUpperCase()
    if (!code) continue
    let set = natByCode.get(code)
    if (!set) { set = new Set(); natByCode.set(code, set) }
    set.add(id)
    if (code !== 'TH') foreignSet.add(id)
  }

  console.error(`[rankings-cache] facets: ind=${indBySlug.size} prov=${provBySlug.size} nat=${natByCode.size} in ${Date.now() - t0}ms`)
  return { indBySlug, provBySlug, natByCode, foreignSet }
}

function sourceSignature(cfg) {
  // ETL 每次完成都会更新这份配置。只比较影响快照内容的字段，避免对象键顺序造成误判。
  return JSON.stringify({
    fiscalYearBe: num(cfg?.fiscalYearBe),
    updatedAt: String(cfg?._updatedAt || ''),
    byYear: (cfg?.byYear || []).map(y => [num(y.fiscalYearBe), num(y.revenueCoverage), num(y.profitCoverage)]),
  })
}

async function buildSnapshot(loadedConfig = null) {
  if (!config.db.user || !config.db.name) {
    throw new Error('DB not configured')
  }
  const t0 = Date.now()
  const cfg = loadedConfig || await loadYearConfig()
  if (!cfg) throw new Error('ranking_config.financial_ranking_year missing')
  const years = yearsToLoad(cfg)
  if (!years.length) throw new Error('no years to load')

  const byYear = new Map()
  const idUniverse = new Set()
  const sharedCorps = new Map()
  for (const y of years) {
    const block = await loadOneYear(y, sharedCorps)
    byYear.set(y, block)
    for (let i = 0; i < block.n; i++) idUniverse.add(block.entryIds[i])
  }
  const facets = await loadFacets(idUniverse)

  // coverage 按年从 config 取
  const covByYear = new Map()
  for (const y of (cfg.byYear || [])) {
    covByYear.set(num(y.fiscalYearBe), {
      revenue: num(y.revenueCoverage),
      profitloss: num(y.profitCoverage),
    })
  }

  const snap = {
    refreshedAt: new Date().toISOString(),
    sourceSignature: sourceSignature(cfg),
    defaultFiscalYearBe: num(cfg.fiscalYearBe),
    availableYears: availableYears(cfg),
    byYear,
    covByYear,
    ...facets,
  }
  console.error(`[rankings-cache] snapshot ready years=${years.join(',')} universe=${idUniverse.size} in ${Date.now() - t0}ms`)
  return snap
}

async function refresh() {
  if (inflight) return inflight
  inflight = loadYearConfig()
    .then(cfg => {
      if (!cfg) throw new Error('ranking_config.financial_ranking_year missing')
      const nextSignature = sourceSignature(cfg)
      if (snapshot && snapshot.sourceSignature === nextSignature) return snapshot
      // 新 ETL 数据到达时不能在旧的 1GB+ 快照旁边再构建一份。让 systemd 用新进程
      // 原子换代：当前请求仍拿旧快照，本轮事件循环结束后退出；新进程只构建一份新快照。
      if (snapshot) {
        console.error('[rankings-cache] source changed; restarting analytics for a memory-safe snapshot rebuild')
        setTimeout(() => process.exit(75), 100).unref?.()
        return snapshot
      }
      return buildSnapshot(cfg)
    })
    .then(snap => { snapshot = snap; return snap })
    .catch(err => {
      console.error('[rankings-cache] 刷新失败:', err.message)
      if (!snapshot) throw err
      return snapshot
    })
    .finally(() => { inflight = null })
  return inflight
}

export async function getRankingsSnapshot() {
  if (snapshot) return snapshot
  if (/^(?:1|true|yes)$/i.test(process.env.DISABLE_WARMUP || '')) throw new Error('rankings_snapshot_not_ready')
  return refresh()
}

export function startRankingsScheduler() {
  refresh().catch(err => console.error('[rankings-cache] 首次构建失败:', err.message))
  // 与全局商业快照同周期;财报 ETL 一天一次,小时级刷新足够跟上,又不会一直扫库
  refreshTimer = setInterval(() => { refresh().catch(() => {}) }, config.refreshMs)
  refreshTimer.unref?.()
}

export function rankingsMeta() {
  return {
    ready: Boolean(snapshot),
    refreshedAt: snapshot?.refreshedAt ?? null,
    defaultFiscalYearBe: snapshot?.defaultFiscalYearBe ?? null,
    yearsLoaded: snapshot ? [...snapshot.byYear.keys()] : [],
    building: Boolean(inflight),
  }
}

function scoreOf(block, metric, i) {
  if (metric === 'growth') return block.growth[i]
  if (metric === 'profitloss') return block.profitloss[i]
  const v = block.revenue[i]
  return v >= 0 ? v : NaN
}

function orderOf(block, metric, activeOnly) {
  if (metric === 'growth') return activeOnly ? block.orderGrowthActive : block.orderGrowth
  if (metric === 'profitloss') return activeOnly ? block.orderPlActive : block.orderPl
  return activeOnly ? block.orderRevActive : block.orderRev
}

function intersectSets(sets) {
  if (!sets.length) return null
  sets.sort((a, b) => a.size - b.size)
  const out = new Set()
  const [first, ...rest] = sets
  for (const id of first) {
    let ok = true
    for (const s of rest) {
      if (!s.has(id)) { ok = false; break }
    }
    if (ok) out.add(id)
  }
  return out
}

/**
 * 纯内存排行。快照未就绪时返回 null(调用方应 503,不要回退 SQL)。
 * 形状对齐 rankCompaniesByFinancials。
 */
export async function rankFromSnapshot(params = {}) {
  const snap = snapshot || await getRankingsSnapshot().catch(() => null)
  if (!snap) return null

  const metric = params.metric === 'profitloss' || params.metric === 'growth' ? params.metric : 'revenue'
  const industryList = (Array.isArray(params.industry) ? params.industry : [params.industry])
    .map(s => String(s || '').trim()).filter(Boolean)
  const provinceSlug = String(params.province || '').trim()
  const sizeKey = ['S', 'M', 'L'].includes(String(params.sizeCode || '').toUpperCase())
    ? String(params.sizeCode).toUpperCase() : ''
  const natRaw = String(params.natCode || '').toUpperCase()
  const nat = /^[A-Z]{2}$/.test(natRaw) ? natRaw : (natRaw === 'FOREIGN' ? 'FOREIGN' : '')
  const lim = Math.max(1, Math.min(num(params.limit) || 24, 100))
  const off = Math.max(0, Math.min(num(params.offset), MAX_OFFSET))
  const inactive = params.includeInactive === true || params.includeInactive === 1
    || ['1', 'true', 'yes', 'all'].includes(String(params.includeInactive || '').toLowerCase())

  const year = num(params.fiscalYear) || snap.defaultFiscalYearBe
  const block = snap.byYear.get(year)
  const cov = snap.covByYear.get(year) || { revenue: 0, profitloss: 0 }
  const coverage = metric === 'profitloss' ? cov.profitloss : cov.revenue

  if (!block) {
    return {
      items: [], total: 0, limit: lim, offset: off, metric,
      fiscalYearBe: year, defaultFiscalYearBe: snap.defaultFiscalYearBe,
      coverage: 0, availableYears: snap.availableYears, includeInactive: inactive,
      source: 'rankings_snapshot_missing_year',
    }
  }

  // 维度集合:行业多 slug OR,再与府 AND
  const filterSets = []
  if (industryList.length) {
    const union = new Set()
    let any = false
    for (const slug of industryList) {
      const s = snap.indBySlug.get(slug)
      if (!s) continue
      any = true
      for (const id of s) union.add(id)
    }
    if (!any) {
      return {
        items: [], total: 0, limit: lim, offset: off, metric,
        fiscalYearBe: year, defaultFiscalYearBe: snap.defaultFiscalYearBe,
        coverage: 0, availableYears: snap.availableYears, includeInactive: inactive,
        source: 'rankings_snapshot',
      }
    }
    filterSets.push(union)
  }
  if (provinceSlug) {
    const s = snap.provBySlug.get(provinceSlug)
    if (!s) {
      return {
        items: [], total: 0, limit: lim, offset: off, metric,
        fiscalYearBe: year, defaultFiscalYearBe: snap.defaultFiscalYearBe,
        coverage: 0, availableYears: snap.availableYears, includeInactive: inactive,
        source: 'rankings_snapshot',
      }
    }
    filterSets.push(s)
  }
  if (nat === 'FOREIGN') filterSets.push(snap.foreignSet)
  else if (nat) {
    const s = snap.natByCode.get(nat)
    if (!s) {
      return {
        items: [], total: 0, limit: lim, offset: off, metric,
        fiscalYearBe: year, defaultFiscalYearBe: snap.defaultFiscalYearBe,
        coverage: 0, availableYears: snap.availableYears, includeInactive: inactive,
        source: 'rankings_snapshot',
      }
    }
    filterSets.push(s)
  }

  const allowed = filterSets.length ? intersectSets(filterSets) : null
  const sizeNeed = sizeKey ? SIZE_MAP[sizeKey] : 0
  const order = orderOf(block, metric, !inactive)

  const items = []
  let total = 0
  for (let k = 0; k < order.length; k++) {
    const i = order[k]
    const id = block.entryIds[i]
    if (allowed && !allowed.has(id)) continue
    if (sizeNeed && block.sizeCode[i] !== sizeNeed) continue
    const metricValue = scoreOf(block, metric, i)
    if (!Number.isFinite(metricValue)) continue
    if (total >= off && items.length < lim) {
      const corp = block.corps.get(id)
      if (corp) items.push({ ...corp, metricValue })
    }
    total++
  }

  return {
    items, total, limit: lim, offset: off, metric,
    fiscalYearBe: year, defaultFiscalYearBe: snap.defaultFiscalYearBe,
    coverage, availableYears: snap.availableYears, includeInactive: inactive,
    source: 'rankings_snapshot',
  }
}
