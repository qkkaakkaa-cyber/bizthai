// HTTP 服务:公司详情「纯英文名 URL」解析 + 反代。经 nginx 把所有 *.html 反代到本服务。
//   GET /<英文名slug>.html            → 按 slug 反查 jpNo(走函数索引),内部取 WooCMS /company/{jpNo} 整页返回
//   GET /<jpNo>.html                  → 无英文名公司的降级形态,直接取 /company/{jpNo}
//   GET /<英文名slug>-<jpNo>.html      → 旧形态(向后兼容),取尾部 jpNo
//   GET /api/site/v1/resolver/health  → 健康/索引状态
//
// 底层:函数索引 idx_thaicompany_nameslug,每请求按 slug 精确查 jpNo(~1ms);带短 TTL 缓存。
import { Agent, createServer, request as httpRequest } from 'node:http'
import { config } from './config.js'
import { resolveSlug, indexPresent, samePeers, entryTopTerms, bumpCompanyViews, lookupApprovedRevisions, companyCanonicalPath } from './db.js'
import { ensureIndustryLoaded, resolveIndustrySlug, ensureProvincesLoaded, matchCrossProvince, provinceByEngSlug, allProvinces } from './industry.js'
import { resolveBizPage, injectBizSlots, analyticsQuery, renderOwnerSearch, renderYearMain, renderNatMain, renderRegionProvinceGrid, renderRegionDistrictGrid, renderRegionDistrictReport, pagerHtml, renderTrendingMain } from './biz.js'
import { CURATED_LISTS, CURATED_LIST_MAP } from './curatedLists.js'
import { buildRobotsTxt, buildLlmsTxt, buildSitemapIndex, buildCoreSitemap, buildPagesSitemap, buildTaxonomySitemap, buildPostsSitemap, buildCompaniesSitemap, buildSitemapPageContent, sitemapSeo, buildSitemapXsl, sitemapPaths, parseCompanyShardPath, parseCoreShardPath } from './sitemap.js'
import { createHtmlCache, htmlCacheKey, matchesIfNoneMatch, requestAllowsSharedHtmlCache } from './html-cache.js'

// sitemap 保留既有 token 路径兼容已提交记录，同时提供完整、稳定的公开路径供 robots 发现。
const SM = sitemapPaths(config.sitemapToken)
const SM_PUBLIC = sitemapPaths('')
// 任何未被两套明确路由命中的 /sitemap*.xml 一律 404，避免落到 WooCMS 原生错误 sitemap。
const SM_LEGACY_RE = /^\/sitemap(?:-[a-z0-9-]+)?\.xml$/

const HEALTH = '/api/site/v1/resolver/health'
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/   // 前端 slugify 产物;非此格式直接判未命中
const DIGITS = /^\d{6,}$/
const NAME_JPNO = /^(?:.*-)?(\d{6,})$/    // 旧 <name>-<jpno> 或纯 <jpno>

// WooCMS 的 database/sql 池当前上限是 20。详情页渲染会在读取字段组后继续查字段定义，
// 因此不能允许 20 个请求同时各占一条连接，否则所有请求都会拿着第一条连接等待第二条，
// 形成池饥饿。这里给嵌套查询留出余量，并给正常访客预留不被分布式爬虫占满的槽位。
const WOO_MAX_INFLIGHT = 3
const WOO_BOT_MAX_INFLIGHT = 1
const OTHER_MAX_INFLIGHT = 8
const UPSTREAM_TIMEOUT_MS = 15000
const MAX_BUFFERED_UPSTREAM_BODY = 16 * 1024 * 1024
const wooAgent = new Agent({ keepAlive: true, maxSockets: WOO_MAX_INFLIGHT, maxFreeSockets: 6, timeout: 30000 })
const otherAgent = new Agent({ keepAlive: true, maxSockets: OTHER_MAX_INFLIGHT, maxFreeSockets: 16, timeout: 30000 })
const upstreamInflight = new Map()
let wooBotInflight = 0

function upstreamKey(host, port) { return String(host) + ':' + String(port) }
function isWooUpstream(host, port) {
  return String(host) === String(config.woocmsHost) && Number(port) === Number(config.woocmsPort)
}
function acquireUpstream(host, port, headers = {}) {
  const key = upstreamKey(host, port)
  const current = upstreamInflight.get(key) || 0
  const woo = isWooUpstream(host, port)
  const bot = woo && isBotUA(headers['user-agent'])
  const max = woo ? WOO_MAX_INFLIGHT : OTHER_MAX_INFLIGHT
  if (current >= max || (bot && wooBotInflight >= WOO_BOT_MAX_INFLIGHT)) return null
  upstreamInflight.set(key, current + 1)
  if (bot) wooBotInflight++
  let released = false
  return () => {
    if (released) return
    released = true
    const next = Math.max(0, (upstreamInflight.get(key) || 1) - 1)
    if (next) upstreamInflight.set(key, next)
    else upstreamInflight.delete(key)
    if (bot) wooBotInflight = Math.max(0, wooBotInflight - 1)
  }
}
function agentFor(host, port) { return isWooUpstream(host, port) ? wooAgent : otherAgent }

function temporaryUnavailable(res) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(503, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': '60',
  })
  res.end('Service temporarily unavailable\n')
}

function relayFetched(req, res, fetched) {
  if (!fetched || res.destroyed || res.writableEnded) return
  const headers = { ...(fetched.headers || {}) }
  for (const h of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade']) delete headers[h]
  res.writeHead(fetched.status || 502, headers)
  res.end(req.method === 'HEAD' ? '' : fetched.body)
}

// ── slug→jpNo 短 TTL 缓存(索引查已很快,缓存主要削峰)──────────
const cache = new Map() // slug -> { at, jpno }
function cacheGet(slug) {
  const hit = cache.get(slug)
  if (!hit) return undefined
  if (Date.now() - hit.at > config.cacheTtlMs) { cache.delete(slug); return undefined }
  return hit.jpno
}
function cacheSet(slug, jpno) {
  if (cache.size >= config.cacheMax) cache.clear()
  cache.set(slug, { at: Date.now(), jpno })
}

// ── 最终 HTML 短缓存(SEO/SSR 注入之后的完整页面)────────────
const htmlCache = createHtmlCache({ ttlMs: config.htmlCacheTtlMs, maxEntries: config.htmlCacheMax })
const HTML_CACHE_CONTROL = `public, max-age=${config.htmlBrowserMaxAge}, s-maxage=${config.htmlSharedMaxAge}, stale-while-revalidate=30`

function htmlResponseHeaders(entry, cacheStatus) {
  const age = Math.max(0, Math.floor((Date.now() - entry.storedAt) / 1000))
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': HTML_CACHE_CONTROL,
    ETag: entry.etag,
    'Last-Modified': new Date(entry.storedAt).toUTCString(),
    'X-BizThai-Last-Modified': new Date(entry.storedAt).toUTCString(),
    Age: String(age),
    'X-Accel-Expires': String(config.htmlSharedMaxAge),
    'X-Resolver-HTML-Cache': cacheStatus,
  }
}

function writeHtmlEntry(req, res, entry, cacheStatus) {
  const headers = htmlResponseHeaders(entry, cacheStatus)
  const ifNoneMatch = req.headers['if-none-match']
  const ifModifiedSince = Date.parse(String(req.headers['if-modified-since'] || ''))
  const notModifiedSince = !ifNoneMatch && Number.isFinite(ifModifiedSince) &&
    Math.floor(entry.storedAt / 1000) * 1000 <= ifModifiedSince
  if (matchesIfNoneMatch(ifNoneMatch, entry.etag) || notModifiedSince) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? '' : entry.body)
}

function serveHtmlCacheHit(req, res, url) {
  if (/^\/(?:admin|api|login|logout|register|account|forgot-password|reset-password|verify-email|claim)(?:\/|$)/.test(url.pathname)) return false
  if (!requestAllowsSharedHtmlCache(req)) return false
  const entry = htmlCache.get(htmlCacheKey(req, url))
  if (!entry) return false
  writeHtmlEntry(req, res, entry, 'hit')
  return true
}

function sendHtml(req, res, url, html, cacheable = false) {
  if (/^\/(?:admin|api|login|logout|register|account|forgot-password|reset-password|verify-email|claim)(?:\/|$)/.test(url.pathname)) cacheable = false
  html = html.replace(/(href|action)=(["'])\/(?:th|en)(?=\/|["'])([^"']*)\2/gi, (_, attr, quote, path) => attr + '=' + quote + (path || '/') + quote)
  if (cacheable && requestAllowsSharedHtmlCache(req)) {
    const entry = htmlCache.set(htmlCacheKey(req, url), html)
    writeHtmlEntry(req, res, entry, 'miss')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Accel-Expires': '0',
    'X-Resolver-HTML-Cache': 'bypass',
  })
  res.end(req.method === 'HEAD' ? '' : html)
}

function onlyQueryKeys(url, allowed) {
  const keys = Array.from(url.searchParams.keys())
  return keys.every(key => allowed.includes(key))
}

// ── 反方向:jpNo→WooCMS 路由 key(英文名公司是 slug,stub 公司是 jpNo 本身)。数据库里
// meta_json->>'jpno' 没有可用索引(全表扫会 timeout,加索引需要 DDL 权限,resolver 的库账号
// 只读没有),改成"顺路"缓存:每次 resolveJpNo() 成功解出一个 jpNo,顺手把这个方向也记一笔。
// 命中率取决于"最近有没有人访问过这家公司的详情页"——serveDirectorPage 用,查不到就退回
// 直接拿 jpNo 当 key 试(stub 公司命中,英文名公司还是 404,和这次改动前的行为一致,不会更差)。
const jpnoKeyCache = new Map() // jpno -> { at, key }
function jpnoKeyGet(jpno) {
  const hit = jpnoKeyCache.get(jpno)
  if (!hit) return undefined
  if (Date.now() - hit.at > config.cacheTtlMs) { jpnoKeyCache.delete(jpno); return undefined }
  return hit.key
}
function jpnoKeySet(jpno, key) {
  if (jpnoKeyCache.size >= config.cacheMax) jpnoKeyCache.clear()
  jpnoKeyCache.set(jpno, { at: Date.now(), key })
}

// 从 .html 路径解析出 jpNo。纯数字/尾部数字形态零查询;纯英文名 slug 走索引查。
async function resolveJpNo(pathname) {
  const clean = pathname.replace(/\/+$/, '')
  if (!/\.html$/i.test(clean)) return null
  let file = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  try { file = decodeURIComponent(file) } catch { /* 原样 */ }
  if (!file) return null
  if (DIGITS.test(file)) { jpnoKeySet(file, file); return file }              // 纯 jpNo(stub 公司,key 就是 jpNo 本身)
  const m = file.match(NAME_JPNO)
  if (m) return m[1]                              // 旧 <name>-<jpno>(尾部数字)
  const slug = file.toLowerCase()
  if (!SLUG_RE.test(slug)) return null
  const cached = cacheGet(slug)
  if (cached !== undefined) { if (cached) jpnoKeySet(cached, slug); return cached }
  const jpno = await resolveSlug(slug).catch(() => null)
  cacheSet(slug, jpno || null)
  if (jpno) jpnoKeySet(jpno, slug)              // 顺路记一笔反方向映射,供 serveDirectorPage 用
  return jpno || null
}

// 行业扁平 URL: /industry-<x>.html → /t/industry/<term-slug>。非行业/未命中 → null(回退公司解析)
async function resolveIndustryPath(pathname) {
  const clean = pathname.replace(/\/+$/, '')
  if (!/\.html$/i.test(clean)) return null
  let file = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  try { file = decodeURIComponent(file) } catch { /* 原样 */ }
  if (!/^industry-/i.test(file)) return null
  const rest = file.slice('industry-'.length).toLowerCase()
  if (!rest) return null
  await ensureIndustryLoaded()
  const termSlug = resolveIndustrySlug(rest)
  return termSlug ? `/t/industry/${encodeURIComponent(termSlug)}` : null
}

// ── 反代到 WooCMS,原样 relay(状态/头/体)──────────────────
function proxyTo(targetPath, req, res) {
  const headers = { ...req.headers }
  for (const h of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']) delete headers[h]

  const release = acquireUpstream(config.woocmsHost, config.woocmsPort, headers)
  if (!release) { temporaryUnavailable(res); return }

  let timedOut = false
  let settled = false
  let timer = null
  const finish = () => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    release()
  }

  const upstream = httpRequest({
    host: config.woocmsHost,
    port: config.woocmsPort,
    method: req.method,
    path: targetPath,
    headers,
    agent: agentFor(config.woocmsHost, config.woocmsPort),
  }, (up) => {
    up.once('end', finish)
    up.once('close', finish)
    up.once('error', finish)
    if (res.destroyed || res.writableEnded) { up.destroy(); finish(); return }
    res.writeHead(up.statusCode || 502, up.headers)
    up.pipe(res)
  })
  timer = setTimeout(() => {
    timedOut = true
    upstream.destroy(new Error('upstream timeout'))
  }, UPSTREAM_TIMEOUT_MS)
  upstream.once('close', finish)
  upstream.on('error', (e) => {
    finish()
    if (res.destroyed || res.writableEnded) return
    if (timedOut) { temporaryUnavailable(res); return }
    if (!res.headersSent) temporaryUnavailable(res)
    else res.destroy()
  })
  const abortUpstream = () => {
    if (!res.writableEnded && !upstream.destroyed) upstream.destroy(new Error('downstream closed'))
  }
  req.once('aborted', abortUpstream)
  res.once('close', abortUpstream)
  req.pipe(upstream)
}

// ── 行业×府 交叉 SEO 页:/industry-<行业>-<府>.html ──────────
async function resolveCross(pathname) {
  const clean = pathname.replace(/\/+$/, '')
  if (!/\.html$/i.test(clean)) return null
  let file = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  try { file = decodeURIComponent(file) } catch { /* 原样 */ }
  if (!/^industry-/i.test(file)) return null
  const rest = file.slice('industry-'.length).toLowerCase()
  if (!rest) return null
  await ensureProvincesLoaded()
  const m = matchCrossProvince(rest)
  if (!m || !m.prov) return null
  await ensureIndustryLoaded()
  const indSlug = resolveIndustrySlug(m.indPart)
  return indSlug ? { indSlug, prov: m.prov } : null
}

