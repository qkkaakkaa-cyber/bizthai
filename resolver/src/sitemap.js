// SEO sitemap:XML(索引 + 分页公司/静态页/分类页/文章)+ HTML 落地页 + robots.txt。
//
// 为什么不用 WooCMS 原生 /sitemap.xml:实测该内置端点硬编码只出前 5000 条(全站发布公司
// 194.7 万家,覆盖不到 0.3%),且公司链接用 `/c/thaicompany/{jpNo}` 通用 CPT 路由(不经过本
// resolver 的 SSR 注入,business/profile/directors/contact 面板全是空 div,canonical 自我指向该
// 野路径)——等于给搜索引擎提交了一堆重复空壳页。闭源二进制改不了,所以在 nginx 层把
// /sitemap.xml、/sitemap-*.xml、/robots.txt、/sitemap 分流到本服务,原生端点被永久遮蔽。
//
// URL 来源口径(每类都实测验证过 200,不是照抄 cms_permalink_routes 了事):
//   - 公司:cms_permalink_routes(entity_type=cpt_entry)存的就是真实 flat URL,直接用。
//   - 静态页:cms_pages.slug 拼 `/{slug}`(cms_permalink_routes 对 page 存的是历史遗留的
//     `{slug}.html` 形态,从未被真实路由使用,不能用;实测 curl 验证过)。
//   - industry/capital/companytype 分类:cms_permalink_routes(entity_type=cpt_term)的 flat
//     URL 直接可用(顶层+子类都实测 200)。
//   - province 分类:cms_permalink_routes 对它存的是形如 `/province-prov<hash>.html` 的路径,
//     实测 404(死链,疑似批量迁移脚本的副产物,从未接入真实路由)。真实友好 URL 是
//     `/{engslug}.html`(resolver 的 resolveProvinceFlat 用的同一套),且只有 77 个顶层府本身可用
//     ——province 分类下 8415 个县/乡级子项没有独立可用 URL(404),排除在外。
import { request as httpRequest } from 'node:http'
import { countPublishedCompanies, countAllPublishedCompanies, fetchCompanyPage, countPublishedPosts, fetchPostPage, fetchAllPages, fetchTaxonomyRoutes } from './db.js'
import { ensureProvincesLoaded, allProvinces } from './industry.js'
import { CURATED_LISTS } from './curatedLists.js'
import { config } from './config.js'

