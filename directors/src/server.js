// HTTP 服务:董事(委员)按证件号反查接口。经 nginx 反代到本服务。
//   GET /api/site/v1/directors/{cmtNo}        反查此人名下所有公司(支持 ?limit= &offset=)
//   GET /api/site/v1/directors/health         健康/索引状态
//
// 底层:woocms.director_index 倒排表(由 ops/build_director_index.sql 定时全量重建)。
import { createServer } from 'node:http'
import { config } from './config.js'
import { lookupDirector, lookupRelatedCompanies, lookupNetwork, lookupClaimStatus, indexMeta, searchDirectors, companiesByNationality } from './db.js'

// ── 身份解析(cookie/Authorization/X-Session-Token → uid),带 60s 缓存——与 sanitizer/src/server.js
// 的 whoAmI() 同款手法(那边挡 models API,这里挡 related/network,是两个独立服务,复制一份而不是共享
// 一个模块,跟这个代码库"每个 sidecar 零依赖、各自独立"的一贯风格一致)。
// 2026-07-12:related/network 端点原先零鉴权,任何人(含爬虫)直接打接口就能拿到 sharedDirectors 里的
// 董事姓名——公司自己的 committees 字段已经在 sanitizer 那边按登录态收紧,这两个跨公司视角的端点也要
// 补上同等力度,不能只在前端 theme.js 里做"未登录不发请求"这种纯 UI 层面的遮掩(爬虫不会跑前端 JS,
// 但更关键的是它压根不需要跑——直接 curl 这个 URL 就绕过去了)。
const idCache = new Map()
const ID_TTL = 60000
async function whoAmI(cookie, authHeader, sessionTokenHeader) {
  const idKey = cookie || authHeader || sessionTokenHeader
  if (!idKey) return null
  const hit = idCache.get(idKey)
  if (hit && Date.now() - hit.at < ID_TTL) return hit.uid
  let uid = null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (authHeader) headers.authorization = authHeader
    if (sessionTokenHeader) headers['x-session-token'] = sessionTokenHeader
    const r = await fetch(`http://${config.woocmsHost}:${config.woocmsPort}/api/site/v1/auth/me`, { headers, signal: ctrl.signal })
    clearTimeout(t)
    if (r.ok) { const j = await r.json(); uid = (j?.data?.user?.id ?? j?.data?.id) || null }
  } catch { uid = null }
  idCache.set(idKey, { uid, at: Date.now() })
  return uid
}
const idSweep = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of idCache) if (now - v.at > ID_TTL) idCache.delete(k)
}, 600000)
if (idSweep.unref) idSweep.unref()

const BASE = '/api/site/v1/directors'
// 公司视角(共享董事):/companies/{jpNo}/related(一跳列表) 与 /companies/{jpNo}/network(多级子图)
const RELATED_RE = /^\/api\/site\/v1\/companies\/([^/]+)\/related$/
const NETWORK_RE = /^\/api\/site\/v1\/companies\/([^/]+)\/network$/
// 公开认领状态:/companies/{jpNo}/claim-status → { jpNo, claimed:boolean }
const CLAIM_RE = /^\/api\/site\/v1\/companies\/([^/]+)\/claim-status$/
const VALID_JPNO = /^[A-Za-z0-9-]{1,64}$/
const clamp = (n, lo, hi, d) => Number.isFinite(n) && n >= lo ? Math.min(Math.floor(n), hi) : d

// cmtNo 有效性:与索引 build 口径一致(>=6 位字母数字,非单字符重复)。
// 不合规者(空 / "1" / "fff" 等)不可聚合,前端按 jpNo+cmtSeq 兜底。
const VALID_CMTNO = /^[A-Za-z0-9]{6,}$/
const isAggregatable = v => VALID_CMTNO.test(v) && !/^(.)\1+$/.test(v)