function langFromHost(host) {
  return String(host || '').toLowerCase().split(':')[0] === 'en.bizthai.com' ? 'en' : 'th'
}
// 本站 i18n 以 URL 路径前缀(/zh、/th)为准(见 partials/header.html 统一方案),而不是 langFromHost
// 认的子域名(cn./th.,历史上生产多子域名部署遗留的判断方式)。serveSitemapPage/其中一个 flat 页面
// 分支已经按这个原则手写过一次(pathLang || langFromHost),这里抽成共享 helper 给其余按 Host 判断的
// 分支复用,不是新原则,只是把已经验证过的写法用到之前漏掉的地方(公司详情页等)。
function pathLangOf(url) { return /^\/zh(\/|$)/.test(url.pathname) ? 'zh' : (/^\/th(\/|$)/.test(url.pathname) ? 'th' : '') }
function langFromReq(req, url) { return pathLangOf(url) || langFromHost(req.headers.host) }
// canonicalHref 的调用方普遍传入 url.pathname——但 nginx 代理 /th//zh/ 请求时会把这个前缀从路径里
// 剥掉再转发(见 bizthai.com.conf 对应 location 块),所以这里拿到的 url.pathname 已经不带前缀,
// 必须用已经算对的当前语言(langFromReq 的结果,path 优先、Host 兜底)重新拼回去,不能再用
// pathLangOf(url) 单独判断(那样在前缀已被剥掉的请求上永远判空,等于没加)。
function localePrefixOf(lang) { return '' }
function escHtml(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
// 2026-07-12:认领会员把 directorsPublic 设为 'hidden' 时,姓名不是整段不显示,是打码——保留首尾
// 各一个字符,中间固定 5 个星号(不随原长度变化,跟这几个字符串的 UI 展示口径一致,比如 jasson wo
// → j*****o)。这个打码后的值就是要真正落进 SSR HTML 和公开接口响应的东西,不是"看起来打码、
// 接口里还是明文"那种前端遮罩——所以放在 resolver 这一层算,sanitizer 那边对匿名/非公开请求
// 也要用同一套算法,两边必须产出完全一致的打码结果。
function ssrMaskName(name) {
  name = String(name || '').trim()
  if (name.length <= 1) return name
  if (name.length === 2) return name[0] + '*'
  return name[0] + '*****' + name[name.length - 1]
}
const BRAND = 'BizThai'
const BRAND_DOMAIN = 'BizThai.com'

function seoT(lang, en, th, zh) { return lang === 'th' ? th : (lang === 'zh' ? zh : en) }
function cleanMetaText(v, maxLen) {
  let s = String(v == null ? '' : v)
    .replace(/<[^>]*>/g, ' ')
    .replace(/DBD\s*Data\s*Warehouse\+?/gi, BRAND)
    .replace(/DBD\s*DataWarehouse\+?/gi, BRAND)
    .replace(/DataWarehouse\+?/gi, BRAND)
    .replace(/\bDBD\b/gi, BRAND)
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(new RegExp('(?:' + BRAND + '\\s*){2,}', 'g'), BRAND + ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
  if (maxLen && s.length > maxLen) s = s.slice(0, Math.max(0, maxLen - 3)).trim() + '...'
  return s
}
function cleanKeywords(items) {
  const out = [], seen = new Set()
  const add = (v) => {
    const s = cleanMetaText(v, 80)
    if (!s) return
    const k = s.toLowerCase()
    if (seen.has(k)) return
    seen.add(k); out.push(s)
  }
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return }
    String(v == null ? '' : v).split(',').forEach(add)
  }
  walk(items)
  add(BRAND); add(BRAND_DOMAIN)
  return out.slice(0, 18).join(', ')
}
function cleanUrl(v) {
  const s = String(v == null ? '' : v).trim()
  return s.length > 300 ? s.slice(0, 300) : s
}
function canonicalHref(req, path) {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'bizthai.com').split(',')[0].trim().split(':')[0].toLowerCase()
  const host = rawHost === 'en.bizthai.com' ? 'en.bizthai.com' : 'bizthai.com'
  let value = String(path || '/')
  if (/^https?:\/\//i.test(value)) { const parsed = new URL(value); value = parsed.pathname + parsed.search }
  const bare = value.replace(/^(?:\/(?:th|en|zh))+(?=\/|$)/, '') || '/'
  return 'https://' + host + (bare.startsWith('/') ? bare : '/' + bare)
}
function stripHtmlText(v) {
  return String(v == null ? '' : v)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
function firstHtmlText(html, re) {
  const m = String(html || '').match(re)
  return m ? stripHtmlText(m[1] || '') : ''
}
// 三语 alternate:站点 i18n 以 URL 路径前缀为唯一真相(/zh/、/th/、无前缀=en),
// 任意 canonical 直接剥掉/替换前缀即可推出三个变体,不需要额外查库。
function hreflangLinks(canonical) {
  const url = new URL(canonical)
  const bare = url.pathname.replace(/^(?:\/(?:th|en|zh))+(?=\/|$)/, '') || '/'
  const links = [['th', 'https://bizthai.com' + bare], ['x-default', 'https://bizthai.com' + bare]]
  if (process.env.BIZTHAI_ENGLISH_ENABLED === '1') links.splice(1, 0, ['en', 'https://en.bizthai.com' + bare])
  return links.map(([hl, href]) => '<link rel="alternate" hreflang="' + hl + '" href="' + escHtml(href) + '" />').join('')
}
function applySeo(html, seo) {
  const title = cleanMetaText(seo && seo.title, 150)
  const description = cleanMetaText(seo && seo.description, 220)
  const keywords = cleanKeywords(seo && seo.keywords)
  const canonical = cleanUrl(seo && seo.canonical)
  const image = cleanUrl(seo && seo.image)
  const lang = (seo && seo.lang) || 'en'
  const locale = lang === 'zh' ? 'zh_CN' : (lang === 'th' ? 'th_TH' : 'en_US')
  const type = cleanMetaText((seo && seo.type) || 'website', 50)
  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    ...(image ? { image } : {}),
  }).replace(/</g, '\\u003c')
  const bundleParts = [
    // 稀疏筛选组合(命中公司数太少,近似空列表)标 noindex,follow——可爬、不收录,避免大量
    // 近似重复的低质量分面页拖累全站 SEO 权重(目前只有排行榜的筛选组合会传这个 flag)。
    seo && seo.noindex ? '<meta name="robots" content="noindex,follow" />' : '',
    description ? '<meta name="description" content="' + escHtml(description) + '" />' : '',
    keywords ? '<meta name="keywords" content="' + escHtml(keywords) + '" />' : '',
    canonical ? '<link rel="canonical" href="' + escHtml(canonical) + '" />' : '',
    canonical ? hreflangLinks(canonical) : '',
    '<meta property="og:type" content="' + escHtml(type) + '" />',
    '<meta property="og:locale" content="' + escHtml(locale) + '" />',
    title ? '<meta property="og:title" content="' + escHtml(title) + '" />' : '',
    description ? '<meta property="og:description" content="' + escHtml(description) + '" />' : '',
    canonical ? '<meta property="og:url" content="' + escHtml(canonical) + '" />' : '',
    image ? '<meta property="og:image" content="' + escHtml(image) + '" />' : '',
    '<meta name="twitter:card" content="summary_large_image" />',
    title ? '<meta name="twitter:title" content="' + escHtml(title) + '" />' : '',
    description ? '<meta name="twitter:description" content="' + escHtml(description) + '" />' : '',
    image ? '<meta name="twitter:image" content="' + escHtml(image) + '" />' : '',
    '<script type="application/ld+json">' + json + '</script>',
  ]
  // FAQPage 结构化数据:仅公司详情页会传 seo.faq,且要求跟页面上可见的问答文本逐字一致(Google 规范)。
  const faq = Array.isArray(seo && seo.faq) ? seo.faq.filter(f => f && f.q && f.a) : []
  if (faq.length) {
    const faqJson = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    }).replace(/</g, '\\u003c')
    bundleParts.push('<script type="application/ld+json">' + faqJson + '</script>')
  }
  const bundle = bundleParts.join('')
  const rewriteHead = (head) => {
    let h = head
      .replace(/<meta\b(?=[^>]*(?:name|property)=["'](?:description|keywords|robots|twitter:card|twitter:title|twitter:description|twitter:image|og:type|og:locale|og:title|og:description|og:url|og:image)["'])[^>]*>\s*/gi, '')
      .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>\s*/gi, '')
      .replace(/<link\b(?=[^>]*rel=["']alternate["'])(?=[^>]*hreflang=)[^>]*>\s*/gi, '')
      .replace(/<script\b(?=[^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>\s*/gi, '')
    if (title) {
      if (/<title>[\s\S]*?<\/title>/i.test(h)) h = h.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escHtml(title) + '</title>')
      else h = '<title>' + escHtml(title) + '</title>' + h
    }
    return h + bundle
  }
  if (/<head\b/i.test(html)) {
    return html.replace(/<head([^>]*)>([\s\S]*?)<\/head>/i, (m, attrs, head) => '<head' + attrs + '>' + rewriteHead(head) + '</head>')
  }
  return html
}

// 模板中已用 data-en/data-th/data-zh 保存三语文案，但 WooCMS SSR 仍会输出模板里的默认文字，
// 导致爬虫在 JS 执行前看到错语言。只改“纯文本叶子节点”，不碰含子元素的复杂组件。
function localizeDataAttrsSSR(html, lang) {
  const key = lang === 'zh' ? 'zh' : (lang === 'th' ? 'th' : 'en')
  const pick = (attrs) => {
    const hit = attrs.match(new RegExp('\\bdata-' + key + '=["\']([^"\']*)["\']', 'i'))
    return hit ? hit[1] : null
  }
  let out = String(html || '').replace(/<([a-z][\w:-]*)([^>]*\bdata-en=["'][^"']*["'][^>]*)>\s*<wc-t>[^<>]*<\/wc-t>\s*<\/\1>/gi,
    (m, tag, attrs) => {
      const value = pick(attrs)
      return value === null ? m : '<' + tag + attrs + '>' + value + '</' + tag + '>'
    })
  out = out.replace(/<([a-z][\w:-]*)([^>]*\bdata-en=["'][^"']*["'][^>]*)>([^<>]*)<\/\1>/gi,
    (m, tag, attrs) => {
      const value = pick(attrs)
      return value === null ? m : '<' + tag + attrs + '>' + value + '</' + tag + '>'
    })
  return out
}

function genericPageSeo(html, lang, canonical, barePath) {
  const title = firstHtmlText(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || BRAND
  const dm = String(html || '').match(/<meta\b(?=[^>]*name=["']description["'])[^>]*content=["']([^"']*)["'][^>]*>/i)
  const accountNoindex = /\/(?:login|register|forgot-password|reset-password|account|verify-email)\/?$/.test(String(barePath || ''))
  return { title, description: dm ? dm[1] : '', canonical, lang, noindex: accountNoindex }
}

// 首页 SEO 不依赖 WooCMS 透传(CMS 目前三语都只吐站点名 + 英文 description)。
// title 已含品牌后缀,不再套 brandTitle,避免出现 "| BizThai | BizThai"。
function homePageSeo(lang, canonical, image) {
  const title = seoT(lang,
    'Thailand Company Search & Business Intelligence | BizThai',
    'ค้นหาบริษัทไทยและข้อมูลธุรกิจ | BizThai',
    '泰国企业查询与商业数据平台 | BizThai')
  const description = seoT(lang,
    'BizThai.com is a Thai company search and business intelligence platform for company lookup, company profiles, partner search, market research and due diligence.',
    'BizThai.com คือแพลตฟอร์มค้นหาบริษัทไทยและข้อมูลธุรกิจ สำหรับตรวจสอบบริษัท โปรไฟล์บริษัท ค้นหาคู่ค้า วิจัยตลาด และตรวจสอบข้อมูล',
    'BizThai.com 是泰国企业查询与商业数据平台，提供公司查询、企业档案、合作伙伴搜索、市场研究和商业尽调。')
  return {
    title,
    description,
    keywords: [
      seoT(lang, 'Thai company search', 'ค้นหาบริษัทไทย', '泰国企业查询'),
      seoT(lang, 'Thailand company lookup', 'ตรวจสอบบริษัทไทย', '泰国公司查询'),
      seoT(lang, 'business intelligence Thailand', 'ข้อมูลธุรกิจไทย', '泰国商业数据'),
      seoGenericKeywords(lang),
    ],
    canonical,
    lang,
    image: image || '',
  }
}

// 首页等静态池里若仍写着 /{jpno}.html,则尽量改成可读 slug(爬虫不该再吃到纯数字注册号链接)。
// 优先 data-en-name 的拉丁 slug(与 analytics companyHref 一致);若英文名为空/纯泰文导致
// slugify 为空,则泰文罗马化后再 slugify。罗马化 slug 不在 idx_thaicompany_nameslug 里,
// 故后缀 -<jpno>,走 resolveJpNo 的旧 name-jpno 形态,链接可点且首页不再暴露裸注册号。
function rewriteNumericCompanyHrefs(html) {
  return String(html || '').replace(
    /<a\b([^>]*?)\bhref="\/(\d{10,})\.html"([^>]*)>/gi,
    (m, pre, jpno, post) => {
      const attrs = pre + post
      const en = (attrs.match(/\bdata-en-name="([^"]*)"/i) || [])[1] || ''
      const th = (attrs.match(/\bdata-th="([^"]*)"/i) || attrs.match(/\bdata-name-th="([^"]*)"/i) || [])[1] || ''
      let slug = ssrSlugifyIndustry(en)
      let romanized = false
      if (!slug || slug === jpno) {
        slug = ssrSlugifyIndustry(romanizeThai(en || th))
        romanized = true
      }
      if (!slug || slug === jpno) return m
      if (romanized) {
        cacheSet(slug, jpno)
        slug = slug + '-' + jpno
      } else {
        cacheSet(slug, jpno)
      }
      return '<a' + pre + 'href="/' + slug + '.html"' + post + '>'
    },
  )
}

function localizeSitemapFooterHref(html, lang) {
  if (lang !== 'th' && lang !== 'zh') return html
  // 页脚 Sitemap 指向对应语言索引,避免 /th/ 页面链到英文 /sitemap.xml
  return String(html || '').replace(/href="\/sitemap\.xml"/g, 'href="/' + lang + '/sitemap.xml"')
}

async function serveGenericSeoPage(req, res, url) {
  const barePath = url.pathname.replace(/^\/(?:zh|th)(?=\/|$)/, '') || '/'
  const upstreamPath = (pathLangOf(url) ? url.pathname : barePath) + url.search
  const up = await fetchUpstream(config.woocmsHost, config.woocmsPort, upstreamPath, req.headers)
  if (!up || up.status !== 200 || !up.body) { proxyTo(url.pathname + url.search, req, res); return }
  const lang = langFromReq(req, url)
  let html = localizeDataAttrsSSR(up.body, lang)
  if (barePath === '/' || barePath === '') html = rewriteNumericCompanyHrefs(html)
  html = localizeSitemapFooterHref(html, lang)
  const canonical = canonicalHref(req, localePrefixOf(lang) + barePath)
  const isHome = barePath === '/' || barePath === ''
  const seo = isHome
    ? homePageSeo(lang, canonical, canonicalHref(req, '/theme-assets/starter/og-default.png'))
    : genericPageSeo(html, lang, canonical, barePath)
  html = applySeo(html, seo)
  sendHtml(req, res, url, html, !url.search)
}

function brandTitle(core) { return cleanMetaText(core + ' | ' + BRAND, 150) }

// 出错一律 resolve(null)(调用方按"上游没返回"处理),但要留下失败原因——之前这里完全静默,
// 连接失败/超时/响应流中途被重置都无声无息地变成 null,复现时日志里什么都看不到。另外原来
// up(响应流)没挂 error 监听:body 读到一半连接被重置会在 stream 内部抛出没人接的 'error'
// 事件,这类事件不接住会被当成未捕获异常,足以打崩整个 resolver 进程(配合 systemd
// Restart=always 就是无声无息的 crash-loop)。
function fetchUpstream(host, port, path, headers, downstreamRes = null) {
  return new Promise((resolve) => {
    const h = { ...headers }
    delete h['accept-encoding']  // 要明文 body 做注入,不收 gzip
    const release = acquireUpstream(host, port, h)
    if (!release) {
      console.error('[resolver] fetchUpstream 并发保护拒绝 ' + host + ':' + port + path)
      resolve(null)
      return
    }
    let settled = false
    let timer = null
    let req
    const onDownstreamClose = () => {
      if (downstreamRes && !downstreamRes.writableEnded && req && !req.destroyed) {
        req.destroy(new Error('downstream closed'))
      }
    }
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (downstreamRes) downstreamRes.off('close', onDownstreamClose)
      release()
      resolve(value)
    }
    if (downstreamRes) downstreamRes.once('close', onDownstreamClose)
    req = httpRequest({ host, port, method: 'GET', path, headers: h, agent: agentFor(host, port) }, (up) => {
      let buf = ''
      let bytes = 0
      up.setEncoding('utf8')
      up.on('data', (c) => {
        bytes += Buffer.byteLength(c)
        if (bytes > MAX_BUFFERED_UPSTREAM_BODY) {
          console.error('[resolver] fetchUpstream 响应过大 ' + host + ':' + port + path)
          up.destroy(new Error('upstream body too large'))
          return
        }
        buf += c
      })
      up.on('end', () => finish({ status: up.statusCode || 502, headers: up.headers, body: buf }))
      up.on('error', (e) => { console.error('[resolver] fetchUpstream 响应流中断 ' + host + ':' + port + path, e.code || e.message); finish(null) })
      up.on('aborted', () => finish(null))
    })
    req.on('error', (e) => { console.error('[resolver] fetchUpstream 请求失败 ' + host + ':' + port + path, e.code || e.message); finish(null) })
    timer = setTimeout(() => {
      console.error('[resolver] fetchUpstream 超时(15s) ' + host + ':' + port + path)
      req.destroy(new Error('upstream timeout'))
      finish(null)
    }, UPSTREAM_TIMEOUT_MS)
    req.end()
  })
}

// 身份解析(cookie/Authorization/X-Session-Token → uid),带短 TTL 缓存——与 sanitizer/directors
// 的 whoAmI() 同款手法,复制一份(不共享模块)是这个代码库一贯的"每个服务零依赖"风格。
// 2026-07-12:董事个人主页(/director-*.html)改成登录会员可见,这里用来判断登录态。
const authIdCache = new Map()
const AUTH_ID_TTL = 60000
async function whoAmI(cookie, authHeader, sessionTokenHeader) {
  const idKey = cookie || authHeader || sessionTokenHeader
  if (!idKey) return null
  const hit = authIdCache.get(idKey)
  if (hit && Date.now() - hit.at < AUTH_ID_TTL) return hit.uid
  let uid = null
  try {
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (authHeader) headers.authorization = authHeader
    if (sessionTokenHeader) headers['x-session-token'] = sessionTokenHeader
    const r = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/auth/me', headers)
    if (r && r.status === 200 && r.body) { const j = JSON.parse(r.body); uid = (j?.data?.user?.id ?? j?.data?.id) || null }
  } catch { uid = null }
  authIdCache.set(idKey, { uid, at: Date.now() })
  return uid
}
const authIdSweep = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of authIdCache) if (now - v.at > AUTH_ID_TTL) authIdCache.delete(k)
}, 600000)
if (authIdSweep.unref) authIdSweep.unref()

function termHref(term) {
  return term && term.permalink ? term.permalink : '/t/industry/' + encodeURIComponent(String((term && term.slug) || ''))
}

function renderIndustryChips(terms) {
  return terms.map(t => '<a class="biz-fl-chip" href="' + escHtml(termHref(t)) + '">' + escHtml(t.name || t.slug || '') + '</a>').join('')
}

function renderIndustryTermList(terms) {
  return terms.map(t => '<a class="biz-report-term" href="' + escHtml(termHref(t)) + '"><span>' + escHtml(t.name || t.slug || '') + '</span><i aria-hidden="true">›</i></a>').join('')
}

async function injectLocalizedIndustryTerms(html, req) {
  const up = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/taxonomies/industry/terms?limit=24&offset=0&sort=sort_order_asc', req.headers)
  let terms = []
  if (up && up.status === 200 && up.body) {
    try { terms = (((JSON.parse(up.body) || {}).data || {}).items || []).filter(t => t && t.slug) } catch { /* ignore */ }
  }
  if (!terms.length) return html
  let out = html.replace(/(<section class="biz-fl-filter"[\s\S]*?<div class="biz-fl-chips">)[\s\S]*?(<\/div>\s*<\/section>)/, (m, a, b) => a + renderIndustryChips(terms) + b)
  out = out.replace(/(<div class="biz-report-term-list">)[\s\S]*?(<\/div>\s*<\/aside>)/, (m, a, b) => a + renderIndustryTermList(terms) + b)
  return out
}

// 反代行业页壳 + 注入 sidecar 交叉列表(SSR,爬虫可抓)+ 改 H1/count/canonical/交叉标记
async function serveCrossPage(cross, req, res, url) {
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/t/industry/' + encodeURIComponent(cross.indSlug), req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  const lang = langFromReq(req, url)
  const pname = (cross.prov.name && (cross.prov.name[lang] || cross.prov.name.en)) || cross.prov.engslug
  const indName = firstHtmlText(shell.body, /<h1\b[^>]*class="[^"]*\bindustry-hero__title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    firstHtmlText(shell.body, /<title[^>]*>([\s\S]*?)<\/title>/i) || cross.indSlug
  const data = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/cross?industry=' + encodeURIComponent(cross.indSlug) + '&province=' + encodeURIComponent(cross.prov.slug) + '&limit=20&offset=0&format=html', { accept: 'application/json' })
  let crossHtml = '', crossTotal = 0
  if (data && data.body) { try { const j = JSON.parse(data.body); crossHtml = j.html || ''; crossTotal = j.total || 0 } catch { /* ignore */ } }
  let html = shell.body
  if (crossHtml) html = html.replace(/(<div class="biz-industry-list"[^>]*>)[\s\S]*?(<\/div>)/, (mm, a, c) => a + crossHtml + c)
  html = html.replace(/(<h1 class="industry-hero__title"[^>]*>)([\s\S]*?)(<\/h1>)/, (mm, a, t, c) => a + t.trim() + ' · ' + escHtml(pname) + c)
  if (crossTotal) html = html.replace(/(<strong data-industry-count>)[\s\S]*?(<\/strong>)/, (mm, a, c) => a + crossTotal + c)
  html = html.replace(/(data-industry-archive)/, (mm) => mm + ' data-cross-prov="' + escHtml(cross.prov.slug) + '" data-cross-prov-eng="' + escHtml(cross.prov.engslug) + '"')
  html = applySeo(html, crossSeo(indName, pname, crossTotal, lang, canonicalHref(req, localePrefixOf(lang) + url.pathname)))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// 体检发现:/companies 与税收分类页此前只 SSR 首屏 24/20 条,翻页靠客户端 JS fetch,
// 爬虫从不点"下一页",194 万公司几乎全靠 sitemap 一条腿被发现。下面两个函数给这两类
// 列表页补服务端可翻页(?page=N,N≥2 时接管;首屏 page=1 原样走 WooCMS 原生渲染不动,
// 不影响其现有缓存行为),复用 analytics 的 /company-list?format=html(与 /cross 的
// format=html 同一套路,renderItemsHtml 保证卡片样式与客户端版一致)+ biz.js 现成的
// pagerHtml 生成真实 <a href> 分页链接(不是 JS 驱动,爬虫能顺着往下抓)。
const PER_PAGE_LIST = 24
// 与 analytics browseCompanies / rankings-cache 的深分页硬上限对齐(OFFSET 封顶后继续翻页
// 会返回同一批内容)。超出此 offset 对应的页码必须 404,不能再 self-canonical 重复页。
const MAX_BROWSE_OFFSET = 96000
function maxBrowsePage(perPage, total) {
  const per = Math.max(1, Number(perPage) || 1)
  const byOffset = Math.floor(MAX_BROWSE_OFFSET / per) + 1
  const byTotal = Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / per))
  return Math.min(byOffset, byTotal)
}
function sendPlain404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('not found')
}
async function fetchCompanyListHtml(params) {
  const qs = new URLSearchParams(params)
  qs.set('format', 'html')
  const dataRes = await fetchUpstream(config.analyticsHost, config.analyticsPort,
    '/api/site/v1/analytics/company-list?' + qs.toString(), { accept: 'application/json' })
  if (!dataRes || !dataRes.body) return { html: '', total: 0 }
  try { const j = JSON.parse(dataRes.body); return { html: j.html || '', total: j.total || 0 } } catch { return { html: '', total: 0 } }
}
function injectPagedList(shellHtml, listSelectorRe, pagerRe, listHtml, pager) {
  let html = shellHtml.replace(listSelectorRe, (m, a, c) => a + listHtml + c)
  html = html.replace(pagerRe, pager || '')
  return html
}


// capital-XX.html（两字母国别代码）薄分类页：短期 noindex，避免 ~200 个近空页进索引。
// capital-thai-capital / capital-foreign-capital 等非两字母 slug 不命中，仍可收录。
async function serveCapitalCountryPage(req, res, url) {
  const barePath = url.pathname.replace(/^\/(?:zh|th)(?=\/|$)/, '') || '/'
  const up = await fetchUpstream(config.woocmsHost, config.woocmsPort, barePath + (url.search || ''), req.headers)
  if (!up || up.status !== 200 || !up.body) { proxyTo(url.pathname + (url.search || ''), req, res); return }
  const lang = langFromReq(req, url)
  let html = localizeDataAttrsSSR(up.body, lang)
  const title = firstHtmlText(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || BRAND
  html = applySeo(html, {
    title,
    description: '',
    canonical: canonicalHref(req, localePrefixOf(lang) + barePath),
    lang,
    noindex: true,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function serveCompaniesPage(req, res, url) {
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1)
  const lang = langFromReq(req, url)
  // 统一规范路径为 /companies(去掉 .html),壳与 canonical/pager 都走无扩展名,避免与 /companies.html 重复收录
  const listPath = localePrefixOf(lang) + '/companies'
  // OFFSET 封顶之外的页必然重复末页内容 → 直接 404,不浪费上游查询
  if (page > Math.floor(MAX_BROWSE_OFFSET / PER_PAGE_LIST) + 1) { sendPlain404(res); return }
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/companies', req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(listPath + (url.search || ''), req, res); return }
  let html = localizeDataAttrsSSR(shell.body, lang)
  const offset = (page - 1) * PER_PAGE_LIST
  const { html: listHtml, total } = await fetchCompanyListHtml({ limit: PER_PAGE_LIST, offset })
  const maxPage = maxBrowsePage(PER_PAGE_LIST, total)
  if (page > maxPage) { sendPlain404(res); return }
  // pager 用封顶后的 total,避免链到 offset 封顶之后的重复页
  const pager = pagerHtml(page, Math.min(total, maxPage * PER_PAGE_LIST), PER_PAGE_LIST, listPath, lang)
  html = injectPagedList(
    html,
    /(<div class="[^"]*\bbiz-report-company-list\b[^"]*"[^>]*data-company-list[^>]*>)[\s\S]*?(<\/div>)/,
    /<nav class="biz-arch-pager" data-company-pager[^>]*><\/nav>/,
    listHtml, pager,
  )
  const pageSuffix = page > 1 ? '?page=' + page : ''
  html = applySeo(html, companiesListSeo(page, lang, canonicalHref(req, listPath + pageSuffix)))
  // 不转发 WooCMS 的 Link(旧 th./cn. 子域);hreflang 已由 applySeo 写入 <head>
  sendHtml(req, res, url, html, onlyQueryKeys(url, ['page']))
}

async function serveIndustryFlatPage(indPath, req, res, url) {
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1)
  const perPage = 20
  if (page > Math.floor(MAX_BROWSE_OFFSET / perPage) + 1) { sendPlain404(res); return }
  const target = indPath + (page <= 1 ? (url.search || '') : '')
  const up = await fetchUpstream(config.woocmsHost, config.woocmsPort, target, req.headers)
  if (!up || up.status !== 200 || !up.body) { proxyTo(target, req, res); return }
  const lang = langFromReq(req, url)
  const indName = firstHtmlText(up.body, /<h1\b[^>]*class="[^"]*\bindustry-hero__title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
    firstHtmlText(up.body, /<title[^>]*>([\s\S]*?)<\/title>/i) || indPath.split('/').pop()
  let html = up.body
  // 各页(含首屏)都注入 analytics 列表:默认仅运营中,与客户端/company-list 口径一致,
  // 避免 page=1 仍渲染 WooCMS 原生未过滤列表被爬虫收录。
  {
    const termSlug = decodeURIComponent(indPath.split('/').pop())
    const offset = (page - 1) * perPage
    const { html: listHtml, total } = await fetchCompanyListHtml({ industry: termSlug, limit: perPage, offset })
    const maxPage = maxBrowsePage(perPage, total)
    if (page > maxPage) { sendPlain404(res); return }
    const pager = pagerHtml(page, Math.min(total, maxPage * perPage), perPage, url.pathname, lang)
    html = injectPagedList(
      html,
      /(<div class="[^"]*\bbiz-industry-list\b[^"]*"[^>]*data-industry-list[^>]*>)[\s\S]*?(<\/div>)/,
      /<nav class="biz-arch-pager" data-industry-pager hidden[^>]*><\/nav>/,
      listHtml, pager,
    )
  }
  html = applySeo(html, industrySeo(indName, lang, canonicalHref(req, localePrefixOf(lang) + url.pathname + (page > 1 ? '?page=' + page : ''))))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// ── 公司详情 SSR:取单条 entry,把数据服务端渲染注入页面(爬虫可抓;theme.js 客户端照常增强)──
const SSR_LBL = {
  registrationNo: { en: 'Registration number', th: 'เลขทะเบียน', zh: '注册号' },
  companyType: { en: 'Company type', th: 'ประเภทนิติบุคคล', zh: '企业类型' },
  status: { en: 'Status', th: 'สถานะ', zh: '经营状态' },
  companySize: { en: 'Company size', th: 'ขนาดธุรกิจ', zh: '企业规模' },
  businessCategory: { en: 'Business category', th: 'ประเภทธุรกิจ', zh: '经营类型' },
  industry: { en: 'Industry', th: 'กลุ่มอุตสาหกรรม', zh: '行业大类' },
  registeredCapital: { en: 'Registered capital', th: 'ทุนจดทะเบียน', zh: '注册资本' },
  paidCapital: { en: 'Paid-up capital', th: 'ทุนชำระแล้ว', zh: '实缴资本' },
  shares: { en: 'Shares', th: 'จำนวนหุ้น', zh: '股本数量' },
  regDate: { en: 'Registration date', th: 'วันที่จดทะเบียน', zh: '注册日期' },
  financialYear: { en: 'Financial year', th: 'ปีงบการเงิน', zh: '财务年份' },
  lastUpdated: { en: 'Last updated', th: 'ปรับปรุงล่าสุด', zh: '数据更新' },
  dataSource: { en: 'Data source: DBD DataWarehouse+', th: 'แหล่งข้อมูล: DBD DataWarehouse+', zh: '数据来源:DBD DataWarehouse+' },
  nameTh: { en: 'Name (Thai)', th: 'ชื่อ (ไทย)', zh: '名称(泰文)' },
  nameEn: { en: 'Name (English)', th: 'ชื่อ (อังกฤษ)', zh: '名称(英文)' },
  address: { en: 'Address', th: 'ที่อยู่', zh: '地址' },
  region: { en: 'District / province', th: 'พื้นที่', zh: '区域' },
  zipcode: { en: 'Postal code', th: 'รหัสไปรษณีย์', zh: '邮编' },
  phone: { en: 'Phone', th: 'โทรศัพท์', zh: '电话' },
  email: { en: 'Email', th: 'อีเมล', zh: '邮箱' },
  website: { en: 'Website', th: 'เว็บไซต์', zh: '网站' },
  fax: { en: 'Fax', th: 'โทรสาร', zh: '传真' },
  overview: { en: 'Company overview', th: 'ข้อมูลทั่วไป', zh: '公司概览' },
  registeredAddress: { en: 'Registered address', th: 'ที่อยู่จดทะเบียน', zh: '注册地址' },
  contact: { en: 'Contact', th: 'ข้อมูลติดต่อ', zh: '联系方式' },
  // 认领会员编辑记录提示(2026-07-05):{date} 是月日时分的轻量格式(ssrEditNoteDate 生成),
  // 不用登记信息那套泰历双历格式——这是会员编辑元数据,不是 DBD 官方登记日期
  ownerEditNote: { en: 'Updated by verified owner on {date}', th: 'อัปเดตโดยเจ้าของที่ยืนยันแล้วเมื่อ {date}', zh: '认领后 {date} 修改' },
  registrationDetails: { en: 'Registration details', th: 'รายละเอียดการจดทะเบียน', zh: '登记明细' },
  businessActivity: { en: 'Business activity', th: 'กิจกรรมทางธุรกิจ', zh: '经营业务' },
  revenue: { en: 'Revenue', th: 'รายได้', zh: '营业收入' },
  netProfit: { en: 'Net profit', th: 'กำไรสุทธิ', zh: '净利润' },
  totalAssets: { en: 'Total assets', th: 'สินทรัพย์รวม', zh: '总资产' },
  equity: { en: 'Equity', th: 'ส่วนของผู้ถือหุ้น', zh: '股东权益' },
  latestFinancials: { en: 'Latest financials', th: 'ผลการเงินล่าสุด', zh: '最新财务表现' },
  financialRecords: { en: 'Financial Records', th: 'ข้อมูลการเงิน', zh: '财务数据' },
  netProfitLoss: { en: 'Profit (Loss)', th: 'กำไร(ขาดทุน)', zh: '利润(亏损)' },
  yoy: { en: 'YoY', th: 'YoY', zh: '同比' },
  finCardHead: { en: '{label} Year {y} ({unit})', th: '{label} ปี {y} ({unit})', zh: '{label} {y}年 ({unit})' },
  finTrendCaption: { en: '{label} {n}-Year ({unit})', th: '{label} {n} ปี ({unit})', zh: '{label} {n}年趋势 ({unit})' },
  finNoData: { en: 'No financial data available', th: 'ไม่มีข้อมูลทางการเงิน', zh: '暂无财务数据' },
  viewsCount: { en: '{n} views', th: 'เข้าชม {n} ครั้ง', zh: '{n} 人看过' },
  registeredDirectors: { en: 'Registered directors', th: 'กรรมการที่จดทะเบียน', zh: '登记董事' },
  signAuthorityBadge: { en: 'Signing authority', th: 'มีอำนาจลงนาม', zh: '有签字权限' },
  natBreakdownTitle: { en: 'Nationality Breakdown', th: 'สัดส่วนสัญชาติกรรมการ', zh: '董事国籍分布' },
  natBreakdownNote: { en: 'By director headcount, not by investment value.', th: 'นับตามจำนวนกรรมการ ไม่ใช่มูลค่าการลงทุน', zh: '按董事人数占比,非出资金额占比。' },
  natTableNat: { en: 'Nationality', th: 'สัญชาติ', zh: '国籍' },
  natTableCount: { en: 'Directors', th: 'จำนวน', zh: '人数' },
  natTablePct: { en: 'Share', th: 'สัดส่วน', zh: '占比' },
  capBreakdownTitle: { en: 'Shareholding by Nationality', th: 'สัดส่วนผู้ถือหุ้นตามสัญชาติ', zh: '股权国籍构成' },
  capBreakdownNote: { en: 'By registered capital (share value).', th: 'ตามสัดส่วนทุนจดทะเบียน (มูลค่าหุ้น)', zh: '按注册资本(股份价值)占比。' },
  shareTrendTitle: { en: 'Shareholding Trend by Nationality', th: 'แนวโน้มสัดส่วนผู้ถือหุ้นตามสัญชาติ (รายปี)', zh: '历年股权国籍占比趋势' },
  shareTrendNote: { en: 'Thai vs. foreign shareholding by year (% of registered capital).', th: 'สัดส่วนผู้ถือหุ้นไทยเทียบกับต่างชาติรายปี (% ของทุนจดทะเบียน)', zh: '按年度对比泰籍与外籍持股占比(占注册资本比例)。' },
  capTableShares: { en: 'Shares', th: 'จำนวนหุ้น', zh: '股份数量' },
  capTableValue: { en: 'Investment Value (THB)', th: 'มูลค่าการลงทุน (บาท)', zh: '投资价值(泰铢)' },
  currencyUnit: { en: 'THB', th: 'บาท', zh: '泰铢' },
  nameHistory: { en: 'Name history', th: 'ประวัติการเปลี่ยนชื่อ', zh: '曾用名历史' },
  capitalHistory: { en: 'Capital history', th: 'ประวัติการเปลี่ยนแปลงทุน', zh: '增减资历史' },
  previousCapital: { en: 'Previous capital', th: 'ทุนก่อนเปลี่ยนแปลง', zh: '变更前资本' },
  capitalChange: { en: 'Change', th: 'จำนวนที่เปลี่ยนแปลง', zh: '变动金额' },
  secLicenses: { en: 'Securities licenses', th: 'ใบอนุญาตหลักทรัพย์', zh: '证券牌照' },
  license: { en: 'License', th: 'ใบอนุญาต', zh: '牌照' },
  trademarks: { en: 'Trademarks', th: 'เครื่องหมายการค้า', zh: '商标' },
  tmRegNo: { en: 'Registration No.', th: 'เลขทะเบียน', zh: '注册号' },
  tmFilDate: { en: 'Filing date', th: 'วันที่ยื่นคำขอ', zh: '申请日期' },
  tmRegDate: { en: 'Registration date', th: 'วันที่จดทะเบียน', zh: '注册日期' },
  tmExpDate: { en: 'Expiry date', th: 'วันหมดอายุ', zh: '到期日期' },
  tmStatus: { en: 'Status', th: 'สถานะ', zh: '状态' },
  tmProduct: { en: 'Goods / services', th: 'สินค้า/บริการ', zh: '商品/服务类别' },
  // ── 变更记录 tab(2026-07-03 二期):曾用名/增减资从 profile 挪到独立 tab,新增并购/改制记录 ──
  changeRecordsTab: { en: 'Change Records', th: 'ประวัติการเปลี่ยนแปลง', zh: '变更记录' },
  changesEmpty: { en: 'No change records are available for this company yet.', th: 'ยังไม่มีข้อมูลประวัติการเปลี่ยนแปลงสำหรับบริษัทนี้', zh: '该公司暂无变更记录。' },
  financialDataEmpty: { en: 'No detailed financial analysis is available for this company yet.', th: 'ยังไม่มีข้อมูลวิเคราะห์การเงินเชิงลึกสำหรับบริษัทนี้', zh: '该公司暂无深度财务分析数据。' },
  changeDateUnknown: { en: 'Date unknown', th: 'ไม่ระบุวันที่', zh: '日期不详' },
  mergerHistory: { en: 'Merger records', th: 'ประวัติการควบรวมกิจการ', zh: '并购记录' },
  mergerFromHeading: { en: 'Merged from', th: 'ควบรวมมาจาก', zh: '并入自' },
  mergerToHeading: { en: 'Merged into', th: 'ควบรวมเข้าสู่', zh: '并入至' },
  transformHistory: { en: 'Transformation records', th: 'ประวัติการแปรสภาพ', zh: '改制/转型记录' },
  transformFromHeading: { en: 'Transformed from', th: 'แปรสภาพจาก', zh: '由...改制而来' },
  transformToHeading: { en: 'Transformed into', th: 'แปรสภาพเป็น', zh: '改制为' },
  // ── 分析 tab(2026-07-03 二期):jpNationCharts/basicFinCharts 的 55 条 customChart 曲线,按 9 组渲染 ──
  analyticsGroupBalance: { en: 'Balance sheet trend', th: 'แนวโน้มงบดุล', zh: '资产负债趋势' },
  analyticsGroupIncome: { en: 'Income statement trend', th: 'แนวโน้มงบกำไรขาดทุน', zh: '损益趋势' },
  analyticsGroupProfitability: { en: 'Profitability', th: 'ความสามารถในการทำกำไร', zh: '盈利能力' },
  analyticsGroupSolvency: { en: 'Solvency & liquidity', th: 'สภาพคล่องและความสามารถชำระหนี้', zh: '偿债与流动性' },
  analyticsGroupEfficiency: { en: 'Operating efficiency', th: 'ประสิทธิภาพการดำเนินงาน', zh: '运营效率' },
  analyticsGroupCapital: { en: 'Capital & revenue trend', th: 'แนวโน้มทุนและรายได้', zh: '资本与营收趋势' },
  analyticsGroupIndustry: { en: 'Industry overview', th: 'ภาพรวมอุตสาหกรรม', zh: '同业概况' },
  analyticsGroupRegistration: { en: 'Registration & survival stats', th: 'สถิติการจดทะเบียนและการอยู่รอด', zh: '登记与存续统计' },
  metricShareHistTH: { en: 'Thai shareholding', th: 'สัดส่วนผู้ถือหุ้นไทย', zh: '泰籍持股比例' },
  metricShareHistOT: { en: 'Foreign shareholding', th: 'สัดส่วนผู้ถือหุ้นต่างชาติ', zh: '外籍持股比例' },
  metricBsAsset: { en: 'Total assets', th: 'สินทรัพย์รวม', zh: '总资产' },
  metricBsAssetPc: { en: 'Total assets (% share)', th: 'สินทรัพย์รวม (% สัดส่วน)', zh: '总资产占比' },
  metricBsEquity: { en: 'Equity', th: 'ส่วนของผู้ถือหุ้น', zh: '股东权益' },
  metricBsEquityPc: { en: 'Equity (% share)', th: 'ส่วนของผู้ถือหุ้น (% สัดส่วน)', zh: '股东权益占比' },
  metricBsLiability: { en: 'Total liabilities', th: 'หนี้สินรวม', zh: '总负债' },
  metricBsLiabilityPc: { en: 'Total liabilities (% share)', th: 'หนี้สินรวม (% สัดส่วน)', zh: '总负债占比' },
  metricPlRevenue: { en: 'Revenue', th: 'รายได้', zh: '营业收入' },
  metricPlRevenuePct: { en: 'Revenue growth', th: 'อัตราการเติบโตของรายได้', zh: '营收增长率' },
  metricPlExpense: { en: 'Expenses', th: 'ค่าใช้จ่าย', zh: '费用支出' },
  metricPlExpensePct: { en: 'Expense growth', th: 'อัตราการเติบโตของค่าใช้จ่าย', zh: '费用增长率' },
  metricPlProfitLoss: { en: 'Profit / loss', th: 'กำไร/ขาดทุน', zh: '损益' },
  metricPlProfitLossPct: { en: 'Profit margin', th: 'อัตรากำไร', zh: '利润率' },
  metricGrossProfit: { en: 'Gross profit', th: 'กำไรขั้นต้น', zh: '毛利润' },
  metricOperatingProfit: { en: 'Operating profit', th: 'กำไรจากการดำเนินงาน', zh: '营业利润' },
  metricNetProfit: { en: 'Net profit', th: 'กำไรสุทธิ', zh: '净利润' },
  metricNetProfitForecast: { en: 'Net profit forecast (avg)', th: 'คาดการณ์กำไรสุทธิเฉลี่ย', zh: '净利润预测均值' },
  metricRoa: { en: 'Return on assets (ROA)', th: 'ผลตอบแทนจากสินทรัพย์ (ROA)', zh: '总资产收益率(ROA)' },
  metricRoe: { en: 'Return on equity (ROE)', th: 'ผลตอบแทนผู้ถือหุ้น (ROE)', zh: '净资产收益率(ROE)' },
  metricCurrentRatio: { en: 'Current ratio', th: 'อัตราส่วนสภาพคล่อง', zh: '流动比率' },
  metricDebtToAsset: { en: 'Debt to assets', th: 'หนี้สินต่อสินทรัพย์', zh: '负债/资产比' },
  metricDebtToCapital: { en: 'Debt to capital', th: 'หนี้สินต่อทุน', zh: '负债/资本比' },
  metricDebtToEquity: { en: 'Debt to equity', th: 'หนี้สินต่อส่วนของผู้ถือหุ้น', zh: '负债/权益比' },
  metricTotalAssetToEquity: { en: 'Assets to equity', th: 'สินทรัพย์ต่อส่วนของผู้ถือหุ้น', zh: '资产/权益比' },
  metricTotalAssetTurnover: { en: 'Total asset turnover', th: 'อัตราหมุนเวียนสินทรัพย์รวม', zh: '总资产周转率' },
  metricCostToIncome: { en: 'Cost to income ratio', th: 'อัตราส่วนต้นทุนต่อรายได้', zh: '成本收入比' },
  metricAccPayableTurnover: { en: 'Accounts payable turnover', th: 'อัตราหมุนเวียนเจ้าหนี้การค้า', zh: '应付账款周转率' },
  metricAccReceivableTurnover: { en: 'Accounts receivable turnover', th: 'อัตราหมุนเวียนลูกหนี้การค้า', zh: '应收账款周转率' },
  metricInventoryTurnover: { en: 'Inventory turnover', th: 'อัตราหมุนเวียนสินค้าคงคลัง', zh: '存货周转率' },
  metricBizCapital: { en: 'Registered capital trend', th: 'แนวโน้มทุนจดทะเบียน', zh: '注册资本趋势' },
  metricCapitalHist: { en: 'Capital history trend', th: 'แนวโน้มประวัติทุน', zh: '资本变动趋势' },
  metricNewCap: { en: 'New capital raised', th: 'ทุนที่เพิ่มใหม่', zh: '新增资本' },
  metricInvestRatio: { en: 'Investment ratio', th: 'อัตราส่วนการลงทุน', zh: '投资比率' },
  metricRevenueRatio: { en: 'Revenue ratio', th: 'อัตราส่วนรายได้', zh: '营收比率' },
  metricRevenueForecast: { en: 'Revenue forecast (avg)', th: 'คาดการณ์รายได้เฉลี่ย', zh: '营收预测均值' },
  metricJuristicActive: { en: 'Active companies (industry)', th: 'บริษัทที่ดำเนินกิจการ (อุตสาหกรรม)', zh: '同业存续企业数' },
  metricJuristicEst: { en: 'New registrations (industry)', th: 'การจดทะเบียนใหม่ (อุตสาหกรรม)', zh: '同业新设企业数' },
  metricJuristicGrowth: { en: 'Industry growth rate', th: 'อัตราการเติบโตของอุตสาหกรรม', zh: '同业增长率' },
  metricJuristicRatio: { en: 'Industry composition ratio', th: 'สัดส่วนโครงสร้างอุตสาหกรรม', zh: '同业构成占比' },
  metricNewCnt: { en: 'New company count', th: 'จำนวนบริษัทจดทะเบียนใหม่', zh: '新设企业数量' },
  metricActiveAge: { en: 'Average company age', th: 'อายุเฉลี่ยของบริษัท', zh: '企业平均存续年限' },
  metricSurvivalRate: { en: 'Survival rate', th: 'อัตราการอยู่รอด', zh: '存续率' },
  metricRegisNew2: { en: 'New registrations (2yr)', th: 'จดทะเบียนใหม่ (2 ปี)', zh: '新设企业(2年)' },
  metricRegisNew3: { en: 'New registrations (3yr)', th: 'จดทะเบียนใหม่ (3 ปี)', zh: '新设企业(3年)' },
  metricRegisNew5: { en: 'New registrations (5yr)', th: 'จดทะเบียนใหม่ (5 ปี)', zh: '新设企业(5年)' },
  metricRegisNew7: { en: 'New registrations (7yr)', th: 'จดทะเบียนใหม่ (7 ปี)', zh: '新设企业(7年)' },
  metricRegisClose2: { en: 'Closures (2yr)', th: 'เลิกกิจการ (2 ปี)', zh: '注销企业(2年)' },
  metricRegisClose3: { en: 'Closures (3yr)', th: 'เลิกกิจการ (3 ปี)', zh: '注销企业(3年)' },
  metricRegisClose5: { en: 'Closures (5yr)', th: 'เลิกกิจการ (5 ปี)', zh: '注销企业(5年)' },
  metricRegisClose7: { en: 'Closures (7yr)', th: 'เลิกกิจการ (7 ปี)', zh: '注销企业(7年)' },
  metricRegisOst2: { en: 'Active registrations (2yr)', th: 'ดำเนินกิจการอยู่ (2 ปี)', zh: '存续企业(2年)' },
  metricRegisOst3: { en: 'Active registrations (3yr)', th: 'ดำเนินกิจการอยู่ (3 ปี)', zh: '存续企业(3年)' },
  metricRegisOst5: { en: 'Active registrations (5yr)', th: 'ดำเนินกิจการอยู่ (5 ปี)', zh: '存续企业(5年)' },
  metricRegisOst7: { en: 'Active registrations (7yr)', th: 'ดำเนินกิจการอยู่ (7 ปี)', zh: '存续企业(7年)' },
  peerTag: { en: 'Similar companies', th: 'บริษัทคล้ายกัน', zh: '同类企业' },
  peersHeading: { en: 'More companies in this province & industry', th: 'บริษัทอื่นในจังหวัดและประเภทธุรกิจเดียวกัน', zh: '同府同行业的其他企业' },
  relCompany: { en: 'Company', th: 'บริษัท', zh: '公司' },
  provinceShort: { en: 'Province', th: 'จังหวัด', zh: '府' },
  nationality: { en: 'Nationality', th: 'สัญชาติ', zh: '国籍' },
  home: { en: 'Home', th: 'หน้าแรก', zh: '首页' },
  directory: { en: 'Company Directory', th: 'ทำเนียบบริษัท', zh: '公司名录' },
  ownerCompanies: { en: 'Companies', th: 'จำนวนบริษัท', zh: '任职公司' },
  ownerRole: { en: 'Role', th: 'ตำแหน่ง', zh: '职位' },
  ownerUpdated: { en: 'Updated', th: 'อัปเดต', zh: '更新日期' },
  ownerCompaniesHeading: { en: 'Companies held (as director)', th: 'บริษัทที่ดำรงตำแหน่ง (กรรมการ)', zh: '任职公司(董事)' },
  ownerLead: { en: 'Companies where this person is a registered director, from DBD DataWarehouse+ records.', th: 'บริษัทที่บุคคลนี้จดทะเบียนเป็นกรรมการ จากข้อมูล DBD DataWarehouse+', zh: '此人在 DBD DataWarehouse+ 登记担任董事的公司。' },
  ownerNote: { en: 'Linked by directorship records only — not shareholding or control. DBD registry data has no shareholding details.', th: 'เชื่อมโยงผ่านการเป็นกรรมการเท่านั้น ไม่ใช่การถือหุ้นหรือการควบคุม ข้อมูล DBD ไม่มีรายละเอียดผู้ถือหุ้น', zh: '仅基于董事任职登记关联,不代表持股或控制关系;DBD 登记数据不含股东持股明细。' },
  ownerShowing: { en: 'Showing {a} of {b} companies.', th: 'แสดง {a} จาก {b} บริษัท', zh: '仅显示前 {a} 家,共 {b} 家。' },
  ownerUnnamed: { en: 'Unnamed', th: 'ไม่ระบุชื่อ', zh: '未具名' },
  ownerGateTitle: { en: 'Sign in to view this director profile', th: 'เข้าสู่ระบบเพื่อดูโปรไฟล์กรรมการนี้', zh: '登录后查看该董事详情' },
  ownerGateBody: { en: 'Director and shareholder details are only shown to signed-in members.', th: 'รายละเอียดกรรมการและผู้ถือหุ้นแสดงเฉพาะสมาชิกที่เข้าสู่ระบบเท่านั้น', zh: '董事与股东详情仅登录会员可见。' },
  ownerHiddenNotice: { en: 'The business owner has claimed this listing and chosen to mask shareholder/director names.', th: 'เจ้าของธุรกิจได้ยืนยันการเป็นเจ้าของรายชื่อนี้และเลือกปิดบังชื่อผู้ถือหุ้น/กรรมการบางส่วน', zh: '企业主已认领公司并将股东/董事姓名做打码处理。' },
  ownerPublicNotice: { en: 'The business owner has claimed this listing and chosen to display this information publicly.', th: 'เจ้าของธุรกิจได้ยืนยันการเป็นเจ้าของรายชื่อนี้และเลือกแสดงข้อมูลนี้ต่อสาธารณะ', zh: '企业主已认领公司并选择对外公开展示。' },
  signIn: { en: 'Sign in', th: 'เข้าสู่ระบบ', zh: '登录' },
  // ── 公司详情页「常见问题」FAQ 模块(SEO):问题/答案模板,{name} 等占位符由 faqT() 替换 ──
  faqSectionTitle: { en: 'Frequently asked questions about {name}', th: 'คำถามที่พบบ่อยเกี่ยวกับ {name}', zh: '关于{name}的常见问题' },
  faqEstablishedQ: { en: 'When was {name} established?', th: '{name} ก่อตั้งเมื่อใด', zh: '{name}是什么时候成立的？' },
  faqEstablishedA: { en: '{name} was established on {date} and is currently {status}.', th: '{name} จดทะเบียนก่อตั้งเมื่อ {date} และปัจจุบันมีสถานะ{status}', zh: '{name}成立于{date}，目前公司状态为{status}。' },
  faqRegNoQ: { en: "What is {name}'s registration number?", th: '{name} มีเลขทะเบียนนิติบุคคลใด', zh: '{name}的注册号是多少？' },
  faqRegNoA: { en: "{name}'s official DBD registration number is {jpno}.", th: '{name} มีเลขทะเบียนนิติบุคคลอย่างเป็นทางการคือ {jpno}', zh: '{name}的官方注册号（统一编号）是 {jpno}。' },
  faqTypeQ: { en: 'What type of company is {name}?', th: '{name} เป็นนิติบุคคลประเภทใด', zh: '{name}是什么类型的企业？' },
  faqTypeA: { en: '{name} is registered as a {ctype}.', th: '{name} จดทะเบียนในรูปแบบ{ctype}', zh: '{name}登记的企业类型为{ctype}。' },
  faqAddressQ: { en: "Where is {name}'s registered address?", th: 'ที่อยู่จดทะเบียนของ {name} อยู่ที่ใด', zh: '{name}的注册地址在哪里？' },
  faqAddressA: { en: "{name}'s registered address is {addr}.", th: '{name} จดทะเบียนที่อยู่ {addr}', zh: '{name}的注册地址是{addr}。' },
  faqSizeQ: { en: 'What size business is {name}?', th: '{name} จัดอยู่ในธุรกิจขนาดใด', zh: '{name}属于什么规模的企业？' },
  faqSizeA: { en: '{name} is classified as a {size}.', th: '{name} จัดอยู่ในกลุ่ม{size}', zh: '{name}被归类为{size}。' },
  faqNameQ: { en: "What is {name}'s registered English and Thai name?", th: 'ชื่อจดทะเบียนภาษาอังกฤษและภาษาไทยของ {name} คืออะไร', zh: '{name}登记的英文名和泰文名分别是什么？' },
  faqNameA: { en: '{name} is registered in English as "{nameEn}" and in Thai as "{nameTh}".', th: '{name} จดทะเบียนชื่อภาษาอังกฤษว่า "{nameEn}" และภาษาไทยว่า "{nameTh}"', zh: '{name}登记的英文名称为"{nameEn}"，泰文名称为"{nameTh}"。' },
  faqUpdatedQ: { en: "When was {name}'s company information last updated?", th: 'ข้อมูลบริษัทของ {name} ปรับปรุงล่าสุดเมื่อใด', zh: '{name}的资料最后更新时间是什么时候？' },
  faqUpdatedA: { en: "{name}'s company record was last updated on {date}.", th: 'ข้อมูลบริษัท {name} ปรับปรุงล่าสุดเมื่อ {date}', zh: '{name}的企业资料最后更新于{date}。' },
  faqCapitalQ: { en: "What is {name}'s registered capital?", th: 'ทุนจดทะเบียนของ {name} มีเท่าใด', zh: '{name}的注册资本是多少？' },
  faqCapitalA: { en: "{name}'s registered capital is {cap}.", th: '{name} มีทุนจดทะเบียน {cap}', zh: '{name}的注册资本为{cap}。' },
  faqCapitalPaidExtra: { en: ' Its paid-up capital is {paid}.', th: ' มีทุนที่ชำระแล้ว {paid}', zh: '实缴资本为{paid}。' },
  faqSharesQ: { en: 'How many shares has {name} issued?', th: '{name} ออกหุ้นทั้งหมดกี่หุ้น', zh: '{name}发行了多少股份？' },
  faqSharesA: { en: '{name} has issued {shares} shares.', th: '{name} ออกหุ้นทั้งหมด {shares} หุ้น', zh: '{name}共发行 {shares} 股。' },
  faqRevenueQ: { en: "What was {name}'s latest revenue?", th: 'รายได้ล่าสุดของ {name} มีเท่าใด', zh: '{name}的最新营收是多少？' },
  faqRevenueA: { en: 'In the fiscal year ended {finyear}, {name} generated revenue of {revenue}.', th: '{name} มีรายได้ {revenue} ในปีงบการเงินที่สิ้นสุด {finyear}', zh: '{name}在截至 {finyear} 的财政年度中创造了 {revenue} 的收入。' },
  faqProfitQ: { en: 'Is {name} profitable?', th: '{name} มีผลกำไรหรือไม่', zh: '{name}是否盈利？' },
  faqProfitPosA: { en: '{name} reported a net profit of {profit} for the latest fiscal year.', th: '{name} มีกำไรสุทธิ {profit} ในปีงบการเงินล่าสุด', zh: '{name}在最新财年录得净利润 {profit}。' },
  faqProfitNegA: { en: '{name} reported a net loss of {profit} for the latest fiscal year.', th: '{name} ขาดทุนสุทธิ {profit} ในปีงบการเงินล่าสุด', zh: '{name}在最新财年录得净亏损 {profit}。' },
  faqAssetsQ: { en: "What are {name}'s total assets and shareholder equity?", th: 'สินทรัพย์รวมและส่วนของผู้ถือหุ้นของ {name} มีเท่าใด', zh: '{name}的总资产和股东权益是多少？' },
  faqAssetsBothA: { en: '{name} reported total assets of {assets} and shareholder equity of {equity}.', th: '{name} มีสินทรัพย์รวม {assets} และส่วนของผู้ถือหุ้น {equity}', zh: '{name}的总资产为 {assets}，股东权益为 {equity}。' },
  faqAssetsAssetOnlyA: { en: '{name} reported total assets of {assets}.', th: '{name} มีสินทรัพย์รวม {assets}', zh: '{name}的总资产为 {assets}。' },
  faqAssetsEquityOnlyA: { en: '{name} reported shareholder equity of {equity}.', th: '{name} มีส่วนของผู้ถือหุ้น {equity}', zh: '{name}的股东权益为 {equity}。' },
  faqBusinessQ: { en: 'What does {name} do?', th: '{name} ประกอบธุรกิจอะไร', zh: '{name}主要经营什么业务？' },
  faqBusinessA: { en: "{name}'s registered business activity is: {objective}", th: '{name} จดทะเบียนประกอบกิจการ: {objective}', zh: '{name}登记的经营业务为：{objective}' },
  faqIndustryQ: { en: 'What industry is {name} in?', th: '{name} อยู่ในกลุ่มอุตสาหกรรมใด', zh: '{name}属于哪个行业大类？' },
  faqIndustryA: { en: '{name} is classified under the {industry} industry.', th: '{name} จัดอยู่ในกลุ่มอุตสาหกรรม{industry}', zh: '{name}被归类为{industry}行业。' },
  faqDirectorsQ: { en: 'How many registered directors does {name} have?', th: '{name} มีกรรมการที่จดทะเบียนกี่คน', zh: '{name}有多少名登记董事？' },
  faqDirectorsA: { en: '{name} has {count} registered director(s).', th: '{name} มีกรรมการที่จดทะเบียน {count} คน', zh: '{name}共有 {count} 名登记董事。' },
  faqDirectorsPublicA: { en: '{name} has {count} registered director(s), including:', th: '{name} มีกรรมการที่จดทะเบียน {count} คน ได้แก่:', zh: '{name}共有 {count} 名登记董事，包括：' },
  faqContactQ: { en: 'How can I contact {name}?', th: 'ติดต่อ {name} ได้อย่างไร', zh: '如何联系{name}？' },
  faqContactIntro: { en: 'You can reach {name} through:', th: 'สามารถติดต่อ {name} ได้ผ่านทาง:', zh: '可以通过以下方式联系{name}：' },
  faqPeersQ: { en: 'What other companies are similar to {name}?', th: 'มีบริษัทใดที่คล้ายกับ {name} บ้าง', zh: '还有哪些企业和{name}类似？' },
  faqPeersIntro: { en: 'Other companies in the same province and industry as {name} include:', th: 'บริษัทอื่นในจังหวัดและอุตสาหกรรมเดียวกันกับ {name} ได้แก่:', zh: '与{name}同府同行业的企业还包括：' },
  faqSourceQ: { en: 'Where does this information about {name} come from?', th: 'ข้อมูลเกี่ยวกับ {name} มาจากแหล่งใด', zh: '关于{name}的这些数据来自哪里？' },
  faqSourceA: { en: "This profile is compiled from Thailand's DBD DataWarehouse+ official company registry, last refreshed {date}, and published by BizThai.com for reference — please verify critical details against the official DBD registry.", th: 'ข้อมูลนี้รวบรวมจากฐานข้อมูลทะเบียนนิติบุคคลอย่างเป็นทางการ DBD DataWarehouse+ ของประเทศไทย ปรับปรุงล่าสุดเมื่อ {date} เผยแพร่โดย BizThai.com เพื่อการอ้างอิง ควรตรวจสอบข้อมูลสำคัญกับกรมพัฒนาธุรกิจการค้าอีกครั้ง', zh: '本资料整理自泰国商业发展厅（DBD）DataWarehouse+官方企业登记数据库，数据更新于{date}，由 BizThai.com 整理发布仅供参考，重要信息请以 DBD 官方登记为准。' },
}
const SSR_SIZE = {
  S: { en: 'Small enterprise', th: 'ธุรกิจขนาดเล็ก', zh: '小型企业' },
  M: { en: 'Medium enterprise', th: 'ธุรกิจขนาดกลาง', zh: '中型企业' },
  L: { en: 'Large enterprise', th: 'ธุรกิจขนาดใหญ่', zh: '大型企业' },
}
function LBL(lang, k) { const e = SSR_LBL[k]; return e ? (e[lang] || e.en) : k }
// FAQ 模板取值:LBL() 拿三语句子模板,{占位符} 用 vars 里的值替换。
function faqT(lang, k, vars) { return LBL(lang, k).replace(/\{(\w+)\}/g, (m, key) => (vars && vars[key] != null ? String(vars[key]) : '')) }
function ssrPick(lang, th, en, zh) {
  const t = th || '', e = en || '', z = zh || '', fb = e || t || z
  if (lang === 'zh') return z || fb
  if (lang === 'th') return t || fb
  return e || fb
}
// 认领会员编辑提示(2026-07-05):轻量的"月日 时:分"格式,不用登记信息那套泰历双历格式——
// 这是会员编辑元数据,不是 DBD 官方登记日期。直接从 reviewed_at 原始字符串(Postgres 已经是
// +07 本地时区)正则取数字,不用 Date 对象,避免服务器自身时区和数据库时区不一致时被悄悄转换。
const SSR_EDIT_NOTE_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function ssrEditNoteDate(lang, editedAt) {
  const m = String(editedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return ''
  const month = parseInt(m[2], 10), day = parseInt(m[3], 10), hh = m[4], mm = m[5]
  const monEn = SSR_EDIT_NOTE_MONTHS_EN[month - 1] || ''
  if (lang === 'zh') return month + '月' + day + '日 ' + hh + ':' + mm
  if (lang === 'th') return day + ' ' + monEn + ' ' + hh + ':' + mm
  return monEn + ' ' + day + ', ' + hh + ':' + mm
}
// 在(按时间倒序排好的)已通过编辑记录里,找"最新一条同时满足①包含这个字段 ②该字段值和当前
// 线上值完全一致"的记录,返回其编辑时间;找不到就返回空——避免"数据其实已被 DBD 同步覆盖回去,
// 却还显示认领后修改过"这种误导。
function ssrFindEditedAt(revisions, fieldName, currentValue) {
  if (!fieldName || currentValue == null || currentValue === '') return ''
  for (const rev of revisions) {
    if (rev.meta && Object.prototype.hasOwnProperty.call(rev.meta, fieldName) && rev.meta[fieldName] === currentValue) return rev.editedAt
  }
  return ''
}
function ssrField(meta, lang, i18nKey, th, en, zh) {
  const b = meta.i18n
  if (b && i18nKey) {
    const bt = b.th && b.th[i18nKey], be = b.en && b.en[i18nKey], bz = b.zh && b.zh[i18nKey]
    if (bt || be || bz) return ssrPick(lang, bt, be, bz)
  }
  return ssrPick(lang, th, en, zh)
}
// v==null(即 null/undefined)和空串必须先排掉再转数字:JS 的 Number(null)===0、Number('')===0,
// 不这样写"未填报"会被当成"填报了 0"——2026-07-01 加 FAQ 模块时发现这条,连带修了此前财务面板的同款问题
// (没有财务数据的公司,「财务数据」区块此前一直显示营收/净利润/总资产/权益全部"0 THB")。
function ssrNum(v) { if (v == null || v === '') return null; const n = Number(v); return isFinite(n) ? n : null }
function ssrFmt(v) { const n = Number(v); if (!isFinite(n)) return ''; const p = String(Math.round(n * 100) / 100).split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.') }
function ssrBeYear(y) { y = parseInt(y, 10); if (isNaN(y)) return null; return y >= 2400 ? y - 543 : y }
function ssrDualYear(lang, y) { const ce = ssrBeYear(y); if (ce == null) return ''; return lang === 'th' ? (ce + 543) + ' (' + ce + ')' : ce + ' (' + (ce + 543) + ')' }
function ssrDualDate(lang, raw) { raw = String(raw || ''); const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return raw; const ce = ssrBeYear(m[1]); if (ce == null) return raw; const be = ce + 543, rest = '-' + m[2] + '-' + m[3]; return lang === 'th' ? (be + rest + ' (' + ce + ')') : (ce + rest + ' (' + be + ')') }

// ── 董事国籍(ntCode → 旗帜+国名),与 theme.js 客户端版本保持同一份映射表(两处独立维护,SSR/客户端渲染同一份数据) ──
const NATIONALITY_MAP = {
  TH: { flag: '🇹🇭', en: 'Thailand', th: 'ไทย', zh: '泰国' },
  CN: { flag: '🇨🇳', en: 'China', th: 'จีน', zh: '中国' },
  US: { flag: '🇺🇸', en: 'United States', th: 'สหรัฐอเมริกา', zh: '美国' },
  JP: { flag: '🇯🇵', en: 'Japan', th: 'ญี่ปุ่น', zh: '日本' },
  KR: { flag: '🇰🇷', en: 'South Korea', th: 'เกาหลีใต้', zh: '韩国' },
  GB: { flag: '🇬🇧', en: 'United Kingdom', th: 'สหราชอาณาจักร', zh: '英国' },
  DE: { flag: '🇩🇪', en: 'Germany', th: 'เยอรมนี', zh: '德国' },
  FR: { flag: '🇫🇷', en: 'France', th: 'ฝรั่งเศส', zh: '法国' },
  IN: { flag: '🇮🇳', en: 'India', th: 'อินเดีย', zh: '印度' },
  SG: { flag: '🇸🇬', en: 'Singapore', th: 'สิงคโปร์', zh: '新加坡' },
  MY: { flag: '🇲🇾', en: 'Malaysia', th: 'มาเลเซีย', zh: '马来西亚' },
  HK: { flag: '🇭🇰', en: 'Hong Kong', th: 'ฮ่องกง', zh: '中国香港' },
  TW: { flag: '🇹🇼', en: 'Taiwan', th: 'ไต้หวัน', zh: '中国台湾' },
  VN: { flag: '🇻🇳', en: 'Vietnam', th: 'เวียดนาม', zh: '越南' },
  ID: { flag: '🇮🇩', en: 'Indonesia', th: 'อินโดนีเซีย', zh: '印度尼西亚' },
  PH: { flag: '🇵🇭', en: 'Philippines', th: 'ฟิลิปปินส์', zh: '菲律宾' },
  NL: { flag: '🇳🇱', en: 'Netherlands', th: 'เนเธอร์แลนด์', zh: '荷兰' },
  CH: { flag: '🇨🇭', en: 'Switzerland', th: 'สวิตเซอร์แลนด์', zh: '瑞士' },
  SE: { flag: '🇸🇪', en: 'Sweden', th: 'สวีเดน', zh: '瑞典' },
  IT: { flag: '🇮🇹', en: 'Italy', th: 'อิตาลี', zh: '意大利' },
  ES: { flag: '🇪🇸', en: 'Spain', th: 'สเปน', zh: '西班牙' },
  AU: { flag: '🇦🇺', en: 'Australia', th: 'ออสเตรเลีย', zh: '澳大利亚' },
  CA: { flag: '🇨🇦', en: 'Canada', th: 'แคนาดา', zh: '加拿大' },
  NZ: { flag: '🇳🇿', en: 'New Zealand', th: 'นิวซีแลนด์', zh: '新西兰' },
  RU: { flag: '🇷🇺', en: 'Russia', th: 'รัสเซีย', zh: '俄罗斯' },
  AE: { flag: '🇦🇪', en: 'UAE', th: 'สหรัฐอาหรับเอมิเรตส์', zh: '阿联酋' },
  PK: { flag: '🇵🇰', en: 'Pakistan', th: 'ปากีสถาน', zh: '巴基斯坦' },
  BD: { flag: '🇧🇩', en: 'Bangladesh', th: 'บังกลาเทศ', zh: '孟加拉国' },
  LK: { flag: '🇱🇰', en: 'Sri Lanka', th: 'ศรีลังกา', zh: '斯里兰卡' },
  NP: { flag: '🇳🇵', en: 'Nepal', th: 'เนปาล', zh: '尼泊尔' },
  MM: { flag: '🇲🇲', en: 'Myanmar', th: 'เมียนมา', zh: '缅甸' },
  LA: { flag: '🇱🇦', en: 'Laos', th: 'ลาว', zh: '老挝' },
  KH: { flag: '🇰🇭', en: 'Cambodia', th: 'กัมพูชา', zh: '柬埔寨' },
  LT: { flag: '🇱🇹', en: 'Lithuania', th: 'ลิทัวเนีย', zh: '立陶宛' },
  BR: { flag: '🇧🇷', en: 'Brazil', th: 'บราซิล', zh: '巴西' },
  ZA: { flag: '🇿🇦', en: 'South Africa', th: 'แอฟริกาใต้', zh: '南非' },
  NG: { flag: '🇳🇬', en: 'Nigeria', th: 'ไนจีเรีย', zh: '尼日利亚' },
  IL: { flag: '🇮🇱', en: 'Israel', th: 'อิสราเอล', zh: '以色列' },
  SA: { flag: '🇸🇦', en: 'Saudi Arabia', th: 'ซาอุดีอาระเบีย', zh: '沙特阿拉伯' },
  NO: { flag: '🇳🇴', en: 'Norway', th: 'นอร์เวย์', zh: '挪威' },
  DK: { flag: '🇩🇰', en: 'Denmark', th: 'เดนมาร์ก', zh: '丹麦' },
  FI: { flag: '🇫🇮', en: 'Finland', th: 'ฟินแลนด์', zh: '芬兰' },
  BE: { flag: '🇧🇪', en: 'Belgium', th: 'เบลเยียม', zh: '比利时' },
  AT: { flag: '🇦🇹', en: 'Austria', th: 'ออสเตรีย', zh: '奥地利' },
  PL: { flag: '🇵🇱', en: 'Poland', th: 'โปแลนด์', zh: '波兰' }
}
function nationalityInfo(lang, code) {
  code = String(code || '').trim().toUpperCase()
  if (!code) return null
  const e = NATIONALITY_MAP[code]
  return { code, flag: e ? e.flag : '🏳️', name: e ? (e[lang] || e.en) : code }
}
// 签字权限比对:signCommittees 是自由文本,姓名前后空格不统一,还偶发混入杂散分隔符(如尾部 "/"),
// 去空白+去杂散符号后做子串匹配比死板对齐更稳(漏判比误判安全,但可清洗的噪声应该先洗掉)
function stripSpace(s) { return String(s || '').replace(/[\s/,]+/g, '') }
function hasSignAuthority(nameTh, nameEn, signs) {
  if (!signs || !signs.length) return false
  const needleTh = stripSpace(nameTh), needleEn = stripSpace(nameEn)
  return signs.some(s => {
    const d = stripSpace(s.signDescription), de = stripSpace(s.signDescriptionE)
    return (needleTh.length > 3 && d.indexOf(needleTh) !== -1) || (needleEn.length > 3 && de.length > 0 && de.indexOf(needleEn) !== -1)
  })
}
// 按国籍统计董事人数占比(不是出资金额占比——investAmt 目前几乎没有真实数据,见项目记忆)
function nationalityBreakdown(lang, coms) {
  const counts = {}, order = []
  coms.forEach(c => {
    const code = String(c.ntCode || '').trim().toUpperCase()
    if (!code) return
    if (!counts[code]) { counts[code] = 0; order.push(code) }
    counts[code] += 1
  })
  const total = order.reduce((s, code) => s + counts[code], 0)
  if (!total) return []
  order.sort((a, b) => counts[b] - counts[a])
  return order.map(code => {
    const info = nationalityInfo(lang, code)
    return { code, flag: info.flag, name: info.name, count: counts[code], pct: (counts[code] / total * 100).toFixed(1) }
  })
}
// 按国籍统计真实股权资本占比——jpNations 是 2026-07-04 新推送的字段,每行是一个真实国籍的持股汇总
// (ntCode 顶层为 null 的那一行是"全部国籍"合计行,不是真实国籍,过滤掉)
function jpNationsBreakdown(lang, jpNations) {
  if (!Array.isArray(jpNations)) return []
  const rows = jpNations.filter(n => n && n.ntCode)
  if (!rows.length) return []
  return rows.map(n => {
    const info = nationalityInfo(lang, n.ntCode)
    const shareVol = ssrNum(n.shareVol), shareAmt = ssrNum(n.shareAmt), pctRaw = ssrNum(n.sharePctVol)
    return { code: info.code, flag: info.flag, name: info.name, shareVol, shareAmt, pct: pctRaw != null ? pctRaw.toFixed(2) : null, count: shareAmt != null ? shareAmt : (shareVol || 0) }
  }).sort((a, b) => (b.count || 0) - (a.count || 0))
}
// SSR 兜底可视化:无 JS/爬虫场景不画真圆环(避免手写弧形路径的三角函数出错风险),改用等价信息量的
// 水平分段比例条(每段宽度=占比,颜色复用趋势图同一套调色板),配合下方表格给出精确数字
const NAT_PALETTE = ['#7901b2', '#11803f', '#d97706', '#0f6cbd', '#c02638', '#57535e', '#9333ea', '#0a8f4f', '#b45309', '#1d4ed8']
function ssrNationalityBar(breakdown) {
  const segs = breakdown.map((b, i) => '<span style="flex:' + (b.pct || 0) + ' 0 0%;background:' + NAT_PALETTE[i % NAT_PALETTE.length] + '" title="' + escHtml(b.flag + ' ' + b.name + ': ' + (b.pct != null ? b.pct + '%' : '-')) + '"></span>').join('')
  return '<div class="biz-dir-nat__bar">' + segs + '</div>'
}

// 历年泰籍/外籍持股比例趋势(shareHistTHDps/shareHistOTDps,2026-07-04 从「数据分析」tab 挪到这里,
// 固定只有「泰籍/外籍」两类,配色写在 style.css 的 .biz-share-trend__seg--th/--ot 里,和任意国籍列表
// 用的 NAT_PALETTE 无关)
// 从单个曲线点取数字百分比(区别于 ssrChartLatest 只取格式化文本,这里要数字来算堆叠柱的高度比例)
function ssrChartPctNum(p) {
  if (!p) return null
  if (p.y != null && isFinite(Number(p.y))) return Number(p.y)
  if (p.sharePctVol != null && p.sharePctVol !== '') { const n = Number(p.sharePctVol); return isFinite(n) ? n : null }
  if (p.indexLabel != null) { const n = Number(String(p.indexLabel).replace('%', '')); return isFinite(n) ? n : null }
  return null
}
function ssrShareHistTrend(meta) {
  const jnc = (meta.jpNationCharts && typeof meta.jpNationCharts === 'object') ? meta.jpNationCharts : {}
  const bfc = (meta.basicFinCharts && typeof meta.basicFinCharts === 'object') ? meta.basicFinCharts : {}
  const jncCC = (jnc.customChart && typeof jnc.customChart === 'object') ? jnc.customChart : {}
  const bfcCC = (bfc.customChart && typeof bfc.customChart === 'object') ? bfc.customChart : {}
  const pick = (k) => (Array.isArray(jncCC[k]) && jncCC[k].length) ? jncCC[k] : ((Array.isArray(bfcCC[k]) && bfcCC[k].length) ? bfcCC[k] : [])
  const thPoints = pick('shareHistTHDps'), otPoints = pick('shareHistOTDps')
  if (!thPoints.length && !otPoints.length) return []
  const byLabel = new Map(), order = []
  const add = (points, key) => points.forEach(p => {
    if (!p || p.label == null) return
    const label = String(p.label)
    if (!byLabel.has(label)) { byLabel.set(label, {}); order.push(label) }
    const v = ssrChartPctNum(p)
    if (v != null) byLabel.get(label)[key] = v
  })
  add(thPoints, 'th')
  add(otPoints, 'ot')
  return order.filter(label => byLabel.get(label).th != null || byLabel.get(label).ot != null)
    .map(label => ({ label, th: byLabel.get(label).th, ot: byLabel.get(label).ot }))
}
// SSR 兜底:每年一根竖向堆叠双色条,flexbox 高度比例撑开(不手写柱状图 SVG 路径,和 ssrNationalityBar 同一手法)
function ssrShareTrendBars(lang, rows) {
  if (!rows.length) return ''
  const cols = rows.map(r => {
    const th = r.th != null ? r.th : 0, ot = r.ot != null ? r.ot : 0
    const yearLbl = ssrDualYear(lang, r.label) || String(r.label)
    // 源数据年份是泰历(BE,如 "2565"),原样显示会让 zh/en 用户误以为是公历——短标签按语言转成对应历法
    // (th 显示佛历,zh/en 显示公历),完整的中泰双历对照放在 title 悬浮提示里
    const ce = ssrBeYear(r.label)
    const shortYear = ce != null ? String(lang === 'th' ? ce + 543 : ce) : String(r.label)
    return '<div class="biz-share-trend__col" title="' + escHtml(yearLbl) + '"><div class="biz-share-trend__stack">' +
      (ot > 0 ? '<span class="biz-share-trend__seg biz-share-trend__seg--ot" style="flex:' + ot + ' 0 0%"></span>' : '') +
      (th > 0 ? '<span class="biz-share-trend__seg biz-share-trend__seg--th" style="flex:' + th + ' 0 0%"></span>' : '') +
      '</div><div class="biz-share-trend__year">' + escHtml(shortYear) + '</div></div>'
  }).join('')
  const legend = '<div class="biz-share-trend__legend">' +
    '<span><span class="biz-share-trend__swatch biz-share-trend__swatch--th"></span>' + escHtml(LBL(lang, 'metricShareHistTH')) + '</span>' +
    '<span><span class="biz-share-trend__swatch biz-share-trend__swatch--ot"></span>' + escHtml(LBL(lang, 'metricShareHistOT')) + '</span>' +
    '</div>'
  return '<div class="biz-share-trend">' + cols + '</div>' + legend
}

// ── 分析 tab(2026-07-03 二期):jpNationCharts.customChart / basicFinCharts.customChart 共享同一套
// 55 个 "xxxDps" 曲线键(两处 schema 完全一致,实际哪边非空取决于数据类型——股权国籍类落在
// jpNationCharts,财务比率类落在 basicFinCharts)。按语义分成 9 组,只有非空的组/指标才渲染,
// 生产现存补采样本里 90%+ 是 null,这是预期的稀疏形态,不是 bug(见 详情页补采字段渲染-TODO.md)。
const SSR_ANALYTICS_GROUPS = [
  // shareHistTHDps/shareHistOTDps(泰籍/外籍持股历年比例)2026-07-04 挪到「董事与国籍信息」tab
  // 做堆叠柱状图(ssrShareHistTrend/ssrShareTrendBars),不再在这里重复展示。
  { titleKey: 'analyticsGroupBalance', metrics: [
    { key: 'bsAssetDps', labelKey: 'metricBsAsset' },
    { key: 'bsAssetPcDps', labelKey: 'metricBsAssetPc' },
    { key: 'bsEquityDps', labelKey: 'metricBsEquity' },
    { key: 'bsEquityPcDps', labelKey: 'metricBsEquityPc' },
    { key: 'bsLiabilityDps', labelKey: 'metricBsLiability' },
    { key: 'bsLiabilityPcDps', labelKey: 'metricBsLiabilityPc' },
  ] },
  { titleKey: 'analyticsGroupIncome', metrics: [
    { key: 'plRevenueDps', labelKey: 'metricPlRevenue' },
    { key: 'plRevenuePctDps', labelKey: 'metricPlRevenuePct' },
    { key: 'plExpenseDps', labelKey: 'metricPlExpense' },
    { key: 'plExpensePctDps', labelKey: 'metricPlExpensePct' },
    { key: 'plProfitLossDps', labelKey: 'metricPlProfitLoss' },
    { key: 'plProfitLossPctDps', labelKey: 'metricPlProfitLossPct' },
  ] },
  { titleKey: 'analyticsGroupProfitability', metrics: [
    { key: 'grossProfitDps', labelKey: 'metricGrossProfit' },
    { key: 'operatingProfitDps', labelKey: 'metricOperatingProfit' },
    { key: 'netProfitDps', labelKey: 'metricNetProfit' },
    { key: 'netProfitAvgForecastDps', labelKey: 'metricNetProfitForecast' },
    { key: 'roaDps', labelKey: 'metricRoa' },
    { key: 'roeDps', labelKey: 'metricRoe' },
  ] },
  { titleKey: 'analyticsGroupSolvency', metrics: [
    { key: 'currentRatioDps', labelKey: 'metricCurrentRatio' },
    { key: 'debtToAssetDps', labelKey: 'metricDebtToAsset' },
    { key: 'debtToCapitalDps', labelKey: 'metricDebtToCapital' },
    { key: 'debtToEquityDps', labelKey: 'metricDebtToEquity' },
    { key: 'totalAssetToEquityDps', labelKey: 'metricTotalAssetToEquity' },
  ] },
  { titleKey: 'analyticsGroupEfficiency', metrics: [
    { key: 'totalAssetTurnoverDps', labelKey: 'metricTotalAssetTurnover' },
    { key: 'costToIncomeDps', labelKey: 'metricCostToIncome' },
    { key: 'accPayableTurnoverDps', labelKey: 'metricAccPayableTurnover' },
    { key: 'accReceivableTurnoverDps', labelKey: 'metricAccReceivableTurnover' },
    { key: 'inventoryTurnoverDps', labelKey: 'metricInventoryTurnover' },
  ] },
  { titleKey: 'analyticsGroupCapital', metrics: [
    { key: 'bizCapitalDps', labelKey: 'metricBizCapital' },
    { key: 'capitalHistDps', labelKey: 'metricCapitalHist' },
    { key: 'newCapDps', labelKey: 'metricNewCap' },
    { key: 'investRatioDps', labelKey: 'metricInvestRatio' },
    { key: 'revenueRatioDps', labelKey: 'metricRevenueRatio' },
    { key: 'revenueAvgForecastDps', labelKey: 'metricRevenueForecast' },
  ] },
  { titleKey: 'analyticsGroupIndustry', metrics: [
    { key: 'juristicOverviewActiveDps', labelKey: 'metricJuristicActive' },
    { key: 'juristicOverviewEstDps', labelKey: 'metricJuristicEst' },
    { key: 'juristicOverviewGrowthDps', labelKey: 'metricJuristicGrowth' },
    { key: 'juristicOverviewRatioDps', labelKey: 'metricJuristicRatio' },
  ] },
  { titleKey: 'analyticsGroupRegistration', metrics: [
    { key: 'newCntDps', labelKey: 'metricNewCnt' },
    { key: 'activeAgeDps', labelKey: 'metricActiveAge' },
    { key: 'survivalRateDps', labelKey: 'metricSurvivalRate' },
    { key: 'statRegisNew2', labelKey: 'metricRegisNew2' },
    { key: 'statRegisNew3', labelKey: 'metricRegisNew3' },
    { key: 'statRegisNew5', labelKey: 'metricRegisNew5' },
    { key: 'statRegisNew7', labelKey: 'metricRegisNew7' },
    { key: 'statRegisClose2', labelKey: 'metricRegisClose2' },
    { key: 'statRegisClose3', labelKey: 'metricRegisClose3' },
    { key: 'statRegisClose5', labelKey: 'metricRegisClose5' },
    { key: 'statRegisClose7', labelKey: 'metricRegisClose7' },
    { key: 'statRegisOst2', labelKey: 'metricRegisOst2' },
    { key: 'statRegisOst3', labelKey: 'metricRegisOst3' },
    { key: 'statRegisOst5', labelKey: 'metricRegisOst5' },
    { key: 'statRegisOst7', labelKey: 'metricRegisOst7' },
  ] },
]

// 从曲线的最后一个非空点取"最新值"的展示文本:优先用源数据自带的格式化 indexLabel(如 "16%"、"2.05"),
// 其次 shareHist 系列专属的 sharePctVol,最后兜底数值本身。倒序遍历以跳过尾部的 null 占位点。
function ssrChartLatest(points) {
  if (!Array.isArray(points)) return ''
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]
    if (!p) continue
    if (p.indexLabel != null && p.indexLabel !== '') return String(p.indexLabel)
    if (p.sharePctVol != null && p.sharePctVol !== '') return String(p.sharePctVol) + '%'
    if (p.y != null && isFinite(Number(p.y))) return ssrFmt(p.y)
  }
  return ''
}
// 服务端内联 SVG 折线图(不依赖客户端图表库,爬虫可见):按点位归一化到固定视口,数据点数 <2 时不画线。
function ssrSparkline(points) {
  if (!Array.isArray(points)) return ''
  const nums = points.map(p => (p && p.y != null && isFinite(Number(p.y))) ? Number(p.y) : null)
  const known = nums.filter(v => v != null)
  if (known.length < 2) return ''
  const min = Math.min(...known), max = Math.max(...known), range = (max - min) || 1
  const w = 160, h = 40, pad = 4, n = nums.length
  const stepX = (w - pad * 2) / (n - 1)
  const coords = []
  nums.forEach((v, i) => {
    if (v == null) return
    const x = pad + i * stepX
    const y = pad + (h - pad * 2) * (1 - (v - min) / range)
    coords.push(x.toFixed(1) + ',' + y.toFixed(1))
  })
  if (coords.length < 2) return ''
  const color = known[known.length - 1] >= known[0] ? '#0a8f4f' : '#c0392b'
  return '<svg class="biz-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="color:' + color + '" aria-hidden="true"><polyline points="' + coords.join(' ') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
}
// 单个指标卡片:标题 + 折线(有 ≥2 点时)+ 最新值。整条曲线全空(全部点都没有 y/indexLabel/sharePctVol)时返回空串。
function ssrMetricCard(lang, label, points) {
  if (!Array.isArray(points) || !points.length) return ''
  const hasAny = points.some(p => p && (p.y != null || p.indexLabel != null || p.sharePctVol != null))
  if (!hasAny) return ''
  const latest = ssrChartLatest(points)
  if (!latest) return ''
  const lastPoint = points[points.length - 1]
  const yearLbl = lastPoint && lastPoint.label != null ? ssrDualYear(lang, lastPoint.label) : ''
  const spark = ssrSparkline(points)
  return '<div class="biz-detail-card"><h3>' + escHtml(label) + '</h3>' +
    (spark ? '<div class="biz-spark-wrap">' + spark + '</div>' : '') +
    '<dl class="biz-detail-dl"><div class="biz-detail-dl__row"><dt>' + escHtml(yearLbl || label) + '</dt><dd>' + escHtml(latest) + '</dd></div></dl></div>'
}
// 一组指标卡片拼成一个 section;整组都没数据时返回空串(不渲染空标题)。
function ssrAnalyticsGroup(lang, groupTitle, metrics, series) {
  const cards = metrics.map(m => ssrMetricCard(lang, LBL(lang, m.labelKey), series[m.key])).filter(Boolean).join('')
  if (!cards) return ''
  return '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(groupTitle) + '</h2></div><div class="biz-detail-grid">' + cards + '</div></div>'
}
// 通用记录卡片(用于 extSecLic / 并购 / 改制等形状未经真实数据验证的稀疏字段):按 key 人肉可读化展示,
// 跳过内部噪音键,日期数组按 [y,m,d] 处理。和 renderCompanySSR 内 extSecLic 那段是同一手法的独立版本。
function ssrGenericRecords(lang, arr, cardTitle) {
  if (!Array.isArray(arr) || !arr.length) return ''
  const SKIP_KEYS = ['jpNo', 'rowNo', 'seqNo']
  const humanize = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, s => s.toUpperCase())
  const leaf = (v) => {
    if (Array.isArray(v)) return (v.length === 3 && v[0] && v[1] && v[2])
      ? ssrDualDate(lang, String(v[0]).padStart(4, '0') + '-' + String(v[1]).padStart(2, '0') + '-' + String(v[2]).padStart(2, '0'))
      : ''
    if (v == null || v === '' || typeof v === 'object') return ''
    return String(v)
  }
  return arr.map((it, i) => {
    if (!it || typeof it !== 'object') return ''
    const rows = Object.keys(it).filter(k => !SKIP_KEYS.includes(k))
      .map(k => { const val = leaf(it[k]); return val ? '<div class="biz-detail-dl__row"><dt>' + escHtml(humanize(k)) + '</dt><dd>' + escHtml(val) + '</dd></div>' : '' }).join('')
    return rows ? '<div class="biz-detail-card"><h3>' + escHtml(cardTitle) + ' #' + (i + 1) + '</h3><dl class="biz-detail-dl">' + rows + '</dl></div>' : ''
  }).filter(Boolean).join('')
}

// 泰文公司名 → 拉丁(URL 用)。覆盖前置元音 เ/แ/โ/ใ/ไ、上下元音、ห 静音簇,以及常见公司后缀词。
// 不追求出版级 RTGS,只求稳定 ASCII slug,供首页 rewrite 在无英文名时兜底。
function romanizeThai(input) {
  const C = {
    'ก':'k','ข':'kh','ฃ':'kh','ค':'kh','ฅ':'kh','ฆ':'kh','ง':'ng',
    'จ':'ch','ฉ':'ch','ช':'ch','ซ':'s','ฌ':'ch','ญ':'y',
    'ฎ':'d','ฏ':'t','ฐ':'th','ฑ':'th','ฒ':'th','ณ':'n',
    'ด':'d','ต':'t','ถ':'th','ท':'th','ธ':'th','น':'n',
    'บ':'b','ป':'p','ผ':'ph','ฝ':'f','พ':'ph','ฟ':'f','ภ':'ph','ม':'m',
    'ย':'y','ร':'r','ฤ':'rue','ล':'l','ฦ':'lue','ว':'w',
    'ศ':'s','ษ':'s','ส':'s','ห':'h','ฬ':'l','อ':'','ฮ':'h',
  }
  const MARK = {
    'ั':'a','ิ':'i','ี':'i','ึ':'ue','ื':'ue','ุ':'u','ู':'u','็':'','์':'','ํ':'',
    '่':'','้':'','๊':'','๋':'','ฺ':'',
  }
  const LEAD = { 'เ':'e', 'แ':'ae', 'โ':'o', 'ใ':'ai', 'ไ':'ai' }
  const AFTER = { 'ะ':'a', 'า':'a', 'ำ':'am', 'ๅ':'a' }
  const H_SILENT = new Set(['ง', 'น', 'ม', 'ย', 'ร', 'ล', 'ว'])
  let s = String(input || '')
    .replace(/บริษัท/g, ' company ')
    .replace(/จำกัด/g, ' limited ')
    .replace(/มหาชน/g, ' public ')
    .replace(/\(ประเทศไทย\)|\(ไทย\)/g, ' thailand ')
    .replace(/ประเทศไทย/g, ' thailand ')
  const chars = [...s]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (LEAD[ch] !== undefined) {
      const vow = LEAD[ch]
      let j = i + 1
      // ห 静音: เหา / ไหล — 若 lead 后是 ห+低辅音簇,跳过 ห
      if (j < chars.length && chars[j] === 'ห' && j + 1 < chars.length && H_SILENT.has(chars[j + 1])) j++
      if (j < chars.length && C[chars[j]] !== undefined) {
        let cons = C[chars[j]]
        j++
        let rest = ''
        while (j < chars.length) {
          if (AFTER[chars[j]] !== undefined) { rest += AFTER[chars[j]]; j++; continue }
          if (MARK[chars[j]] !== undefined) { rest += MARK[chars[j]]; j++; continue }
          if (chars[j] === 'ย' && vow === 'e') { rest += 'ia'; j++; continue }
          if (chars[j] === 'ว' && vow === 'e') { rest += 'ua'; j++; continue }
          if (chars[j] === 'อ') { j++; continue }
          break
        }
        out += cons + vow + rest
        i = j - 1
        continue
      }
      out += vow
      continue
    }
    if (ch === 'ห' && i + 1 < chars.length && H_SILENT.has(chars[i + 1])) continue
    if (C[ch] !== undefined) {
      let cons = C[ch]
      let j = i + 1
      let vow = ''
      while (j < chars.length && (MARK[chars[j]] !== undefined || AFTER[chars[j]] !== undefined)) {
        if (AFTER[chars[j]] !== undefined) vow += AFTER[chars[j]]
        else vow += MARK[chars[j]]
        j++
      }
      out += cons + vow
      i = j - 1
      continue
    }
    if (MARK[ch] !== undefined) { out += MARK[ch]; continue }
    if (AFTER[ch] !== undefined) { out += AFTER[ch]; continue }
    out += ch
  }
  return out
}

function ssrSlugifyIndustry(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function ssrTsicSection(code) {
  const d = parseInt(String(code || '').slice(0, 2), 10)
  if (!d) return ''
  const mp = [[1,3,'a'],[5,9,'b'],[10,33,'c'],[35,35,'d'],[36,39,'e'],[41,43,'f'],[45,47,'g'],[49,53,'h'],[55,56,'i'],[58,63,'j'],[64,66,'k'],[68,68,'l'],[69,75,'m'],[77,82,'n'],[85,85,'p'],[86,88,'q'],[90,93,'r'],[94,96,'s'],[97,99,'t']]
  for (const m of mp) { if (d >= m[0] && d <= m[1]) return m[2] }
  return ''
}
// tsic 大类字母 → 扁平 canonical URL 的英文名 slug(与 industry.js 的 bigCatBySlug 同源,
// 这里静态写死是因为 renderCompanySSR 是每次公司详情页请求都会走的同步热路径,
// 不适合为这一个链接临时接入 ensureIndustryLoaded() 的异步加载)
const TSIC_SECTION_ENGSLUG = {
  a: 'agriculture-forestry-fishing', b: 'mining-quarrying', c: 'manufacturing',
  d: 'electricity-gas-supply', e: 'water-supply-waste-management', f: 'construction',
  g: 'wholesale-retail-trade', h: 'transportation-storage', i: 'accommodation-food-service',
  j: 'information-communication', k: 'finance-insurance', l: 'real-estate',
  m: 'professional-scientific-technical', n: 'administrative-support-service', p: 'education',
  q: 'health-social-work', r: 'arts-entertainment-recreation', s: 'other-service-activities',
  t: 'household-employment-activities',
}
const TSIC_SECTION_LABELS = {
  a: { en: 'Agriculture, Forestry & Fishing', th: 'เกษตรกรรม การป่าไม้ และการประมง', zh: '农林牧渔' },
  b: { en: 'Mining & Quarrying', th: 'การทำเหมืองแร่และเหมืองหิน', zh: '采矿业' },
  c: { en: 'Manufacturing', th: 'การผลิต', zh: '制造业' },
  d: { en: 'Electricity & Gas Supply', th: 'ไฟฟ้า ก๊าซ ไอน้ำ และระบบปรับอากาศ', zh: '电力燃气供应' },
  e: { en: 'Water Supply & Waste Management', th: 'การจัดหาน้ำ การจัดการน้ำเสียและของเสีย', zh: '供水及废弃物管理' },
  f: { en: 'Construction', th: 'การก่อสร้าง', zh: '建筑业' },
  g: { en: 'Wholesale & Retail Trade', th: 'การขายส่งและการขายปลีก การซ่อมยานยนต์และจักรยานยนต์', zh: '批发与零售' },
  h: { en: 'Transportation & Storage', th: 'การขนส่งและสถานที่เก็บสินค้า', zh: '运输仓储' },
  i: { en: 'Accommodation & Food Service', th: 'ที่พักแรมและบริการด้านอาหาร', zh: '住宿与餐饮' },
  j: { en: 'Information & Communication', th: 'ข้อมูลข่าวสารและการสื่อสาร', zh: '信息与通信' },
  k: { en: 'Finance & Insurance', th: 'กิจกรรมทางการเงินและการประกันภัย', zh: '金融与保险' },
  l: { en: 'Real Estate', th: 'กิจกรรมด้านอสังหาริมทรัพย์', zh: '房地产' },
  m: { en: 'Professional, Scientific & Technical', th: 'กิจกรรมวิชาชีพ วิทยาศาสตร์ และกิจกรรมทางวิชาการ', zh: '专业科技服务' },
  n: { en: 'Administrative & Support Service', th: 'กิจกรรมการบริหารและบริการสนับสนุน', zh: '行政与支持服务' },
  p: { en: 'Education', th: 'การศึกษา', zh: '教育' },
  q: { en: 'Health & Social Work', th: 'กิจกรรมด้านสุขภาพและงานสังคมสงเคราะห์', zh: '卫生与社会工作' },
  r: { en: 'Arts, Entertainment & Recreation', th: 'ศิลปะ ความบันเทิงและนันทนาการ', zh: '文化娱乐' },
  s: { en: 'Other Service Activities', th: 'กิจกรรมการบริการด้านอื่น ๆ', zh: '其他服务业' },
  t: { en: 'Household Employment Activities', th: 'กิจกรรมการจ้างงานในครัวเรือน', zh: '家庭雇佣活动' },
}
function ssrTsicSectionLabel(section, lang) {
  const labels = TSIC_SECTION_LABELS[section]
  return labels ? (labels[lang] || labels.en) : ''
}

function seoGenericKeywords(lang) {
  return seoT(lang,
    ['Thai company search', 'Thailand company search', 'company profile', 'business registration', 'company directory', 'business report'],
    ['ค้นหาบริษัทไทย', 'ค้นหาข้อมูลบริษัท', 'ทะเบียนบริษัทไทย', 'ข้อมูลนิติบุคคล', 'รายงานธุรกิจ', 'ไดเรกทอรีบริษัท'],
    ['泰国企业查询', '泰国公司查询', '泰国工商信息', '企业档案', '公司名录', '商业报告'])
}
function seoCompanyName(meta, lang) {
  const nameTh = meta.jpname || ''
  const nameEn = meta.jpnamee || meta.jpName || ''
  const nameZh = meta.jpnamezh || nameEn || nameTh
  return ssrPick(lang, nameTh, nameEn, nameZh) || nameEn || nameTh
}
function seoCompanyFacts(meta, lang) {
  const province = ssrField(meta, lang, 'province', meta.province, meta.provincee, meta.provincezh)
  const industry = ssrField(meta, lang, 'industryGroup', meta.setupobjgrpdesc, meta.setupobjgrpdesce, meta.setupobjgrpdesczh)
  const status = ssrField(meta, lang, 'status', meta.status || meta.jpstatdesc, meta.jpstatdesce, meta.statuszh)
  const objective = (meta.objective_th || meta.objective_en || meta.objective_zh)
    ? ssrPick(lang, meta.objective_th, meta.objective_en, meta.objective_zh)
    : ssrField(meta, lang, 'objective', meta.setupobjdesc || meta.submitobjdesc, meta.setupobjdesce || meta.submitobjdesce, meta.setupobjdesczh || meta.submitobjdesczh)
  const ctype = ssrField(meta, lang, 'companyType', meta.jptypedesc, meta.companytypee || meta.jptypedesce, meta.companytypezh)
  return { province, industry, status, objective, ctype }
}
function companySeo(meta, lang, jpNo, canonical, faq, noindex) {
  const name = seoCompanyName(meta, lang) || jpNo
  const f = seoCompanyFacts(meta, lang)
  const title = brandTitle(seoT(lang,
    name + ' company profile, registration no. ' + jpNo,
    'ข้อมูลบริษัท ' + name + ' เลขทะเบียน ' + jpNo,
    name + '工商信息_泰国企业档案_' + jpNo))
  const description = seoT(lang,
    'View ' + name + ' (' + jpNo + ') company profile on ' + BRAND_DOMAIN + ', including registration status, company type, registered capital, address, industry, directors and business activity.',
    'ค้นหาโปรไฟล์บริษัท ' + name + ' เลขทะเบียน ' + jpNo + ' บน ' + BRAND_DOMAIN + ' พร้อมสถานะ ประเภทนิติบุคคล ทุนจดทะเบียน ที่อยู่ อุตสาหกรรม กรรมการ และกิจกรรมธุรกิจ',
    '在 ' + BRAND_DOMAIN + ' 查询 ' + name + '（注册号 ' + jpNo + '）的泰国企业档案，了解经营状态、企业类型、注册资本、地址、行业、董事和主营业务。')
  return {
    title,
    description,
    keywords: [name, meta.jpname, meta.jpnamee, meta.jpnamezh, jpNo, f.province, f.industry, f.status, f.objective, f.ctype, seoGenericKeywords(lang)],
    canonical,
    lang,
    type: 'profile',
    faq,
    noindex: !!noindex,
  }
}
function companyIndexable(meta) {
  const fields = [meta.province, meta.setupobjgrpdesc, meta.capamt, meta.regdate]
  return fields.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length >= 2
}
function directorSeo(r, lang, canonical) {
  const person = cleanMetaText(r.personName || r.title || '', 90)
  const company = cleanMetaText(r.srcName || '', 90)
  const title = brandTitle(seoT(lang,
    (person || 'Director') + ' director companies and Thai business links',
    'ข้อมูลกรรมการ ' + (person || 'ไม่ระบุชื่อ') + ' และบริษัทที่เกี่ยวข้อง',
    (person || '董事') + '任职企业与泰国商业关联'))
  const description = seoT(lang,
    'Search ' + (person || 'this director') + ' on ' + BRAND_DOMAIN + ' to view Thai companies, registered roles, linked company profiles and business context' + (company ? ' for ' + company : '') + '.',
    'ค้นหา ' + (person || 'กรรมการรายนี้') + ' บน ' + BRAND_DOMAIN + ' เพื่อดูบริษัทไทย ตำแหน่งที่จดทะเบียน โปรไฟล์บริษัทที่เกี่ยวข้อง และบริบทธุรกิจ',
    '在 ' + BRAND_DOMAIN + ' 查询 ' + (person || '该董事') + ' 的泰国任职企业、登记职位、关联公司档案与商业背景' + (company ? '，来源企业：' + company : '') + '。')
  return {
    title,
    description,
    keywords: [person, company, seoT(lang, 'Thai director search', 'ค้นหากรรมการบริษัทไทย', '泰国董事查询'), seoT(lang, 'shareholder search', 'ค้นหาผู้ถือหุ้น', '股东查询'), seoGenericKeywords(lang)],
    canonical,
    lang,
    type: 'profile',
    // 2026-07-12:这整页都是围绕一个自然人姓名建的跨公司反查页,不能让搜索引擎按人名收录这页
    // (真人访客照常能打开看,只是不希望"搜这个人的名字"能在 Google 里搜到)。noindex,follow 复用
    // 已有的 applySeo 机制(见 RANK_NOINDEX_THRESHOLD 那处稀疏筛选页的同款用法)——不收录本页,
    // 但页面里指向公司详情页的链接照常允许爬,那些公司页本来就该正常被收录。
    noindex: true,
  }
}
function provinceSeo(provName, lang, canonical) {
  const p = cleanMetaText(provName, 80)
  const title = brandTitle(seoT(lang,
    p + ' company search and business directory',
    'ค้นหาบริษัทใน' + p + ' และไดเรกทอรีธุรกิจ',
    p + '公司查询_泰国地区企业名录'))
  const description = seoT(lang,
    'Search companies in ' + p + ' on ' + BRAND_DOMAIN + '. Browse local company profiles, business registration information, industries, registered capital and commercial leads.',
    'ค้นหาบริษัทใน' + p + ' บน ' + BRAND_DOMAIN + ' ดูโปรไฟล์บริษัท ข้อมูลทะเบียน อุตสาหกรรม ทุนจดทะเบียน และโอกาสทางธุรกิจในพื้นที่',
    '在 ' + BRAND_DOMAIN + ' 查询' + p + '企业名录，浏览当地公司档案、工商登记信息、行业分布、注册资本和商业线索。')
  return {
    title,
    description,
    keywords: [p, seoT(lang, 'companies in ' + p, 'บริษัทใน' + p, p + '公司'), seoT(lang, p + ' business directory', 'ไดเรกทอรีธุรกิจ' + p, p + '企业名录'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
// /companies 深分页页(第2页起)的 SEO——第1页由 WooCMS 原生渲染+已有 SEO,不走这里。
function companiesListSeo(page, lang, canonical) {
  const title = brandTitle(seoT(lang,
    'All Thai companies - page ' + page + ' - company search',
    'ค้นหาบริษัททั้งหมดในไทย - หน้า ' + page,
    '全部泰国公司查询 - 第' + page + '页'))
  const description = seoT(lang,
    'Browse Thailand\'s complete company directory on ' + BRAND_DOMAIN + ', page ' + page + '. Registration number, registered capital, industry and province for every listed company.',
    'เรียกดูไดเรกทอรีบริษัทไทยทั้งหมดบน ' + BRAND_DOMAIN + ' หน้า ' + page + ' พร้อมเลขทะเบียน ทุนจดทะเบียน อุตสาหกรรม และจังหวัด',
    '在 ' + BRAND_DOMAIN + ' 浏览泰国完整企业名录，第' + page + '页。含注册号、注册资本、行业与所在府信息。')
  return {
    title,
    description,
    keywords: [seoT(lang, 'Thailand companies', 'บริษัทในประเทศไทย', '泰国公司'), seoT(lang, 'company directory', 'ไดเรกทอรีบริษัท', '企业名录'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
function industrySeo(indName, lang, canonical) {
  const i = cleanMetaText(indName, 90)
  const title = brandTitle(seoT(lang,
    i + ' companies in Thailand - company search',
    'ค้นหาบริษัทอุตสาหกรรม' + i + 'ในไทย',
    i + '企业查询_泰国行业公司名录'))
  const description = seoT(lang,
    'Search Thailand ' + i + ' companies on ' + BRAND_DOMAIN + '. View company profiles, registration details, province distribution, registered capital and business activity.',
    'ค้นหาบริษัทไทยในอุตสาหกรรม' + i + ' บน ' + BRAND_DOMAIN + ' พร้อมโปรไฟล์บริษัท ข้อมูลทะเบียน การกระจายตามจังหวัด ทุนจดทะเบียน และกิจกรรมธุรกิจ',
    '在 ' + BRAND_DOMAIN + ' 查询泰国' + i + '企业，查看公司档案、工商登记、地区分布、注册资本和主营业务。')
  return {
    title,
    description,
    keywords: [i, seoT(lang, i + ' companies', 'บริษัทอุตสาหกรรม' + i, i + '企业'), seoT(lang, 'Thailand industry directory', 'ไดเรกทอรีอุตสาหกรรมไทย', '泰国行业公司名录'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
function crossSeo(indName, provName, total, lang, canonical) {
  const i = cleanMetaText(indName, 90)
  const p = cleanMetaText(provName, 80)
  const n = Number(total) > 0 ? ssrFmt(total) : ''
  const title = brandTitle(seoT(lang,
    i + ' companies in ' + p + ', Thailand',
    'บริษัท' + i + 'ใน' + p,
    p + i + '公司查询_泰国行业地区企业'))
  const description = seoT(lang,
    'Find ' + (n ? n + ' ' : '') + i + ' companies in ' + p + ' on ' + BRAND_DOMAIN + ', with company profiles, registration information, registered capital, addresses and business activity.',
    'ค้นหาบริษัท' + i + 'ใน' + p + (n ? ' จำนวน ' + n + ' รายการ' : '') + ' บน ' + BRAND_DOMAIN + ' พร้อมโปรไฟล์ ข้อมูลทะเบียน ทุนจดทะเบียน ที่อยู่ และกิจกรรมธุรกิจ',
    '在 ' + BRAND_DOMAIN + ' 查询' + p + i + '企业' + (n ? '，共 ' + n + ' 家' : '') + '，查看公司档案、工商信息、注册资本、地址和主营业务。')
  return {
    title,
    description,
    keywords: [i, p, p + ' ' + i, seoT(lang, 'industry by province', 'อุตสาหกรรมตามจังหวัด', '行业地区企业查询'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
function yearSeo(year, lang, canonical) {
  const title = brandTitle(seoT(lang,
    'New companies registered in Thailand in ' + year,
    'บริษัทจดทะเบียนใหม่ในไทยปี ' + year,
    year + '年泰国新注册公司查询'))
  const description = seoT(lang,
    'Browse Thai companies newly registered in ' + year + ' on ' + BRAND_DOMAIN + ', including company names, registration numbers, provinces, registered capital and latest company profiles.',
    'ดูรายชื่อบริษัทไทยที่จดทะเบียนใหม่ในปี ' + year + ' บน ' + BRAND_DOMAIN + ' พร้อมชื่อบริษัท เลขทะเบียน จังหวัด ทุนจดทะเบียน และโปรไฟล์ล่าสุด',
    '在 ' + BRAND_DOMAIN + ' 浏览 ' + year + ' 年泰国新注册公司，包含公司名称、注册号、所在府、注册资本和最新企业档案。')
  return {
    title,
    description,
    keywords: [year, seoT(lang, 'new Thai companies', 'บริษัทไทยจดทะเบียนใหม่', '泰国新注册公司'), seoT(lang, 'new company registration ' + year, 'จดทะเบียนบริษัทใหม่ ' + year, year + '年新设公司'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
function countrySeo(countryName, lang, canonical) {
  const c = cleanMetaText(countryName, 80)
  const title = brandTitle(seoT(lang,
    c + '-linked companies in Thailand',
    'บริษัทในไทยที่เชื่อมโยงกับ' + c,
    '关联' + c + '的在泰企业查询'))
  const description = seoT(lang,
    'Search Thai companies linked to ' + c + ' on ' + BRAND_DOMAIN + ', including company profiles, registered capital, director or shareholder signals and business contact context.',
    'ค้นหาบริษัทไทยที่เชื่อมโยงกับ' + c + ' บน ' + BRAND_DOMAIN + ' พร้อมโปรไฟล์บริษัท ทุนจดทะเบียน สัญญาณกรรมการหรือผู้ถือหุ้น และบริบทธุรกิจ',
    '在 ' + BRAND_DOMAIN + ' 查询关联' + c + '的在泰企业，查看公司档案、注册资本、董事或股东线索及商业背景。')
  return {
    title,
    description,
    keywords: [c, seoT(lang, c + ' companies in Thailand', 'บริษัท' + c + 'ในไทย', c + '在泰企业'), seoT(lang, 'foreign company search', 'ค้นหาบริษัททุนต่างชาติ', '外资企业查询'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
// 排行榜筛选组合命中公司数低于这个数,标 noindex(可爬不收录),防止大量近似空列表被当成
// 重复/低质量内容收录——细分组合(某窄行业+某省份+某规模)完全可能命中个位数公司,这不是 bug。
const RANK_NOINDEX_THRESHOLD = 10
// 参数版 /business-leaderboards 的筛选/翻页组合近乎无限;可收录入口只留默认首屏,
// 设计好的扁平精选榜单走 curatedLists。带 metric/industry/province/size/year/page 的变体
// 一律 noindex,并统一 canonical 到无参落地页,避免抓取预算被参数墙吃光。
function leaderboardHasSeoVariant(sp) {
  const metric = (sp.get('metric') || '').trim()
  const page = Math.max(1, parseInt(sp.get('page'), 10) || 1)
  return page > 1 ||
    !!(sp.get('industry') || '').trim() ||
    !!(sp.get('province') || '').trim() ||
    !!(sp.get('size') || '').trim() ||
    !!(sp.get('natCode') || '').trim() ||
    !!(sp.get('year') || '').trim() ||
    (metric && metric !== 'revenue')
}
function leaderboardSeo(sp, data, lang, canonical) {
  const f = (data && data.filters) || {}
  const findName = (list, slug) => { const hit = (list || []).find(x => x.slug === slug); return hit ? flPick(hit.name, lang) : '' }
  const indName = f.industry ? findName(data.industrySections, f.industry) : ''
  const provName = f.province ? findName(data.provinceList, f.province) : ''
  const sizeName = f.sizeCode ? seoT(lang, { S: 'small', M: 'medium', L: 'large' }[f.sizeCode] || '', { S: 'ขนาดเล็ก', M: 'ขนาดกลาง', L: 'ขนาดใหญ่' }[f.sizeCode] || '', { S: '小型', M: '中型', L: '大型' }[f.sizeCode] || '') : ''
  const metricName = seoT(lang, f.metric === 'profitloss' ? 'profit' : f.metric === 'growth' ? 'growth' : 'revenue', f.metric === 'profitloss' ? 'กำไร' : f.metric === 'growth' ? 'การเติบโต' : 'รายได้', f.metric === 'profitloss' ? '利润' : f.metric === 'growth' ? '增长' : '营收')
  const scopeBits = [indName, provName, sizeName].filter(Boolean)
  const scope = scopeBits.length ? scopeBits.join(seoT(lang, ' / ', ' / ', ' / ')) : seoT(lang, 'Thailand', 'ทั่วประเทศ', '全泰')
  const title = seoT(lang,
    scope + ' company ' + metricName + ' ranking',
    'อันดับ' + metricName + 'บริษัท' + (scopeBits.length ? scope : 'ทั่วประเทศ'),
    scope + '企业' + metricName + '排行榜')
  const description = seoT(lang,
    'BizThai-computed ' + metricName + ' ranking for ' + scope + ' companies, based on companies’ own filed financial statements — transparent methodology, not a third-party or DBD-provided rank.',
    'อันดับ' + metricName + 'ของบริษัท' + scope + ' คำนวณโดย BizThai จากงบการเงินที่บริษัทยื่นจริง ไม่ใช่อันดับจากบุคคลที่สามหรือ DBD',
    '基于企业自己提交的财报数据、由 BizThai 自行计算的' + scope + '企业' + metricName + '排行榜——口径透明,不是第三方或 DBD 提供的现成排名。')
  const sparse = !!(data && Number(data.total) > 0 && Number(data.total) < RANK_NOINDEX_THRESHOLD)
  const noindex = sparse || leaderboardHasSeoVariant(sp)
  return {
    title: brandTitle(title),
    description,
    keywords: [scope, metricName, seoT(lang, 'Thailand company ranking', 'อันดับบริษัทไทย', '泰国企业排行'), seoGenericKeywords(lang)],
    canonical,
    lang,
    noindex,
  }
}
function businessSeo(pathname, sp, data, lang, canonical) {
  if (pathname === '/business-leaderboards') return leaderboardSeo(sp, data, lang, canonical)
  const q = (sp.get('q') || '').trim()
  const indName = data && data.crossIndustryName ? flPick(data.crossIndustryName, lang) : ''
  const defs = {
    '/regional-rankings': [
      'Thailand regional company rankings',
      'อันดับบริษัทตามภูมิภาคของไทย',
      '泰国地区企业排行',
      'Compare Thai provinces by company count, registered capital, foreign share and business density on ' + BRAND_DOMAIN + '.',
      'เปรียบเทียบจังหวัดไทยตามจำนวนบริษัท ทุนจดทะเบียน สัดส่วนทุนต่างชาติ และความหนาแน่นทางธุรกิจบน ' + BRAND_DOMAIN,
      '在 ' + BRAND_DOMAIN + ' 对比泰国各府企业数量、注册资本、外资占比和商业活跃度。'
    ],
    '/business-foreign-capital': [
      'Thailand foreign capital company analysis',
      'วิเคราะห์บริษัททุนต่างชาติในไทย',
      '泰国外资企业分析',
      'Explore foreign-linked Thai companies, capital origins, nationality distribution and company leads on ' + BRAND_DOMAIN + '.',
      'สำรวจบริษัทไทยที่เกี่ยวข้องกับทุนต่างชาติ แหล่งทุน สัญชาติ และโอกาสทางธุรกิจบน ' + BRAND_DOMAIN,
      '在 ' + BRAND_DOMAIN + ' 查看泰国外资关联企业、资本来源、国籍分布和公司线索。'
    ],
    '/business-new-registrations': [
      'New company registrations in Thailand',
      'บริษัทจดทะเบียนใหม่ในไทย',
      '泰国新注册公司分析',
      'Track newly registered Thai companies by year, month, province, industry and registered capital on ' + BRAND_DOMAIN + '.',
      'ติดตามบริษัทไทยจดทะเบียนใหม่ตามปี เดือน จังหวัด อุตสาหกรรม และทุนจดทะเบียนบน ' + BRAND_DOMAIN,
      '在 ' + BRAND_DOMAIN + ' 按年份、月份、府、行业和注册资本追踪泰国新注册公司。'
    ],
    '/business-industry-overview': [
      'Thailand industry company overview',
      'ภาพรวมบริษัทตามอุตสาหกรรมในไทย',
      '泰国行业企业概览',
      'Analyze Thai companies by industry section, company count, registration status, capital and leading sectors on ' + BRAND_DOMAIN + '.',
      'วิเคราะห์บริษัทไทยตามหมวดอุตสาหกรรม จำนวนบริษัท สถานะ ทุน และกลุ่มธุรกิจหลักบน ' + BRAND_DOMAIN,
      '在 ' + BRAND_DOMAIN + ' 按行业大类分析泰国公司数量、经营状态、资本规模和重点赛道。'
    ],
    '/business-regional-investment-map': [
      indName ? indName + ' companies by province in Thailand' : 'Thailand business investment map',
      indName ? 'บริษัท' + indName + 'แยกตามจังหวัดในไทย' : 'แผนที่การลงทุนธุรกิจไทย',
      indName ? '泰国' + indName + '企业地区分布' : '泰国商业投资地图',
      indName
        ? 'View ' + indName + ' company distribution by province on ' + BRAND_DOMAIN + ', including capital scale, company count and local business leads.'
        : 'Map Thai company distribution by province on ' + BRAND_DOMAIN + ', including registered capital, company count, industries and investment hotspots.',
      indName
        ? 'ดูการกระจายของบริษัท' + indName + 'ตามจังหวัดบน ' + BRAND_DOMAIN + ' พร้อมขนาดทุน จำนวนบริษัท และโอกาสธุรกิจในพื้นที่'
        : 'ดูแผนที่การกระจายบริษัทไทยตามจังหวัดบน ' + BRAND_DOMAIN + ' พร้อมทุนจดทะเบียน จำนวนบริษัท อุตสาหกรรม และพื้นที่เด่น',
      indName
        ? '在 ' + BRAND_DOMAIN + ' 查看泰国' + indName + '企业按府分布，包含资本规模、公司数量和地区商业线索。'
        : '在 ' + BRAND_DOMAIN + ' 查看泰国企业按府分布地图，包含注册资本、企业数量、行业和投资热点。'
    ],
    '/business-owner-shareholder-leads': [
      q ? 'Shareholder and owner search for ' + q : 'Thailand shareholder and owner leads',
      q ? 'ค้นหาผู้ถือหุ้นและเจ้าของ: ' + q : 'ข้อมูลผู้ถือหุ้นและเจ้าของในไทย',
      q ? '股东/老板搜索：' + q : '泰国股东与老板线索',
      q
        ? 'Search Thai company directors, shareholders and owner leads matching "' + q + '" on ' + BRAND_DOMAIN + ', with linked company profiles and business context.'
        : 'Find Thai company directors, shareholders and owner leads on ' + BRAND_DOMAIN + ', with linked companies, capital signals and profile pages.',
      q
        ? 'ค้นหากรรมการ ผู้ถือหุ้น และเจ้าของบริษัทไทยที่ตรงกับ "' + q + '" บน ' + BRAND_DOMAIN + ' พร้อมบริษัทที่เกี่ยวข้องและบริบทธุรกิจ'
        : 'ค้นหากรรมการ ผู้ถือหุ้น และเจ้าของบริษัทไทยบน ' + BRAND_DOMAIN + ' พร้อมบริษัทที่เกี่ยวข้อง สัญญาณทุน และโปรไฟล์',
      q
        ? '在 ' + BRAND_DOMAIN + ' 搜索匹配“' + q + '”的泰国公司董事、股东和老板线索，查看关联企业档案与商业背景。'
        : '在 ' + BRAND_DOMAIN + ' 查询泰国公司董事、股东和老板线索，查看关联公司、资本信号和企业档案。'
    ],
    '/business-regional-rankings-summary': [
      'Thailand company rankings by province and district',
      'อันดับบริษัทไทยตามจังหวัดและอำเภอ',
      '泰国府县企业排行',
      'Browse Thai companies by province and district on ' + BRAND_DOMAIN + ', with rankings, company counts, registered capital and local company lists.',
      'เรียกดูบริษัทไทยตามจังหวัดและอำเภอบน ' + BRAND_DOMAIN + ' พร้อมอันดับ จำนวนบริษัท ทุนจดทะเบียน และรายชื่อบริษัทในพื้นที่',
      '在 ' + BRAND_DOMAIN + ' 按府和县/区浏览泰国企业排行，查看公司数量、注册资本和地区企业列表。'
    ],
  }
  const d = defs[pathname] || [
    'Thailand business report',
    'รายงานธุรกิจไทย',
    '泰国商业报告',
    'Explore Thai company search, business reports, company profiles and market intelligence on ' + BRAND_DOMAIN + '.',
    'สำรวจการค้นหาบริษัทไทย รายงานธุรกิจ โปรไฟล์บริษัท และข้อมูลเชิงพาณิชย์บน ' + BRAND_DOMAIN,
    '在 ' + BRAND_DOMAIN + ' 使用泰国企业查询、商业报告、公司档案和市场情报工具。'
  ]
  const core = seoT(lang, d[0], d[1], d[2])
  // 2026-07-12:/business-owner-shareholder-leads?q=<人名> 会把搜索词直接嵌进 title/description/keywords
  // (上面 d[0]/d[3]/keywords 里的 q)——这就是"搜股东/董事姓名能搜到这个站"的另一条独立入口,跟公司
  // 详情页那条无关,得单独堵。带 q 时标 noindex,follow(复用既有机制,见 RANK_NOINDEX_THRESHOLD 那处
  // 用法同款):不追查询串的页面继续可收录(搜索功能本身没问题),但每个具体人名查询结果不进索引。
  const ownerSearchNoindex = pathname === '/business-owner-shareholder-leads' && !!q
  return {
    title: brandTitle(core),
    description: seoT(lang, d[3], d[4], d[5]),
    keywords: [core, indName, ownerSearchNoindex ? '' : q, seoT(lang, 'Thai business intelligence', 'ข้อมูลธุรกิจไทย', '泰国商业情报'), seoGenericKeywords(lang)],
    canonical,
    lang,
    noindex: ownerSearchNoindex,
  }
}
function regionDrillSeo(provName, districtName, lang, canonical) {
  const p = cleanMetaText(provName, 80)
  const d = cleanMetaText(districtName, 80)
  if (d) {
    return {
      title: brandTitle(seoT(lang, d + ', ' + p + ' company search', 'ค้นหาบริษัทใน' + d + ' ' + p, p + d + '公司查询')),
      description: seoT(lang,
        'Search companies in ' + d + ', ' + p + ' on ' + BRAND_DOMAIN + ', including local company profiles, registration numbers, registered capital, industries and business activity.',
        'ค้นหาบริษัทใน' + d + ' ' + p + ' บน ' + BRAND_DOMAIN + ' พร้อมโปรไฟล์ เลขทะเบียน ทุนจดทะเบียน อุตสาหกรรม และกิจกรรมธุรกิจ',
        '在 ' + BRAND_DOMAIN + ' 查询' + p + d + '企业，查看当地公司档案、注册号、注册资本、行业和主营业务。'),
      keywords: [p, d, d + ' ' + p, seoT(lang, 'district company search', 'ค้นหาบริษัทตามอำเภอ', '县区公司查询'), seoGenericKeywords(lang)],
      canonical,
      lang,
    }
  }
  return provinceSeo(p, lang, canonical)
}

function renderCompanySSR(meta, raw, lang, jpno, peers, updatedAt, ownerRevisions) {
  const revisions = Array.isArray(ownerRevisions) ? ownerRevisions : []
  const peerList = Array.isArray(peers) ? peers : []
  const dl = (label, val) => { val = val == null ? '' : String(val); return (val && val !== '-') ? '<div class="biz-detail-dl__row"><dt>' + escHtml(label) + '</dt><dd>' + escHtml(val) + '</dd></div>' : '' }
  const card = (title, inner, cls) => (inner && inner.trim()) ? '<div class="biz-detail-card' + (cls ? ' ' + cls : '') + '"><h3>' + escHtml(title) + '</h3><dl class="biz-detail-dl">' + inner + '</dl></div>' : ''
  const capUnit = (v) => { const n = ssrNum(v); return n == null ? '' : ssrFmt(n) + ' ' + LBL(lang, 'currencyUnit') }
  // paidamt 有一批脏数据是32位有符号整数溢出出的负数(源头在 DBD/对端同步系统,非本仓库产生;
  // 例 11,000,000,000 mod 2^32 按有符号整数解释精确等于 -1,884,901,888)。实缴资本不可能为负,
  // 出现负数时回退显示注册资本(未被这个bug污染)作估算值;capamt 也没有时则两处消费点自然留空。
  if (ssrNum(meta.paidamt) < 0) meta.paidamt = meta.capamt
  const _sec = ssrTsicSection(meta.setupobjcode || meta.submitobjcode)
  // 直接落地扁平 canonical URL(而非 /t/industry/tsic-x),避免公司详情页里的「同类企业」链接
  // 落地后被 theme.js convergeUrl() 悄悄 replaceState 到扁平页,致链接文本与实际落地页不一致
  const indUrl = _sec ? '/industry-' + (TSIC_SECTION_ENGSLUG[_sec] || ('tsic-' + _sec)) + '.html' : ''
  // 行业大类编号是本地从 setupobjcode 推算的 TSIC 分段字母,不是上游单独同步的字段,
  // 只在展示时拼到名称后面,不进 industry 变量以外的任何比对逻辑
  const _secLabel = _sec ? ('TSIC-' + _sec.toUpperCase()) : ''
  const _code = String(meta.setupobjcode || meta.submitobjcode || ''), _name = String(meta.setupobjdesce || meta.submitobjdesce || '')
  const subUrl = (/^\d{4,}$/.test(_code) && _name) ? '/t/industry/' + ssrSlugifyIndustry(_name) + '-' + _code : ''
  const subFlatUrl = (/^\d{4,}$/.test(_code) && _name) ? '/industry-' + ssrSlugifyIndustry(_name) + '-' + _code + '.html' : ''
  const _objCode = /^\d{4,}$/.test(_code) ? _code : ''
  const peerChip = (url) => url ? ' <a class="biz-detail-peertag" href="' + escHtml(url) + '">' + escHtml(LBL(lang, 'peerTag')) + '</a>' : ''
  const dlLink = (label, val, url) => { val = val == null ? '' : String(val); return (val && val !== '-') ? '<div class="biz-detail-dl__row"><dt>' + escHtml(label) + '</dt><dd>' + escHtml(val) + peerChip(url) + '</dd></div>' : '' }

  const nameEn = meta.jpnamee || meta.jpName || ''
  const nameTh = meta.jpname || ''
  const mainName = nameEn || nameTh || ssrField(meta, lang, 'name', nameTh, nameEn, meta.jpnamezh)
  const altName = (nameTh && nameTh !== mainName) ? nameTh : ''
  const statusText = ssrField(meta, lang, 'status', meta.status || meta.jpstatdesc, meta.jpstatdesce, meta.statuszh)
  const operating = String(meta.jpstatcode) === '1'
  const province = ssrField(meta, lang, 'province', meta.province, meta.provincee, meta.provincezh)
  const district = ssrField(meta, lang, 'district', meta.ampurdesc, meta.ampurdesce, meta.ampurdesczh)
  const subdistrict = ssrField(meta, lang, 'subdistrict', meta.tumbondesc, meta.tumbondesce, meta.tumbondesczh)
  const addr = ssrField(meta, lang, 'address', meta.address, meta.addresse || meta.address, meta.addresszh)
  const ctype = ssrField(meta, lang, 'companyType', meta.jptypedesc, meta.companytypee || meta.jptypedesce, meta.companytypezh)
  // 行业大类以 TSIC 代码区间为唯一依据。旧 industryGroup i18n 可来自历史 term 关联，
  // 关联尚未刷新时会与代码冲突（例如 71209 被显示成 Manufacturing）。
  const industryName = ssrTsicSectionLabel(_sec, lang) || ssrField(meta, lang, 'industryGroup', meta.setupobjgrpdesc, meta.setupobjgrpdesce, meta.setupobjgrpdesczh)
  const industry = industryName ? (_secLabel ? industryName + ' (' + _secLabel + ')' : industryName) : industryName
  // 面包屑行业名优先用 TSIC 细类名(setupobjdesc*),不用会员可改的 objective_* 长文案
  const subclassName = ssrPick(lang, meta.setupobjdesc || meta.submitobjdesc, meta.setupobjdesce || meta.submitobjdesce, meta.setupobjdesczh || meta.submitobjdesczh)
  const crumbIndustryName = subclassName || industryName
  const crumbIndustryUrl = subFlatUrl || indUrl
  const provEng = ssrSlugifyIndustry(meta.provincee || '')
  const crumbProvinceUrl = provEng ? '/' + provEng + '.html' : ''
  const bizcat = ssrPick(lang, meta.businesstypedesc, meta.businesstypedesce, meta.businesstypedesczh)
  const objective = (meta.objective_th || meta.objective_en || meta.objective_zh)
    ? ssrPick(lang, meta.objective_th, meta.objective_en, meta.objective_zh)
    : ssrField(meta, lang, 'objective', meta.setupobjdesc || meta.submitobjdesc, meta.setupobjdesce || meta.submitobjdesce, meta.setupobjdesczh || meta.submitobjdesczh)
  const sizeCode = String(meta.businesssizecode || meta.businessSizeCode || '').toUpperCase()
  const sizeText = SSR_SIZE[sizeCode] ? (SSR_SIZE[sizeCode][lang] || SSR_SIZE[sizeCode].en) : ''
  const region = [subdistrict, district, province].filter(Boolean).join(' · ')
  const fullAddr = [addr, region, meta.zipcode].filter(Boolean).join(', ')

  const factsArr = [
    [LBL(lang, 'registrationNo'), jpno, false, ''],
    [LBL(lang, 'companyType'), ctype, false, ''],
    [LBL(lang, 'industry'), industry, false, indUrl],
    [LBL(lang, 'address'), fullAddr, true, ''],
  ]
  const facts = factsArr.map(f => f[1] ? '<li' + (f[2] ? ' class="is-wide"' : '') + '><span>' + escHtml(f[0]) + '</span><strong>' + escHtml(f[1]) + peerChip(f[3]) + '</strong></li>' : '').join('')
  const badge = '<span class="biz-detail-badge ' + (operating ? 'is-ok' : 'is-muted') + '"><i class="biz-detail-dot" aria-hidden="true"></i>' + escHtml(statusText || '-') + '</span>'

  // 认领会员编辑提示:objective 具体是从 objective_zh/en/th 三者哪一个来的,才去查那一个字段
  // 有没有被认领会员改过且改的值还是现在这个(不是笼统查"objective 有没有被改过")
  const objectiveFieldName = ['objective_zh', 'objective_en', 'objective_th'].find(f => meta[f] === objective) || ''
  const businessEditedAt = ssrFindEditedAt(revisions, objectiveFieldName, objective)
  const businessEditNote = businessEditedAt ? '<p class="biz-detail-editnote">' + escHtml(faqT(lang, 'ownerEditNote', { date: ssrEditNoteDate(lang, businessEditedAt) })) + '</p>' : ''
  const businessHtml = objective ? '<div class="biz-detail-block biz-detail-block--lead"><h3>' + escHtml(LBL(lang, 'businessActivity')) + '</h3><p class="biz-detail-block__lead">' + escHtml(objective + (_objCode ? ' (TSIC-' + _objCode + ')' : '')) + '</p>' + businessEditNote + '</div>' : ''

  let profileHtml = '<div class="biz-detail-grid">'
  profileHtml += card(LBL(lang, 'overview'),
    dl(LBL(lang, 'nameTh'), nameTh) + dl(LBL(lang, 'nameEn'), nameEn) +
    dl(LBL(lang, 'status'), statusText) + dl(LBL(lang, 'companySize'), sizeText) +
    dlLink(LBL(lang, 'industry'), industry, indUrl))
  profileHtml += card(LBL(lang, 'registeredAddress'),
    dl(LBL(lang, 'address'), addr) + dl(LBL(lang, 'region'), region) + dl(LBL(lang, 'zipcode'), meta.zipcode))
  // 2026-07-27:联系方式登录锁已打开——电话/邮箱/传真对访客公开(不再要求登录或认领核验)。
  // 认领会员改过且仍生效时,仍附「认领后修改」提示。
  const phoneVerifiedAt = ssrFindEditedAt(revisions, 'phoneno', meta.phoneno)
  const emailVerifiedAt = ssrFindEditedAt(revisions, 'email', meta.email)
  const faxVerifiedAt = ssrFindEditedAt(revisions, 'faxno', meta.faxno)
  let contact = meta.phoneno ? dl(LBL(lang, 'phone'), meta.phoneno) : ''
  if (meta.email) contact += '<div class="biz-detail-dl__row"><dt>' + escHtml(LBL(lang, 'email')) + '</dt><dd>' + escHtml(meta.email) + '</dd></div>'
  for (const w of ['website1', 'website2', 'website3', 'website4']) {
    const u = meta[w]
    if (u) { const href = /^https?:/i.test(u) ? u : ('http://' + u); contact += '<div class="biz-detail-dl__row"><dt>' + escHtml(LBL(lang, 'website')) + '</dt><dd><a href="' + escHtml(href) + '" target="_blank" rel="noopener nofollow">' + escHtml(u) + '</a></dd></div>' }
  }
  if (meta.faxno) contact += dl(LBL(lang, 'fax'), meta.faxno)
  const contactEditedAt = [
    phoneVerifiedAt,
    emailVerifiedAt,
    ssrFindEditedAt(revisions, 'website1', meta.website1),
  ].filter(Boolean).sort().pop() || ''
  const contactEditNote = contactEditedAt ? '<p class="biz-detail-editnote">' + escHtml(faqT(lang, 'ownerEditNote', { date: ssrEditNoteDate(lang, contactEditedAt) })) + '</p>' : ''
  const contactHtml = card(LBL(lang, 'contact'), contact) + contactEditNote
  // 供 theme.js 客户端读取(公开值;有则注入)
  const contactPhoneVerifiedVal = meta.phoneno || ''
  const contactEmailVerifiedVal = meta.email || ''
  const contactFaxVerifiedVal = meta.faxno || ''
  profileHtml += card(LBL(lang, 'registrationDetails'),
    dl(LBL(lang, 'registeredCapital'), capUnit(meta.capamt)) + dl(LBL(lang, 'paidCapital'), capUnit(meta.paidamt)) +
    dl(LBL(lang, 'shares'), meta.shareqty ? ssrFmt(meta.shareqty) : '') + dl(LBL(lang, 'regDate'), ssrDualDate(lang, meta.regdate)) +
    dl(LBL(lang, 'financialYear'), ssrDualYear(lang, meta.finyear)) + dl(LBL(lang, 'lastUpdated'), ssrDualDate(lang, updatedAt)), 'biz-detail-card--muted')
  profileHtml += '</div>'

  let finHtml = ''
  // 财务趋势卡 SSR 兜底(爬虫/无 JS 可见):与 theme.js renderFinancial 同源数据(raw.financialStatements),
  // 结构对齐但不含「查看完整报表」跳转链接(纯展示,无 JS 交互;客户端渲染时会整块覆盖这个容器)。
  const fs = raw.financialStatements || {}
  const fsYears = Array.isArray(fs.years) ? fs.years.map(String).sort().reverse() : []
  const fsAnnual = fs.annualData || {}
  // DBD 数据每年都预置一整套字段(占位年份也有,值全是 null),不能用「有没有 key」判断这年是否真的有数据——
  // 必须检查营收/利润/资产这三个头条字段里是否至少一个是真实数字。
  const FS_HEADLINE_FIELDS = ['revenue', 'profitloss', 'assets']
  const yearHasHeadlineData = (y) => { const rec = fsAnnual[y]; return !!rec && FS_HEADLINE_FIELDS.some(f => ssrNum(rec[f]) != null) }
  let fsLatest = null
  for (const y of fsYears) { if (yearHasHeadlineData(y)) { fsLatest = y; break } }
  if (fsLatest) {
    const rec = fsAnnual[fsLatest]
    const chartYears = fsYears.slice().reverse().filter(yearHasHeadlineData)
    const nYears = chartYears.length
    const ce = ssrBeYear(fsLatest)
    const yearLbl = ce == null ? fsLatest : String(lang === 'th' ? ce + 543 : ce)
    const trendCards = [
      { field: 'revenue', label: LBL(lang, 'revenue') },
      { field: 'profitloss', label: LBL(lang, 'netProfitLoss') },
      { field: 'assets', label: LBL(lang, 'totalAssets') }
    ].map(c => {
      const v = ssrNum(rec[c.field])
      const pc = ssrNum(rec[c.field + 'Pc'])
      const tone = (c.field === 'profitloss' && v != null) ? (v >= 0 ? ' is-pos' : ' is-neg') : ''
      let yoyHtml = ''
      if (pc != null && pc !== 0) {
        const ycls = pc > 0 ? 'is-up' : 'is-down'
        yoyHtml = '<div class="biz-fin-trendcard__yoy ' + ycls + '"><span class="biz-fin-trendcard__arrow">' + (pc > 0 ? '▲' : '▼') + '</span> ' + escHtml(LBL(lang, 'yoy')) + ' ' + escHtml(ssrFmt(Math.abs(pc))) + '%</div>'
      }
      let chartHtml = ''
      if (nYears > 1) {
        const pts = chartYears.map(y => ({ y: ssrNum((fsAnnual[y] || {})[c.field]) }))
        const spark = ssrSparkline(pts)
        if (spark) {
          chartHtml = '<p class="biz-fin-trendcard__chartcap">' + escHtml(LBL(lang, 'finTrendCaption').replace('{label}', c.label).replace('{n}', String(nYears)).replace('{unit}', LBL(lang, 'currencyUnit'))) + '</p>' +
            '<div class="biz-spark-wrap">' + spark + '</div>'
        }
      }
      return '<div class="biz-fin-trendcard">' +
        '<div class="biz-fin-trendcard__head">' + escHtml(LBL(lang, 'finCardHead').replace('{label}', c.label).replace('{y}', yearLbl).replace('{unit}', LBL(lang, 'currencyUnit'))) + '</div>' +
        '<strong class="biz-fin-trendcard__value' + tone + '">' + (v == null ? '-' : escHtml(ssrFmt(Math.round(v)))) + '</strong>' +
        yoyHtml + chartHtml + '</div>'
    }).join('')
    finHtml = '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(LBL(lang, 'financialRecords')) + '</h2></div>' +
      '<div class="biz-fin-trend-grid">' + trendCards + '</div></div>'
  } else {
    // 兜底1:无 financialStatements 结构但仍有扁平字段(历史数据)时,保留旧的单年 4 项列表展示
    const finItems = [[LBL(lang, 'revenue'), meta.totalincome], [LBL(lang, 'netProfit'), meta.netprofit], [LBL(lang, 'totalAssets'), meta.totalasset], [LBL(lang, 'equity'), meta.totalequity]]
    if (finItems.some(it => ssrNum(it[1]) != null)) {
      finHtml = '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(LBL(lang, 'financialRecords')) + '</h2></div>' +
        '<p class="biz-detail-fin-note">' + escHtml(LBL(lang, 'latestFinancials')) + (meta.finyear ? ' · ' + escHtml(ssrDualYear(lang, meta.finyear)) : '') + '</p>' +
        '<dl class="biz-detail-dl">' +
        finItems.map(it => ssrNum(it[1]) != null ? dl(it[0], ssrFmt(it[1]) + ' ' + LBL(lang, 'currencyUnit')) : '').join('') + '</dl></div>'
    } else {
      // 兜底2:彻底没有财务数据 → 展示空态卡片(与 theme.js renderTrendGrid 的 !latest 分支一致),不隐藏整个模块
      const emptyCards = [LBL(lang, 'revenue'), LBL(lang, 'netProfitLoss'), LBL(lang, 'totalAssets')]
        .map(label => '<div class="biz-fin-trendcard is-empty"><div class="biz-fin-trendcard__head">' + escHtml(label) + '</div><p class="biz-fin-trendcard__empty">' + escHtml(LBL(lang, 'finNoData')) + '</p></div>')
        .join('')
      finHtml = '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(LBL(lang, 'financialRecords')) + '</h2></div>' +
        '<div class="biz-fin-trend-grid">' + emptyCards + '</div></div>'
    }
  }

  let dirHtml = ''
  const coms = Array.isArray(raw.committees) ? raw.committees : []
  const dirSigns = Array.isArray(raw.signCommittees) ? raw.signCommittees : []
  // jpNations(股权国籍数据)与 committees(董事名录)是两个独立字段——有的公司只有前者没有后者
  // (如刚推送测试数据的样例:0 名登记董事但有真实股权构成),两块内容各自独立判断是否渲染,
  // 不能把国籍构成模块嵌套在"有没有董事"的判断里面(嵌套过一版,导致零董事公司的真实股权数据被吞掉)
  const capBreakdown = jpNationsBreakdown(lang, raw.jpNations)
  const dirBreakdown = capBreakdown.length ? capBreakdown : nationalityBreakdown(lang, coms)
  const isCapMode = capBreakdown.length > 0
  let natHtml = ''
  if (dirBreakdown.length) {
    const natRows = dirBreakdown.map(b => {
      const extraCol = isCapMode ? ('<td>' + (b.shareVol != null ? escHtml(ssrFmt(b.shareVol)) : '-') + '</td><td>' + (b.shareAmt != null ? escHtml(ssrFmt(b.shareAmt)) : '-') + '</td>') : ('<td>' + escHtml(String(b.count)) + '</td>')
      return '<tr><td>' + escHtml(b.flag) + ' ' + escHtml(b.name) + '</td>' + extraCol + '<td>' + (b.pct != null ? escHtml(String(b.pct)) + '%' : '-') + '</td></tr>'
    }).join('')
    const headCols = isCapMode
      ? ('<th>' + escHtml(LBL(lang, 'natTableNat')) + '</th><th>' + escHtml(LBL(lang, 'capTableShares')) + '</th><th>' + escHtml(LBL(lang, 'capTableValue')) + '</th><th>' + escHtml(LBL(lang, 'natTablePct')) + '</th>')
      : ('<th>' + escHtml(LBL(lang, 'natTableNat')) + '</th><th>' + escHtml(LBL(lang, 'natTableCount')) + '</th><th>' + escHtml(LBL(lang, 'natTablePct')) + '</th>')
    natHtml = '<div class="biz-detail-block biz-dir-nat"><h3>' + escHtml(LBL(lang, isCapMode ? 'capBreakdownTitle' : 'natBreakdownTitle')) + '</h3>' +
      '<p class="biz-frp__note">' + escHtml(LBL(lang, isCapMode ? 'capBreakdownNote' : 'natBreakdownNote')) + '</p>' +
      ssrNationalityBar(dirBreakdown) +
      '<table class="biz-dir-nat__table"><thead><tr>' + headCols + '</tr></thead><tbody>' + natRows + '</tbody></table></div>'
  }
  // 历年泰籍/外籍持股比例趋势(2026-07-04 从「数据分析」tab 挪过来,和现状构成放在一起对比更直观)
  const shareTrend = ssrShareHistTrend(meta)
  let trendHtml = ''
  if (shareTrend.length) {
    const compactTable = isCapMode
      ? ('<table class="biz-dir-nat__table"><thead><tr><th>' + escHtml(LBL(lang, 'natTableNat')) + '</th><th>' + escHtml(LBL(lang, 'capTableValue')) + '</th><th>' + escHtml(LBL(lang, 'natTablePct')) + '</th></tr></thead><tbody>' +
        capBreakdown.map(b => '<tr><td>' + escHtml(b.flag) + ' ' + escHtml(b.name) + '</td><td>' + (b.shareAmt != null ? escHtml(ssrFmt(b.shareAmt)) : '-') + '</td><td>' + (b.pct != null ? escHtml(String(b.pct)) + '%' : '-') + '</td></tr>').join('') +
        '</tbody></table>')
      : ''
    trendHtml = '<div class="biz-detail-block biz-share-trend-block"><h3>' + escHtml(LBL(lang, 'shareTrendTitle')) + '</h3>' +
      '<p class="biz-frp__note">' + escHtml(LBL(lang, 'shareTrendNote')) + '</p>' +
      '<div class="biz-share-trend__body">' + compactTable + ssrShareTrendBars(lang, shareTrend) + '</div></div>'
  }
  // 2026-07-12:董事姓名列表默认不服务端渲染——姓名一旦出现在 SSR 输出里就是搜索引擎能收录的纯
  // 文本,谷歌搜"某个董事/股东的姓名"会直接搜到这家公司(董事姓名本身是登记档案信息、给真人看不
  // 违规,但不该被搜索引擎按人名索引到)。natHtml/trendHtml 是聚合数据,不含个人身份,不受影响。
  // 同日再收紧:认领会员可以针对自己公司在会员中心把 meta.directorsPublic 设为 true/false——
  // true(认领会员明确选择公开)时这条数据已经是本人同意公开,不再受"不能被搜索引擎索引"这条限制,
  // 直接 SSR 出全量姓名(参照联系方式那条先例:认领核验过的值可以正常出现在 SSR 里);
  // false(认领会员明确选择隐藏)时不管有没有 committees 数据,统一显示"企业主已隐藏"提示,
  // 底层数据一概不渲染;未设置过(undefined,多数公司)保持"SSR 不渲染姓名,交给客户端按登录态处理"。
  // directorsPublic 是三态字符串('public'/'hidden'/未设置),不是布尔——member center 那张
  // 认领编辑表单一次性提交全部可编辑字段,如果这里用布尔+checkbox,认领会员哪怕只是去改电话号码,
  // 表单里这个字段的 checkbox 也会跟着一起提交(默认未勾选=false),不知不觉把"未设置"状态
  // 悄悄改成"明确选择隐藏"——三态字符串 + <select> 才能让"没碰过这个设置"这件事持续为真。
  const directorsPublic = meta.directorsPublic === 'public'
  const directorsHiddenByOwner = meta.directorsPublic === 'hidden'
  let dirListHtml = ''
  // 2026-07-12 改:'hidden' 不是整段不渲染,是把姓名打码后照常渲染卡片(国籍/签字权限/更新日期这些
  // 非姓名字段原样保留)——跟 'public' 走同一套卡片构建逻辑,只是姓名部分从"原样输出"换成
  // "先过 ssrMaskName() 再输出"。两种情况都要展示,所以合并成一次遍历,用 mask 布尔量控制是否打码。
  if ((directorsPublic || directorsHiddenByOwner) && coms.length) {
    // 外籍董事排在前面(分组+高亮);排序只影响展示顺序,detail 链接的 seq 兜底仍用各自原始下标
    const indexed = coms.map((c, i) => ({ c, i }))
    indexed.sort((a, b) => {
      const af = (a.c.ntCode && a.c.ntCode !== 'TH') ? 0 : 1
      const bf = (b.c.ntCode && b.c.ntCode !== 'TH') ? 0 : 1
      return af - bf
    })
    const rows = indexed.map(({ c, i }) => {
      const th = [c.titleName, c.firstName, c.middleName, c.lastName].map(x => String(x || '').trim()).filter(Boolean).join(' ')
      const en = [c.titleNameE, c.firstNameE, c.middleNameE, c.lastNameE].map(x => String(x || '').trim()).filter(Boolean).join(' ')
      let primary = lang === 'th' ? (th || en) : (en || th)
      if (!primary) return ''
      let sub = lang === 'th' ? (en && en !== primary ? en : '') : (th && th !== primary ? th : '')
      if (directorsHiddenByOwner) { primary = ssrMaskName(primary); sub = sub ? ssrMaskName(sub) : '' }
      const seq = String(c.cmtSeq != null ? c.cmtSeq : (i + 1))
      const nat = nationalityInfo(lang, c.ntCode)
      const isForeign = nat && nat.code !== 'TH'
      const badges = (nat ? '<span class="biz-entcard__nat">' + escHtml(nat.flag) + ' ' + escHtml(nat.name) + '</span>' : '') +
        (hasSignAuthority(th, en, dirSigns) ? '<span class="biz-entcard__tag biz-entcard__tag--sign">' + escHtml(LBL(lang, 'signAuthorityBadge')) + '</span>' : '')
      const updRaw = c.updateDate
      const updStr = (Array.isArray(updRaw) && updRaw[0] && updRaw[1] && updRaw[2])
        ? String(updRaw[0]).padStart(4, '0') + '-' + String(updRaw[1]).padStart(2, '0') + '-' + String(updRaw[2]).padStart(2, '0')
        : (updRaw || '')
      const cardMeta = [updStr ? (escHtml(LBL(lang, 'lastUpdated')) + '：' + escHtml(ssrDualDate(lang, updStr))) : ''].filter(Boolean).map(m => '<span>' + m + '</span>').join('')
      // 打码状态下也不再链到独立董事反查页——那个页面本身还是全量姓名,链过去等于绕开了这里的打码
      const nameSpan = '<span class="biz-entcard__name">' + escHtml(primary) + '</span>' + (sub ? '<span class="biz-entcard__sub">' + escHtml(sub) + '</span>' : '') + (cardMeta ? '<span class="biz-entcard__meta">' + cardMeta + '</span>' : '')
      return directorsHiddenByOwner
        ? '<div class="biz-entcard' + (isForeign ? ' is-foreign' : '') + '">' + (badges ? '<span class="biz-entcard__top">' + badges + '</span>' : '') + nameSpan + '</div>'
        : '<a class="biz-entcard' + (isForeign ? ' is-foreign' : '') + '" href="/director-' + escHtml(jpno) + '-' + escHtml(seq) + '.html">' + (badges ? '<span class="biz-entcard__top">' + badges + '</span>' : '') + nameSpan + '</a>'
    }).join('')
    if (rows) dirListHtml = '<div class="biz-detail-block"><h3>' + escHtml(LBL(lang, 'registeredDirectors')) + '</h3><div class="biz-entlist">' + rows + '</div></div>' +
      '<p class="biz-detail-editnote">' + escHtml(LBL(lang, directorsHiddenByOwner ? 'ownerHiddenNotice' : 'ownerPublicNotice')) + '</p>'
  }
  dirHtml = natHtml + trendHtml + dirListHtml

  // ── 补采字段一期(2026-07-03):曾用名史/增减资史/证券牌照,均 meta 顶层、稀疏、增量铺开 ──
  // 没有对应键或数组为空的公司整段不渲染,不报错(见 详情页补采字段渲染-TODO.md)。
  const ssrArrKey = (a) => (Array.isArray(a) && a[0] && a[1] && a[2])
    ? String(a[0]).padStart(4, '0') + '-' + String(a[1]).padStart(2, '0') + '-' + String(a[2]).padStart(2, '0')
    : null
  const ssrArrDate = (a) => (Array.isArray(a) && a[0] && a[1] && a[2])
    ? ssrDualDate(lang, String(a[0]).padStart(4, '0') + '-' + String(a[1]).padStart(2, '0') + '-' + String(a[2]).padStart(2, '0'))
    : ''

  // extSecLic 形状未经真实数据验证(生产现存样本全是空数组),按同源字段的通用记录形态兜底渲染:
  // 过滤已知的内部字段(jpNo/rowNo/seqNo 全局重复),日期数组按 [y,m,d] 处理,其余标量按 key 人肉可读化展示。
  let secLicHtml = ''
  const secLics = Array.isArray(meta.extSecLic) ? meta.extSecLic : []
  if (secLics.length) {
    const SKIP_KEYS = ['jpNo', 'rowNo', 'seqNo']
    const humanize = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, s => s.toUpperCase())
    const leaf = (v) => {
      if (Array.isArray(v)) return ssrArrDate(v)
      if (v == null || v === '' || typeof v === 'object') return ''
      return String(v)
    }
    const cards = secLics.map((it, i) => {
      if (!it || typeof it !== 'object') return ''
      const rows = Object.keys(it).filter(k => !SKIP_KEYS.includes(k)).map(k => dl(humanize(k), leaf(it[k]))).join('')
      return card(LBL(lang, 'license') + ' #' + (i + 1), rows)
    }).filter(Boolean).join('')
    if (cards) secLicHtml = '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(LBL(lang, 'secLicenses')) + '</h2></div><div class="biz-detail-grid">' + cards + '</div></div>'
  }

  // extTrademarks(2026-07-04 新增,来自 raw.extTrademarks,契约见 ingest/src/db.js RAW_PATCH_FIELDS 注释:
  // 数组,元素形如 {tr_no/reg_no/fil_date/reg_date/exp_date/status/pic/product[]}。目前生产没有非空真实
  // 样本验证过(精确 jpNo 查询、大范围抽样都只见过空数组),日期按数组([y,m,d])或字符串两种形态兜底解析;
  // pic(商标图样)字段形状未知暂不渲染,等真实非空样本出现再核实。
  let tmHtml = ''
  const trademarks = Array.isArray(raw.extTrademarks) ? raw.extTrademarks : []
  if (trademarks.length) {
    const tmDate = (v) => Array.isArray(v) ? ssrArrDate(v) : (v == null || v === '' ? '' : ssrDualDate(lang, String(v)))
    const cards = trademarks.map((tm, i) => {
      if (!tm || typeof tm !== 'object') return ''
      const headline = tm.tr_no || tm.reg_no || (LBL(lang, 'trademarks') + ' #' + (i + 1))
      const otherNo = (tm.tr_no && tm.reg_no && tm.reg_no !== headline) ? tm.reg_no : ''
      const products = Array.isArray(tm.product) ? tm.product.map(p => (p && typeof p === 'object') ? String(p.name || p.desc || '') : String(p || '')).filter(Boolean).join(', ') : ''
      const rows = dl(LBL(lang, 'tmRegNo'), otherNo) + dl(LBL(lang, 'tmFilDate'), tmDate(tm.fil_date)) +
        dl(LBL(lang, 'tmRegDate'), tmDate(tm.reg_date)) + dl(LBL(lang, 'tmExpDate'), tmDate(tm.exp_date)) +
        dl(LBL(lang, 'tmStatus'), tm.status) + dl(LBL(lang, 'tmProduct'), products)
      // card() 要求至少一行内容才渲染(和 nameHist/capHist/secLic 一致的兜底约定),但商标只要有
      // tr_no/reg_no 任一个编号本身就已经是有意义的信息,不能因为其它字段全空就整条丢弃
      if (!rows && !tm.tr_no && !tm.reg_no) return ''
      return rows ? card(String(headline), rows) : '<div class="biz-detail-card"><h3>' + escHtml(String(headline)) + '</h3></div>'
    }).filter(Boolean).join('')
    if (cards) tmHtml = '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escHtml(LBL(lang, 'trademarks')) + '</h2></div><div class="biz-detail-grid">' + cards + '</div></div>'
  }

  // ── 变更记录 tab(2026-07-04 三期改版):曾用名/增减资/并购/改制不再按数据类型分段摆放,
  // 而是合并成一条按日期排序的竖直时间轴(creden.co 风格)。并购/改制字段形状未见真实非空样本验证过,
  // 沿用 ssrGenericRecords 的通用 key-value 兜底渲染,只是外层包装换成时间轴卡片。
  // 董事变更/业务类型变更历史 DBD 源数据目前不提供(只有现状快照,没有变更前后+日期),不在本时间轴内。
  const jnc = (meta.jpNationCharts && typeof meta.jpNationCharts === 'object') ? meta.jpNationCharts : {}
  const TIMELINE_ICONS = {
    name: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    capital: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    merger: '<path d="M17 3v6l3 3-3 3v6"/><path d="M7 3v6l-3 3 3 3v6"/>',
    transform: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  }
  const timelineNode = (type) => '<div class="biz-timeline__node biz-timeline__node--' + escHtml(type) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (TIMELINE_ICONS[type] || TIMELINE_ICONS.name) + '</svg></div>'

  const timelineEntries = []

  const nameHists = Array.isArray(meta.nameHists) ? meta.nameHists : []
  nameHists.forEach(h => {
    const name = lang === 'th' ? (h.jpNewName || h.jpNewNameE) : (h.jpNewNameE || h.jpNewName)
    if (!name) return
    const sub = lang === 'th' ? (h.jpNewNameE && h.jpNewNameE !== name ? h.jpNewNameE : '') : (h.jpNewName && h.jpNewName !== name ? h.jpNewName : '')
    const ev = lang === 'th' ? (h.seqDesc || h.seqDescE) : (h.seqDescE || h.seqDesc)
    const cardHtml = '<span class="biz-timeline__title">' + escHtml(name) + '</span>' +
      (sub ? '<span class="biz-timeline__sub">' + escHtml(sub) + '</span>' : '') +
      (ev ? '<span class="biz-timeline__event">' + escHtml(ev) + '</span>' : '')
    timelineEntries.push({
      dateKey: ssrArrKey(h.changeDate) || ssrArrKey(h.updateDate),
      dateLabel: ssrArrDate(h.changeDate) || ssrArrDate(h.updateDate),
      type: 'name', badgeLabel: LBL(lang, 'nameHistory'), cardHtml, showBadge: true,
    })
  })

  const capHists = Array.isArray(meta.capitalHists) ? meta.capitalHists : []
  capHists.forEach(c => {
    const ev = (lang === 'th' ? (c.seqDesc || c.seqDescE) : (c.seqDescE || c.seqDesc)) || LBL(lang, 'capitalHistory')
    const newCap = ssrNum(c.newCapAmt), prevCap = ssrNum(c.previousCapAmt), delta = ssrNum(c.incDecAmt)
    const headline = newCap != null ? newCap : prevCap
    if (headline == null) return
    const changeRow = (newCap != null && prevCap != null)
      ? '<span class="biz-timeline__change"><span class="biz-timeline__before">฿' + escHtml(ssrFmt(prevCap)) + '</span><span class="biz-timeline__arrow" aria-hidden="true">→</span><span class="biz-timeline__after">฿' + escHtml(ssrFmt(headline)) + '</span></span>'
      : '<span class="biz-timeline__after">฿' + escHtml(ssrFmt(headline)) + '</span>'
    const deltaTag = delta != null
      ? '<span class="biz-timeline__delta ' + (delta >= 0 ? 'is-up' : 'is-down') + '">' + (delta >= 0 ? '+' : '') + escHtml(ssrFmt(delta)) + ' ' + escHtml(LBL(lang, 'currencyUnit')) + '</span>' : ''
    const cardHtml = '<span class="biz-timeline__title">' + escHtml(ev) + '</span>' + changeRow + deltaTag
    timelineEntries.push({
      dateKey: ssrArrKey(c.changeDate) || ssrArrKey(c.updateDate),
      dateLabel: ssrArrDate(c.changeDate) || ssrArrDate(c.updateDate),
      type: 'capital', badgeLabel: LBL(lang, 'capitalHistory'), cardHtml, showBadge: true,
    })
  })

  const pushGenericTimelineEntries = (arr, type, badgeLabel) => {
    if (!Array.isArray(arr)) return
    arr.forEach(it => {
      if (!it || typeof it !== 'object') return
      const cardHtml = ssrGenericRecords(lang, [it], badgeLabel)
      if (!cardHtml) return
      timelineEntries.push({
        dateKey: ssrArrKey(it.changeDate) || ssrArrKey(it.updateDate),
        dateLabel: ssrArrDate(it.changeDate) || ssrArrDate(it.updateDate),
        type, badgeLabel, cardHtml, showBadge: false,
      })
    })
  }
  pushGenericTimelineEntries(jnc.mergerFroms, 'merger', LBL(lang, 'mergerFromHeading'))
  pushGenericTimelineEntries(jnc.mergerTos, 'merger', LBL(lang, 'mergerToHeading'))
  pushGenericTimelineEntries(jnc.transformFroms, 'transform', LBL(lang, 'transformFromHeading'))
  pushGenericTimelineEntries(jnc.transformTos, 'transform', LBL(lang, 'transformToHeading'))

  let changesHtml = ''
  if (timelineEntries.length) {
    const dated = timelineEntries.filter(e => e.dateKey).sort((a, b) => a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0)
    const undated = timelineEntries.filter(e => !e.dateKey)
    const renderItem = (e, isLast) => '<div class="biz-timeline__item' + (isLast ? ' is-last' : '') + (e.dateKey ? '' : ' is-dateless') + '">' +
      timelineNode(e.type) +
      '<div class="biz-timeline__body">' +
      (e.dateLabel ? '<div class="biz-timeline__date">' + escHtml(e.dateLabel) + '</div>' : '') +
      '<div class="biz-timeline__card">' + (e.showBadge ? '<span class="biz-timeline__badge">' + escHtml(e.badgeLabel) + '</span>' : '') + e.cardHtml + '</div>' +
      '</div></div>'
    const datedHtml = dated.map((e, i) => renderItem(e, i === dated.length - 1 && !undated.length)).join('')
    const undatedHtml = undated.length
      ? '<div class="biz-timeline__undated-head">' + escHtml(LBL(lang, 'changeDateUnknown')) + '</div>' + undated.map((e, i) => renderItem(e, i === undated.length - 1)).join('')
      : ''
    changesHtml = '<div class="biz-timeline">' + datedHtml + undatedHtml + '</div>'
  } else {
    changesHtml = '<div class="biz-detail-empty">' + escHtml(LBL(lang, 'changesEmpty')) + '</div>'
  }

  // ── 分析 tab(2026-07-03 二期):55 条 customChart 曲线,jpNationCharts/basicFinCharts 同 key 取并集
  // (同名键两边都可能非空,以先出现非空数组的一侧为准)──
  const jncCC = (jnc.customChart && typeof jnc.customChart === 'object') ? jnc.customChart : {}
  const bfc = (meta.basicFinCharts && typeof meta.basicFinCharts === 'object') ? meta.basicFinCharts : {}
  const bfcCC = (bfc.customChart && typeof bfc.customChart === 'object') ? bfc.customChart : {}
  const anaSeries = {}
  for (const k of Object.keys(jncCC)) { if (Array.isArray(jncCC[k]) && jncCC[k].length) anaSeries[k] = jncCC[k] }
  for (const k of Object.keys(bfcCC)) { if (!anaSeries[k] && Array.isArray(bfcCC[k]) && bfcCC[k].length) anaSeries[k] = bfcCC[k] }
  // 2026-07-04:8 组指标改回独立的「财务数据」tab(当天早些时候合并进「登记档案」又被撤回)——
  // 3 卡趋势图 + 市场地位排名继续留在「登记档案」不动(finHtml,市场地位是纯客户端渲染,不在这里),
  // 这里只是 8 组比率分析,tab 整体可能为空,需要兜底文案
  let analyticsHtml = SSR_ANALYTICS_GROUPS.map(g => ssrAnalyticsGroup(lang, LBL(lang, g.titleKey), g.metrics, anaSeries)).filter(Boolean).join('')
  if (!analyticsHtml) analyticsHtml = '<div class="biz-detail-empty">' + escHtml(LBL(lang, 'financialDataEmpty')) + '</div>'

  const titleText = (lang === 'th' ? (nameTh || mainName) : mainName) + ' · ' + jpno

  // ── 常见问题(FAQ):答案全部由上面已算好的结构化字段模板拼出,不调用大模型——
  // 零成本、瞬时生成,可覆盖全量公司;某类数据缺失时对应问题自动不出现。下面一共定义了 18 种
  // 问题,cap 按这个总数设(而不是拍脑袋的小数字),避免财务类"干"字段把营业范围/董事/联系方式/
  // 同类企业这些更有内容的问题挤出去(第一版曾用 12,被资料齐全的公司实测占满,教训记在这)。
  // AI 归纳类问题(财务趋势叙述、主营业务改写)按 2026-07-01 讨论定为二期,先不做。
  const faqName = lang === 'th' ? (nameTh || mainName) : mainName
  const faqVars = { name: faqName }
  const faqItems = []
  const pushFaq = (qKey, aHtml) => { if (aHtml) faqItems.push({ q: faqT(lang, qKey, faqVars), aHtml, aText: stripHtmlText(aHtml) }) }

  if (meta.regdate) pushFaq('faqEstablishedQ', escHtml(faqT(lang, 'faqEstablishedA', { name: faqName, date: ssrDualDate(lang, meta.regdate), status: statusText || '-' })))
  if (jpno) pushFaq('faqRegNoQ', escHtml(faqT(lang, 'faqRegNoA', { name: faqName, jpno })))
  if (ctype) pushFaq('faqTypeQ', escHtml(faqT(lang, 'faqTypeA', { name: faqName, ctype })))
  if (fullAddr) pushFaq('faqAddressQ', escHtml(faqT(lang, 'faqAddressA', { name: faqName, addr: fullAddr })))
  if (sizeText) pushFaq('faqSizeQ', escHtml(faqT(lang, 'faqSizeA', { name: faqName, size: sizeText })))
  if (nameEn && nameTh && nameEn !== nameTh) pushFaq('faqNameQ', escHtml(faqT(lang, 'faqNameA', { name: faqName, nameEn, nameTh })))
  if (updatedAt) pushFaq('faqUpdatedQ', escHtml(faqT(lang, 'faqUpdatedA', { name: faqName, date: ssrDualDate(lang, updatedAt) })))

  const capStr = capUnit(meta.capamt)
  if (capStr) {
    let a = faqT(lang, 'faqCapitalA', { name: faqName, cap: capStr })
    const paidStr = capUnit(meta.paidamt)
    if (paidStr) a += faqT(lang, 'faqCapitalPaidExtra', { paid: paidStr })
    pushFaq('faqCapitalQ', escHtml(a))
  }
  if (ssrNum(meta.shareqty) != null) pushFaq('faqSharesQ', escHtml(faqT(lang, 'faqSharesA', { name: faqName, shares: ssrFmt(meta.shareqty) })))

  // ── 财务类 FAQ 的取数口径(2026-07-23 修复)──
  // 原实现无条件读 meta.totalincome/netprofit/totalasset/totalequity 这组遗留扁平字段。问题是:
  // 这组字段全项目 0 处写入(早期导入流程留下的,之后再没更新过),而 meta.finyear 仍由 sync/mapping.py
  // 每天同步更新 → 「新年份标签 + 旧金额」被拼进同一句 FAQ,与上方财务卡片(读 raw.financialStatements)
  // 直接矛盾。实测全库 654,210 家有财年标签的公司中,293,907 家(44.9%)两处对不上。
  // 现改为与财务卡片同源:优先取 financialStatements 中最新「有头条数据」的年份(fsLatest,同一函数上方
  // 已按 FS_HEADLINE_FIELDS 筛出);仅当该结构完全缺失时才回落到遗留字段——那种情况下上方卡片走的也是
  // 同一组遗留字段的「兜底1」分支,两处依然自洽。
  const faqFinRec = fsLatest ? (fsAnnual[fsLatest] || {}) : null
  const faqFinYear = fsLatest || meta.finyear
  const faqFinVal = (fsField, legacyVal) => faqFinRec ? ssrNum(faqFinRec[fsField]) : ssrNum(legacyVal)

  const revenueNum = faqFinVal('revenue', meta.totalincome)
  if (revenueNum != null) pushFaq('faqRevenueQ', escHtml(faqT(lang, 'faqRevenueA', { name: faqName, revenue: ssrFmt(revenueNum) + ' ' + LBL(lang, 'currencyUnit'), finyear: ssrDualYear(lang, faqFinYear) })))

  const profitNum = faqFinVal('profitloss', meta.netprofit)
  if (profitNum != null) {
    const pKey = profitNum >= 0 ? 'faqProfitPosA' : 'faqProfitNegA'
    pushFaq('faqProfitQ', escHtml(faqT(lang, pKey, { name: faqName, profit: ssrFmt(Math.abs(profitNum)) + ' ' + LBL(lang, 'currencyUnit') })))
  }

  const assetsNum = faqFinVal('assets', meta.totalasset), equityNum = faqFinVal('equity', meta.totalequity)
  if (assetsNum != null || equityNum != null) {
    const av = { name: faqName, assets: assetsNum != null ? ssrFmt(assetsNum) + ' ' + LBL(lang, 'currencyUnit') : '', equity: equityNum != null ? ssrFmt(equityNum) + ' ' + LBL(lang, 'currencyUnit') : '' }
    const aKey = (assetsNum != null && equityNum != null) ? 'faqAssetsBothA' : (assetsNum != null ? 'faqAssetsAssetOnlyA' : 'faqAssetsEquityOnlyA')
    pushFaq('faqAssetsQ', escHtml(faqT(lang, aKey, av)))
  }

  if (objective) pushFaq('faqBusinessQ', escHtml(faqT(lang, 'faqBusinessA', { name: faqName, objective })))
  if (industry) pushFaq('faqIndustryQ', escHtml(faqT(lang, 'faqIndustryA', { name: faqName, industry })) + peerChip(indUrl))

  // 2026-07-12:FAQ 问答文本(含 JSON-LD FAQPage,二者必须逐字一致,见 companySeo 里的注释)默认
  // 不再列出董事姓名——搜索引擎会把这段文本当成人名可索引内容,搜"股东/董事姓名"能直接搜到这家
  // 公司(董事姓名本身不违规,但不该被搜索引擎按人名收录)。同日再收紧:directorsPublic==='public'
  // 时(认领会员明确选择公开)恢复带姓名的版本,已经是本人同意公开;==='hidden'(明确选择打码)
  // 时姓名列表改成打码后的版本,不链到独立董事反查页(那个页面本身是全量姓名,链过去等于绕开打码);
  // 未设置时只保留人数,姓名列表(不管打码与否)都去掉。
  if ((directorsPublic || directorsHiddenByOwner) && coms.length) {
    const dirNames = coms.slice(0, 8).map((c, i) => {
      const th2 = [c.titleName, c.firstName, c.middleName, c.lastName].map(x => String(x || '').trim()).filter(Boolean).join(' ')
      const en2 = [c.titleNameE, c.firstNameE, c.middleNameE, c.lastNameE].map(x => String(x || '').trim()).filter(Boolean).join(' ')
      let primary = lang === 'th' ? (th2 || en2) : (en2 || th2)
      if (!primary) return ''
      if (directorsHiddenByOwner) return escHtml(ssrMaskName(primary))
      const seq = String(c.cmtSeq != null ? c.cmtSeq : (i + 1))
      return '<a href="/director-' + escHtml(jpno) + '-' + escHtml(seq) + '.html">' + escHtml(primary) + '</a>'
    }).filter(Boolean)
    if (dirNames.length) pushFaq('faqDirectorsQ', escHtml(faqT(lang, 'faqDirectorsPublicA', { name: faqName, count: coms.length })) + ' ' + dirNames.join(lang === 'zh' ? '、' : ', '))
  } else if (coms.length) {
    pushFaq('faqDirectorsQ', escHtml(faqT(lang, 'faqDirectorsA', { name: faqName, count: coms.length })))
  }

  const contactBits = []
  if (phoneVerifiedAt) contactBits.push(escHtml(LBL(lang, 'phone')) + ' ' + escHtml(meta.phoneno))
  if (emailVerifiedAt && meta.email) contactBits.push(escHtml(LBL(lang, 'email')) + ' ' + escHtml(meta.email))
  for (const w of ['website1', 'website2', 'website3', 'website4']) {
    const u = meta[w]
    if (u) { const href = /^https?:/i.test(u) ? u : ('http://' + u); contactBits.push('<a href="' + escHtml(href) + '" target="_blank" rel="noopener nofollow">' + escHtml(u) + '</a>'); break }
  }
  if (contactBits.length) pushFaq('faqContactQ', escHtml(faqT(lang, 'faqContactIntro', { name: faqName })) + ' ' + contactBits.join('; '))

  if (peerList.length) {
    const peerNames = peerList.slice(0, 5).map(m => {
      const en2 = m.jpnamee || ''
      const nm = lang === 'th' ? (m.jpname || en2) : (lang === 'zh' ? (m.jpnamezh || en2 || m.jpname) : (en2 || m.jpname))
      if (!nm) return ''
      return '<a href="' + escHtml(ownerHref(m.jpno, en2)) + '">' + escHtml(nm) + '</a>'
    }).filter(Boolean)
    if (peerNames.length) pushFaq('faqPeersQ', escHtml(faqT(lang, 'faqPeersIntro', { name: faqName })) + ' ' + peerNames.join(lang === 'zh' ? '、' : ', '))
  }

  pushFaq('faqSourceQ', escHtml(faqT(lang, 'faqSourceA', { name: faqName, date: ssrDualDate(lang, updatedAt || meta.regdate) })))

  const faqCapped = faqItems.slice(0, 18)
  let faqHtml = ''
  if (faqCapped.length) {
    const faqRows = faqCapped.map((it, i) =>
      '<details class="biz-detail-faq__item"' + (i < 2 ? ' open' : '') + '><summary class="biz-detail-faq__q"><span class="biz-detail-faq__q-text">' + escHtml(it.q) + '</span></summary><div class="biz-detail-faq__a"><p>' + it.aHtml + '</p></div></details>'
    ).join('')
    faqHtml = '<div class="biz-detail-faq__head"><h2 class="biz-detail-faq__title">' + escHtml(faqT(lang, 'faqSectionTitle', faqVars)) + '</h2></div><div class="biz-detail-faq__grid">' + faqRows + '</div>'
  }
  const faqPairs = faqCapped.map(it => ({ q: it.q, a: it.aText }))

  // 面包屑:首页 / 公司名录 / 行业类目 / 所属府 / 公司名。行业优先细类,缺省回退大类;府用语本地化名。
  // 链接带当前语言前缀(/zh|/th),避免中/泰文页点进英文无前缀路径。
  const crumbLp = localePrefixOf(lang)
  const crumbSep = '<span aria-hidden="true">/</span>'
  const crumbLink = (href, label, attr) => '<a href="' + escHtml(crumbLp + href) + '"' + (attr ? ' ' + attr : '') + '>' + escHtml(label) + '</a>'
  const crumbBits = [
    crumbLink('/', LBL(lang, 'home'), 'data-crumb="home"'),
    crumbSep,
    crumbLink('/companies', LBL(lang, 'directory'), 'data-crumb="directory"'),
  ]
  if (crumbIndustryName && crumbIndustryUrl) {
    crumbBits.push(crumbSep, crumbLink(crumbIndustryUrl, crumbIndustryName, 'data-crumb="industry"'))
  }
  if (province && crumbProvinceUrl) {
    crumbBits.push(crumbSep, crumbLink(crumbProvinceUrl, province, 'data-crumb="province"'))
  }
  crumbBits.push(crumbSep, '<span data-crumb="current">' + escHtml(mainName || jpNo) + '</span>')
  const breadcrumbHtml = '<nav class="biz-detail-breadcrumb" aria-label="Breadcrumb" data-detail-breadcrumb>' + crumbBits.join('') + '</nav>'

  return { mainName, altName, badge, facts, businessHtml, profileHtml, contactHtml, finHtml, dirHtml, secLicHtml, tmHtml, changesHtml, analyticsHtml, titleText, leadText: objective, faqHtml, faqPairs, breadcrumbHtml, contactEditedAt, businessEditedAt, contactPhoneVerifiedVal, contactEmailVerifiedVal, contactFaxVerifiedVal }
}

// ── 同府同业 SEO 内链模块(详情页底部;按(段,府)缓存 10min,共享给同组所有公司)──
const peersCache = new Map()
async function samePeersCached(indId, provId, jpNo) {
  if (!indId || !provId) return []
  const key = indId + '|' + provId
  const hit = peersCache.get(key)
  if (!hit || Date.now() - hit.at >= 600000) {
    const peers = await samePeers(indId, provId, 24, '')
    if (peersCache.size > 1000) peersCache.clear()
    peersCache.set(key, { at: Date.now(), peers })
    return peers.filter(m => m.jpno && m.jpno !== jpNo).slice(0, 20)
  }
  return hit.peers.filter(m => m.jpno && m.jpno !== jpNo).slice(0, 20)
}
function renderPeersSSR(peers, lang) {
  if (!peers || !peers.length) return ''
  const cards = peers.map(m => {
    const en = m.jpnamee || ''
    const name = lang === 'th' ? (m.jpname || en) : (lang === 'zh' ? (m.jpnamezh || en || m.jpname) : (en || m.jpname))
    if (!name) return ''
    const obj = lang === 'th' ? (m.setupobjdesc || m.setupobjdesce) : (lang === 'zh' ? (m.setupobjdesczh || m.setupobjdesce) : (m.setupobjdesce || m.setupobjdesc))
    const cap = ssrNum(m.capamt)
    const metaHtml = [
      obj ? '<span class="biz-entcard__desc">' + escHtml(obj) + '</span>' : '',
      cap == null ? '' : '<span><span class="biz-entcard__cap-label">' + escHtml(LBL(lang, 'registeredCapital')) + '：</span>฿' + escHtml(ssrFmt(cap)) + '</span>'
    ].filter(Boolean).join('')
    return '<a class="biz-entcard" href="' + escHtml(ownerHref(m.jpno, en)) + '"><span class="biz-entcard__name">' + escHtml(name) + '</span>' + (metaHtml ? '<span class="biz-entcard__meta">' + metaHtml + '</span>' : '') + '</a>'
  }).join('')
  if (!cards) return ''
  return '<div class="biz-detail-block"><h3>' + escHtml(LBL(lang, 'peersHeading')) + '</h3><div class="biz-entlist">' + cards + '</div></div>'
}

// 浏览量:识别爬虫/非真人 UA(这些不计入"X 人看过",也不显示)。空 UA 视为非真人。
function isBotUA(ua) {
  if (!ua) return true
  return /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|embedly|bingpreview|yandex|baidu|sogou|duckduck|whatsapp|telegram|skypeuripreview|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|headless|phantom|python|curl|wget|axios|okhttp|go-http|java\//i.test(ua)
}

// 浏览量从可缓存 HTML 中拆出：浏览器在详情数据加载完成后 POST 当前 .html?__view=1。
// 同一 IP + 公司 30 分钟内只计一次，既防刷新刷量，也让 nginx 对普通 GET 的页面缓存保持稳定。
const VIEW_DEDUPE_TTL_MS = 30 * 60 * 1000
const viewDedupe = new Map()
function viewClientKey(req, jpNo) {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return (forwarded || req.socket.remoteAddress || 'unknown') + '|' + jpNo
}
function readRequestJson(req, maxBytes = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(Object.assign(new Error('invalid json'), { statusCode: 400 })) }
    })
    req.on('error', e => { if (!settled) { settled = true; reject(e) } })
  })
}
function sendViewJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  })
  res.end(data == null ? '' : JSON.stringify(data))
}
async function serveCompanyView(req, res, url) {
  if (req.method !== 'POST' || url.searchParams.get('__view') !== '1' || !/\.html$/i.test(url.pathname)) return false
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
    req.resume()
    sendViewJson(res, 403, { error: 'forbidden' })
    return true
  }
  if (isBotUA(req.headers['user-agent'])) {
    req.resume()
    sendViewJson(res, 204, null)
    return true
  }
  let payload
  try { payload = await readRequestJson(req) }
  catch (e) { if (!res.headersSent) sendViewJson(res, e.statusCode || 400, { error: e.message }); return true }
  const pathJpNo = await resolveJpNo(url.pathname)
  const payloadJpNo = String(payload && payload.jpno || '')
  const entryId = Number(payload && payload.entryId)
  if (!pathJpNo || payloadJpNo !== String(pathJpNo) || !Number.isSafeInteger(entryId) || entryId <= 0) {
    sendViewJson(res, 400, { error: 'invalid company' })
    return true
  }
  const key = viewClientKey(req, pathJpNo)
  const previous = viewDedupe.get(key)
  if (previous && Date.now() - previous.at < VIEW_DEDUPE_TTL_MS) {
    sendViewJson(res, 200, { views: previous.views, counted: false })
    return true
  }
  try {
    const views = await bumpCompanyViews(pathJpNo, entryId)
    if (!Number.isFinite(views) || views <= 0) throw new Error('view counter unavailable')
    if (viewDedupe.size >= 100000) viewDedupe.delete(viewDedupe.keys().next().value)
    viewDedupe.set(key, { at: Date.now(), views })
    sendViewJson(res, 200, { views, counted: true })
  } catch (e) {
    console.error('[resolver] company view increment failed:', e && e.message)
    sendViewJson(res, 503, { error: 'view counter unavailable' })
  }
  return true
}

// ── 企业微站(microsite CPT):独立品牌化主页,无 header/footer,只挂右下角 Powered by BizThai 徽标 ──
// 与公司详情页(thaicompany)同构:壳来自 WooCMS 按 permalink_pattern(/b2b-{slug})渲染的
// single-microsite.html,数据来自公开只读 API,repeater 字段(products/services/...)同样绕不开
// <wc-data> 无法在单条目详情页循环嵌套数组的限制,靠这里正则注入空 data-panel div。
function resolveMicrosite(pathname) {
  const m = pathname.match(/^(?:\/(?:zh|th))?\/b2b-([a-z0-9-]+)\.html$/i)
  return m ? m[1] : null
}

// 三个更具体的 /b2b-… 变体必须排在上面这个"裸首页"判定之前(见调度处注释)——
// 首页正则的捕获组本身宽松到能吃下 "xxx-profile"/"xxx-products"/"xxx-product-yyy" 这种整段,
// 谁先判定谁生效。
function resolveMicrositeProfile(pathname) {
  const m = pathname.match(/^(?:\/(?:zh|th))?\/b2b-(.+)-profile\.html$/i)
  return m ? m[1] : null
}
function resolveMicrositeProducts(pathname) {
  const m = pathname.match(/^(?:\/(?:zh|th))?\/b2b-(.+)-products\.html$/i)
  return m ? m[1] : null
}
function resolveMicrositeProduct(pathname) {
  const m = pathname.match(/^(?:\/(?:zh|th))?\/b2b-(.+)-product-([a-z0-9-]+)\.html$/i)
  return m ? { slug: m[1], productSlug: m[2] } : null
}

const MICROSITE_ICONS = {
  website: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 8h-2a2 2 0 0 0-2 2v2H9v3h2v5h3v-5h2l1-3h-3v-1a1 1 0 0 1 1-1h2z"/></svg>',
  line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A9 9 0 0 1 8 19l-4 1 1.2-3.6A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.9 3a8.4 8.4 0 0 1 8.1 8.5z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A9 9 0 0 1 8 19l-4 1 1.2-3.6A8.3 8.3 0 0 1 4 11.5 8.4 8.4 0 0 1 12.9 3a8.4 8.4 0 0 1 8.1 8.5z"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>',
}

// 微站四个独立页面(首页/公司档案/产品分类/产品详情)共用的数据装配——只抓一次企业微站条目 +
// 关联的 thaicompany 条目,推导出所有页面都要用到的品牌色/注册信息/产品-服务-资质-动态-来源列表/
// 联系渠道,以及"产品详情页"用的 slug(按产品名派生,同名兜底加序号)。四个 serve* 只管拼各自的 HTML。
async function loadMicrositeContext(slug, req) {
  const ent = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/models/microsite/entries/' + encodeURIComponent(slug), { accept: 'application/json', host: (req.headers && req.headers.host) || 'bizthai.com' })
  let meta = null, title = '', updatedAt = ''
  if (ent && ent.body) { try { const j = JSON.parse(ent.body); const d = j && j.data ? j.data : null; if (d) { meta = d.meta || {}; title = d.title || ''; updatedAt = d.updated_at || '' } } catch { /* ignore */ } }
  if (!meta) return null

  const g = (k) => (meta[k] == null ? '' : String(meta[k]))
  const hexOr = (v, fallback) => (/^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback)
  const brandDeep = hexOr(g('brand-deep'), '#2b3648')
  const brandAccent = hexOr(g('brand-accent'), '#f0a531')
  const brandAccentInk = hexOr(g('brand-accent-ink'), '#b9660b')

  // 成立年份/所在地/注册地址与「泰国企业」(thaicompany)同源,不在 microsite 后台重复维护——
  // 有 jpno 就按注册号抓关联企业条目现取,取不到(未关联/尚未入库)则这几项留空,不做人工兜底字段。
  let foundedYear = '', factoryLocation = '', addressLine = '', companyHref = ''
  const jpno = g('jpno')
  if (jpno) {
    try {
      const cr = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/models/thaicompany/entries/' + encodeURIComponent(jpno), { accept: 'application/json', host: (req.headers && req.headers.host) || 'bizthai.com' })
      if (cr && cr.body) {
        const cj = JSON.parse(cr.body)
        const companyEntry = (cj && cj.data) || null
        const cm = (companyEntry && companyEntry.meta) || null
        if (companyEntry && companyEntry.id) companyHref = await companyCanonicalPath(companyEntry.id)
        if (cm) {
          foundedYear = /^\d{4}/.test(String(cm.regdate || '')) ? String(cm.regdate).slice(0, 4) : ''
          factoryLocation = String(cm.provincee || cm.province || '')
          addressLine = [cm.addresse || cm.address, cm.ampurdesce || cm.ampurdesc, cm.provincee || cm.province].filter(Boolean).join(', ') + (cm.zipcode ? ' ' + cm.zipcode : '') + (cm.addresse || cm.address ? ', Thailand' : '')
        }
      }
    } catch { /* 关联企业抓取失败不影响微站主体渲染 */ }
  }
  if (!companyHref && jpno && title) {
    const companySlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (companySlug) {
      try {
        const matchedJpno = await resolveSlug(companySlug)
        if (matchedJpno === jpno) companyHref = '/' + companySlug + '.html'
      } catch { /* 名称无法解析时继续使用注册号兼容地址 */ }
    }
  }
  if (!companyHref && jpno) companyHref = '/' + encodeURIComponent(jpno) + '.html'
  const companyClaimHref = companyHref ? companyHref + (companyHref.includes('?') ? '&' : '?') + 'claimopen=1' : '/search'

  const products = Array.isArray(meta.products) ? meta.products : []
  const services = Array.isArray(meta.services) ? meta.services : []
  const certifications = Array.isArray(meta.certifications) ? meta.certifications : []
  const news = Array.isArray(meta.news) ? meta.news : []
  const sources = Array.isArray(meta.sources) ? meta.sources : []

  const channels = []
  if (g('website-url')) channels.push(['Website', g('website-url'), MICROSITE_ICONS.website])
  if (g('facebook-url')) channels.push(['Facebook', g('facebook-url'), MICROSITE_ICONS.facebook])
  if (g('line-id')) channels.push(['LINE', 'https://line.me/ti/p/~' + g('line-id').replace(/^@/, ''), MICROSITE_ICONS.line])
  if (g('whatsapp-number')) channels.push(['WhatsApp', 'https://wa.me/' + g('whatsapp-number').replace(/[^0-9]/g, ''), MICROSITE_ICONS.whatsapp])
  if (g('wechat-id')) channels.push(['WeChat: ' + g('wechat-id'), '#', MICROSITE_ICONS.wechat])
  const phoneLabel = g('whatsapp-number') || (g('line-id') ? 'LINE ' + g('line-id') : 'Online inquiry')
  const inquiryHref = g('whatsapp-number')
    ? 'https://wa.me/' + g('whatsapp-number').replace(/[^0-9]/g, '')
    : (g('line-id') ? 'https://line.me/ti/p/~' + g('line-id').replace(/^@/, '') : (g('website-url') || g('facebook-url') || ('/b2b-' + slug + '-profile.html#contact')))

  const slugifyName = (name, fallbackIdx) => {
    const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return s || ('product-' + (fallbackIdx + 1))
  }
  const productSlugs = products.map((p, i) => slugifyName(p.name, i))
  const seenSlug = {}
  for (let i = 0; i < productSlugs.length; i++) {
    const base = productSlugs[i]
    seenSlug[base] = (seenSlug[base] || 0) + 1
    if (seenSlug[base] > 1) productSlugs[i] = base + '-' + seenSlug[base]
  }

  const disclaimerParts = ['此页面内容由 <a href="/" rel="nofollow">BizThai AI</a> 检索' + (sources.length ? ' ' + sources.length + ' 条' : '') + ' 公开网络信息自动生成']
  if (updatedAt) disclaimerParts.push('更新于 ' + updatedAt.slice(0, 10))
  const disclaimer = disclaimerParts.join('，') + '，可能与企业实际情况存在偏差，不构成官方工商记录。'

  return {
    slug, meta, title, updatedAt, jpno, g,
    brandDeep, brandAccent, brandAccentInk,
    foundedYear, factoryLocation, addressLine, companyHref, companyClaimHref,
    products, services, certifications, news, sources, channels,
    phoneLabel, inquiryHref,
    productSlugs, disclaimer,
    homeHref: '/b2b-' + slug + '.html',
    productsHref: '/b2b-' + slug + '-products.html',
    profileHref: '/b2b-' + slug + '-profile.html',
    productHref: (i) => '/b2b-' + slug + '-product-' + productSlugs[i] + '.html',
  }
}

// ── 独立页面(公司档案/产品分类/产品详情)共用的轻量页面壳:不依赖 WooCMS 主题壳,
// 整页 HTML 由本文件直接拼装(与 serveDirectorPage 等纯 resolver 渲染页同一手法),
// 只在 <head>/nav/footer 里复用与首页一致的品牌变量与视觉语言。
const MICROSITE_SUBPAGE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 13px/1.6 Arial, "Segoe UI", "PingFang SC", "Noto Sans Thai", "Microsoft YaHei", sans-serif; color: #444; background: #f3f3f3; }
  a { color: inherit; text-decoration: none; }
  svg { display: block; }
  .msite__container { width: min(100% - 32px, 1060px); margin: 0 auto; }
  .msite__utility { height: 32px; color: #888; background: #fafafa; border-bottom: 1px solid #e8e8e8; font-size: 11px; }
  .msite__utility .msite__container { height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
  .msite__utility-actions { height: 100%; display: flex; align-items: center; gap: 18px; }
  .msite__utility-links { display: flex; gap: 24px; }
  .msite__utility a:hover { color: var(--site-accent-ink); }
  .msite__language { height: 100%; display: flex; align-items: center; gap: 2px; padding-left: 12px; border-left: 1px solid #e2e2e2; }
  .msite__language button { min-width: 36px; height: 24px; padding: 0 7px; color: #777; background: transparent; border: 0; border-radius: 3px; cursor: pointer; font-size: 10px; }
  .msite__language button:hover { color: var(--site-accent-ink); background: #eef5fd; }
  .msite__language button.is-active { color: #fff; background: var(--site-deep); font-weight: 700; }
  #google_translate_element_msite, body > .skiptranslate, .goog-te-banner-frame { display: none !important; }
  body { top: 0 !important; }
  font font { position: initial !important; background: transparent !important; box-shadow: none !important; }
  .msite__brandbar { background: #fff; }
  .msite__brandbar .msite__container { min-height: 100px; display: flex; align-items: center; gap: 16px; }
  .msite__brandmark { width: 58px; height: 58px; flex: none; display: grid; place-items: center; color: #fff; font-size: 17px; font-weight: 800; letter-spacing: -.04em; border-radius: 50%; background: radial-gradient(circle at 50% 50%, var(--site-accent) 0 31%, transparent 32%), repeating-radial-gradient(circle, transparent 0 7px, rgba(255,255,255,.55) 8px 9px), var(--site-deep); border: 3px solid var(--site-accent); box-shadow: inset 0 0 0 2px #fff; }
  .msite__brandcopy { min-width: 0; margin-right: auto; }
  .msite__brandname { color: #2d2d2d; font-size: 22px; line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; }
  .msite__brandtag { max-width: 620px; margin-top: 5px; color: #777; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .msite__header-actions { flex: none; display: flex; align-items: center; gap: 12px; }
  .msite__contact-card { min-width: 190px; display: flex; align-items: center; gap: 10px; padding: 8px 13px; background: #fafafa; border: 1px solid #e7e7e7; border-radius: 5px; }
  .msite__contact-icon { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #e42323; font-size: 17px; transform: rotate(-18deg); }
  .msite__contact-copy { min-width: 0; }
  .msite__contact-copy small { display: flex; align-items: center; gap: 5px; color: #888; font-size: 10px; line-height: 1.2; }
  .msite__contact-copy small::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #36a852; }
  .msite__contact-copy strong { max-width: 210px; display: block; margin-top: 3px; color: #333; font-size: 14px; line-height: 1.2; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .msite__claim { min-height: 52px; display: flex; flex-direction: column; justify-content: center; padding: 8px 16px; color: #fff; background: var(--site-deep); border-radius: 5px; box-shadow: 0 4px 10px rgba(10,48,80,.14); white-space: nowrap; transition: transform .15s, filter .15s; }
  .msite__claim:hover { transform: translateY(-1px); filter: brightness(1.08); }
  .msite__claim strong { font-size: 12px; }
  .msite__claim small { margin-top: 1px; color: rgba(255,255,255,.7); font-size: 9px; }
  .msite__nav { color: #fff; background: var(--site-deep); }
  .msite__navlinks { width: max-content; display: flex; }
  .msite__navlinks a { min-height: 42px; display: grid; place-items: center; padding: 0 28px; border-left: 1px solid rgba(255,255,255,.07); font-size: 13px; font-weight: 700; text-align: center; white-space: nowrap; }
  .msite__navlinks a:last-child { border-right: 1px solid rgba(255,255,255,.07); }
  .msite__navlinks a:hover, .msite__navlinks a.is-active { background: var(--site-accent); }
  .msite__breadcrumb { width: min(100% - 32px, 1060px); min-height: 36px; margin: 0 auto; display: flex; align-items: center; gap: 8px; color: #999; font-size: 11px; }
  .msite__breadcrumb a:hover { color: var(--site-accent-ink); }
  .msite__pagehead, .msite__section { width: min(100% - 32px, 1060px); margin: 0 auto 14px; padding: 20px; background: #fff; border: 1px solid #e2e2e2; }
  .msite__pagehead { border-top: 3px solid var(--site-deep); }
  .msite__eyebrow { margin-bottom: 7px; color: var(--site-accent-ink); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .msite__h1 { margin: 0 0 9px; color: #333; font-size: clamp(23px, 3.2vw, 30px); line-height: 1.3; }
  .msite__lead { max-width: 76ch; margin: 0; color: #666; font-size: 13px; line-height: 1.8; }
  .msite__h2 { margin: -20px -20px 16px; padding: 10px 14px; border-bottom: 1px solid #e5e5e5; color: #333; font-size: 16px; }
  .msite__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
  .msite__card { overflow: hidden; background: #fff; border: 1px solid #e4e4e4; }
  .msite__card a.msite__card-link { display: block; }
  .msite__thumb { height: 118px; position: relative; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, #f5f7f9 0 54%, #e7edf2 55%); }
  .msite__thumb::before { content: ""; position: absolute; width: 70px; height: 70px; border-radius: 50%; background: repeating-radial-gradient(circle, var(--site-deep) 0 5px, var(--site-accent) 6px 9px, #f5f5f5 10px 12px); box-shadow: 0 7px 14px rgba(10,48,80,.18); }
  .msite__thumb svg { display: none; }
  .msite__card-body { padding: 10px 12px; }
  .msite__card-name { color: #444; font-size: 12px; font-weight: 700; }
  .msite__card-desc { margin: 5px 0 0; color: #888; font-size: 10px; line-height: 1.55; }
  .msite__card-tag { display: inline-block; margin-top: 7px; color: var(--site-accent-ink); font-size: 9px; }
  .msite__facts { display: flex; gap: 12px 28px; flex-wrap: wrap; margin-top: 17px; }
  .msite__fact { min-width: 135px; }
  .msite__fact span { display: block; color: #999; font-size: 10px; text-transform: uppercase; }
  .msite__fact strong { color: #555; font-size: 13px; }
  .msite__services { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
  .msite__srow { display: flex; gap: 12px; align-items: flex-start; padding: 13px 0; border-top: 1px dotted #ddd; }
  .msite__srow:first-child { border-top: 0; padding-top: 0; }
  .msite__srow-num { flex: none; color: var(--site-accent-ink); font-size: 12px; font-weight: 800; }
  .msite__srow-name { font-size: 12px; font-weight: 700; }
  .msite__srow-desc { margin-top: 3px; color: #888; font-size: 10px; }
  .msite__certs { display: flex; gap: 10px; flex-wrap: wrap; }
  .msite__cert { display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px; border: 1px solid #ddd; background: #fafafa; color: #666; font-size: 11px; font-weight: 700; }
  .msite__cert svg { width: 13px; height: 13px; color: #2e9c4b; flex: none; }
  .msite__news { display: grid; gap: 9px; }
  .msite__news-item { display: grid; grid-template-columns: 82px 1fr; gap: 12px; }
  .msite__news-date { color: #999; font-size: 10px; }
  .msite__news-title { font-size: 12px; }
  .msite__news-src { color: var(--site-accent-ink); font-size: 10px; }
  .msite__empty { color: #999; font-size: 12px; }
  .msite__cta { display: inline-flex; margin-top: 20px; padding: 9px 17px; color: #fff; background: var(--site-deep); font-size: 12px; font-weight: 700; }
  .msite__footer { margin-top: 28px; color: #a8b4c3; background: #0b1726; border-top: 4px solid var(--site-accent); }
  .msite__footer-main { display: grid; grid-template-columns: minmax(280px, 1.7fr) minmax(120px, .65fr) minmax(140px, .75fr) minmax(190px, 1fr); gap: 38px; padding: 44px 0 36px; }
  .msite__footer-brandrow { display: flex; align-items: center; gap: 12px; }
  .msite__footer-mark { width: 44px; height: 44px; flex: none; display: grid; place-items: center; color: #07101c; background: var(--site-accent); border-radius: 6px; font-size: 12px; font-weight: 800; }
  .msite__footer-brand { color: #fff; font-size: 16px; line-height: 1.35; font-weight: 700; }
  .msite__footer-tagline { margin-top: 3px; color: #718095; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
  .msite__footer-addr { max-width: 43ch; margin-top: 16px; color: #8290a3; font-size: 11px; line-height: 1.75; }
  .msite__footer-title { margin: 0 0 14px; color: #fff; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
  .msite__footer-links { display: grid; gap: 9px; }
  .msite__footer-links a { width: max-content; max-width: 100%; color: #94a2b4; font-size: 11px; }
  .msite__footer-links a:hover { color: var(--site-accent); }
  .msite__footer-contact { margin: 0 0 12px; color: #c4ccd6; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
  .msite__social { display: flex; flex-wrap: wrap; gap: 7px; }
  .msite__social a { width: 32px; height: 32px; display: grid; place-items: center; color: #cbd4df; background: #152438; border: 1px solid #26374d; border-radius: 4px; }
  .msite__social a:hover { color: #07101c; background: var(--site-accent); border-color: var(--site-accent); }
  .msite__social a svg { width: 14px; height: 14px; }
  .msite__footer-claim { width: max-content; display: inline-flex; margin-top: 13px; padding: 8px 12px; color: #fff; border: 1px solid #3a4d65; border-radius: 4px; font-size: 10px; font-weight: 700; }
  .msite__footer-claim:hover { color: #07101c; background: var(--site-accent); border-color: var(--site-accent); }
  .msite__footer-bottom { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 28px; padding: 18px 0 24px; border-top: 1px solid #1d2b3e; }
  .msite__finetext { max-width: 82ch; margin: 0; color: #657389; font-size: 9px; line-height: 1.7; }
  .msite__finetext a { color: #a9b5c5; font-weight: 700; }
  .msite__footer-meta { color: #657389; font-size: 9px; white-space: nowrap; }
  .msite__servicebar { position: fixed; z-index: 20; top: 138px; right: 0; width: 136px; background: #fff; border: 1px solid #ddd; box-shadow: 0 2px 12px rgba(0,0,0,.08); text-align: center; }
  .msite__servicebar-head { padding: 8px; color: #fff; background: #287ee4; font-size: 11px; font-weight: 700; }
  .msite__servicebar-body { padding: 14px 10px; }
  .msite__servicebar small { color: #888; }
  .msite__service-phone { margin: 8px 0 12px; color: #333; font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
  .msite__service-btn { display: block; padding: 7px; color: #fff; background: #2b80e7; font-size: 11px; }
  .poweredby { position: fixed; right: 15px; bottom: 14px; z-index: 40; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 6px; background: rgba(255,255,255,.94); border: 1px solid #ddd; box-shadow: 0 3px 10px rgba(0,0,0,.13); color: #555; font-size: 10px; }
  .poweredby__mark { width: 18px; height: 18px; display: grid; place-items: center; background: #651a9b; color: #fff; font-weight: 800; }
  @media (max-width: 1320px) { .msite__servicebar { display: none; } }
  @media (max-width: 720px) {
    .msite__container, .msite__breadcrumb, .msite__pagehead, .msite__section { width: min(100% - 20px, 1060px); }
    .msite__utility-links, .msite__contact-copy small { display: none; }
    .msite__brandbar .msite__container { min-height: 78px; }
    .msite__brandmark { width: 46px; height: 46px; font-size: 14px; }
    .msite__brandname { font-size: 17px; }
    .msite__brandtag { max-width: 50vw; }
    .msite__header-actions { gap: 7px; }
    .msite__contact-card { min-width: 0; padding: 6px 9px; }
    .msite__contact-icon { width: 30px; height: 30px; }
    .msite__contact-copy strong { max-width: 120px; margin-top: 0; font-size: 12px; }
    .msite__claim { min-height: 44px; padding: 6px 10px; }
    .msite__claim small { display: none; }
    .msite__nav { overflow-x: auto; }
    .msite__navlinks { width: max-content; display: flex; }
    .msite__navlinks a { width: auto; min-height: 39px; padding: 0 18px; }
    .msite__services { grid-template-columns: 1fr; }
    .msite__footer-main { grid-template-columns: 1fr 1fr; gap: 28px; padding: 34px 0 28px; }
    .msite__footer-company { grid-column: 1 / -1; }
    .msite__footer-bottom { grid-template-columns: 1fr; gap: 10px; }
    .poweredby { right: 10px; bottom: 10px; }
  }
  @media (max-width: 480px) {
    .msite__utility .msite__container > span { display: none; }
    .msite__utility-actions { margin-left: auto; }
    .msite__contact-card { display: none; }
    .msite__footer-main { grid-template-columns: 1fr; }
    .msite__footer-company { grid-column: auto; }
    .msite__brandtag { max-width: calc(100vw - 180px); }
  }
`

function micrositeNav(ctx, active) {
  const items = [
    ['Home', ctx.homeHref, 'home'],
    ['Company Profile', ctx.profileHref, 'profile'],
    ['Products', ctx.productsHref, 'products'],
  ]
  return '<div class="msite__utility"><div class="msite__container"><span>Welcome to the BizThai B2B company marketplace</span>' +
    '<div class="msite__utility-actions"><div class="msite__utility-links"><a href="/">BizThai Home</a><a href="' + escHtml(ctx.profileHref) + '#contact">Customer Service</a><a href="' + escHtml(ctx.productsHref) + '">Mobile Store</a></div>' +
    '<div class="msite__language notranslate" translate="no" aria-label="Translate this microsite">' +
    '<button class="is-active" type="button" data-ms-lang="en" aria-pressed="true">EN</button>' +
    '<button type="button" data-ms-lang="th" aria-pressed="false">ไทย</button>' +
    '<button type="button" data-ms-lang="zh-CN" aria-pressed="false">中文</button></div></div></div></div>' +
    '<header class="msite__brandbar"><div class="msite__container">' +
    '<span class="msite__brandmark">' + escHtml(ctx.g('logo-mark') || ctx.title.slice(0, 2).toUpperCase()) + '</span>' +
    '<div class="msite__brandcopy"><div class="msite__brandname">' + escHtml(ctx.title) + '</div><div class="msite__brandtag">' + escHtml(ctx.g('tagline')) + '</div></div>' +
    '<div class="msite__header-actions"><div class="msite__contact-card"><span class="msite__contact-icon">☎</span>' +
    '<span class="msite__contact-copy"><small>Published business contact</small><strong>' + escHtml(ctx.phoneLabel) + '</strong></span></div>' +
    '<a class="msite__claim" href="' + escHtml(ctx.companyClaimHref) + '"><strong>Claim this company</strong><small>Open BizThai company record</small></a></div>' +
    '</div></header>' +
    '<nav class="msite__nav" aria-label="Company navigation"><div class="msite__container"><div class="msite__navlinks">' +
    items.map(it => '<a' + (it[2] === active ? ' class="is-active"' : '') + ' href="' + escHtml(it[1]) + '">' + it[0] + '</a>').join('') +
    '</div></div></nav>'
}

function micrositeFooter(ctx) {
  const channelsHtml = ctx.channels.map(c => '<a href="' + escHtml(c[1]) + '" target="_blank" rel="noopener nofollow" aria-label="' + escHtml(c[0]) + '">' + c[2] + '</a>').join('')
  return '<footer class="msite__footer"><div class="msite__container">' +
    '<div class="msite__footer-main"><div class="msite__footer-company"><div class="msite__footer-brandrow">' +
    '<span class="msite__footer-mark">' + escHtml(ctx.g('logo-mark') || ctx.title.slice(0, 2).toUpperCase()) + '</span><div>' +
    '<div class="msite__footer-brand">' + escHtml(ctx.title) + '</div><div class="msite__footer-tagline">Verified company microsite on BizThai</div></div></div>' +
    (ctx.addressLine ? '<div class="msite__footer-addr">' + escHtml(ctx.addressLine) + '</div>' : '') + '</div>' +
    '<div><h3 class="msite__footer-title">Company</h3><div class="msite__footer-links">' +
    '<a href="' + escHtml(ctx.homeHref) + '">Home</a><a href="' + escHtml(ctx.profileHref) + '">Company Profile</a><a href="' + escHtml(ctx.productsHref) + '">Products</a></div></div>' +
    '<div><h3 class="msite__footer-title">Business</h3><div class="msite__footer-links">' +
    '<a href="' + escHtml(ctx.inquiryHref) + '"' + (/^https?:/i.test(ctx.inquiryHref) ? ' target="_blank" rel="noopener nofollow"' : '') + '>Contact supplier</a>' +
    '<a href="' + escHtml(ctx.productsHref) + '">Latest supply</a><a href="/">BizThai marketplace</a></div></div>' +
    '<div><h3 class="msite__footer-title">Connect</h3><p class="msite__footer-contact">' + escHtml(ctx.phoneLabel) + '</p>' +
    '<div class="msite__social">' + channelsHtml + '</div><a class="msite__footer-claim" href="' + escHtml(ctx.companyClaimHref) + '">Claim this company</a></div></div>' +
    '<div class="msite__footer-bottom"><p class="msite__finetext">' + ctx.disclaimer + '</p>' +
    '<div class="msite__footer-meta">BizThai · Thailand Business Directory</div></div>' +
    '</div></footer>'
}

function micrositeServicebar(ctx) {
  return '<aside class="msite__servicebar" aria-label="Customer service"><div class="msite__servicebar-head">Customer Service</div>' +
    '<div class="msite__servicebar-body"><small>Company contact</small><div class="msite__service-phone">' + escHtml(ctx.phoneLabel) + '</div>' +
    '<a class="msite__service-btn" href="' + escHtml(ctx.inquiryHref) + '"' + (/^https?:/i.test(ctx.inquiryHref) ? ' target="_blank" rel="noopener nofollow"' : '') + '>Contact supplier</a></div></aside>'
}

function micrositeDocument({ ctx, active, title, description, canonicalPath, bodyHtml }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escHtml(title) + '</title>' +
    '<meta name="description" content="' + escHtml(description) + '">' +
    '<meta name="robots" content="index,follow">' +
    '<link rel="canonical" href="https://bizthai.com' + escHtml(canonicalPath) + '">' +
    '<style>' + MICROSITE_SUBPAGE_CSS + '</style></head><body>' +
    '<div class="msite" style="--site-deep:' + ctx.brandDeep + ';--site-accent:' + ctx.brandAccent + ';--site-accent-ink:' + ctx.brandAccentInk + ';">' +
    micrositeNav(ctx, active) + bodyHtml + micrositeFooter(ctx) + micrositeServicebar(ctx) +
    '</div>' +
    '<div class="poweredby"><span class="poweredby__mark">B</span>Powered by <b>BizThai</b></div>' +
    '<script src="/theme-assets/starter/microsite-translate.js?v=20260725-1" defer></script>' +
    '</body></html>'
}

async function serveMicrositeProfilePage(slug, req, res, url) {
  const ctx = await loadMicrositeContext(slug, req)
  if (!ctx) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return }

  const factsArr = [
    ['Founded', ctx.foundedYear], ['Employees (est.)', ctx.g('employees-estimate')],
    ['Factory / HQ', ctx.factoryLocation], ['Own brand', ctx.g('own-brand')],
  ].filter(f => f[1])
  const factsHtml = factsArr.map(f => '<div class="msite__fact"><span>' + escHtml(f[0]) + '</span><strong>' + escHtml(f[1]) + '</strong></div>').join('')

  const servicesHtml = ctx.services.length
    ? '<div class="msite__services">' + ctx.services.map((s, i) => '<div class="msite__srow"><span class="msite__srow-num">' + String(i + 1).padStart(2, '0') + '</span><div><div class="msite__srow-name">' + escHtml(s.name) + '</div>' + (s.description ? '<div class="msite__srow-desc">' + escHtml(s.description) + '</div>' : '') + '</div></div>').join('') + '</div>'
    : '<p class="msite__empty">No services listed yet.</p>'

  const certsHtml = ctx.certifications.length
    ? '<div class="msite__certs">' + ctx.certifications.map(c => '<span class="msite__cert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l6 6L20 6"/></svg>' + escHtml(c.name) + '</span>').join('') + '</div>'
    : '<p class="msite__empty">No certifications listed yet.</p>'

  const newsHtml = ctx.news.length
    ? '<div class="msite__news">' + ctx.news.map(n => '<div class="msite__news-item"><span class="msite__news-date">' + escHtml(n.date) + '</span><div><div class="msite__news-title">' + escHtml(n.title) + '</div>' + (n['source-url'] ? '<a class="msite__news-src" href="' + escHtml(n['source-url']) + '" target="_blank" rel="noopener nofollow">' + escHtml(n['source-label'] || n['source-url']) + '</a>' : '') + '</div></div>').join('') + '</div>'
    : ''

  const body =
    '<div class="msite__breadcrumb"><a href="' + ctx.homeHref + '">Home</a><span>/</span><span>Company Profile</span></div>' +
    '<div class="msite__pagehead"><div class="msite__eyebrow">Company Profile</div><h1 class="msite__h1">' + escHtml(ctx.title) + '</h1>' +
    (ctx.g('intro') ? '<p class="msite__lead">' + escHtml(ctx.g('intro')) + '</p>' : '') +
    '<div class="msite__facts">' + factsHtml + '</div></div>' +
    '<section class="msite__section" id="services"><h2 class="msite__h2">Services</h2>' + servicesHtml + '</section>' +
    '<section class="msite__section" id="certifications"><h2 class="msite__h2">Certifications</h2>' + certsHtml + '</section>' +
    (newsHtml ? '<section class="msite__section" id="news"><h2 class="msite__h2">Recent activity</h2>' + newsHtml + '</section>' : '') +
    '<section class="msite__section" id="contact"><h2 class="msite__h2">Contact supplier</h2><p class="msite__lead">Send a sourcing inquiry through the company’s published business channel.</p>' +
    '<a class="msite__cta" href="' + escHtml(ctx.inquiryHref) + '"' + (/^https?:/i.test(ctx.inquiryHref) ? ' target="_blank" rel="noopener nofollow"' : '') + '>Start inquiry</a></section>'

  const html = micrositeDocument({
    ctx, active: 'profile',
    title: ctx.title + ' — Company Profile — BizThai',
    description: (ctx.g('intro') || ctx.g('tagline')).slice(0, 160),
    canonicalPath: ctx.profileHref,
    bodyHtml: body,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function serveMicrositeProductsPage(slug, req, res, url) {
  const ctx = await loadMicrositeContext(slug, req)
  if (!ctx) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return }

  const groups = new Map()
  ctx.products.forEach((p, i) => {
    const cat = p.tag || 'Other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat).push(i)
  })

  const productCard = (p, i) => '<div class="msite__card"><a class="msite__card-link" href="' + escHtml(ctx.productHref(i)) + '">' +
    '<div class="msite__thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/></svg></div>' +
    '<div class="msite__card-body"><div class="msite__card-name">' + escHtml(p.name) + '</div>' +
    (p.description ? '<p class="msite__card-desc">' + escHtml(p.description) + '</p>' : '') +
    '</div></a></div>'

  const sectionsHtml = groups.size
    ? Array.from(groups.entries()).map(([cat, idxs]) =>
        '<section class="msite__section" id="' + escHtml(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">' +
        '<div class="msite__eyebrow">Category</div><h2 class="msite__h2">' + escHtml(cat) + '</h2>' +
        '<div class="msite__grid">' + idxs.map(i => productCard(ctx.products[i], i)).join('') + '</div></section>'
      ).join('')
    : '<section class="msite__section"><p class="msite__empty">No products listed yet.</p></section>'

  const body =
    '<div class="msite__breadcrumb"><a href="' + ctx.homeHref + '">Home</a><span>/</span><span>Products</span></div>' +
    '<div class="msite__pagehead"><div class="msite__eyebrow">Catalog</div><h1 class="msite__h1">Products &amp; categories</h1>' +
    '<p class="msite__lead">' + escHtml(ctx.title) + '’s product range, grouped by category.</p></div>' +
    sectionsHtml

  const html = micrositeDocument({
    ctx, active: 'products',
    title: 'Products — ' + ctx.title + ' — BizThai',
    description: ('Browse ' + ctx.title + '’s product catalog by category.').slice(0, 160),
    canonicalPath: '/b2b-' + slug + '-products.html',
    bodyHtml: body,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function serveMicrositeProductPage(slug, productSlug, req, res, url) {
  const ctx = await loadMicrositeContext(slug, req)
  if (!ctx) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
  const idx = ctx.productSlugs.indexOf(productSlug)
  if (idx === -1) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('product not found'); return }
  const p = ctx.products[idx]

  const others = ctx.products
    .map((op, i) => ({ op, i }))
    .filter(({ op, i }) => i !== idx && op.tag === p.tag)
    .slice(0, 3)
  const othersHtml = others.length
    ? '<section class="msite__section"><h2 class="msite__h2">More in ' + escHtml(p.tag || 'this category') + '</h2><div class="msite__grid">' +
      others.map(({ op, i }) => '<div class="msite__card"><a class="msite__card-link" href="' + escHtml(ctx.productHref(i)) + '">' +
        '<div class="msite__thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/></svg></div>' +
        '<div class="msite__card-body"><div class="msite__card-name">' + escHtml(op.name) + '</div></div></a></div>').join('') +
      '</div></section>'
    : ''

  const body =
    '<div class="msite__breadcrumb"><a href="' + ctx.homeHref + '">Home</a><span>/</span><a href="' + ctx.productsHref + '">Products</a><span>/</span><span>' + escHtml(p.name) + '</span></div>' +
    '<div class="msite__pagehead">' +
    (p.tag ? '<div class="msite__eyebrow"><a href="' + ctx.productsHref + '#' + escHtml(String(p.tag).toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '" style="color:inherit">' + escHtml(p.tag) + '</a></div>' : '') +
    '<h1 class="msite__h1">' + escHtml(p.name) + '</h1>' +
    (p.description ? '<p class="msite__lead">' + escHtml(p.description) + '</p>' : '') +
    '<a class="msite__cta" href="' + escHtml(ctx.inquiryHref) + '"' + (/^https?:/i.test(ctx.inquiryHref) ? ' target="_blank" rel="noopener nofollow"' : '') + '>Contact ' + escHtml(ctx.title) + '</a>' +
    '</div>' + othersHtml

  const html = micrositeDocument({
    ctx, active: 'products',
    title: p.name + ' — ' + ctx.title + ' — BizThai',
    description: (p.description || (p.name + ' by ' + ctx.title)).slice(0, 160),
    canonicalPath: ctx.productHref(idx),
    bodyHtml: body,
  })
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function serveMicrositePage(slug, req, res, url) {
  const search = url.search || ''
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/b2b-' + encodeURIComponent(slug) + search, req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  const ctx = await loadMicrositeContext(slug, req)
  if (!ctx) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(shell.body); return }
  const { meta, title, updatedAt, g, brandDeep, brandAccent, brandAccentInk, foundedYear, factoryLocation, addressLine } = ctx

  let html = shell.body
  html = html.replace(/(<div class="msite" data-site-root)([^>]*)>/, (m0, a) =>
    a + ' style="--site-deep:' + brandDeep + ';--site-accent:' + brandAccent + ';--site-accent-ink:' + brandAccentInk + ';">')
  // 首页导航/Hero CTA 里指向「产品分类」「公司档案」两个独立页面的链接(各自的完整内容/SEO 元信息
  // 见 serveMicrositeProductsPage / serveMicrositeProfilePage)。
  html = html.replace(/(<a[^>]*\bdata-nav-products\b[^>]*\shref=")#products(")/g, (m0, a, b) => a + escHtml(ctx.productsHref) + b)
  html = html.replace(/(<a[^>]*\bdata-nav-profile\b[^>]*\shref=")#services(")/g, (m0, a, b) => a + escHtml(ctx.profileHref) + b)
  html = html.replace(/<title[^>]*data-site-title-tag[^>]*>[\s\S]*?<\/title>/, () => '<title data-site-title-tag>' + escHtml(title) + ' — BizThai</title>')
  html = html.replace(/(<meta name="description"[^>]*data-site-desc-tag[^>]*content=")[^"]*(")/, (m0, a, b) => a + escHtml(g('tagline')) + b)
  html = html.replace(/<span class="msite__navmark"[^>]*data-site-logo[^>]*>[\s\S]*?<\/span>/, () => '<span class="msite__navmark" data-site-logo>' + escHtml(g('logo-mark') || title.slice(0, 2).toUpperCase()) + '</span>')
  html = html.replace(/<div class="msite__brandname"[^>]*data-site-name[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__brandname" data-site-name>' + escHtml(title) + '</div>')
  html = html.replace(/<div class="msite__brandtag"[^>]*data-site-tagline[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__brandtag" data-site-tagline>' + escHtml(g('tagline')) + '</div>')
  html = html.replace(/<strong[^>]*data-site-phone[^>]*>[\s\S]*?<\/strong>/, () => '<strong data-site-phone>' + escHtml(ctx.phoneLabel) + '</strong>')
  html = html.replace(/<strong[^>]*data-site-banner-title[^>]*>[\s\S]*?<\/strong>/, () => '<strong data-site-banner-title>' + escHtml(title) + '</strong>')
  html = html.replace(/<p[^>]*data-site-banner-tagline[^>]*>[\s\S]*?<\/p>/, () => '<p data-site-banner-tagline>' + escHtml(g('tagline') || 'Reliable B2B supply') + '</p>')
  html = html.replace(/<span[^>]*data-site-updated[^>]*>[\s\S]*?<\/span>/, () => '<span class="msite__date" data-site-updated>' + escHtml(updatedAt ? 'Updated ' + updatedAt.slice(0, 10) : '') + '</span>')
  html = html.replace(/<div[^>]*data-site-sidebar-name[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__company-title" data-site-sidebar-name>' + escHtml(title) + '</div>')
  html = html.replace(/<div[^>]*data-site-intro-logo[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__introvisual" data-site-intro-logo>' + escHtml(g('logo-mark') || title.slice(0, 2).toUpperCase()) + '</div>')
  html = html.replace(/<div[^>]*data-site-service-phone[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__service-phone" data-site-service-phone>' + escHtml(ctx.phoneLabel) + '</div>')
  html = html.replace(/(<a[^>]*\bdata-site-company-link\b[^>]*\shref=")[^"]*(")/g, (m0, a, b) => a + escHtml(ctx.companyClaimHref) + b)
  html = html.replace(/(<a[^>]*\bdata-site-inquiry-link\b[^>]*\shref=")[^"]*(")/g, (m0, a, b) => a + escHtml(ctx.inquiryHref) + b)

  const kicker = [foundedYear ? 'Est. ' + foundedYear : '', factoryLocation].filter(Boolean).join(' · ')
  html = html.replace(/<div class="msite__kicker"[^>]*data-site-kicker[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__kicker" data-site-kicker>' + escHtml(kicker || 'Company profile') + '</div>')
  html = html.replace(/<h1[^>]*data-site-tagline[^>]*>[\s\S]*?<\/h1>/, () => '<h1 data-site-tagline>' + escHtml(g('tagline') || title) + '</h1>')
  html = html.replace(/<p[^>]*data-site-intro[^>]*>[\s\S]*?<\/p>/, () => '<p class="msite__introtext" data-site-intro>' + escHtml(g('intro')) + '</p>')
  html = html.replace(/<h2 class="msite__h2"[^>]*data-site-about-title[^>]*>[\s\S]*?<\/h2>/, () => '<h2 class="msite__h2" data-site-about-title>About ' + escHtml(title) + '</h2>')

  const facts = [
    ['Founded', foundedYear],
    ['Employees (est.)', g('employees-estimate')],
    ['Factory / HQ', factoryLocation],
    ['Own brand', g('own-brand')],
  ].filter(f => f[1])
  const factsHtml = facts.map(f => '<div class="msite__fact"><span>' + escHtml(f[0]) + '</span><strong>' + escHtml(f[1]) + '</strong></div>').join('')
  html = html.replace(/<div class="msite__facts" data-panel="facts">\s*<\/div>/, () => '<div class="msite__facts" data-panel="facts">' + factsHtml + '</div>')

  const products = Array.isArray(meta.products) ? meta.products : []
  const productsHtml = products.length
    ? '<div class="msite__grid">' + products.map((p, i) => '<div class="msite__card"><a class="msite__card-link" href="' + escHtml(ctx.productHref(i)) + '"><div class="msite__thumb"></div><div class="msite__card-body"><div class="msite__card-name">' + escHtml(p.name) + '</div>' + (p.description ? '<p class="msite__card-desc">' + escHtml(p.description) + '</p>' : '') + (p.tag ? '<span class="msite__card-tag">' + escHtml(p.tag) + '</span>' : '') + '</div></a></div>').join('') + '</div>'
    : '<p class="msite__empty">No products listed yet.</p>'
  html = html.replace(/<div data-panel="products">\s*<\/div>/, () => '<div data-panel="products">' + productsHtml + '</div>')

  const categoryNames = Array.from(new Set(products.map(p => String(p.tag || 'Other')).filter(Boolean)))
  const categoriesHtml = categoryNames.length
    ? '<ul class="msite__side-list">' + categoryNames.map(cat => '<li><a href="' + escHtml(ctx.productsHref) + '#' + escHtml(cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">' + escHtml(cat) + '</a></li>').join('') + '</ul>'
    : '<p class="msite__empty" style="padding:12px 14px">No categories listed yet.</p>'
  html = html.replace(/<div data-panel="categories">\s*<\/div>/, () => '<div data-panel="categories">' + categoriesHtml + '</div>')

  const supplyDate = updatedAt ? updatedAt.slice(0, 10) : ''
  const suppliesHtml = products.length
    ? '<div class="msite__supplies">' + products.map((p, i) => '<div class="msite__supply"><a href="' + escHtml(ctx.productHref(i)) + '">' + escHtml(p.name) + (p.tag ? ' — ' + escHtml(p.tag) : '') + '</a>' + (supplyDate ? '<time>' + escHtml(supplyDate) + '</time>' : '') + '</div>').join('') + '</div>'
    : '<p class="msite__empty">No supply listings yet.</p>'
  html = html.replace(/<div data-panel="supplies">\s*<\/div>/, () => '<div data-panel="supplies">' + suppliesHtml + '</div>')

  const services = Array.isArray(meta.services) ? meta.services : []
  const servicesHtml = services.length
    ? '<div class="msite__services">' + services.map((s, i) => '<div class="msite__srow"><span class="msite__srow-num">' + String(i + 1).padStart(2, '0') + '</span><div><div class="msite__srow-name">' + escHtml(s.name) + '</div>' + (s.description ? '<div class="msite__srow-desc">' + escHtml(s.description) + '</div>' : '') + '</div></div>').join('') + '</div>'
    : '<p class="msite__empty">No services listed yet.</p>'
  html = html.replace(/<div data-panel="services">\s*<\/div>/, () => '<div data-panel="services">' + servicesHtml + '</div>')

  const certs = Array.isArray(meta.certifications) ? meta.certifications : []
  const certsHtml = certs.length
    ? '<div class="msite__certs">' + certs.map(c => '<span class="msite__cert"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12l6 6L20 6"/></svg>' + escHtml(c.name) + '</span>').join('') + '</div>'
    : ''
  html = html.replace(/<div data-panel="certifications">\s*<\/div>/, () => '<div data-panel="certifications">' + certsHtml + '</div>')

  const news = Array.isArray(meta.news) ? meta.news : []
  const newsHtml = news.length
    ? '<ul class="msite__side-list">' + news.map(n => '<li>' + (n['source-url'] ? '<a href="' + escHtml(n['source-url']) + '" target="_blank" rel="noopener nofollow">' : '') + escHtml(n.title) + (n['source-url'] ? '</a>' : '') + (n.date ? '<br><small>' + escHtml(n.date) + '</small>' : '') + '</li>').join('') + '</ul>'
    : '<p class="msite__empty" style="padding:12px 14px">No news listed yet.</p>'
  html = html.replace(/<div data-panel="news">\s*<\/div>/, () => '<div data-panel="news">' + newsHtml + '</div>')

  const channels = []
  if (g('website-url')) channels.push(['Website', g('website-url'), MICROSITE_ICONS.website])
  if (g('facebook-url')) channels.push(['Facebook', g('facebook-url'), MICROSITE_ICONS.facebook])
  if (g('line-id')) channels.push(['LINE', 'https://line.me/ti/p/~' + g('line-id').replace(/^@/, ''), MICROSITE_ICONS.line])
  if (g('whatsapp-number')) channels.push(['WhatsApp', 'https://wa.me/' + g('whatsapp-number').replace(/[^0-9]/g, ''), MICROSITE_ICONS.whatsapp])
  if (g('wechat-id')) channels.push(['WeChat: ' + g('wechat-id'), '#', MICROSITE_ICONS.wechat])
  const channelsHtml = channels.map(c => '<a href="' + escHtml(c[1]) + '" target="_blank" rel="noopener nofollow" aria-label="' + escHtml(c[0]) + '">' + c[2] + '</a>').join('')
  html = html.replace(/<div class="msite__social" data-panel="channels">\s*<\/div>/, () => '<div class="msite__social" data-panel="channels">' + channelsHtml + '</div>')

  html = html.replace(/<div class="msite__footer-brand"[^>]*data-site-footer-brand[^>]*>[\s\S]*?<\/div>/, () => '<div class="msite__footer-brand" data-site-footer-brand>' + escHtml(title) + '</div>')
  html = html.replace(/<span class="msite__footer-mark"[^>]*data-site-footer-logo[^>]*>[\s\S]*?<\/span>/, () => '<span class="msite__footer-mark" data-site-footer-logo>' + escHtml(g('logo-mark') || title.slice(0, 2).toUpperCase()) + '</span>')
  html = html.replace(/<div class="msite__address" data-site-address><\/div>/, () => '<div class="msite__address" data-site-address>' + escHtml(addressLine) + '</div>')
  html = html.replace(/<div class="msite__footer-addr" data-site-footer-address><\/div>/, () => '<div class="msite__footer-addr" data-site-footer-address>' + escHtml(addressLine) + '</div>')
  html = html.replace(/<p class="msite__footer-contact"[^>]*data-site-footer-contact[^>]*>[\s\S]*?<\/p>/, () => '<p class="msite__footer-contact" data-site-footer-contact>' + escHtml(ctx.phoneLabel) + '</p>')

  const sources = Array.isArray(meta.sources) ? meta.sources : []
  const disclaimerParts = ['此页面内容由 <a href="/" rel="nofollow">BizThai AI</a> 检索' + (sources.length ? ' ' + sources.length + ' 条' : '') + ' 公开网络信息自动生成']
  if (updatedAt) disclaimerParts.push('更新于 ' + updatedAt.slice(0, 10))
  const disclaimer = disclaimerParts.join('，') + '，可能与企业实际情况存在偏差，不构成官方工商记录。'
  html = html.replace(/<p class="msite__finetext" data-panel="disclaimer">\s*<\/p>/, () => '<p class="msite__finetext" data-panel="disclaimer">' + disclaimer + '</p>')

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

async function serveCompanyPage(jpNo, req, res, url) {
  const search = url.search || ''
  // WooCMS 按 slug 路由:stub 公司 slug==jpNo,但「英文名 slug」公司用 jpNo 取会 404。
  // 先按 jpNo 取(注册号 slug 命中),失败再按 URL 里的英文名 slug 取(英文名 slug 公司命中)。
  let key = String(jpNo)
  let urlSlug = ''
  try {
    const base = url.pathname.replace(/\/+$/, '')
    urlSlug = decodeURIComponent(base.slice(base.lastIndexOf('/') + 1).replace(/\.html$/i, '')).toLowerCase()
  } catch { /* 原样 */ }
  let shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/company/' + encodeURIComponent(key) + search, req.headers, res)
  if (!shell) { temporaryUnavailable(res); return }
  if ((!shell || shell.status !== 200 || !shell.body) && urlSlug && urlSlug !== key) {
    key = urlSlug
    shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/company/' + encodeURIComponent(key) + search, req.headers, res)
  }
  if (!shell) { temporaryUnavailable(res); return }
  if (shell.status !== 200 || !shell.body) { relayFetched(req, res, shell); return }
  const ent = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/models/thaicompany/entries/' + encodeURIComponent(key), { accept: 'application/json', host: (req.headers && req.headers.host) || 'bizthai.com', 'user-agent': req.headers['user-agent'] || '' }, res)
  let meta = null, raw = {}, entryId = null, updatedAt = ''
  if (ent && ent.body) { try { const j = JSON.parse(ent.body); const d = j && j.data ? j.data : null; if (d) { meta = d.meta || {}; raw = meta.raw || {}; entryId = d.id; updatedAt = d.updated_at || '' } } catch { /* ignore */ } }
  if (!meta) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(shell.body); return }
  const lang = langFromReq(req, url)
  // 所有历史/数字别名统一 301 到数据库 permalink_routes 的唯一 flat URL，语言前缀保留。
  if (entryId) {
    const canonicalPath = await companyCanonicalPath(entryId)
    const requestedPath = url.pathname.replace(/^\/(?:zh|th)(?=\/|$)/, '') || '/'
    if (canonicalPath && requestedPath !== canonicalPath) {
      res.writeHead(301, { Location: localePrefixOf(lang) + canonicalPath + url.search })
      res.end()
      return
    }
  }
  // 会员上传的商务页头图:仅接受本站 /uploads 或 http(s) URL,注入根 div 作 hero 背景(页头+hero 融合)
  const heroUrl = (function (u) { u = String(u || '').trim().slice(0, 400); return /^(https?:\/\/[^\s'"<>]+|\/uploads\/[^\s'"<>]+)$/.test(u) ? u : '' })(meta.herourl)
  // 同府同业(供底部「同类企业」模块 + FAQ「还有哪些类似企业」共用同一份数据,只查一次)
  let peers = []
  try {
    if (entryId) {
      const tt = await entryTopTerms(entryId)
      if (tt.industry && tt.province) peers = await samePeersCached(tt.industry, tt.province, jpNo)
    }
  } catch { /* 模块可选,失败不影响主页面 */ }
  // 认领会员编辑记录(cms_entry_field_revisions,只读):给联系方式/经营业务里"认领后 X 修改"提示用
  let ownerRevisions = []
  try { if (entryId) ownerRevisions = await lookupApprovedRevisions(entryId) } catch { /* 提示可选,失败不影响主页面 */ }
  const r = renderCompanySSR(meta, raw, lang, jpNo, peers, updatedAt, ownerRevisions)
  let html = shell.body
  if (r.breadcrumbHtml) {
    html = html.replace(/<nav[^>]*data-detail-breadcrumb[^>]*>[\s\S]*?<\/nav>/, () => r.breadcrumbHtml)
  }
  html = html.replace(/(<h1[^>]*data-detail-name-en[^>]*>)[\s\S]*?(<\/h1>)/, () => '<h1 id="company-detail-title" data-detail-name-en>' + escHtml(r.mainName) + '</h1>')
  if (r.altName) html = html.replace(/<p[^>]*data-detail-name-alt[^>]*>[\s\S]*?<\/p>/, () => '<p class="biz-detail-hero__alt" data-detail-name-alt>' + escHtml(r.altName) + '</p>')
  html = html.replace(/(<div[^>]*data-detail-badges[^>]*>)\s*<\/div>/, () => '<div class="biz-detail-badges" data-detail-badges>' + r.badge + '</div>')
  // 浏览量由浏览器异步 POST 获取；HTML 保持稳定，才能安全共享缓存并返回一致 ETag。
  html = html.replace(/<div[^>]*data-detail-views[^>]*>\s*<\/div>/, () => '<div class="biz-detail-views" data-detail-views hidden></div>')
  // 副标题行右侧:数据来源 + 数据更新(SSR 直接写出,避免空节点被 :empty 隐藏或旧缓存错位)
  html = html.replace(/<div[^>]*data-detail-source[^>]*>\s*<\/div>/, () => '<div class="biz-detail-source" data-detail-source>' + escHtml(LBL(lang, 'dataSource')) + '</div>')
  {
    const upd = ssrDualDate(lang, updatedAt || (meta && meta.updatedate))
    html = html.replace(/<div[^>]*data-detail-updated[^>]*>[\s\S]*?<\/div>/, () => upd
      ? '<div class="biz-detail-updated" data-detail-updated><span class="biz-detail-updated__label">' + escHtml(LBL(lang, 'lastUpdated')) + '</span><time class="biz-detail-updated__date">' + escHtml(upd) + '</time></div>'
      : '<div class="biz-detail-updated" data-detail-updated hidden></div>')
  }
  html = html.replace(/(<ul[^>]*data-detail-facts[^>]*>)\s*<\/ul>/, () => '<ul class="biz-detail-hero__facts" data-detail-facts>' + r.facts + '</ul>')
  if (r.leadText) html = html.replace(/<p[^>]*data-detail-lead[^>]*>[\s\S]*?<\/p>/, () => '<p class="biz-detail-hero__lead" data-detail-lead>' + escHtml(r.leadText) + '</p>')
  html = html.replace(/<div[^>]*data-detail-status[^>]*>[\s\S]*?<\/div>/, () => '<div class="biz-detail-status" data-detail-status hidden></div>')
  html = html.replace(/<div[^>]*data-panel="business"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="business" role="tabpanel" hidden' + (r.businessEditedAt ? ' data-business-edited-at="' + escHtml(r.businessEditedAt) + '"' : '') + '>' + r.businessHtml + '</div>')
  // 「登记档案」与「财务报表」合并:profileHtml(基础信息)在上,finHtml(财务摘要)在下,证券牌照
  // (补采字段一期)追加在后,同一手法,稀疏时静默不渲染。曾用名/增减资已挪到独立 changes 面板(二期)。
  html = html.replace(/<div[^>]*data-panel="profile"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="profile" role="tabpanel">' + r.profileHtml + r.finHtml + r.secLicHtml + r.tmHtml + '</div>')
  html = html.replace(/<div[^>]*data-panel="directors"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="directors" role="tabpanel" hidden>' + r.dirHtml + '</div>')
  html = html.replace(/<div[^>]*data-panel="changes"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="changes" role="tabpanel" hidden>' + r.changesHtml + '</div>')
  html = html.replace(/<div[^>]*data-panel="finance"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="finance" role="tabpanel" hidden>' + r.analyticsHtml + '</div>')
  // data-contact-{phone,email,fax} 只在认领会员已确认发布该值时才输出——theme.js 客户端渲染联系方式面板
  // 只信这几个属性,不再自行判定"是否已登录"就展示(2026-07-11 PDPA 投诉修复,原逻辑是任意登录用户可见全量值)。
  const contactAttrs = (r.contactEditedAt ? ' data-contact-edited-at="' + escHtml(r.contactEditedAt) + '"' : '') +
    (r.contactPhoneVerifiedVal ? ' data-contact-phone="' + escHtml(r.contactPhoneVerifiedVal) + '"' : '') +
    (r.contactEmailVerifiedVal ? ' data-contact-email="' + escHtml(r.contactEmailVerifiedVal) + '"' : '') +
    (r.contactFaxVerifiedVal ? ' data-contact-fax="' + escHtml(r.contactFaxVerifiedVal) + '"' : '')
  html = html.replace(/<div[^>]*data-panel="contact"[^>]*>\s*<\/div>/, () => '<div class="biz-detail-panel" data-panel="contact" role="tabpanel" hidden' + contactAttrs + '>' + r.contactHtml + '</div>')
  html = applySeo(html, companySeo(meta, lang, jpNo, canonicalHref(req, localePrefixOf(lang) + url.pathname), r.faqPairs, !companyIndexable(meta)))
  // 注入 jpNo 供 theme.js 取(因 canonical 已改漂亮 URL 无数字,客户端需从此属性拿 jpNo)
  html = html.replace(/(<div[^>]*\bdata-company-detail\b)([^>]*>)/, (m, a, b) => a + ' data-detail-jpno="' + escHtml(jpNo) + '" data-detail-slug="' + escHtml(key) + '"' + (entryId ? ' data-detail-entry-id="' + escHtml(entryId) + '"' : '') + (heroUrl ? " data-has-hero style=\"--biz-hero:url('" + escHtml(heroUrl) + "')\"" : '') + b)
  // 同府同业 SEO 内链模块(SSR,爬虫可抓):peers 已在上面取过,这里只渲染
  const peersHtml = renderPeersSSR(peers, lang)
  if (peersHtml) html = html.replace(/(<section[^>]*\bdata-detail-peers\b[^>]*>)\s*<\/section>/, () => '<section class="biz-detail-peers" data-detail-peers>' + peersHtml + '</section>')
  // 常见问题 FAQ 模块(SSR,爬虫可抓):数据不全的公司,r.faqHtml 可能为空,对应留空 section 靠 CSS :empty 隐藏
  if (r.faqHtml) html = html.replace(/(<section[^>]*\bdata-detail-faq\b[^>]*>)\s*<\/section>/, () => '<section class="biz-detail-faq" data-detail-faq>' + r.faqHtml + '</section>')
  sendHtml(req, res, url, html, !url.search)
}

// ── 董事/股东个人主页 SSR(/director-<jpNo>-<cmtSeq>.html;cmtNo 不进 URL/UI)──
// 2026-07-11:PDPA 投诉调查中一度整体下线过(担心跨公司反查=聚合档案违规),用户确认后恢复——
// 违规点是未经同意的个人联系电话/邮箱(已单独修复,见 renderCompanySSR 里的 phoneVerifiedAt 等),
// 董事任职关联本身是登记档案的合法查看能力,不受影响。
var OWNER_ROLE = { KC: { en: 'Director', th: 'กรรมการ', zh: '董事' } }
function ownerRole(code, lang) { var e = OWNER_ROLE[String(code || '').toUpperCase()]; return e ? (e[lang] || e.en) : (code || '-') }
function ownerHref(jpNo, enName) { var sl = ssrSlugifyIndustry(enName); return sl ? '/' + sl + '.html' : '/' + jpNo + '.html' }

function renderOwnerSSR(d, lang) {
  var meta = d.meta, jpNo = d.jpNo, cm = d.cm, dir = d.dir
  var personName = lang === 'th' ? (d.personTh || d.personEn) : (d.personEn || d.personTh)
  var personAlt = (d.personTh && d.personTh !== personName) ? d.personTh : ''
  var srcEn = meta.jpnamee || ''
  var srcName = lang === 'th' ? (meta.jpname || srcEn) : (srcEn || meta.jpname || '')
  var companies = (dir && dir.aggregatable !== false && Array.isArray(dir.companies)) ? dir.companies : []
  var total = (dir && dir.total) || companies.length
  if (!companies.length) {
    companies = [{ jpNo: jpNo, companyNameEn: srcEn, companyNameTh: meta.jpname, cmtTypeCode: cm && cm.cmtTypeCode, province: meta.province, registeredCapital: meta.capamt, updateDate: d.updatedAt }]
    total = 1
  }
  var rows = companies.map(function (c, i) {
    var cn = lang === 'th' ? (c.companyNameTh || c.companyNameEn) : (c.companyNameEn || c.companyNameTh)
    var cap = ssrNum(c.registeredCapital != null ? c.registeredCapital : c.capAmt)
    var upd = c.updateDate ? ssrDualDate(lang, c.updateDate) : ''
    var meta = [ownerRole(c.cmtTypeCode, lang), c.province, cap == null ? '' : ('฿' + ssrFmt(cap)), upd].filter(Boolean).map(function (m) { return '<span>' + escHtml(m) + '</span>' }).join('')
    return '<a class="biz-entcard" href="' + escHtml(ownerHref(c.jpNo, c.companyNameEn || '')) + '"><span class="biz-entcard__name">' + escHtml(cn || c.jpNo) + '</span>' + (meta ? '<span class="biz-entcard__meta">' + meta + '</span>' : '') + '</a>'
  }).join('')
  var facts = (d.ntCode ? '<li><span>' + escHtml(LBL(lang, 'nationality')) + '</span><strong>' + escHtml(d.ntCode) + '</strong></li>' : '') +
    '<li><span>' + escHtml(LBL(lang, 'ownerCompanies')) + '</span><strong>' + total + '</strong></li>'
  var heroArt = '<div class="biz-owner-hero-art" aria-hidden="true">' +
    '<svg viewBox="0 0 260 260" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="106" cy="106" r="80"/>' +
    '<line x1="163" y1="163" x2="222" y2="222" stroke-width="15"/>' +
    '<circle cx="106" cy="88" r="27"/>' +
    '<path d="M64 150c0-23 19-37 42-37s42 14 42 37"/>' +
    '</svg></div>'
  var content = '<section class="biz-detail-hero">' +
    '<nav class="biz-detail-breadcrumb"><a href="/">' + escHtml(LBL(lang, 'home')) + '</a><span aria-hidden="true">/</span><a href="' + escHtml(ownerHref(jpNo, srcEn)) + '">' + escHtml(srcName || jpNo) + '</a><span aria-hidden="true">/</span><span>' + escHtml(personName || jpNo) + '</span></nav>' +
    '<div class="biz-detail-hero__main"><div class="biz-detail-titlerow"><h1>' + escHtml(personName || LBL(lang, 'ownerUnnamed')) + '</h1></div>' +
    (personAlt ? '<p class="biz-detail-hero__alt">' + escHtml(personAlt) + '</p>' : '') +
    '<p class="biz-detail-hero__lead">' + escHtml(LBL(lang, 'ownerLead')) + '</p>' +
    '<ul class="biz-detail-hero__facts">' + facts + '</ul></div>' + heroArt + '</section>' +
    '<section class="biz-detail-panels"><div class="biz-detail-block"><h3>' + escHtml(LBL(lang, 'ownerCompaniesHeading')) + '</h3>' +
    '<div class="biz-entlist">' + rows + '</div>' +
    (total > companies.length ? '<p class="biz-owner-more">' + escHtml(LBL(lang, 'ownerShowing').replace('{a}', companies.length).replace('{b}', total)) + '</p>' : '') +
    '</div></section>'
  return { content: content, title: (personName || jpNo) + (srcName ? ' · ' + srcName : ''), personName: personName, srcName: srcName }
}

function resolveDirector(pathname) {
  var clean = pathname.replace(/\/+$/, '')
  if (!/\.html$/i.test(clean)) return null
  var file = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  try { file = decodeURIComponent(file) } catch { /* */ }
  var m = file.match(/^director-(\d{6,})-(\d+)$/)
  return m ? { jpNo: m[1], cmtSeq: m[2] } : null
}

async function serveDirectorPage(jpNo, cmtSeq, req, res, url) {
  // WooCMS 按 slug 路由,有英文名的公司用 jpNo 直接取会 404(同一个坑 serveCompanyPage 也踩过,见其
  // 注释)——这里 URL(/director-<jpNo>-<cmtSeq>.html)里没有 slug 可退。数据库 meta_json->>'jpno'
  // 没有可用索引(试过,全表扫描 timeout;加索引需要 DDL 权限,resolver 库账号只读没有,见 db.js 里
  // 被撤掉的 resolveKeyByJpno),改成查 jpnoKeyGet() 这个"顺路"缓存——命中就是这家公司最近被访问过
  // (多数董事卡片本来就是从公司详情页点进来的,大概率命中);没命中就直接拿 jpNo 当 key 试(stub
  // 公司能中,英文名公司还是 404,不比这次改动前更差,只是不再额外花几秒钟去试一个注定超时的查询)。
  var key = jpnoKeyGet(jpNo) || jpNo
  var shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/company/' + encodeURIComponent(key), req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  var lang = langFromReq(req, url)
  // 2026-07-12:整页都是围绕一个自然人的董事/关联公司信息,改成登录会员可见——不登录时不去打
  // entries/directors 这两个后端(反正拿到也不会展示,省一次内部往返),直接拼登录提示塞进壳页。
  var viewerUid = await whoAmI(req.headers.cookie || '', req.headers['authorization'] || '', req.headers['x-session-token'] || '')
  if (!viewerUid) {
    var gateHtml = '<section class="biz-detail-hero"><div class="biz-detail-hero__main"><div class="biz-detail-titlerow"><h1>' + escHtml(LBL(lang, 'ownerGateTitle')) + '</h1></div>' +
      '<p class="biz-detail-hero__lead">' + escHtml(LBL(lang, 'ownerGateBody')) + '</p>' +
      '<button type="button" style="margin-top:14px;padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escHtml(LBL(lang, 'signIn')) + '</button>' +
      '</div></section>'
    var gateShellHtml = shell.body
    gateShellHtml = gateShellHtml.replace(/<div class="starter-theme biz-company-detail"[^>]*>/, function () { return '<div class="starter-theme biz-owner-page" data-owner-page>' })
    gateShellHtml = gateShellHtml.replace(/<main class="starter-main">[\s\S]*?<\/main>/, function () { return '<main class="starter-main">' + gateHtml + '</main>' })
    gateShellHtml = applySeo(gateShellHtml, { title: brandTitle(LBL(lang, 'ownerGateTitle')), description: LBL(lang, 'ownerGateBody'), canonical: canonicalHref(req, localePrefixOf(lang) + url.pathname), lang, noindex: true })
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(gateShellHtml)
    return
  }
  var ent = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/api/site/v1/models/thaicompany/entries/' + encodeURIComponent(key), { accept: 'application/json' })
  var meta = {}, coms = [], updatedAt = ''
  if (ent && ent.body) { try { var dd = JSON.parse(ent.body).data; if (dd) { meta = dd.meta || {}; coms = (meta.raw && meta.raw.committees) || []; updatedAt = dd.updated_at || '' } } catch { /* */ } }
  var cm = null
  for (var i = 0; i < coms.length; i += 1) { if (String(coms[i].cmtSeq) === String(cmtSeq)) { cm = coms[i]; break } }
  if (!cm && coms[Number(cmtSeq) - 1]) cm = coms[Number(cmtSeq) - 1]
  var join = function (ks) { return ks.map(function (k) { return String((cm && cm[k]) || '').trim() }).filter(Boolean).join(' ') }
  var personTh = cm ? join(['titleName', 'firstName', 'middleName', 'lastName']) : ''
  var personEn = cm ? join(['titleNameE', 'firstNameE', 'middleNameE', 'lastNameE']) : ''
  var ntCode = cm ? String(cm.ntCode || '') : ''
  var cmtNo = cm ? String(cm.cmtNo || '') : ''
  var valid = /^[A-Za-z0-9]{6,}$/.test(cmtNo) && !/^(.)\1+$/.test(cmtNo)
  var dir = null
  // x-private-fields: cmt_no 标记这是受信的内部调用——directors 服务的按证件号直查端点现在
  // 只对内部调用开放("只能后台调用"),不再看登录态;这里用已知的 cmtNo(来自本公司自己的董
  // 事名录)去查该人名下其它公司,不是把用户输入的证件号转发出去,属于合法的内部用途。
  if (valid) { var dr = await fetchUpstream(config.directorsHost, config.directorsPort, '/api/site/v1/directors/' + encodeURIComponent(cmtNo) + '?limit=200', { accept: 'application/json', 'x-private-fields': 'cmt_no' }); if (dr && dr.body) { try { dir = JSON.parse(dr.body) } catch { /* */ } } }
  if (dir && dir.person) { personTh = dir.person.nameTh || personTh; personEn = dir.person.nameEn || personEn; ntCode = dir.person.ntCode || ntCode }
  var r = renderOwnerSSR({ meta: meta, jpNo: jpNo, cmtSeq: cmtSeq, cm: cm, personTh: personTh, personEn: personEn, ntCode: ntCode, dir: dir, updatedAt: updatedAt }, lang)
  var html = shell.body
  html = html.replace(/<div class="starter-theme biz-company-detail"[^>]*>/, function () { return '<div class="starter-theme biz-owner-page" data-owner-page>' })
  html = html.replace(/<main class="starter-main">[\s\S]*?<\/main>/, function () { return '<main class="starter-main">' + r.content + '</main>' })
  html = applySeo(html, directorSeo(r, lang, canonicalHref(req, localePrefixOf(lang) + url.pathname)))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// 排行榜数据取数(/business-leaderboards 的查询参数版本、精选榜单的固定预设版本共用)。
async function fetchLeaderboardData({ metric, industry, province, sizeCode, natCode, fiscalYear, page, perPage, basePath }) {
  const rq = new URLSearchParams({ metric, limit: String(perPage), offset: String((page - 1) * perPage) })
  if (industry) rq.set('industry', Array.isArray(industry) ? industry.join(',') : industry)
  if (province) rq.set('province', province)
  if (sizeCode) rq.set('size', sizeCode)
  if (natCode) rq.set('natCode', natCode)
  if (fiscalYear) rq.set('fiscalYear', String(fiscalYear))
  const rankRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/rankings?' + rq.toString(), { accept: 'application/json' })
  let d = null
  if (rankRes && rankRes.body) { try { d = JSON.parse(rankRes.body) } catch (e) { console.error('[resolver] fetchLeaderboardData: rankings 响应 JSON 解析失败, status=' + rankRes.status, e.message) } }
  // analytics 内部出错(如 PG statement_timeout 被取消)时也会带一个合法 JSON body 返回(形如
  // {error,message},状态码非 200),只看 body 是否非空会把这种错误响应当成有效数据放行——
  // d 非 null 但没有 items/total,下游 injectBizSlots 找不到数据就悄悄渲染成空槽位,整个
  // 过程没有任何日志(实测到的偶发空壳榜单就是这个原因)。这里必须同时验证状态码和
  // d.error,跟 serveBizPage 那边已有的 `d && !d.error` 判断口径对齐——serveCuratedListPage
  // 和 warmCuratedListsCache 这两个调用方之前都没有这道检查。
  if (d && (rankRes.status !== 200 || d.error)) {
    console.error('[resolver] fetchLeaderboardData: analytics 返回错误 status=' + rankRes.status, d.error || '', d.message || '')
    d = null
  }
  if (!d) return null
  d.filters = { metric, industry, province, sizeCode, natCode, fiscalYear }
  const secRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/industry-sections', { accept: 'application/json' })
  if (secRes && secRes.body) { try { d.industrySections = JSON.parse(secRes.body).sections || [] } catch { /* */ } }
  await ensureProvincesLoaded()
  d.provinceList = allProvinces().map(p => ({ slug: p.slug, name: p.name }))
  d._page = page
  d._perPage = perPage
  d._basePath = basePath
  return d
}

// 精选命名榜单(/top-100-thai-food-companies.html 等扁平 URL,见 curatedLists.js)——复用
// /business-leaderboards 的 WooCMS 模板壳(同一套 data-biz-fill 槽),换成固定预设筛选 +
// 手写 SEO 文案(不是自动生成的),不走查询参数。hasData:false 走占位("数据录入中")渲染。
async function serveCuratedListPage(list, req, res, url) {
  const pathLang = /^\/zh(\/|$)/.test(url.pathname) ? 'zh' : (/^\/th(\/|$)/.test(url.pathname) ? 'th' : '')
  const lang = pathLang || langFromHost(req.headers.host)
  const shellPath = (pathLang ? '/' + pathLang : '') + '/business-leaderboards'
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, shellPath, req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  let html = shell.body
  // hero 大标题/引导语要跟着具体榜单变,不能全部 22 个精选榜单共用同一句通用文案(WooCMS 壳
  // 里那句 <wc-t> 是 /business-leaderboards 自己的通用文案,这里直接在服务端拼好的 HTML 上
  // 做定向替换,不影响没有匹配到的其它页面)。desc 里的 " — "/"——" 换成真换行符(配合
  // .biz-report-lead 的 white-space:pre-line),不是塞 <br> 标签——这段文字来自 seoT() 三语
  // 挑选后的纯字符串,不经过 <wc-t>/cms_ui_strings 那套转义,可以放心用 esc() 转义后原样插入。
  const titleTextForHero = seoT(lang, list.title.en, list.title.th, list.title.zh)
  const leadTextForHero = seoT(lang, list.desc.en, list.desc.th, list.desc.zh).replace(/\s+—\s+|——/g, '\n')
  html = html.replace(/(<h1 id="leaderboards-title">)[\s\S]*?(<\/h1>)/, (m, open, close) => open + escHtml(titleTextForHero) + close)
  html = html.replace(/(<p class="biz-report-lead">)[\s\S]*?(<\/p>)/, (m, open, close) => open + escHtml(leadTextForHero) + close)
  if (!list.hasData) {
    html = injectBizSlots(html, { _placeholder: true, placeholderText: list.desc, items: [], total: 0, filters: {} }, lang, null)
  } else {
    const f = list.filters || {}
    // 精选榜单固定只展示 Top N(N = f.limit,如 100/500),不接受 ?page= 翻页——不给采集者一个
    // 翻页接口把"前 100/500 名之外"的公司也扒走;page 硬编码成 1,perPage 直接用列表自己声明的
    // limit(不再套 100 的人为上限,否则"Top 500 中资企业"那张榜单其实只会返回前 100 家)。
    // 财年是唯一允许 ?year= 覆盖的维度(2026-07-06 新增,跟 /business-leaderboards 一致的
    // 读取方式)——metric/行业/国别这些精选榜单的固定预设不接受覆盖,只有财年切换不影响 SEO
    // (道理见 biz.js rankingYearSelect 边上的注释),所以单独放开。
    const perPage = Math.min(f.limit || 24, 500)
    const fiscalYear = parseInt(url.searchParams.get('year'), 10) || 0
    const d = await fetchLeaderboardData({
      metric: f.metric || 'revenue', industry: f.industry || '', province: f.province || '',
      sizeCode: f.sizeCode || '', natCode: f.natCode || '', fiscalYear, page: 1, perPage, basePath: url.pathname,
    })
    if (d) { d._hideFilters = true; d._hidePager = true; d._reasonTemplate = list.reasonTemplate || null; html = injectBizSlots(html, d, lang, null) }
  }
  const titleText = seoT(lang, list.title.en, list.title.th, list.title.zh)
  const seo = {
    title: brandTitle(titleText),
    description: seoT(lang, list.desc.en, list.desc.th, list.desc.zh),
    keywords: [titleText, seoGenericKeywords(lang)],
    canonical: canonicalHref(req, localePrefixOf(lang) + url.pathname),
    lang,
    noindex: list.hasData === false,
  }
  html = applySeo(html, seo)
  // 精选榜单只缓存固定的无参数落地页；年份变体保持动态且不进入共享缓存。
  sendHtml(req, res, url, html, !url.search)
}

// 精选榜单缓存预热:这 19 个(hasData:true)榜单筛选条件固定不变、数据本来就是一周才刷新一次,
// 不该让"analytics 那个 crossCache 10 分钟过期后,下一个真实访客"去承担一次几百毫秒到 2 秒的
// 现查询代价(2026-07-05 实测:制造/食品这类候选集大的榜单冷查询要 1.5~2 秒)。这里直接复用
// fetchLeaderboardData——跟真实请求走同一个函数、写进 analytics 同一个 crossCache,不用另外
// 维护一份筛选条件——每 8 分钟(小于 crossCache 10 分钟 TTL)重新查一遍全部榜单,缓存永远不过期,
// 数据也就跟着 analytics 自己的刷新节奏自动更新,不需要另外感知 ETL 什么时候跑完。逐个顺序
// 请求 + 间隔,不并发轰炸 analytics/DB(参照项目里"别把磁盘 IO 打爆"的一贯纪律)。
const CURATED_WARM_INTERVAL_MS = 8 * 60 * 1000
async function warmCuratedListsCache() {
  for (const list of CURATED_LISTS) {
    if (!list.hasData) continue
    const f = list.filters || {}
    try {
      const d = await fetchLeaderboardData({
        metric: f.metric || 'revenue', industry: f.industry || '', province: f.province || '',
        sizeCode: f.sizeCode || '', natCode: f.natCode || '', page: 1,
        perPage: Math.min(f.limit || 24, 500), basePath: '/' + list.slug + '.html',
      })
      // fetchLeaderboardData 上游偶发失败时静默返回 null(不抛异常),这里补一条日志——
      // 不然这种"没报错但也没缓存成功"的情况完全看不出来,下一轮(8 分钟后)会自动重试补上。
      if (!d) console.error('[resolver] warmCuratedListsCache got empty result for', list.slug)
    } catch (e) { console.error('[resolver] warmCuratedListsCache failed for', list.slug, e && e.message) }
    await new Promise(r => setTimeout(r, 400))
  }
}

// ── 商业报告子页 SSR:取 WooCMS 壳 + 取 analytics 综合数据 + 服务端注入各 data-biz-fill 槽 ──
async function serveBizPage(req, res, url) {
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, url.pathname + (url.search || ''), req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  // 本地/本站 i18n 以 URL 路径前缀(/zh、/th)为准,而不是 langFromHost 认的子域名(cn./th.,生产多子域名
  // 部署用)——壳是按路径前缀渲染出对应语言的静态文案,注入内容的语言必须跟它一致。logicalPath 是去掉
  // 前缀后的"逻辑路径",下面所有按具体页面分支的判断都要用它(而不是带前缀的 url.pathname),否则
  // /zh/business-regional-investment-map 这类请求会因为字符串对不上而全部走进"什么都不做"的默认分支。
  const pathLang = /^\/zh(\/|$)/.test(url.pathname) ? 'zh' : (/^\/th(\/|$)/.test(url.pathname) ? 'th' : '')
  const lang = pathLang || langFromHost(req.headers.host)
  const logicalPath = pathLang ? url.pathname.slice(1 + pathLang.length) || '/' : url.pathname
  const sp = new URLSearchParams(url.search)
  // 地区排名 / 投资地图 / 排名汇总(府 grid)要全部 77 府(无显式 limit 时取全量)
  if ((logicalPath === '/regional-rankings' || logicalPath === '/business-regional-investment-map' || logicalPath === '/business-regional-rankings-summary') && !sp.get('limit')) sp.set('limit', '90')
  const sort = sp.get('sort') || 'capital_desc'
  const data = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/business?' + analyticsQuery(sp), { accept: 'application/json' })
  let d = null
  if (data && data.body) { try { d = JSON.parse(data.body) } catch { /* ignore */ } }
  // 投资地图行业透视:?industry=<term slug> → 用该行业的各府分布覆盖 provinceRanking + 标记交叉(府下钻到交叉页)
  if (logicalPath === '/business-regional-investment-map' && d && !d.error) {
    // 行业大类 chips(三语名,wc-data 不本地化故从 analytics 取)
    const secRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/industry-sections', { accept: 'application/json' })
    if (secRes && secRes.body) { try { d.industrySections = JSON.parse(secRes.body).sections || [] } catch { /* */ } }
    const ind = (sp.get('industry') || '').trim()
    if (ind) {
      const ipRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/industry-provinces?industry=' + encodeURIComponent(ind), { accept: 'application/json' })
      let ip = null
      if (ipRes && ipRes.body) { try { ip = JSON.parse(ipRes.body) } catch { /* */ } }
      if (ip && (ip.provinceRanking || []).length) {
        d.provinceRanking = ip.provinceRanking
        d.crossIndustry = ind
        d.crossIndustryName = ip.industryName
      }
    }
  }
  // 企业营收/利润排行榜:数据形状跟上面通用的 /business 快照完全不同(分页+多维筛选,
  // 查的是 thaicompany_financial_facts,不是 thaicompany_facts),整个 d 换成自己的取数,
  // 不复用上面已经打过的那次 /business 请求结果。
  if (logicalPath === '/business-leaderboards') {
    const metric = ['profitloss', 'growth'].includes(sp.get('metric')) ? sp.get('metric') : 'revenue'
    const industry = (sp.get('industry') || '').trim()
    const province = (sp.get('province') || '').trim()
    const sizeCode = (sp.get('size') || '').trim()
    const natCode = (sp.get('natCode') || '').trim()
    const fiscalYear = parseInt(sp.get('year'), 10) || 0
    const page = Math.max(1, parseInt(sp.get('page'), 10) || 1)
    const perPage = 24
    // OFFSET 封顶之外必然重复 → 先 404,再取数
    if (page > Math.floor(MAX_BROWSE_OFFSET / perPage) + 1) { sendPlain404(res); return }
    // pagerHtml 只会在 basePath 后追加 page=N,要保留翻页时的筛选状态就得把当前筛选参数
    // (不含 page 本身)先编进 basePath 里,不能翻页就把 metric/industry/province/size/natCode/year 丢光。
    const keepQs = new URLSearchParams()
    if (metric !== 'revenue') keepQs.set('metric', metric)
    if (industry) keepQs.set('industry', industry)
    if (province) keepQs.set('province', province)
    if (sizeCode) keepQs.set('size', sizeCode)
    if (natCode) keepQs.set('natCode', natCode)
    if (fiscalYear) keepQs.set('year', String(fiscalYear))
    const qsStr = keepQs.toString()
    const basePath = (pathLang ? '/' + pathLang : '') + logicalPath + (qsStr ? '?' + qsStr : '')
    d = await fetchLeaderboardData({ metric, industry, province, sizeCode, natCode, fiscalYear, page, perPage, basePath })
    if (d && !d.error) {
      const maxPage = maxBrowsePage(perPage, d.total)
      if (page > maxPage) { sendPlain404(res); return }
      // 分页器按封顶页数截断链接;真实 total 仍留给方法论/覆盖量文案展示
      d._pagerTotal = Math.min(Number(d.total) || 0, maxPage * perPage)
    }
  }
  let html = shell.body
  // nginx 代理这类 /th//zh/ 请求时已把前缀从 url.pathname 里剥掉(见 canonicalHref 边上的注释),
  // 这里用上面已经算对的 lang(pathLang||langFromHost)重新拼回去,不能只用 url.pathname 本身。
  // 排行榜参数变体统一 canonical 到无参落地页;其它业务页仍用完整 pathname+search。
  const canon = logicalPath === '/business-leaderboards'
    ? (localePrefixOf(lang) + '/business-leaderboards')
    : (localePrefixOf(lang) + url.pathname + (url.search || ''))
  let seo = businessSeo(logicalPath, sp, d && !d.error ? d : null, lang, canonicalHref(req, canon))
  if (d && !d.error) {
    html = injectBizSlots(html, d, lang, sort)
  }
  if (logicalPath === '/business-industry-overview') {
    html = await injectLocalizedIndustryTerms(html, req)
  }
  // 排名汇总页:地区下钻浏览(府 grid → 县 grid → 县公司报告);带 ?province/?district 时隐藏常规汇总
  if (logicalPath === '/business-regional-rankings-summary' && d && !d.error) {
    const provEng = (sp.get('province') || '').trim()
    const dslug = (sp.get('district') || '').trim()
    const page = Math.max(1, parseInt(sp.get('page'), 10) || 1)
    let browserHtml = ''
    if (provEng && dslug) {
      const dr = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/district-companies?district=' + encodeURIComponent(dslug) + '&limit=24&offset=' + ((page - 1) * 24), { accept: 'application/json' })
      let dd = null; if (dr && dr.body) { try { dd = JSON.parse(dr.body) } catch { /* */ } }
      browserHtml = renderRegionDistrictReport(dd || {}, provEng, lang, page)
      if (dd) seo = regionDrillSeo(flPick(dd.province, lang) || provEng, flPick(dd.district, lang) || dslug, lang, canonicalHref(req, canon))
    } else if (provEng) {
      await ensureProvincesLoaded()
      const prov = provinceByEngSlug(provEng)
      if (prov) {
        const pr = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/province-districts?province=' + encodeURIComponent(prov.slug), { accept: 'application/json' })
        let pd = null; if (pr && pr.body) { try { pd = JSON.parse(pr.body) } catch { /* */ } }
        browserHtml = renderRegionDistrictGrid(pd || {}, flPick(prov.name, lang), provEng, lang)
        seo = regionDrillSeo(flPick(prov.name, lang), '', lang, canonicalHref(req, canon))
      }
    } else {
      browserHtml = renderRegionProvinceGrid(d.provinceRanking, lang)
    }
    html = html.replace('<div data-region-browser></div>', '<div data-region-browser>' + browserHtml + '</div>')
    if (provEng) html = html.replace('data-region-summary>', 'data-region-summary hidden>') // 下钻时隐藏常规汇总
  }

  // 股东/老板搜索:owners 页带 ?q= 时,调 directors sidecar(8085)渲染人物结果注入 data-owner-results
  if (logicalPath === '/business-owner-shareholder-leads') {
    const qv = (sp.get('q') || '').trim()
    let resultsHtml = ''
    if (qv) {
      // 2026-07-12:搜索结果含真实姓名,改成登录会员可见——未登录时不去打 directors sidecar
      // (反正拿到也不展示),直接给登录提示。
      const viewerUid = await whoAmI(req.headers.cookie || '', req.headers['authorization'] || '', req.headers['x-session-token'] || '')
      if (!viewerUid) {
        resultsHtml = '<section class="biz-report-section biz-owner-results-sec"><div class="biz-report-section__head"><div><h2>' + escHtml(LBL(lang, 'ownerGateTitle')) + '</h2><p>' + escHtml(LBL(lang, 'ownerGateBody')) + '</p></div></div>' +
          '<p><button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escHtml(LBL(lang, 'signIn')) + '</button></p></section>'
      } else {
        // 公开页面的用户输入搜索,只按姓名匹配——显式传 mode=name,不依赖 sidecar 的默认值,
        // 避免以后 sidecar 默认行为变化时又意外重新开放匿名证件号反查。directors 服务自己也会
        // 核验登录态(见其 server.js 的 /search 处理),这里把原始请求的登录凭据转发过去,
        // 不能只带 accept 头——不然会被那边的登录门槛拦回 401。
        const qs = new URLSearchParams({ q: qv, mode: 'name', limit: '24', offset: '0' }).toString()
        const searchHeaders = { accept: 'application/json' }
        if (req.headers.cookie) searchHeaders.cookie = req.headers.cookie
        if (req.headers['authorization']) searchHeaders['authorization'] = req.headers['authorization']
        if (req.headers['x-session-token']) searchHeaders['x-session-token'] = req.headers['x-session-token']
        const sd = await fetchUpstream(config.directorsHost, config.directorsPort, '/api/site/v1/directors/search?' + qs, searchHeaders)
        let sdata = null
        if (sd && sd.body) { try { sdata = JSON.parse(sd.body) } catch { /* ignore */ } }
        resultsHtml = renderOwnerSearch(sdata, qv, lang)
      }
      // 搜索模式:只显结果,把常规分析内容整块隐藏
      html = html.replace('data-owner-analytics>', 'data-owner-analytics hidden>')
    }
    html = html.replace('<div data-owner-results></div>', '<div data-owner-results>' + resultsHtml + '</div>')
  }
  html = applySeo(html, seo)
  // 商业报告的年份/行业/府/规模/指标组合会产生高基数 URL；仅缓存经过设计的无参数落地页。
  sendHtml(req, res, url, html, !url.search)
}

// ── 筛选公司列表 SSR 页(/new-companies-<年>.html · /foreign-companies-<国>.html)──
// 取 hub 页壳(/business-reports,无客户端 JS 触发属性)+ 替换 <main> 为按语言渲染的筛选列表 main。
function flSlugify(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function flPick(obj, lang) { if (!obj) return ''; return lang === 'zh' ? (obj.zh || obj.en || obj.th) : lang === 'th' ? (obj.th || obj.en || obj.zh) : (obj.en || obj.th || obj.zh) }
function injectFilteredMain(shellBody, mainHtml, seo) {
  let html = shellBody.replace(/<main\b[^>]*>[\s\S]*<\/main>/, () => mainHtml)
  html = html.replace('biz-report-page biz-hub', 'biz-report-page biz-fl-root')
  return applySeo(html, seo)
}
function trendingSeo(metric, scope, scopeName, lang, canonical) {
  const metricName = metric === 'search'
    ? seoT(lang, 'search appearances', 'การปรากฏในผลค้นหา', '搜索曝光量')
    : seoT(lang, 'page views', 'ยอดเข้าชมหน้า', '页面浏览量')
  const scopeBit = scope !== 'global' && scopeName
    ? ' — ' + (lang === 'th' ? scopeName.th : (lang === 'zh' ? scopeName.zh : scopeName.en))
    : ''
  const title = brandTitle(seoT(lang,
    'Trending Thai companies by ' + metricName + scopeBit,
    'บริษัทไทยยอดนิยมตาม' + metricName + scopeBit,
    '热门泰国公司 · 按' + metricName + '排名' + scopeBit))
  const description = seoT(lang,
    'See which Thai companies are getting the most ' + metricName + ' on ' + BRAND_DOMAIN + ', ranked from real visitor activity with bot traffic excluded.',
    'ดูบริษัทไทยที่มี' + metricName + 'สูงสุดบน ' + BRAND_DOMAIN + ' จัดอันดับจากกิจกรรมผู้เยี่ยมชมจริง ไม่รวมบอท',
    '查看在 ' + BRAND_DOMAIN + ' 上' + metricName + '最高的泰国公司,基于真实访客行为排名(已排除爬虫流量)。')
  return {
    title,
    description,
    keywords: [seoT(lang, 'trending Thai companies', 'บริษัทไทยยอดนิยม', '泰国热门公司'), seoT(lang, 'popular companies Thailand', 'บริษัทยอดนิยมในไทย', '泰国人气企业'), seoGenericKeywords(lang)],
    canonical,
    lang,
  }
}
// 人气排行页(/trending-companies · 扁平变体 /trending-<metric>-industry|region-<slug>.html):
// 壳借用 /business-reports(与 serveYearCompanies 同一手法,不需要专门建 cms_pages 页面),
// 真正内容由 injectFilteredMain 整块替换 <main>。
// metric=views|search(默认 views)、scope=global|province|industry(默认 global)、
// scope 非 global 时 value=<term slug>——见 analytics fetchTrending 同名参数。
// flat 参数:命中扁平 URL 路由时传 {metric,scope,value}(见下方路由表),跳过 query string 解析
// ——全站默认榜(无 scope)参数少,仍走 ?metric= 这一种,没有拆扁平 URL(行业 19×地区 77 才是
// 参数爆炸的大头,见 CLAUDE.md 记忆 bizthai-popularity-view-tracking 第十轮)。
async function serveTrendingPage(req, res, url, flat) {
  const lang = langFromReq(req, url)
  let metric, scope, value
  if (flat) {
    metric = flat.metric
    scope = flat.scope
    value = flat.value
  } else {
    const sp = new URLSearchParams(url.search)
    metric = sp.get('metric') === 'search' ? 'search' : 'views'
    // 三个下拉筛选(排名指标/行业/地区,见 biz.js trendScopeHero)提交的是 industry/region 两个
    // 字段名,不是旧版 chips 用的 scope/value——两个字段互斥,industry 有值优先(没有 JS 时,浏览器
    // 原生 <form> 提交可能把两个字段都带上,这里兜底选一个,不报错)。
    const industry = (sp.get('industry') || '').trim()
    const region = (sp.get('region') || '').trim()
    scope = industry ? 'industry' : (region ? 'province' : 'global')
    value = industry || region
  }
  // 时间窗口(24h/7d/30d):跟 flat/非 flat 是两个独立维度,扁平行业/地区榜单也能叠加
  // ?window=,不放进 canonical/flat URL——跟排行榜页的 year 是同一个道理,时间窗口不需要 SEO。
  const windowRaw = (new URLSearchParams(url.search).get('window') || '').trim()
  const timeWindow = ['24h', '7d', '30d'].includes(windowRaw) ? windowRaw : undefined
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/business-reports', req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }

  const trendQuery = 'metric=' + encodeURIComponent(metric) + '&scope=' + encodeURIComponent(scope) +
    (value ? '&value=' + encodeURIComponent(value) : '') + (timeWindow ? '&window=' + timeWindow : '') + '&limit=20'
  const [trendRes, sectionsRes, regionsRes] = await Promise.all([
    fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/trending?' + trendQuery, { accept: 'application/json' }),
    fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/industry-sections', { accept: 'application/json' }),
    fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/regions', { accept: 'application/json' }),
  ])
  let items = [], sections = [], provinces = []
  if (trendRes && trendRes.body) { try { items = (JSON.parse(trendRes.body).data || {}).items || [] } catch { /* ignore */ } }
  if (sectionsRes && sectionsRes.body) { try { sections = JSON.parse(sectionsRes.body).sections || [] } catch { /* ignore */ } }
  if (regionsRes && regionsRes.body) { try { provinces = JSON.parse(regionsRes.body).provinces || [] } catch { /* ignore */ } }

  let scopeName = null
  if (scope === 'industry') scopeName = (sections.find(s => s.slug === value) || {}).name || null
  if (scope === 'province') { const p = provinces.find(pp => pp.slug === value); if (p) scopeName = p.name }

  // pathLangOf(url) 在这类请求上永远判空(nginx 已把 /th//zh/ 前缀从路径里剥掉),必须用已经
  // 正确兜底到 Host 的 lang,不能只看路径。
  const localePrefix = localePrefixOf(lang)
  const main = renderTrendingMain({
    lang, metric, scope, value, scopeName, items, window: timeWindow,
    industrySections: sections, provinces, basePath: localePrefix + '/trending-companies', localePrefix,
  })
  // canonical 统一指向扁平 URL(不管这次请求是走旧的 ?industry=/?region= 还是新扁平路由命中的,
  // 两者渲染同一份内容,用 canonical 收敛,不需要额外 301——刚上线不久,搜索引擎还没收录多少旧
  // 参数 URL)。全站默认榜(scope=global)参数少,canonical 仍是 ?metric= 这种,不用拆。
  const canonicalPath = scope === 'global'
    ? localePrefix + '/trending-companies' + (metric === 'search' ? '?metric=search' : '')
    : localePrefix + '/trending-' + metric + '-' + (scope === 'industry' ? 'industry' : 'region') + '-' + encodeURIComponent(value) + '.html'
  const seo = trendingSeo(metric, scope, scopeName, lang, canonicalHref(req, canonicalPath))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(injectFilteredMain(shell.body, main, seo))
}
async function serveYearCompanies(yearStr, req, res, url) {
  const lang = langFromReq(req, url)
  const sp = new URLSearchParams(url.search)
  const page = Math.max(1, parseInt(sp.get('page'), 10) || 1)
  const offset = (page - 1) * 24
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/business-reports', req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  const dataRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/companies-by-year?year=' + encodeURIComponent(yearStr) + '&limit=24&offset=' + offset, { accept: 'application/json' })
  let d = null; if (dataRes && dataRes.body) { try { d = JSON.parse(dataRes.body) } catch { /* */ } }
  const curYear = new Date().getFullYear()
  const years = []; for (let y = curYear; y >= curYear - 11; y -= 1) years.push(y)
  const main = renderYearMain(d, yearStr, lang, page, years)
  const yearLocalePrefix = localePrefixOf(lang)
  const seo = yearSeo(yearStr, lang, canonicalHref(req, yearLocalePrefix + '/new-companies-' + yearStr + '.html'))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(injectFilteredMain(shell.body, main, seo))
}
async function serveNatCompanies(slug, req, res, url) {
  const lang = langFromReq(req, url)
  const sp = new URLSearchParams(url.search)
  const page = Math.max(1, parseInt(sp.get('page'), 10) || 1)
  const offset = (page - 1) * 24
  // 取国籍列表:解析 slug→code + 渲染 chips
  const natRes = await fetchUpstream(config.analyticsHost, config.analyticsPort, '/api/site/v1/analytics/business?foreignLimit=30', { accept: 'application/json' })
  let nats = []; if (natRes && natRes.body) { try { nats = (JSON.parse(natRes.body).foreignComposition || {}).nationalities || [] } catch { /* */ } }
  const match = nats.find(n => flSlugify(n.name && n.name.en) === slug)
  if (!match) { proxyTo(req.url || url.pathname, req, res); return } // 未知国家 → 回退(WooCMS 404)
  const code = String(match.code || '').toUpperCase()
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, '/business-reports', req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  const dataRes = await fetchUpstream(config.directorsHost, config.directorsPort, '/api/site/v1/directors/by-nationality?nt=' + encodeURIComponent(code) + '&limit=24&offset=' + offset, { accept: 'application/json' })
  let d = null; if (dataRes && dataRes.body) { try { d = JSON.parse(dataRes.body) } catch { /* */ } }
  const countryName = flPick(match.name, lang)
  const main = renderNatMain(d, countryName, slug, nats, lang, page)
  const natLocalePrefix = localePrefixOf(lang)
  const seo = countrySeo(countryName, lang, canonicalHref(req, natLocalePrefix + '/foreign-companies-' + slug + '.html'))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(injectFilteredMain(shell.body, main, seo))
}

// 府扁平 URL:/<英文名>.html(如 /bangkok.html)→ 该府公司列表。仅 77 个府 engslug 命中,优先于公司解析。
async function resolveProvinceFlat(pathname) {
  const clean = pathname.replace(/\/+$/, '')
  if (!/\.html$/i.test(clean)) return null
  let file = clean.slice(clean.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  try { file = decodeURIComponent(file) } catch { /* */ }
  file = String(file).toLowerCase()
  if (!file || !/^[a-z0-9-]+$/.test(file)) return null
  await ensureProvincesLoaded()
  const p = provinceByEngSlug(file)
  return p ? { slug: p.slug, eng: file } : null
}
async function serveProvinceFlat(provSlug, eng, req, res, url) {
  const target = '/t/province/' + encodeURIComponent(provSlug) + (url.search || '')
  const up = await fetchUpstream(config.woocmsHost, config.woocmsPort, target, req.headers)
  if (!up || up.status !== 200 || !up.body) { proxyTo(target, req, res); return }
  const lang = langFromReq(req, url)
  const prov = provinceByEngSlug(eng)
  const provName = flPick(prov && prov.name, lang) || firstHtmlText(up.body, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || eng
  // canonical 必须自我指向当前语言前缀版本,否则跟下面注入的 hreflang alternate 打架
  // (Google 会认为 canonical 与 hreflang 冲突,可能整组 hreflang 都被判无效)。
  const localePrefix = localePrefixOf(lang)
  const html = applySeo(up.body, provinceSeo(provName, lang, canonicalHref(req, localePrefix + '/' + eng + '.html' + (url.search || ''))))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// ── SEO sitemap:XML 端点直接吐纯文本/XML,HTML 落地页走"取 WooCMS 壳 + 注入内容"同款套路 ──
function sendXml(res, xml) {
  // no-cache(而非禁止缓存)= 允许缓存但必须先跟服务器 revalidate,搜索引擎/浏览器都不会长期攥着一份
  // 旧内容不放——公司数据会随批量导入变化,sitemap 又没有版本号可做 cache-busting,这个总比默认的
  // 浏览器启发式缓存(容易让人对着一份改动前的旧 <loc> 列表点来点去、越点越糊涂)稳妥。
  res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(xml)
}
async function serveSitemapPage(req, res, url) {
  const shell = await fetchUpstream(config.woocmsHost, config.woocmsPort, url.pathname, req.headers)
  if (!shell || shell.status !== 200 || !shell.body) { proxyTo(req.url || url.pathname, req, res); return }
  // 本地/本站 i18n 以 URL 路径前缀(/zh、/th)为准,而不是 langFromHost 认的子域名(cn./th.,生产多子域名部署用)——
  // 壳是按路径前缀渲染出对应语言的 hero,注入内容的语言必须跟它一致,否则中文 hero 配英文分类列表会很怪。
  const pathLang = /^\/zh(\/|$)/.test(url.pathname) ? 'zh' : (/^\/th(\/|$)/.test(url.pathname) ? 'th' : '')
  const lang = pathLang || langFromHost(req.headers.host)
  const content = await buildSitemapPageContent(req, lang)
  let html = shell.body.replace(/<div([^>]*\bdata-sitemap-content\b[^>]*)>[\s\S]*?<\/div>/, (m, attrs) => '<div' + attrs + '>' + content + '</div>')
  html = applySeo(html, sitemapSeo(lang, canonicalHref(req, localePrefixOf(lang) + url.pathname)))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${config.port}`)
    const pathname = url.pathname

    // 畸形堆叠语言前缀兜底(如 /zh/th/xxx.html):resolveJpNo 等路由只认路径最后一段文件名,
    // 对前面几层前缀不做校验,会把这类畸形路径当合法请求 200 放行;再经 hreflangLinks 只剥
    // 一层前缀,会在 <head> 里自我衍生出更畸形的 hreflang alternate,被爬虫收录、越滚越畸形
    // (2026-07-07 排查记录)。只保留最外层(第一层)前缀,301 收敛到干净路径。
    const dupPrefixMatch = pathname.match(/^\/(zh|th)((?:\/(?:zh|th))+)(\/.*|$)/)
    if (dupPrefixMatch) {
      const cleanPath = '/' + dupPrefixMatch[1] + (dupPrefixMatch[3] || '')
      res.writeHead(301, { Location: cleanPath + url.search })
      res.end()
      return
    }

    // 生产 nginx 的路径语言代理会先剥掉最外层前缀，并用内部 Host 传递该语言：
    // 公网 /th/zh/foo 到这里会变成 pathname=/zh/foo、Host=th.bizthai.com、
    // X-Forwarded-Host=bizthai.com。此时上面的原始路径检查已经看不到两层前缀。
    // 只在“内部语言 Host + 公网无语言 Host + 路径仍带语言”同时成立时判为堆叠，
    // 避免影响直接访问 resolver 或历史语言子域名的正常请求。
    const proxyLang = langFromHost(req.headers.host)
    const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    const forwardedLang = langFromHost(forwardedHost)
    const residualPathLang = pathLangOf(url)
    if (residualPathLang && (proxyLang === 'th' || proxyLang === 'zh') &&
        forwardedHost && forwardedLang === 'en') {
      const rest = pathname.replace(/^\/(?:zh|th)(?=\/|$)/, '') || '/'
      res.writeHead(301, { Location: '/' + proxyLang + rest + url.search })
      res.end()
      return
    }

    if (await serveCompanyView(req, res, url)) return
    if (serveHtmlCacheHit(req, res, url)) return

    if (pathname === HEALTH) {
      const ok = await indexPresent().catch(() => false)
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok, index: 'idx_thaicompany_nameslug', cacheSize: cache.size, htmlCacheSize: htmlCache.size }))
      return
    }

    // SEO sitemap:robots.txt + xml 索引/子文件 + html 落地页(遮蔽 WooCMS 原生 /sitemap.xml,见 sitemap.js 文件头注释)
    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      res.end(await buildRobotsTxt(req, config.sitemapToken)); return
    }
    // Google AdSense ads.txt（授权广告商声明）。内容与 /www/wwwroot/bizthai/static/ads.txt 保持一致。
    if (pathname === '/ads.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      res.end('google.com, pub-1847992822457652, DIRECT, f08c47fec0942fa0\n')
      return
    }
    // llms.txt / llms-full.txt:遮蔽 WooCMS 原生端点(内核自带的后台 API 文档索引,不是站点内容
    // 说明,详见 sitemap.js buildLlmsTxt 头部注释)。nginx 需把两条路径都转发到 9186,见 bizthai.com.conf。
    if (pathname === '/llms.txt' || pathname === '/llms-full.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(buildLlmsTxt(req)); return }
    // Bing 站长验证(XML 文件法,Bing 官方三大验证法之一):把验证码以 /BingSiteAuth.xml 静态吐出。
    // WooCMS 自己不生成 <head>、也没有自定义 head 设置,首页又直连 WooCMS 不经本服务,故不用 meta 法,
    // 改由本服务在根路径直接出这个文件(需 nginx 把 /BingSiteAuth.xml 转发到 9186,见 bizthai.com.conf)。
    if (pathname === '/BingSiteAuth.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
      res.end('<?xml version="1.0"?>\n<users>\n  <user>5326159E37AB264DEDE8348114C3EAE1</user>\n</users>\n')
      return
    }
    // 浏览器端 XSLT 样式表(各 sitemap 头部 <?xml-stylesheet?> 引用它,把裸 XML 渲染成可点击表格)。
    // 不含任何公司 URL、只是展示样式,故不参与密名、固定在 /sitemap.xsl;必须同源,nginx 已转发。
    if (pathname === '/sitemap.xsl') { res.writeHead(200, { 'Content-Type': 'text/xsl; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }); res.end(buildSitemapXsl()); return }
    // 公开 sitemap:每种语言独立索引(路径前缀型)
    //   /sitemap.xml | /th/sitemap.xml | /zh/sitemap.xml
    // nginx 对 /th/*|/zh/* 会剥前缀并改 Host 为 th.|cn.bizthai.com 再反代,
    // 因此 /th/sitemap.xml 到达本服务时 pathname=/sitemap.xml、Host=th.bizthai.com。
    if (pathname === SM_PUBLIC.index || pathname === '/th/sitemap.xml' || pathname === '/zh/sitemap.xml') {
      const hostLang = langFromHost(req.headers.host)
      const pathLang = pathname === '/th/sitemap.xml' ? 'th' : (pathname === '/zh/sitemap.xml' ? 'zh' : '')
      const lang = pathLang || (hostLang === 'th' || hostLang === 'zh' ? hostLang : 'en')
      sendXml(res, await buildSitemapIndex(req, SM_PUBLIC, lang)); return
    }
    // 旧扁平别名 → 路径前缀型
    if (pathname === '/sitemap-th.xml') { res.writeHead(301, { Location: '/th/sitemap.xml' }); res.end(); return }
    if (pathname === '/sitemap-zh.xml') { res.writeHead(301, { Location: '/zh/sitemap.xml' }); res.end(); return }
    const coreLang = parseCoreShardPath(pathname)
    if (coreLang) { sendXml(res, await buildCoreSitemap(req, coreLang)); return }
    // 旧 /sitemap-core.xml → 英文 core(兼容)
    if (pathname === '/sitemap-core.xml') { sendXml(res, await buildCoreSitemap(req, 'en')); return }
    const publicLangCompany = parseCompanyShardPath(pathname)
    if (publicLangCompany) {
      const r = await buildCompaniesSitemap(req, publicLangCompany.pageNum, publicLangCompany.lang)
      if (r.isEmpty) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
      sendXml(res, r.xml); return
    }
    // 旧公开路径别名(不再进索引,但仍 200,避免历史提交突然 404)
    if (pathname === SM_PUBLIC.pages) { sendXml(res, await buildPagesSitemap(req)); return }
    if (pathname === SM_PUBLIC.taxonomy) { sendXml(res, await buildTaxonomySitemap(req)); return }
    if (pathname === SM_PUBLIC.posts) { sendXml(res, await buildPostsSitemap(req)); return }
    const publicSmCompany = pathname.match(SM_PUBLIC.companiesRe)
    if (publicSmCompany) { const r = await buildCompaniesSitemap(req, parseInt(publicSmCompany[1], 10), 'en'); if (r.isEmpty) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return } sendXml(res, r.xml); return }
    // 密名 token 路径(旧 GSC 提交兼容,结构仍为 pages/taxonomy/companies-N)
    if (pathname === SM.index) { sendXml(res, await buildSitemapIndex(req, SM)); return }
    if (pathname === SM.pages) { sendXml(res, await buildPagesSitemap(req)); return }
    if (pathname === SM.taxonomy) { sendXml(res, await buildTaxonomySitemap(req)); return }
    if (pathname === SM.posts) { sendXml(res, await buildPostsSitemap(req)); return }
    const smCompany = pathname.match(SM.companiesRe)
    if (smCompany) { const r = await buildCompaniesSitemap(req, parseInt(smCompany[1], 10)); if (r.isEmpty) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return } sendXml(res, r.xml); return }
    // 所有其它 /sitemap*.xml 猜名请求 → 404，绝不透传给 WooCMS 原生 sitemap。
    if (config.sitemapToken && SM_LEGACY_RE.test(pathname)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return }
    // /sitemap 落地页:兼容 /zh|/th 语言前缀(WooCMS 原生页面路由本身认得这两个前缀,壳能正常吐出
    // 对应语言的 hero;资源不接前缀路由的话请求会落到下面兜底 WooCMS,壳能出但 data-sitemap-content
    // 永远空,因为“往里注内容”这一步只有 resolver 会做)
    if (/^(?:\/(?:zh|th))?\/sitemap$/.test(pathname)) { await serveSitemapPage(req, res, url); return }

    // 合并重复页:企业查询→全部公司目录;地区排名(business-*)→ /regional-rankings(header 导航的正主)。
    // 正则的可选前缀组同时吃掉裸路径和 /zh|/th 前缀路径,跳转要带上同一前缀,否则语言态会跳丢。
    const BIZ_REDIRECT = { '/business-company-lookup': '/companies', '/business-regional-ranking': '/regional-rankings' }
    const bizRedirectMatch = pathname.match(/^(?:\/(zh|th))?(\/business-(?:company-lookup|regional-ranking))$/)
    if (bizRedirectMatch && BIZ_REDIRECT[bizRedirectMatch[2]]) {
      const prefix = bizRedirectMatch[1] ? '/' + bizRedirectMatch[1] : ''
      res.writeHead(301, { Location: prefix + BIZ_REDIRECT[bizRedirectMatch[2]] })
      res.end(); return
    }

    // 全部公司目录:/companies 与 /companies.html(及 /zh|/th 前缀)一律走 SSR 列表+真分页。
    // nginx 对无扩展名走 location = /companies,对 .html 走 location ~ \.html$ → 本服务;
    // 若不匹配 .html 变体,会落到 proxyTo(WooCMS),带上旧子域 Link 头且无 SSR pager。
    if (/^(?:\/(?:zh|th))?\/companies(?:\.html)?$/i.test(pathname)) { await serveCompaniesPage(req, res, url); return }

    // 商业报告子页(无 .html 扩展;nginx 把 /business-* 反代到本服务)→ SSR 注入数据
    if (resolveBizPage(pathname)) { await serveBizPage(req, res, url); return }

    // 人气排行页(无 .html 扩展;nginx 把 /trending-companies 反代到本服务)→ SSR 注入数据
    if (/^(?:\/(?:zh|th))?\/trending-companies$/.test(pathname)) { await serveTrendingPage(req, res, url); return }

    // 人气排行页扁平 URL(按行业/地区):/trending-<views|search>-<industry|region>-<slug>.html——
    // 取代 ?metric=&industry=/?metric=&region= 那种参数多的 URL(用户反馈不利于 SEO)。带 .html
    // 后缀,走全站现成的 location ~ \.html$ → resolver 转发,不用改 nginx。
    const trendFlat = pathname.match(/^(?:\/(?:zh|th))?\/trending-(views|search)-(industry|region)-([a-z0-9-]+)\.html$/)
    if (trendFlat) {
      await serveTrendingPage(req, res, url, { metric: trendFlat[1], scope: trendFlat[2] === 'industry' ? 'industry' : 'province', value: trendFlat[3] })
      return
    }

    // 行业×府 交叉 SEO 页:/industry-<行业>-<府>.html(SSR 注入,爬虫可抓)
    const cross = await resolveCross(pathname)
    if (cross) { await serveCrossPage(cross, req, res, url); return }

    // 行业扁平 URL:/industry-<x>.html → /t/industry/<term-slug>,取壳后注入行业 SEO
    const indPath = await resolveIndustryPath(pathname)
    if (indPath) { await serveIndustryFlatPage(indPath, req, res, url); return }

    // 新注册按年份 / 外资按国家 的筛选公司列表 SSR 页(爬虫可抓)
    const ym = pathname.match(/^\/new-companies-(\d{4})\.html$/)
    if (ym) { await serveYearCompanies(ym[1], req, res, url); return }
    const nm = pathname.match(/^\/foreign-companies-([a-z0-9-]+)\.html$/)
    if (nm) { await serveNatCompanies(nm[1], req, res, url); return }

    const dirp = resolveDirector(pathname)
    if (dirp) { await serveDirectorPage(dirp.jpNo, dirp.cmtSeq, req, res, url); return }

    // 企业微站四个独立页面(首页/公司档案/产品分类/产品详情),扁平 /b2b-<slug>[-...].html,
    // 与 industry-/capital-/trending- 等扁平 SEO URL 同一手法。必须按"最具体先判定"的顺序——
    // resolveMicrosite(首页)的捕获组宽松到能吃下其余三种变体的整段路径,放最后兜底。
    const micrositeProduct = resolveMicrositeProduct(pathname)
    if (micrositeProduct) { await serveMicrositeProductPage(micrositeProduct.slug, micrositeProduct.productSlug, req, res, url); return }
    const micrositeProductsSlug = resolveMicrositeProducts(pathname)
    if (micrositeProductsSlug) { await serveMicrositeProductsPage(micrositeProductsSlug, req, res, url); return }
    const micrositeProfileSlug = resolveMicrositeProfile(pathname)
    if (micrositeProfileSlug) { await serveMicrositeProfilePage(micrositeProfileSlug, req, res, url); return }
    const micrositeSlug = resolveMicrosite(pathname)
    if (micrositeSlug) { await serveMicrositePage(micrositeSlug, req, res, url); return }
    // 畸形 /b2b-… 路径(如浏览器缓存了旧的重定向死循环,带一长串 .html.html…,或不存在的产品 slug)
    // 直接 404,不透传给 WooCMS——WooCMS 对无法解析的 permalink slug 会报 500 而不是 404(上游行为,
    // 这里做兜底拦截,避免用户端看到 500)。
    if (/^(?:\/(?:zh|th))?\/b2b-/.test(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }

    // capital-XX.html 国别薄页 → noindex（保留 thai-capital / foreign-capital）
    if (/^(?:\/(?:zh|th))?\/capital-[a-z]{2}\.html$/.test(pathname)) {
      await serveCapitalCountryPage(req, res, url)
      return
    }

    // 精选命名榜单扁平 URL(/top-100-thai-food-companies.html 等,见 curatedLists.js)——
    // 固定的一份小名单(~20个),不是动态匹配,放在府扁平/公司 slug 解析之前拦截。
    const curatedMatch = pathname.match(/^(?:\/(?:zh|th))?\/([a-z0-9-]+)\.html$/)
    if (curatedMatch && CURATED_LIST_MAP.has(curatedMatch[1])) {
      await serveCuratedListPage(CURATED_LIST_MAP.get(curatedMatch[1]), req, res, url)
      return
    }

    // 府扁平 URL:/<英文名>.html → 该府公司列表(优先于公司 slug 解析;仅 77 个府命中)
    const provFlat = await resolveProvinceFlat(pathname)
    if (provFlat) { await serveProvinceFlat(provFlat.slug, provFlat.eng, req, res, url); return }

    const jpNo = await resolveJpNo(pathname)
    // 命中 → 服务端注入公司数据(SSR,爬虫可抓)再返回;未命中(或非公司 .html)→ 原样透传(WooCMS 404 页)
    if (jpNo) { await serveCompanyPage(jpNo, req, res, url); return }
    // 首页及普通无扩展名内容页统一经 resolver 重写 self-canonical、hreflang 和 SSR 文案。
    // API、资源文件和搜索结果不在这个兜底范围内。
    if ((req.method === 'GET' || req.method === 'HEAD') &&
        !/\.[a-z0-9]+$/i.test(pathname) &&
        !/^\/(?:api|admin|assets|uploads)(?:\/|$)/.test(pathname) &&
        !/^(?:\/(?:zh|th))?\/search(?:\/|$)/.test(pathname)) {
      await serveGenericSeoPage(req, res, url)
      return
    }
    proxyTo(req.url || pathname, req, res)
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('resolver error: ' + (e && e.message || e))
  }
})

server.listen(config.port, config.bindHost, () => {
  console.log(`[resolver] listening on ${config.bindHost}:${config.port} → WooCMS ${config.woocmsHost}:${config.woocmsPort}`)
  if (!config.disableWarmup) {
    warmCuratedListsCache()
    const curatedWarmTimer = setInterval(warmCuratedListsCache, CURATED_WARM_INTERVAL_MS)
    if (curatedWarmTimer.unref) curatedWarmTimer.unref()
  }
})