const COMPANIES_PER_FILE = 4000
// 公司分片命名:sitemap-company-{lang}-{letter}-{nnn}.xml
// letter 每 999 个分片进一位(a-001…a-999, b-001…),与语言正交。
const COMPANY_LETTER_SIZE = 999
const SITEMAP_LANGS = ['th', 'en']
const BRAND = 'BizThai'
const BRAND_DOMAIN = 'BizThai.com'
// 这两个页面的 cms_pages 记录只是 301 到别的规范 URL(见 server.js 的 BIZ_REDIRECT),
// sitemap 只应收录返回 200 的规范地址,重定向源地址不应该出现在 sitemap 里。
const REDIRECT_PAGE_SLUGS = new Set(['business-company-lookup', 'business-regional-ranking'])
const ACCOUNT_PAGE_SLUGS = new Set(['login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'account'])
const COMING_SOON_LIST_SLUGS = new Set(['top-100-companies-by-employees-in-thailand', 'top-100-exporters-in-thailand', 'top-100-ev-companies-in-thailand'])

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function t3(lang, en, th, zh) { return lang === 'th' ? th : (lang === 'zh' ? zh : en) }

// timestamptz 文本(如 "2026-06-21 19:22:10.779385+07")→ sitemap 协议要求的 W3C 日期(YYYY-MM-DD)
function toDate(ts) {
  const m = String(ts || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

// 公开 sitemap 一律用规范源站 bizthai.com。nginx 对 /th|/zh 会把 Host 改写成 th./cn.bizthai.com
// 再反代到本服务——绝不能把这些内部 Host 写进 <loc>。localhost 仅保留给本地调试。
function originFrom(req) {
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim().split(':')[0].toLowerCase()
  return host === 'en.bizthai.com' ? 'https://en.bizthai.com' : 'https://bizthai.com'
}

// nginx 剥掉 /th|/zh 前缀后靠 Host(th./cn./zh.bizthai.com) 标识语言；路径仍带前缀时也可识别。
function requestLang(req) {
  return originFrom(req) === 'https://en.bizthai.com' ? 'en' : 'th'
}

function localePrefix(lang) {
  return ''
}

// path 为英文规范路径(以 / 开头)；按请求语言给 <loc> 加 /th|/zh 前缀。hreflang 始终三语齐全。
function locFor(base, path, lang) {
  const p = ('/' + String(path || '/').replace(/^\/+/, '')).replace(/^(?:\/(?:th|en|zh))+(?=\/|$)/, '') || '/'
  const host = (lang || (base.includes('en.bizthai.com') ? 'en' : 'th')) === 'en' ? 'https://en.bizthai.com' : 'https://bizthai.com'
  return host + p
}

function hreflangAlternates(base, path) {
  return [{ hreflang: 'th', href: locFor(base, path, 'th') }, { hreflang: 'en', href: locFor(base, path, 'en') }, { hreflang: 'x-default', href: locFor(base, path, 'th') }]
}


// 所有 sitemap(索引 + 子文件)头部都挂这张 XSL:浏览器加载时渲染成可点击的 HTML 表格
// (索引页一级 → 点进子 sitemap 二级 → 点进具体 URL),爬虫仍读原始 XML(忽略这条 PI)。
// href 用根相对路径,保证与文档同源(浏览器安全策略要求 XSLT 样式表同源);nginx 需把 /sitemap.xsl
// 也转发到本服务(见 bizthai.com.conf 的 sitemap location 段)。
function xmlHeader() { return '<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n' }
function urlsetOpen(withHreflang) {
  return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' + (withHreflang ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '') + '>\n'
}
const URLSET_CLOSE = '</urlset>\n'

function urlEntry(loc, lastmod, alternates) {
  let s = '  <url>\n    <loc>' + esc(loc) + '</loc>\n'
  if (lastmod) s += '    <lastmod>' + esc(lastmod) + '</lastmod>\n'
  if (alternates) for (const a of alternates) s += '    <xhtml:link rel="alternate" hreflang="' + esc(a.hreflang) + '" href="' + esc(a.href) + '" />\n'
  s += '  </url>\n'
  return s
}

// ── 公司分片命名/解析 ──────────────────────────────────────────
export function companyShardParts(pageNum) {
  const idx = Math.max(0, (pageNum | 0) - 1)
  const letterIdx = Math.floor(idx / COMPANY_LETTER_SIZE)
  const letter = String.fromCharCode(97 + Math.min(25, letterIdx)) // a…z
  const num = String((idx % COMPANY_LETTER_SIZE) + 1).padStart(3, '0')
  return { letter, num }
}

export function companyShardPath(lang, pageNum) {
  const { letter, num } = companyShardParts(pageNum)
  return '/sitemap-company-' + lang + '-' + letter + '-' + num + '.xml'
}

export function parseCompanyShardPath(pathname) {
  const m = String(pathname || '').match(/^\/sitemap-company-(en|th|zh)-([a-z])-(\d{3})\.xml$/)
  if (!m) return null
  const lang = m[1]
  const letterIdx = m[2].charCodeAt(0) - 97
  const num = parseInt(m[3], 10)
  if (!(num >= 1 && num <= COMPANY_LETTER_SIZE)) return null
  return { lang, pageNum: letterIdx * COMPANY_LETTER_SIZE + num }
}

export function coreShardPath(lang) {
  return '/sitemap-core-' + lang + '.xml'
}

export function parseCoreShardPath(pathname) {
  const m = String(pathname || '').match(/^\/sitemap-core-(en|th|zh)\.xml$/)
  return m ? m[1] : null
}

// ── sitemap 全套路径。
// 公开:每种语言独立索引,互不混排(路径前缀型)
//   /sitemap.xml      → en: core-en + company-en-*
//   /th/sitemap.xml   → th: core-th + company-th-*
//   /zh/sitemap.xml   → zh: core-zh + company-zh-*
// token 非空:保留旧密名路径,兼容已提交到 Search Console 的记录。──
export function sitemapPaths(token) {
  const t = (token || '').trim()
  if (t) {
    return {
      kind: 'legacy',
      index: '/sitemap-' + t + '.xml',
      pages: '/sitemap-' + t + '-pages.xml',
      taxonomy: '/sitemap-' + t + '-taxonomy.xml',
      posts: '/sitemap-' + t + '-posts.xml',
      companies: (n) => '/sitemap-' + t + '-companies-' + n + '.xml',
      companiesRe: new RegExp('^/sitemap-' + t + '-companies-(\\d+)\\.xml$'),
    }
  }
  return {
    kind: 'lang',
    index: '/sitemap.xml',
    indexTh: '/th/sitemap.xml',
    indexZh: '/zh/sitemap.xml',
    core: (lang) => coreShardPath(lang),
    // 旧公开路径仍可访问(兼容),但不再出现在新索引里
    pages: '/sitemap-pages.xml',
    taxonomy: '/sitemap-taxonomy.xml',
    posts: '/sitemap-posts.xml',
    companies: (n) => '/sitemap-companies-' + n + '.xml',
    companiesRe: /^\/sitemap-companies-(\d+)\.xml$/,
    company: (lang, n) => companyShardPath(lang, n),
    companyRe: /^\/sitemap-company-(en|th|zh)-([a-z])-(\d{3})\.xml$/,
  }
}

// ── 内核「流量分析→封禁管理」的爬虫类别封禁 / 蜜罐诱饵路径,勾选「robots.txt 联动」后只会
// 写进 WooCMS 内核自己生成的 /robots.txt——但公网 /robots.txt 被 nginx 永久分流到本服务(见
// server.js),内核那份没人会看到,等于配了也白配。这里主动向内核问一次它自己的 /robots.txt,
// 把比默认输出(`User-agent: *` / `Allow: /` / `Sitemap:` 行)多出来的部分(具体哪些爬虫 UA 归
// 哪个类别是内核私有逻辑,不需要在这里重新实现,原样照抄即可)接到本服务的输出后面;内核没
// 配任何封禁/蜜罐时不会多出行,等于没有变化。5 分钟短缓存,避免每次 /robots.txt 请求都打一次内核。
const CORE_ROBOTS_TTL_MS = 300000
const CORE_ROBOTS_BASELINE = new Set(['User-agent: *', 'Allow: /'])
let coreRobotsExtraCache = { at: 0, lines: [] }

function fetchCoreRobotsTxt(host) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: config.woocmsHost, port: config.woocmsPort, method: 'GET', path: '/robots.txt', headers: { host } }, (up) => {
      let buf = ''
      up.setEncoding('utf8')
      up.on('data', (c) => { buf += c })
      up.on('end', () => resolve(buf))
      up.on('error', () => resolve(''))
    })
    req.on('error', () => resolve(''))
    req.setTimeout(3000, () => { req.destroy(); resolve('') })
    req.end()
  })
}

