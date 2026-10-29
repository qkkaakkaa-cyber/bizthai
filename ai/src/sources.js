// 数据源层:AI 工具的「手」。本服务不碰 DB,所有数据都是内部 fetch 调已有服务:
//   WooCMS 站点接口(8083)  —— 企业列表/单条详情、会员鉴权 /auth/me
//   analytics sidecar(8084)—— 市场快照、排名、外资组成、府名解析
//   directors sidecar(8085)—— 共享董事关联、按人/证件号反查
import { config } from './config.js'

let wooInflight = 0
const WOO_MAX_INFLIGHT = 4

async function getJSON(url, { headers, timeout = 30000 } = {}) {
  const usesWoo = String(url).startsWith(`${config.woocmsBase}/`)
  if (usesWoo && wooInflight >= WOO_MAX_INFLIGHT) throw new Error('WooCMS temporarily busy')
  if (usesWoo) wooInflight += 1
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeout)
  try {
    const r = await fetch(url, { headers, signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
    return await r.json()
  } finally {
    clearTimeout(t)
    if (usesWoo) wooInflight -= 1
  }
}

const SITE = `${config.woocmsBase}/api/site/v1`
const ANA = `${config.analyticsBase}/api/site/v1/analytics`
const DIR = `${config.directorsBase}/api/site/v1`

// ── WooCMS 企业数据 ───────────────────────────────────────
export async function searchEntries({ keyword, taxonomy, term, sort, order, limit = 10, offset = 0, fields } = {}) {
  const p = new URLSearchParams()
  if (keyword) p.set('keyword', String(keyword))
  if (taxonomy && term) { p.append('taxonomy', taxonomy); p.append('term', term) }
  p.set('limit', String(limit))
  p.set('offset', String(offset))
  if (sort) { p.set('sort', sort); p.set('order', order || 'desc') }
  if (fields) p.set('fields', Array.isArray(fields) ? fields.join(',') : fields)
  const j = await getJSON(`${SITE}/models/${config.model}/entries?${p.toString()}`)
  return j?.data ?? { items: [], total: 0 }
}

export async function getEntry(jpno) {
  const j = await getJSON(`${SITE}/models/${config.model}/entries/${encodeURIComponent(jpno)}`)
  return j?.data ?? null
}

// 会员身份:把浏览器/小程序透传来的 Cookie 或 Authorization/X-Session-Token 交给 WooCMS /auth/me;
// 200=已登录,401/异常=匿名。小程序 wx.request() 不会自动带 Cookie,登录态走后两个头,
// 之前只转发 Cookie 导致小程序登录会员被误判匿名,吃了每日限次而不是会员不限次。
export async function whoAmI(cookie, authHeader, sessionTokenHeader) {
  if (!cookie && !authHeader && !sessionTokenHeader) return null
  try {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (authHeader) headers.authorization = authHeader
    if (sessionTokenHeader) headers['x-session-token'] = sessionTokenHeader
    const j = await getJSON(`${SITE}/auth/me`, { headers, timeout: 3000 })
    // WooCMS /auth/me 返回 {data:{user:{id,...}}};兼容旧结构 {data:{id,...}}
    return j?.data?.user ?? j?.data ?? null
  } catch {
    return null
  }
}

// ── 府名 → term slug 解析(analytics /regions,缓存 1h) ──
let provincesCache = null
let provincesAt = 0
async function provinceList() {
  if (provincesCache && Date.now() - provincesAt < 3600000) return provincesCache
  const j = await getJSON(`${ANA}/regions`)
  provincesCache = (j?.provinces ?? []).map(p => ({
    slug: p.slug,
    zh: p.name?.zh || '', // 物化视图按 provincezh 过滤
    names: [p.name?.en, p.name?.th, p.name?.zh].filter(Boolean).map(s => String(s).toLowerCase()),
  }))
  provincesAt = Date.now()
  return provincesCache
}
// 把任意语言的府名解析成 { slug, zh };解析不到返回 null
export async function resolveProvince(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  if (!n) return null
  const list = await provinceList()
  let hit = list.find(p => p.names.includes(n))
  if (!hit) hit = list.find(p => p.names.some(x => x.includes(n) || n.includes(x)))
  return hit || null
}

// 府级公司排名(走 analytics 物化视图端点,索引安全,毫秒级)
export async function topCompaniesByProvince(provinceZh, sort = 'capital_desc', limit = 10) {
  const p = new URLSearchParams({ province: provinceZh, sort, limit: String(limit) })
  return getJSON(`${ANA}/top-companies?${p.toString()}`)
}

// 统一公司浏览/关键词搜索(默认仅运营中;按名精确查可传 includeInactive)
export async function browseCompanyList({ keyword, provinceSlug, limit = 10, offset = 0, includeInactive = false } = {}) {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (keyword) p.set('keyword', keyword)
  if (provinceSlug) p.set('province', provinceSlug)
  if (includeInactive) p.set('includeInactive', '1')
  const body = await getJSON(`${ANA}/company-list?${p.toString()}`)
  return (body && body.data) || { items: [], total: 0 }
}

// ── analytics 聚合 ────────────────────────────────────────
export async function marketSnapshot(provinceSlug) {
  const p = new URLSearchParams({ limit: '10', foreignLimit: '8', businessLimit: '8', statusLimit: '8', latestLimit: '10' })
  if (provinceSlug) p.set('provinceSlug', provinceSlug)
  return getJSON(`${ANA}/business?${p.toString()}`, { timeout: 60000 })
}

export async function rankCompanies({ sort = 'capital_desc', limit = 10 } = {}) {
  const p = new URLSearchParams({ sort, limit: String(limit) })
  return getJSON(`${ANA}/business/companies?${p.toString()}`, { timeout: 60000 })
}

export async function foreignComposition(limit = 12) {
  return getJSON(`${ANA}/business/foreign?limit=${limit}`, { timeout: 60000 })
}

// ── directors 关联/反查 ──────────────────────────────────
export async function relatedCompanies(jpno, limit = 12) {
  return getJSON(`${DIR}/companies/${encodeURIComponent(jpno)}/related?limit=${limit}`)
}

// 只按姓名匹配(mode=name,显式传参,不吃 sidecar 默认值)——按证件号反查不是公开产品能力,
// 聊天工具不应该具备这个能力。
export async function searchDirectors(q, limit = 12) {
  return getJSON(`${DIR}/directors/search?q=${encodeURIComponent(q)}&mode=name&limit=${limit}`)
}

export async function companiesByNationality(nt, limit = 15) {
  return getJSON(`${DIR}/directors/by-nationality?nt=${encodeURIComponent(nt)}&limit=${limit}`)
}
