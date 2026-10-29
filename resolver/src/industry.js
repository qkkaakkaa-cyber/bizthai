// 行业扁平 URL 解析:/industry-<x>.html 的 <x> → industry taxonomy 的 term slug。
//   <x> = 大类英文名 slug(manufacturing) → 映射到大类 term slug(tsic-c)
//   <x> = 细类英文名 slug(已是 term slug,manufacture-of-...-10211) → 原样
// term 映射从 WooCMS site API 拉取并缓存(定时刷新);拉失败保留旧映射,避免抖动。
import { request as httpRequest } from 'node:http'
import { config } from './config.js'

// 与 db.js / 前端 theme.js 完全一致的 slugify(lower → 非[a-z0-9]→'-' → 去首尾'-')
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

let bigCatBySlug = new Map()  // 大类英文名 slug -> 大类 term slug(tsic-x)
let allSlugs = new Set()      // 全部 term slug(校验细类直链)
let loadedAt = 0
let loading = null

// WooCMS taxonomy terms API 每页硬上限 200,必须按 offset 翻页拉全(行业 term ~590 个)
function fetchTermsPage(offset) {
  return new Promise((resolve) => {
    const req = httpRequest({
      host: config.woocmsHost,
      port: config.woocmsPort,
      path: '/api/site/v1/taxonomies/industry/terms?limit=200&offset=' + offset + '&sort=sort_order_asc',
      headers: { Host: config.industryNameHost, Accept: 'application/json' },
    }, (up) => {
      let buf = ''
      up.setEncoding('utf8')
      up.on('data', (c) => { buf += c })
      up.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(5000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

async function fetchTerms() {
  const acc = []
  for (let off = 0; off < 20000; off += 200) {
    const j = await fetchTermsPage(off)
    const d = j && j.data
    const items = (d && d.items) || []
    acc.push(...items)
    const total = Number(d && d.total) || acc.length
    if (!items.length || acc.length >= total) break
  }
  return acc.length ? { data: { items: acc } } : null
}

async function reload() {
  const j = await fetchTerms()
  const items = j && j.data && j.data.items
  if (!Array.isArray(items) || !items.length) return  // 失败:保留旧映射
  const big = new Map(), all = new Set()
  for (const t of items) {
    if (t.slug) all.add(t.slug)
    if (t.parent_id == null && t.name && t.slug) big.set(slugify(t.name), t.slug)
  }
  bigCatBySlug = big
  allSlugs = all
  loadedAt = Date.now()
}

export async function ensureIndustryLoaded() {
  if (allSlugs.size && Date.now() - loadedAt < config.industryRefreshMs) return
  if (!loading) loading = reload().finally(() => { loading = null })
  await loading
}

// /industry-<x>.html 的 <x>(已小写)→ 目标 term slug,或 null(回退当公司解析)
export function resolveIndustrySlug(rest) {
  if (bigCatBySlug.has(rest)) return bigCatBySlug.get(rest)  // 大类英文名 → tsic 码
  if (allSlugs.has(rest)) return rest                         // 大类 tsic 码 或 细类 term slug 直链
  return null
}

// ── 府映射(从 analytics sidecar /regions 拉,供「行业×府」交叉页 URL 解析)──
let provByEng = new Map()      // 府英文名 slug -> { slug:prov<hash>, engslug, name:{th,en,zh} }
let provListByLen = []         // 府英文名 slug,按长度降序(尾部最长匹配)
let provLoadedAt = 0, provLoading = null

function fetchRegions() {
  return new Promise((resolve) => {
    const req = httpRequest({
      host: config.analyticsHost, port: config.analyticsPort,
      path: '/api/site/v1/analytics/regions', headers: { Accept: 'application/json' },
    }, (up) => {
      let buf = ''
      up.setEncoding('utf8')
      up.on('data', (c) => { buf += c })
      up.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(5000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

async function reloadProvinces() {
  const j = await fetchRegions()
  const provs = j && j.provinces
  if (!Array.isArray(provs) || !provs.length) return
  const m = new Map()
  for (const p of provs) if (p.engslug) m.set(p.engslug, p)
  provByEng = m
  provListByLen = [...m.keys()].sort((a, b) => b.length - a.length)
}

export async function ensureProvincesLoaded() {
  if (provByEng.size && Date.now() - provLoadedAt < config.industryRefreshMs) return
  if (!provLoading) provLoading = reloadProvinces().finally(() => { provLoadedAt = Date.now(); provLoading = null })
  await provLoading
}

// rest = "<行业engslug>-<府engslug>";从尾部最长匹配府,返回 { indPart, prov } 或 null
export function matchCrossProvince(rest) {
  for (const eng of provListByLen) {
    if (rest.length > eng.length + 1 && rest.endsWith('-' + eng)) {
      return { indPart: rest.slice(0, rest.length - eng.length - 1), prov: provByEng.get(eng) }
    }
  }
  return null
}

// 英文名 slug → 府 term({slug:prov<hash>, engslug, name})(供详情页同府同业模块)
export function provinceByEngSlug(eng) { return provByEng.get(String(eng || '')) || null }

// 全部 77 府({slug, engslug, name})(供 sitemap 用友好 URL `/{engslug}.html`,
// 而非 cms_permalink_routes 里那批已验证失效的 `province-prov<hash>.html`)
export function allProvinces() { return [...provByEng.values()] }