async function coreRobotsExtraLines(host) {
  const now = Date.now()
  if (now - coreRobotsExtraCache.at < CORE_ROBOTS_TTL_MS) return coreRobotsExtraCache.lines
  const body = await fetchCoreRobotsTxt(host)
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
    .filter(l => !CORE_ROBOTS_BASELINE.has(l) && !/^Sitemap:/i.test(l))
  coreRobotsExtraCache = { at: now, lines }
  return lines
}

// ── robots.txt(Sitemap: 行用本服务的规范 base,不依赖 WooCMS 原生生成、避免它 http/host 判定不准的问题)──
export async function buildRobotsTxt(req, token) {
  return 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /account\nDisallow: /search?*\nDisallow: /business-leaderboards?\nSitemap: ' + originFrom(req) + '/sitemap.xml\n'
}

// ── llms.txt(遮蔽 WooCMS 原生端点——那份是内核自带的"API 文档索引",列的是 site.auth.*/
// ai_gateway.* 这类后台接口,不是本站内容说明,格式也不含 Markdown 链接,过不了链接类审计。
// 本站是企业信息查询站,llms.txt 该描述的是"这站是干嘛的、该看哪些内容",不是甩内部接口清单。
// /llms-full.txt 复用同一份内容:全站 194.7 万家公司档案没有"完整版"可言,不像文档站那样能把
// 引用的页面全文内联,故不单独维护一份不同内容。)──
export function buildLlmsTxt(req) {
  const base = originFrom(req)
  const l = (path) => base + path
  return `# ${BRAND} — Thailand Company Registry & Business Intelligence

> ${BRAND_DOMAIN} publishes business information on companies registered in Thailand, sourced from the Department of Business Development (DBD) DataWarehouse+. Coverage includes registration details, director & shareholder records, filed financial statements, industry classification, and revenue/profit/growth rankings.

## Core

- [Company search](${l('/search')}): Search the registry by company name, registration number, or keyword.
- [All companies](${l('/companies')}): Browse all registered companies.
- [HTML sitemap](${l('/sitemap')}): Full index of pages, provinces, industries, capital origin, and company types.

## Rankings

- [Top revenue companies](${l('/top-100-thai-companies-by-revenue.html')}): Ranked from filed financial statements, not third-party estimates.
- [Most profitable companies](${l('/top-100-thai-companies-by-profit.html')})
- [Fastest-growing companies](${l('/top-100-fastest-growing-companies-in-thailand.html')})
- [Foreign-invested companies](${l('/top-100-foreign-owned-companies-in-thailand.html')}): Also broken out by capital origin — Chinese, Japanese, and Korean-invested company rankings are linked from this page.
- [Industry overview](${l('/business-industry-overview')}): Rankings by sector — manufacturing, retail, construction, hotels, hospitals, technology, real estate, logistics, agriculture, food & beverage, and more.
- [Regional rankings](${l('/regional-rankings')}): Company counts and investment by province.

## Reports

- [Foreign capital analysis](${l('/business-foreign-capital')})
- [New company registrations](${l('/business-new-registrations')})

## About this data

- [About ${BRAND}](${l('/about')})
- [About our data](${l('/about-our-data')}): Data source and coverage.
- [Data sources policy](${l('/data-sources-policy')})
- [Business verification policy](${l('/business-verification-policy')}): How listed information can be corrected or verified.
- [Disclaimer](${l('/disclaimer')})

## Notes

- Thai and Chinese translations of most pages are available under \`/th/\` and \`/zh/\` path prefixes (e.g. \`/th/companies\`, \`/zh/companies\`).
- Individual company profile pages use a flat, per-company URL (e.g. \`/{company-name}.html\`); start from Company search or All companies to find a specific one.
`
}