const intParam = (q, key, d) => {
  const raw = q.get(key)
  if (raw == null || raw === '') return d   // 缺省回落默认值(注意 Number(null)===0,不能直接 Number)
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d
}

// ── 体检发现:董事(证件号)反查接口原先零鉴权、零限流,可被无限枚举批量抓走 PII。
// 通用限流(全部端点):单 IP 滑动窗口,超限直接 429。──────────────
const rateHits = new Map() // ip -> { count, resetAt }
function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}
function rateLimited(req) {
  const ip = clientIp(req)
  const now = Date.now()
  let e = rateHits.get(ip)
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + config.rateLimitWindowMs }; rateHits.set(ip, e) }
  e.count += 1
  return e.count > config.rateLimitMax
}
const rateSweep = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rateHits) if (now > v.resetAt) rateHits.delete(k)
}, 3600000)
if (rateSweep.unref) rateSweep.unref()

// 证件号精确反查(mode=id/auto 里摸 cmt_no 的部分 + 按 cmtNo 直查)是最敏感的操作——凭一个
// 证件号就能拿到完整姓名/国籍/持股档案,这类能力只对"后台自己调用"开放,不是"登录会员可调用"
// (会员登录与否跟是不是后台自身调用是两回事)。X-Private-Fields: cmt_no 这个 header 只由本机
// 内部服务(如 resolver)直连 127.0.0.1:9185 时设置,公网 nginx 已把客户端传入的同名 header
// strip 掉(见 bizthai.com.conf),所以它出现本身就等价于"这是受信的内部调用"。
function isInternalCall(req) {
  return (req.headers['x-private-fields'] || '').includes('cmt_no')
}

// ── 极简 TTL 缓存 ────────────────────────────────────────
const cache = new Map() // key -> { at, body }
function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > config.cacheTtlMs) { cache.delete(key); return null }
  return hit.body
}
function cacheSet(key, body) {
  if (cache.size >= config.cacheMax) cache.clear()
  cache.set(key, { at: Date.now(), body })
}