// ── sitemap 索引(单语)────────────────────────────────────────
// 公开(kind=lang):只列该语种的 core + company 分片,绝不混入其它语言。
// 密名(kind=legacy):沿用 pages/taxonomy/companies-N。
export async function buildSitemapIndex(req, paths, lang) {
  const base = originFrom(req)
  const [companiesTotal, postsTotal] = await Promise.all([countPublishedCompanies(), countPublishedPosts()])
  const companyPages = Math.max(1, Math.ceil(companiesTotal / COMPANIES_PER_FILE))
  let xml = xmlHeader() + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  const add = (loc) => { xml += '  <sitemap><loc>' + esc(base + loc) + '</loc></sitemap>\n' }

  if (paths.kind === 'lang') {
    const useLang = (lang === 'th' || lang === 'zh') ? lang : 'en'
    add(paths.core(useLang))
    // posts 目前无多语拆分需求;有内容时仅挂在英文索引,避免三份重复空壳
    if (postsTotal > 0 && useLang === 'en') add(paths.posts)
    for (let i = 1; i <= companyPages; i += 1) add(paths.company(useLang, i))
  } else {
    add(paths.pages)
    add(paths.taxonomy)
    if (postsTotal > 0) add(paths.posts)
    for (let i = 1; i <= companyPages; i += 1) add(paths.companies(i))
  }
  xml += '</sitemapindex>\n'
  return xml
}

// ── 核心(非公司)sitemap:仅单一语言的静态页 + 分类 + 精选榜单 ──
// hreflang 由 HTML 页面输出,sitemap 内不再交叉引用其它语言。
export async function buildCoreSitemap(req, lang) {
  const base = originFrom(req)
  const useLang = (lang === 'th' || lang === 'zh') ? lang : 'en'
  const pages = (await fetchAllPages()).filter(p => !REDIRECT_PAGE_SLUGS.has(p.slug) && !ACCOUNT_PAGE_SLUGS.has(p.slug))
  const [routes] = await Promise.all([fetchTaxonomyRoutes(), ensureProvincesLoaded()])
  let xml = xmlHeader() + urlsetOpen(false)
  const keepCapital = new Set(['/capital-thai-capital.html', '/capital-foreign-capital.html'])
  const emit = (path, updatedAt) => {
    if (/^\/capital-/.test(path) && !keepCapital.has(path)) return
    xml += urlEntry(locFor(base, path, useLang), toDate(updatedAt), null)
  }
  for (const p of pages) {
    const path = p.slug === 'home' ? '/' : '/' + p.slug
    emit(path, p.updatedAt)
  }
  for (const l of CURATED_LISTS) {
    if (l.hasData === false || COMING_SOON_LIST_SLUGS.has(l.slug)) continue
    emit('/' + l.slug + '.html', '')
  }
  for (const r of routes) emit(r.path, r.updatedAt)
  for (const p of allProvinces()) emit('/' + p.engslug + '.html', '')
  xml += URLSET_CLOSE
  return xml
}

// ── 静态页 sitemap:home 特判成 `/`;zh/th 有独立可用前缀 URL(实测 200),带 hreflang 互链;
// en 前缀会 301 回无前缀规范位,不再单独作为 alternate 目标。──
export async function buildPagesSitemap(req) {
  const base = originFrom(req)
  const lang = requestLang(req)
  const pages = (await fetchAllPages()).filter(p => !REDIRECT_PAGE_SLUGS.has(p.slug) && !ACCOUNT_PAGE_SLUGS.has(p.slug))
  let xml = xmlHeader() + urlsetOpen(true)
  for (const p of pages) {
    const path = p.slug === 'home' ? '/' : '/' + p.slug
    xml += urlEntry(locFor(base, path, lang), toDate(p.updatedAt), hreflangAlternates(base, path))
  }
  // 精选命名榜单——排除 hasData:false / coming-soon。
  for (const l of CURATED_LISTS) {
    if (l.hasData === false || COMING_SOON_LIST_SLUGS.has(l.slug)) continue
    const path = '/' + l.slug + '.html'
    xml += urlEntry(locFor(base, path, lang), '', hreflangAlternates(base, path))
  }
  xml += URLSET_CLOSE
  return xml
}

// ── 分类归档页 sitemap:industry/capital/companytype 直接用 permalink_routes 的 flat URL;
// province 只收 77 个顶层府,用 industry.js 里已缓存的友好 URL(理由见文件头注释)。全部合计
// < 1000 条,单文件足够,不需要再分页。这批页面语言由 cookie/query 客户端驱动、没有独立的
// /zh//th/ 前缀路由，建立完整的三语互链。──
export async function buildTaxonomySitemap(req) {
  const base = originFrom(req)
  const lang = requestLang(req)
  const [routes] = await Promise.all([fetchTaxonomyRoutes(), ensureProvincesLoaded()])
  let xml = xmlHeader() + urlsetOpen(true)
  const keepCapital = new Set(['/capital-thai-capital.html', '/capital-foreign-capital.html'])
  const add = (path, updatedAt) => {
    // 短期排除各国 capital-* 薄页；仅保留泰资/外资两个有内容的归档。
    if (/^\/capital-/.test(path) && !keepCapital.has(path)) return
    xml += urlEntry(locFor(base, path, lang), toDate(updatedAt), hreflangAlternates(base, path))
  }
  for (const r of routes) add(r.path, r.updatedAt)
  for (const p of allProvinces()) add('/' + p.engslug + '.html', '')
  xml += URLSET_CLOSE
  return xml
}