function send(res, status, body) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  if (config.corsOrigin) {
    headers['Access-Control-Allow-Origin'] = config.corsOrigin
    headers['Vary'] = 'Origin'
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${config.port}`)
    const path = url.pathname.replace(/\/+$/, '')
    const q = url.searchParams

    if (path === `${BASE}/health`) {
      const meta = await indexMeta().catch(() => null)
      return send(res, meta ? 200 : 503, { ok: !!meta, index: meta })
    }

    // 健康检查之外全部端点限流(单 IP 滑动窗口),防批量枚举/爬取
    if (rateLimited(req)) {
      return send(res, 429, { error: 'rate_limited', message: '请求过于频繁,请稍后再试。' })
    }

    // ── 统一搜索股东/老板:同时按证件号(精确,大小写兼容)+ 姓名(子串模糊,英/泰)──────────────
    // GET /api/site/v1/directors/search?q=&mode=auto|name|id&limit=&offset= → { query, mode, total, persons[] }
    // 默认 mode=auto:命中什么显示什么;persons[].matchedById 标记由证件号命中者。
    // 结果只含姓名/国籍/公司数 + 链接用 jpNo+cmtSeq;绝不返回 cmt_no(合规)。
    // 2026-07-12:结果含真实姓名,改成登录会员可见——之前"不用登录当门槛"是刻意设计(见下面
    // mode=id 那条注释),现在用户明确要求人事/董事信息一律登录可见,这条连带收紧。
    if (path === `${BASE}/search`) {
      if (!(await whoAmI(req.headers.cookie || '', req.headers['authorization'] || '', req.headers['x-session-token'] || ''))) {
        return send(res, 401, { error: 'login_required', message: '此接口仅限登录会员调用。' })
      }
      const rawQ = (q.get('q') || '').trim()
      // 统一搜索:默认 auto(证件号+姓名一起匹配);id/name 仅供直接 API 调用显式指定
      let mode = (q.get('mode') || 'auto').toLowerCase()
      if (mode !== 'id' && mode !== 'name' && mode !== 'company') mode = 'auto'
      const limit = Math.min(intParam(q, 'limit', 24), config.maxLimit)
      const offset = intParam(q, 'offset', 0)
      const empty = (notice) => send(res, 200, { query: rawQ, mode, total: 0, persons: [], limit, offset, notice })
      if (rawQ.length < 3) {
        return empty('too_short') // 至少 3 字符(保证走 trgm 索引)
      }
      // 证件号匹配能力(mode=id 的模糊匹配、mode=auto 里摸 cmt_no 的那部分)仍然只对内部调用开放
      // (登录会员 ≠ 内部调用,这是两道独立的门槛,证件号反查权限不因为登录就放开)。
      const internal = isInternalCall(req)
      const cacheKey = `search|${mode}|${rawQ}|${limit}|${offset}${internal ? '|private' : ''}`
      const cached = cacheGet(cacheKey)
      if (cached) return send(res, 200, cached)
      const result = await searchDirectors(rawQ, { mode, limit, offset, includeCmtNo: internal, allowIdMatch: internal })
      const body = { query: rawQ, mode, total: result?.total ?? 0, persons: result?.persons ?? [], limit, offset }
      cacheSet(cacheKey, body)
      return send(res, 200, body)
    }

    // ── 外资按国家:有该国籍董事/股东的公司列表(/foreign-companies-<国> SSR 用)──────
    if (path === `${BASE}/by-nationality`) {
      const nt = (q.get('nt') || '').trim().toUpperCase()
      const limit = Math.min(intParam(q, 'limit', 24), config.maxLimit)
      const offset = intParam(q, 'offset', 0)
      if (!/^[A-Z]{2,3}$/.test(nt)) return send(res, 200, { ntCode: nt, total: 0, companies: [], limit, offset, notice: 'invalid_nt' })
      const cacheKey = `bynat|${nt}|${limit}|${offset}`
      const cached = cacheGet(cacheKey)
      if (cached) return send(res, 200, cached)
      const result = await companiesByNationality(nt, { limit, offset })
      const body = { ntCode: nt, total: result?.total ?? 0, companies: result?.companies ?? [], limit, offset }
      cacheSet(cacheKey, body)
      return send(res, 200, body)
    }

    // ── 公司视角:共享董事的关联公司(登录会员可见,含 sharedDirectors 里的真实姓名)──────
    const relatedMatch = path.match(RELATED_RE)
    if (relatedMatch) {
      if (!(await whoAmI(req.headers.cookie || '', req.headers['authorization'] || '', req.headers['x-session-token'] || ''))) {
        return send(res, 401, { error: 'login_required', message: '此接口仅限登录会员调用。' })
      }
      const jpNo = decodeURIComponent(relatedMatch[1]).trim()
      if (!VALID_JPNO.test(jpNo)) {
        return send(res, 400, { error: 'invalid_jpno', jpNo })
      }
      const limit = Math.min(intParam(q, 'limit', config.defaultLimit), config.maxLimit)
      const offset = intParam(q, 'offset', 0)
      const cacheKey = `related|${jpNo}|${limit}|${offset}`
      const cached = cacheGet(cacheKey)
      if (cached) return send(res, 200, cached)

      const result = await lookupRelatedCompanies(jpNo, { limit, offset })
      const body = {
        jpNo,
        company: result?.company ?? null,
        related: result?.related ?? [],
        total: result?.total ?? 0,
        limit,
        offset,
      }
      cacheSet(cacheKey, body)
      return send(res, 200, body)
    }

    // ── 公司视角:共享董事关系子图(服务端 BFS,登录会员可见,同样含真实姓名)──────
    const networkMatch = path.match(NETWORK_RE)
    if (networkMatch) {
      if (!(await whoAmI(req.headers.cookie || '', req.headers['authorization'] || '', req.headers['x-session-token'] || ''))) {
        return send(res, 401, { error: 'login_required', message: '此接口仅限登录会员调用。' })
      }
      const jpNo = decodeURIComponent(networkMatch[1]).trim()
      if (!VALID_JPNO.test(jpNo)) {
        return send(res, 400, { error: 'invalid_jpno', jpNo })
      }
      const depth = clamp(Number(q.get('depth')), 1, 4, 2)
      const maxNodes = clamp(Number(q.get('maxNodes')), 1, 300, 60)
      const minShared = clamp(Number(q.get('minShared')), 1, 50, 1)
      const cacheKey = `network|${jpNo}|${depth}|${maxNodes}|${minShared}`
      const cached = cacheGet(cacheKey)
      if (cached) return send(res, 200, cached)

      const g = await lookupNetwork(jpNo, { depth, maxNodes, minShared })
      const body = {
        jpNo, depth, maxNodes, minShared,
        truncated: g?.truncated ?? false,
        nodes: g?.nodes ?? [],
        edges: g?.edges ?? [],
      }
      cacheSet(cacheKey, body)
      return send(res, 200, body)
    }

    // ── 公司视角:公开认领状态(是否已认领并批准)──────────────
    const claimMatch = path.match(CLAIM_RE)
    if (claimMatch) {
      const jpNo = decodeURIComponent(claimMatch[1]).trim()
      if (!VALID_JPNO.test(jpNo)) {
        return send(res, 400, { error: 'invalid_jpno', jpNo })
      }
      const cacheKey = `claim|${jpNo}`
      const cached = cacheGet(cacheKey)
      if (cached) return send(res, 200, cached)

      const claimed = await lookupClaimStatus(jpNo)
      const body = { jpNo, claimed }
      cacheSet(cacheKey, body)
      return send(res, 200, body)
    }

    if (!path.startsWith(`${BASE}/`)) {
      return send(res, 404, { error: 'not_found', hint: `endpoints live under ${BASE}/{cmtNo}` })
    }

    const rawKey = decodeURIComponent(path.slice(`${BASE}/`.length))
    const cmtNo = rawKey.trim()

    // 不可聚合的 key:返回稳定的空结果(非错误),让前端走 jpNo+cmtSeq 兜底。
    if (!isAggregatable(cmtNo)) {
      return send(res, 200, {
        cmtNo, person: null, companies: [], total: 0,
        aggregatable: false,
        notice: 'cmtNo 为空或非有效证件号,无法反查;请按来源公司 jpNo+cmtSeq 兜底展示。',
      })
    }

    // 按证件号直查同样只对内部调用开放("只能后台调用",而不是"登录会员可调用")
    if (!isInternalCall(req)) {
      return send(res, 403, { error: 'internal_only', message: '此接口仅限内部服务调用。' })
    }

    const limit = Math.min(intParam(q, 'limit', config.defaultLimit), config.maxLimit)
    const offset = intParam(q, 'offset', 0)
    const cacheKey = `${cmtNo}|${limit}|${offset}`

    const cached = cacheGet(cacheKey)
    if (cached) return send(res, 200, cached)

    const result = await lookupDirector(cmtNo, { limit, offset })
    const body = {
      cmtNo,
      person: result?.person ?? null,
      companies: result?.companies ?? [],
      total: result?.total ?? 0,
      limit,
      offset,
      aggregatable: true,
    }
    cacheSet(cacheKey, body)
    return send(res, 200, body)
  } catch (err) {
    console.error('[directors] 请求处理失败:', err.message)
    return send(res, 503, { error: 'lookup_unavailable', message: err.message })
  }
})

server.listen(config.port, process.env.BIND_HOST || '127.0.0.1', () => {
  console.log(`[directors] 监听 ${process.env.BIND_HOST || '127.0.0.1'}:${config.port},反查表 ${config.db.schema}.director_index`)
})