// ── 文章 sitemap:当前站点 0 篇,查询按将来会有文章设计,直接可用。──
export async function buildPostsSitemap(req) {
  const base = originFrom(req)
  const lang = requestLang(req)
  const posts = await fetchPostPage(0, COMPANIES_PER_FILE)
  let xml = xmlHeader() + urlsetOpen(false)
  for (const p of posts) xml += urlEntry(locFor(base, '/' + p.slug, lang), toDate(p.updatedAt), null)
  xml += URLSET_CLOSE
  return xml
}

// ── 分页公司 sitemap:pageNum 从 1 开始,每份 COMPANIES_PER_FILE 条。
// 公开的 sitemap-company-{lang}-* 只含该语种 <loc>,不带跨语言 hreflang(由页面 HTML 负责)。
// 未传 lang 时回退 requestLang(兼容旧 /sitemap-companies-N.xml / 密名路径)。──
export async function buildCompaniesSitemap(req, pageNum, lang) {
  const base = originFrom(req)
  const useLang = (lang === 'th' || lang === 'zh' || lang === 'en') ? lang : (requestLang(req) || 'en')
  const offset = Math.max(0, (pageNum - 1)) * COMPANIES_PER_FILE
  const rows = await fetchCompanyPage(offset, COMPANIES_PER_FILE)
  let xml = xmlHeader() + urlsetOpen(false)
  for (const r of rows) {
    xml += urlEntry(locFor(base, r.path, useLang), toDate(r.updatedAt), null)
  }
  xml += URLSET_CLOSE
  return { xml, isEmpty: rows.length === 0 }
}

// ── HTML sitemap 落地页内容(注入 /sitemap 页面的 data-sitemap-content 占位 div)──
const PAGE_GROUPS = [
  { key: 'main', label: { en: 'Main', th: 'หลัก', zh: '主要页面' }, slugs: ['home', 'about', 'contact', 'ai', 'companies', 'regional-rankings'] },
  { key: 'reports', label: { en: 'Business Reports & Analytics', th: 'รายงานธุรกิจและการวิเคราะห์', zh: '商业报告与分析' }, slugs: ['business-reports', 'business-foreign-capital', 'business-new-registrations', 'business-industry-overview', 'business-regional-investment-map', 'business-owner-shareholder-leads', 'business-regional-rankings-summary'] },
  { key: 'legal', label: { en: 'Legal & Policies', th: 'กฎหมายและนโยบาย', zh: '法律与政策' }, slugs: ['privacy-policy', 'terms', 'accessibility', 'about-our-data', 'disclaimer', 'business-data-usage-policy', 'editorial-data-integrity-policy', 'copyright-policy', 'data-sources-policy', 'data-correction-removal-policy', 'business-verification-policy'] },
]

function pageCardsHtml(pages, lang) {
  const bySlug = new Map(pages.map(p => [p.slug, p]))
  let html = ''
  for (const g of PAGE_GROUPS) {
    const items = g.slugs.map(s => bySlug.get(s)).filter(Boolean)
    if (!items.length) continue
    html += '<h2>' + esc(t3(lang, g.label.en, g.label.th, g.label.zh)) + '</h2><div class="biz-entlist">'
    html += items.map(p => {
      const path = p.slug === 'home' ? '/' : '/' + p.slug
      return '<a class="biz-entcard" href="' + esc(path) + '"><span class="biz-entcard__name">' + esc(p.title) + '</span></a>'
    }).join('')
    html += '</div>'
  }
  return html
}

function chipListHtml(items) {
  return '<div class="biz-fl-chips">' + items.map(it => '<a class="biz-fl-chip" href="' + esc(it.href) + '">' + esc(it.label) + '</a>').join('') + '</div>'
}

export async function buildSitemapPageContent(req, lang) {
  const [pages, taxRoutes, companiesTotal] = await Promise.all([fetchAllPages(), fetchTaxonomyRoutes(), countAllPublishedCompanies()])
  await ensureProvincesLoaded()
  const provinces = allProvinces().slice().sort((a, b) => (a.name.en || '').localeCompare(b.name.en || ''))
  const industries = taxRoutes.filter(r => r.taxonomyCode === 'industry' && /^\/industry-tsic-[a-z]\.html$/.test(r.path))
  const companyTypes = taxRoutes.filter(r => r.taxonomyCode === 'companytype')

  // 注意:XML sitemap 已改为密名地址,不在此公开页面暴露其链接(避免把 token 泄露给采集者)。
  let html = '<p class="biz-page-lead-sub">' + esc(t3(lang,
    companiesTotal.toLocaleString('en-US') + ' company profiles and every published page on ' + BRAND_DOMAIN + ' are listed below.',
    'ด้านล่างคือทุกหน้าที่เผยแพร่บน ' + BRAND_DOMAIN + ' และโปรไฟล์บริษัท ' + companiesTotal.toLocaleString('en-US') + ' รายการ',
    BRAND_DOMAIN + ' 上全部已发布页面与 ' + companiesTotal.toLocaleString('en-US') + ' 家公司档案均列于下方。')) + '</p>'

  html += pageCardsHtml(pages.filter(p => !REDIRECT_PAGE_SLUGS.has(p.slug)), lang)

  html += '<h2>' + esc(t3(lang, 'Browse by Province', 'เรียกดูตามจังหวัด', '按府浏览')) + '</h2>'
  html += chipListHtml(provinces.map(p => ({ href: '/' + p.engslug + '.html', label: t3(lang, p.name.en, p.name.th, p.name.zh) || p.engslug })))

  html += '<h2>' + esc(t3(lang, 'Browse by Industry', 'เรียกดูตามอุตสาหกรรม', '按行业浏览')) + '</h2>'
  html += '<p class="biz-page-note">' + esc(t3(lang,
    'These are the 19 top-level industry sections. Browse the full industry overview for all sub-categories.',
    'นี่คือ 19 หมวดอุตสาหกรรมหลัก ดูภาพรวมอุตสาหกรรมทั้งหมดสำหรับหมวดย่อยทั้งหมด',
    '以下为 19 个行业大类,全部细分行业请见行业总览。')) + ' <a href="/business-industry-overview">' + esc(t3(lang, 'Industry overview', 'ภาพรวมอุตสาหกรรม', '行业总览')) + '</a></p>'
  html += chipListHtml(industries.map(r => ({ href: r.path, label: t3(lang, r.name.en, r.name.th, r.name.zh) || r.path })))

  html += '<h2>' + esc(t3(lang, 'Browse by Capital Origin', 'เรียกดูตามแหล่งทุน', '按资本来源浏览')) + '</h2>'
  html += '<p class="biz-page-note"><a href="/business-foreign-capital">' + esc(t3(lang, 'Full foreign capital analysis', 'การวิเคราะห์ทุนต่างชาติทั้งหมด', '完整外资分析')) + '</a></p>'
  html += chipListHtml([
    { href: '/capital-thai-capital.html', label: t3(lang, 'Thai Capital', 'ทุนไทย', '泰资') },
    { href: '/capital-foreign-capital.html', label: t3(lang, 'Foreign Capital', 'ทุนต่างชาติ', '外资') },
  ])

  if (companyTypes.length) {
    html += '<h2>' + esc(t3(lang, 'Browse by Company Type', 'เรียกดูตามประเภทนิติบุคคล', '按企业类型浏览')) + '</h2>'
    html += chipListHtml(companyTypes.map(r => ({ href: r.path, label: t3(lang, r.name.en, r.name.th, r.name.zh) || r.path })))
  }

  return html
}

export function sitemapSeo(lang, canonical) {
  const title = t3(lang, 'Sitemap | ' + BRAND, 'แผนผังเว็บไซต์ | ' + BRAND, '网站地图 | ' + BRAND)
  const description = t3(lang,
    'Browse every page, business report, province, industry and company category on ' + BRAND_DOMAIN + '.',
    'เรียกดูทุกหน้า รายงานธุรกิจ จังหวัด อุตสาหกรรม และหมวดหมู่บริษัทบน ' + BRAND_DOMAIN,
    '浏览 ' + BRAND_DOMAIN + ' 上的全部页面、商业报告、府、行业与企业分类。')
  return { title, description, keywords: [t3(lang, 'sitemap', 'แผนผังเว็บไซต์', '网站地图'), BRAND, BRAND_DOMAIN].join(', '), canonical, lang }
}

// ── 浏览器端 XSLT 样式表:把裸 XML 渲染成可点击的 HTML 表格,一套模板同时处理索引(<sitemapindex>,
// 一级)与子文件(<urlset>,二级)。自包含(内联 CSS、无外链资源),爬虫忽略、只有浏览器会用它。
// 由 server.js 在 /sitemap.xsl 以 text/xsl 吐出。──
const SITEMAP_XSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"
    doctype-system="about:legacy-compat"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex,follow"/>
        <title>${BRAND} &#8212; XML Sitemap</title>
        <style>
          :root{--ink:#0f172a;--sub:#64748b;--line:#e2e8f0;--bg:#f4f5f5;--accent:#1d4ed8;--accentbg:#eff6ff}
          *{box-sizing:border-box}
          body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
          .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
          header{border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}
          .brand{font-weight:700;font-size:20px;letter-spacing:-.01em}
          .brand span{color:var(--accent)}
          h1{font-size:26px;margin:14px 0 6px;letter-spacing:-.02em}
          .lead{color:var(--sub);margin:0}
          .lead strong{color:var(--ink)}
          .count{display:inline-block;margin-top:10px;background:var(--accentbg);color:var(--accent);font-weight:600;font-size:13px;padding:3px 10px;border-radius:999px}
          .tablewrap{overflow-x:auto;margin-top:20px;border:1px solid var(--line);border-radius:12px;background:#fff}
          table{width:100%;border-collapse:collapse;font-size:14px}
          th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
          th{background:#f1f5f9;color:var(--sub);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
          td.num{color:var(--sub);width:56px}
          td.url{white-space:normal;word-break:break-all}
          td.url a{color:var(--accent);text-decoration:none}
          td.url a:hover{text-decoration:underline}
          tr:last-child td{border-bottom:0}
          tbody tr:hover{background:#f4f5f5}
          .mod{color:var(--sub);font-variant-numeric:tabular-nums}
          footer{margin-top:26px;color:var(--sub);font-size:13px}
          footer a{color:var(--accent);text-decoration:none}
        </style>
      </head>
      <body>
        <div class="wrap">
          <header>
            <div class="brand">Biz<span>Thai</span></div>
            <xsl:choose>
              <xsl:when test="s:sitemapindex">
                <h1>XML Sitemap Index</h1>
                <p class="lead">This is a <strong>sitemap index</strong>. Click any row to open its child sitemap.</p>
                <span class="count"><xsl:value-of select="count(s:sitemapindex/s:sitemap)"/> sitemaps</span>
              </xsl:when>
              <xsl:otherwise>
                <h1>XML Sitemap</h1>
                <p class="lead">Generated for search engines &#8212; every URL below is live and crawlable.</p>
                <span class="count"><xsl:value-of select="count(s:urlset/s:url)"/> URLs</span>
              </xsl:otherwise>
            </xsl:choose>
          </header>

          <xsl:choose>
            <xsl:when test="s:sitemapindex">
              <div class="tablewrap">
                <table>
                  <thead><tr><th class="num">#</th><th>Sitemap</th><th>Last modified</th></tr></thead>
                  <tbody>
                    <xsl:for-each select="s:sitemapindex/s:sitemap">
                      <tr>
                        <td class="num"><xsl:value-of select="position()"/></td>
                        <td class="url"><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                        <td class="mod"><xsl:value-of select="s:lastmod"/></td>
                      </tr>
                    </xsl:for-each>
                  </tbody>
                </table>
              </div>
            </xsl:when>
            <xsl:otherwise>
              <div class="tablewrap">
                <table>
                  <thead><tr><th class="num">#</th><th>URL</th><th>Last modified</th></tr></thead>
                  <tbody>
                    <xsl:for-each select="s:urlset/s:url">
                      <tr>
                        <td class="num"><xsl:value-of select="position()"/></td>
                        <td class="url"><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                        <td class="mod"><xsl:value-of select="s:lastmod"/></td>
                      </tr>
                    </xsl:for-each>
                  </tbody>
                </table>
              </div>
            </xsl:otherwise>
          </xsl:choose>

          <footer><a href="/">${BRAND_DOMAIN}</a></footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`

export function buildSitemapXsl() { return SITEMAP_XSL }
