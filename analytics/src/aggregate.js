// 聚合:产出与对接文档(business-analysis-api.md)一致的快照对象。
//
// 后端已提供:① 字段投影/排除 raw、② meta 排序、③ 通用聚合端点(group-by+sum/avg/count)、
// ④ terms 顶层过滤。因此绝大多数字段已是**全量精确**:
//   accurate(聚合端点 / 分类法 total / 全库排序):
//     总量、注册资本汇总与均值、各府(计数+资本)、行业大类、外资组成、状态分布、高资本榜、最新榜
//   sampled(唯一):各年度新增 —— 聚合 group_by 有 200 组上限且无日期区间过滤,
//     故按年用投影大样本(已排除 raw,成本低)估算趋势形态。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from './config.js'
import { fetchProvinceAnalytics, fetchProvinceRecords, fetchGlobalFacts, fetchCapitalCompositionCounts, fetchIndustryCompositionCounts } from './db.js'
import { countEntries, fetchEntriesPage, fetchRootTermNames, aggregate, mapLimit, distributedOffsets } from './woocms.js'
import { toRecord } from './transform.js'

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data')
const load = f => JSON.parse(readFileSync(resolve(dataDir, f), 'utf8'))

const PROVINCES = load('provinces.json')        // [{slug, th, en, zh}] × 77
const INDUSTRY_LABELS = load('industries.json')  // { 'tsic-a': {zh, en} }
const COUNTRY_LABELS = load('countries.json')    // { cn: {zh, en, th} }

// 府中文名 → {slug, 三语};聚合 group_by=provincezh 的 key 即中文府名
const PROV_BY_ZH = new Map(PROVINCES.map(p => [p.zh, p]))
const PROV_BY_SLUG = new Map(PROVINCES.map(p => [p.slug, p]))
const COUNTRY_SLUGS = Object.keys(COUNTRY_LABELS)
const INDUSTRY_SLUGS = Object.keys(INDUSTRY_LABELS)

// 榜单/详情展示所需的精简字段(投影,排除 raw)
const COMPANY_FIELDS = [
  'jpno', 'jpname', 'jpnamee', 'province', 'provincee', 'provincezh',
  'businesstypedesc', 'businesstypedesce', 'businesstypedesczh', 'setupobjgrpdesc',
  'capamt', 'paidamt', 'regdate', 'jpstatcode', 'jpstatdesc', 'jpstatdesce',
  'statuszh', 'status', 'mainnatcode', 'i18n',
]
// 年度趋势 + 状态标签所需字段
const SAMPLE_FIELDS = ['regdate', 'capamt', 'jpstatcode', 'jpstatdesc', 'jpstatdesce', 'statuszh', 'status', 'i18n']

const round2 = n => Math.round((n || 0) * 100) / 100
const numOf = v => (typeof v === 'number' ? v : Number(v) || 0)

function buildDistrictRanking(rows) {
  const map = new Map()
  for (const record of rows) {
    const key = `${record.provinceKey}#${record.districtCode || record.district.zh || 'unknown'}`
    const current = map.get(key) ?? {
      provinceKey: record.provinceKey,
      districtCode: record.districtCode,
      district: record.district,
      companyCount: 0,
      registeredCapital: 0,
      paidCapital: 0,
      avgCapital: 0,
    }
    current.companyCount += 1
    current.registeredCapital += record.capital || 0
    current.paidCapital += record.paidCapital || 0
    current.avgCapital = current.companyCount ? current.registeredCapital / current.companyCount : 0
    map.set(key, current)
  }
  return Array.from(map.values())
    .sort((a, b) => b.registeredCapital - a.registeredCapital)
    .map((row, index) => ({
    key: row.districtCode || `${row.provinceKey}-${index}`,
    provinceKey: row.provinceKey,
    provinceSlug: PROV_BY_ZH.get(row.provinceKey)?.slug,
    province: (() => {
      const p = PROV_BY_ZH.get(row.provinceKey)
      return p ? { th: p.th, en: p.en, zh: p.zh } : { th: row.provinceKey, en: row.provinceKey, zh: row.provinceKey }
    })(),
    districtKey: row.districtCode || row.district.zh,
    district: row.district,
    companyCount: row.companyCount,
    registeredCapital: round2(row.registeredCapital),
    paidCapital: round2(row.paidCapital),
    avgCapital: round2(row.avgCapital),
  }))
}

// ── 各府排行:计数 + 资本均来自聚合端点,全量精确 ──────────
function buildProvinceRanking(groups) {
  return groups
    .filter(g => g.key)
    .map(g => {
      const p = PROV_BY_ZH.get(g.key)
      return {
        provinceKey: g.key,
        provinceSlug: p?.slug,
        province: p ? { th: p.th, en: p.en, zh: p.zh } : { th: g.key, en: g.key, zh: g.key },
        companyCount: g.count,
        registeredCapital: round2(g.sum_capamt),
        paidCapital: round2(g.sum_paidamt),
        avgCapital: round2(g.avg_capamt),
      }
    })
}

// ── 外资组成:capital 分类法 total,精确 ───────────────────
// 无额外筛选(全局快照,10分钟刷新一次,最高频路径)时一次 GROUP BY 拿全部~203个国家,
// 取代按 countries.json 精选~31个国家逐个发 HTTP 请求问 WooCMS 的 N+1 写法(同时修复了
// ~170个真实存在但从未被统计的小语种国家的数据缺口)。
// 2026-07-09 现场诊断实锤(见 bizthai-entries-list-timeout-root-cause 记忆):foreignTotal/
// thaiTotal 原来还各自额外发一次 countEntries HTTP 请求,其中 term=thai-capital 覆盖约90%
// 条目、完全不具选择性,WooCMS 那条 EXISTS+ORDER BY 查询在这种"非选择性 term"下 planner 会
// 放弃"先按 term 过滤"、改成对整张 published 表(81万行)做 Parallel Seq Scan + 全量 Sort 后
// 再逐行核对 term(EXPLAIN 实测证实,与"稀疏词条深扫"是不同机制),在这台机械盘上稳定超时
// 10s——这正是当晚 buildGlobalSnapshotFromFacts 刷新失败、globalSnapshot 变 null 的直接原因。
// 而 fetchCapitalCompositionCounts() 的 GROUP BY 本就不限定 slug,'foreign-capital'/
// 'thai-capital' 这两个伞形词条(企业只打这一个标,不像具体国家还会同时打叶子标)的计数已经
// 在返回的 counts 里,两次 countEntries 完全是重复请求,直接从 counts 读、不再发那两次请求。
// 带筛选(如按省份)的场景:按省份+国家双重过滤需要再 JOIN 一次 province taxonomy 或用
// EXISTS 子查询,改动面更大,本次有意先不做,保留原逐国家循环——filters 分支下的
// foreignTotal/thaiTotal 仍是逐个 countEntries,同样可能撞上 thai-capital 这个非选择性
// term,是已知但尚未处理的残留风险,按需再优化。
async function buildForeignComposition(filters) {
  if (filters.length === 0) {
    const counts = await fetchCapitalCompositionCounts()
    const foreignTotal = counts['foreign-capital'] || 0
    const thaiTotal = counts['thai-capital'] || 0
    const top = Object.entries(counts)
      .filter(([code]) => code !== 'foreign-capital' && code !== 'thai-capital')
      .map(([code, count]) => ({ code, count }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
    return { foreignTotal, thaiTotal, total: foreignTotal + thaiTotal, top }
  }
  const [foreignTotal, thaiTotal, countryRows] = await Promise.all([
    countEntries([...filters, ['capital', 'foreign-capital']]),
    countEntries([...filters, ['capital', 'thai-capital']]),
    mapLimit(COUNTRY_SLUGS, config.countConcurrency, async code => ({
      code,
      count: await countEntries([...filters, ['capital', code]]),
    })),
  ])
  const top = countryRows.filter(r => r.count > 0).sort((a, b) => b.count - a.count)
  return { foreignTotal, thaiTotal, total: foreignTotal + thaiTotal, top }
}

function foreignCompositionResponse({ foreignTotal, thaiTotal, total, top }, limit) {
  const named = top
    .filter(r => r.code && !['frn', 'foreign', 'unknown', 'other'].includes(String(r.code).toLowerCase()))
    .slice(0, limit)
  const namedSum = named.reduce((s, r) => s + r.count, 0)
  const others = Math.max(0, foreignTotal - namedSum)
  const shareBase = Math.max(1, namedSum + others)
  const nationalities = [
    ...named.map(r => ({
      code: r.code,
      name: COUNTRY_LABELS[r.code] ?? { th: r.code.toUpperCase(), en: r.code.toUpperCase(), zh: r.code.toUpperCase() },
      count: r.count,
      share: round2(r.count / shareBase),
    })),
    ...(named.length && others > 0 ? [{
      code: 'other',
      name: { zh: '其他/未细分外资', en: 'Other / unspecified foreign', th: 'ต่างชาติอื่นๆ / ไม่ระบุรายละเอียด' },
      count: others,
      share: round2(others / shareBase),
    }] : []),
  ]
  return {
    total,
    thaiTotal,
    foreignTotal,
    foreignShare: round2(total ? foreignTotal / total : 0),
    nationalities,
    capitalSource: [
      { key: 'foreign', label: { zh: '外资企业', en: 'Foreign-owned', th: 'ทุนต่างชาติ' }, count: foreignTotal },
      { key: 'thai', label: { zh: '纯泰资企业', en: 'Thai-owned', th: 'ทุนไทย' }, count: thaiTotal },
    ],
    basis: 'accurate',
  }
}

// ── 行业分布:industry 19 大类 total,精确;泰文名取词条真值 ──
let industryThPromise = null
const industryThNames = () => (industryThPromise ??= fetchRootTermNames('industry').catch(() => new Map()))

async function buildBusinessTypes(filters, total) {
  const thBySlug = await industryThNames()
  const toRow = (slug, count) => {
    const label = INDUSTRY_LABELS[slug]
    return { key: slug, label: { zh: label.zh, en: label.en, th: thBySlug.get(slug) || label.th || label.en }, count }
  }
  // 无额外筛选(全局快照,1小时刷新一次,原 19 次 HTTP 循环是 entries 列表接口间歇性超时的
  // 触发源,见 fetchIndustryCompositionCounts 注释)时一次 GROUP BY 拿全部;带筛选(按省份)
  // 场景改动面更大,保留原逐大类循环,与 buildForeignComposition 的处理方式一致。
  const rows = filters.length === 0
    ? Object.entries(await fetchIndustryCompositionCounts())
        .filter(([slug]) => INDUSTRY_LABELS[slug])
        .map(([slug, count]) => toRow(slug, count))
    : await mapLimit(INDUSTRY_SLUGS, config.countConcurrency, async slug =>
        toRow(slug, await countEntries([...filters, ['industry', slug]])))
  return rows
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map(r => ({ ...r, share: round2(total ? r.count / total : 0) }))
}

// ── 状态分布:计数走聚合(精确),标签从投影样本学习 ────────
function buildStatuses(statusGroups, sample, total) {
  const labelByCode = new Map()
  for (const r of sample) {
    const code = r.statusKey
    if (code && !labelByCode.has(code)) labelByCode.set(code, r.status)
  }
  return statusGroups
    .map(g => {
      const code = g.key == null ? 'unknown' : String(g.key)
      const label = labelByCode.get(code) ?? (code === 'unknown'
        ? { th: 'ไม่ระบุ', en: 'Unknown', zh: '未知' }
        : { th: code, en: code, zh: code })
      return { key: code, label, count: g.count, share: round2(total ? g.count / total : 0) }
    })
    .sort((a, b) => b.count - a.count)
}

// ── 年度新增:投影大样本 group by 注册年(唯一抽样口径)────
function buildYears(sample) {
  const map = new Map()
  for (const r of sample) {
    if (!r.regYear) continue
    const y = map.get(r.regYear) ?? { year: r.regYear, companyCount: 0, capital: 0 }
    y.companyCount += 1
    y.capital += r.capital
    map.set(r.regYear, y)
  }
  return Array.from(map.values())
    .sort((a, b) => a.year - b.year)
    .map(y => ({
      year: y.year,
      companyCount: y.companyCount,
      registeredCapital: round2(y.capital),
      avgCapital: round2(y.companyCount ? y.capital / y.companyCount : 0),
    }))
}

function buildBusinessTypesFromRecords(records, total) {
  const map = new Map()
  for (const record of records) {
    const key = record.businessGroup || `business-${record.business.zh || record.business.en || record.business.th || 'unknown'}`
    const current = map.get(key) ?? {
      key,
      label: INDUSTRY_LABELS[key]
        ? { zh: INDUSTRY_LABELS[key].zh, en: INDUSTRY_LABELS[key].en, th: record.business.th || INDUSTRY_LABELS[key].th || INDUSTRY_LABELS[key].en }
        : record.business,
      count: 0,
      share: 0,
    }
    current.count += 1
    current.share = round2(total ? current.count / total : 0)
    map.set(key, current)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function buildStatusesFromRecords(records, total) {
  const map = new Map()
  for (const record of records) {
    const key = record.statusKey || 'unknown'
    const current = map.get(key) ?? {
      key,
      label: record.status.th || record.status.en || record.status.zh
        ? record.status
        : { th: 'ไม่ระบุ', en: 'Unknown', zh: '未知' },
      count: 0,
      share: 0,
    }
    current.count += 1
    current.share = round2(total ? current.count / total : 0)
    map.set(key, current)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function buildForeignFromRecords(records) {
  const countryCounts = new Map()
  let foreignTotal = 0
  let thaiTotal = 0
  for (const record of records) {
    if (record.isForeign) {
      foreignTotal += 1
      for (const code of record.nationalityCodes) {
        countryCounts.set(code, (countryCounts.get(code) ?? 0) + 1)
      }
    } else {
      thaiTotal += 1
    }
  }
  return {
    foreignTotal,
    thaiTotal,
    total: foreignTotal + thaiTotal,
    top: Array.from(countryCounts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  }
}

function buildProvinceRecordSnapshot(globalSnapshot, province, list, source = 'province_record_cache') {
  const row = globalSnapshot.provinceRanking.find(item => item.provinceKey === province.zh || item.provinceSlug === province.slug)
  const total = row?.companyCount ?? list.length
  const totalCapital = row?.registeredCapital ?? list.reduce((sum, record) => sum + (record.capital || 0), 0)
  const districtRows = buildDistrictRanking(list)
  const companiesByCapital = [...list].sort((a, b) => b.capital - a.capital).slice(0, config.topCompanies).map(toCompanyRow)
  const companiesByDate = [...list].filter(record => record.regDate).sort((a, b) => b.regDate.localeCompare(a.regDate)).slice(0, config.topCompanies).map(toCompanyRow)
  return {
    provinceSlug: province.slug,
    total,
    sampleSize: total,
    requestedSampleSize: total,
    sampleCapital: round2(totalCapital),
    avgCapital: round2(row?.avgCapital ?? (total ? totalCapital / total : 0)),
    foreign: buildForeignFromRecords(list),
    provinceRanking: districtRows.length ? districtRows : (row ? [row] : []),
    districtRows,
    businessTypes: buildBusinessTypesFromRecords(list, total),
    statuses: buildStatusesFromRecords(list, total),
    years: buildYears(list),
    yearSampleSize: list.length,
    companiesByCapital,
    companiesByDate,
    refreshedAt: globalSnapshot.refreshedAt,
    basis: {
      total: 'accurate',
      capital: 'accurate',
      provinceRanking: districtRows.length ? 'district_from_record_cache' : 'accurate',
      foreignComposition: source,
      businessTypes: source,
      statuses: source,
      companies: source,
      years: source,
    },
  }
}

function buildDistrictRowsFromAnalytics(globalSnapshot, province, rows) {
  return (rows ?? []).map((row, index) => ({
    key: row.districtCode || row.districtKey || `${province.slug}-${index}`,
    provinceKey: province.zh,
    provinceSlug: province.slug,
    province: { th: province.th, en: province.en, zh: province.zh },
    districtKey: row.districtKey || row.districtCode || `${province.slug}-${index}`,
    district: row.district ?? { th: row.districtKey || province.th, en: row.districtKey || province.en, zh: row.districtKey || province.zh },
    companyCount: numOf(row.companyCount),
    registeredCapital: round2(row.registeredCapital),
    paidCapital: round2(row.paidCapital),
    avgCapital: round2(row.avgCapital),
  }))
}

function buildProvinceAnalyticsSnapshot(globalSnapshot, province, data) {
  const row = globalSnapshot.provinceRanking.find(item => item.provinceKey === province.zh || item.provinceSlug === province.slug)
  const total = row?.companyCount ?? numOf(data.total)
  const totalCapital = row?.registeredCapital ?? numOf(data.totalCapital)
  const districtRows = buildDistrictRowsFromAnalytics(globalSnapshot, province, data.districtRows)
  return {
    provinceSlug: province.slug,
    total,
    sampleSize: total,
    requestedSampleSize: total,
    sampleCapital: round2(totalCapital),
    avgCapital: round2(row?.avgCapital ?? numOf(data.avgCapital)),
    foreign: data.foreign ?? { foreignTotal: 0, thaiTotal: total, total, top: [] },
    provinceRanking: districtRows.length ? districtRows : (row ? [row] : []),
    districtRows,
    businessTypes: data.businessTypes ?? [],
    statuses: data.statuses ?? [],
    years: data.years ?? [],
    yearSampleSize: total,
    companiesByCapital: data.companiesByCapital ?? [],
    companiesByDate: data.companiesByDate ?? [],
    refreshedAt: globalSnapshot.refreshedAt,
    basis: {
      total: 'accurate',
      capital: 'accurate',
      provinceRanking: 'province_sql_aggregate',
      foreignComposition: 'province_sql_aggregate',
      businessTypes: 'province_sql_aggregate',
      statuses: 'province_sql_aggregate',
      companies: 'province_sql_aggregate',
      years: 'province_sql_aggregate',
    },
  }
}

function buildProvinceSnapshots(globalSnapshot, records) {
  const byProvince = new Map()
  for (const record of records) {
    const list = byProvince.get(record.provinceKey) ?? []
    list.push(record)
    byProvince.set(record.provinceKey, list)
  }

  const snapshots = new Map()
  for (const [provinceKey, list] of byProvince.entries()) {
    const province = PROV_BY_ZH.get(provinceKey)
    if (!province) continue
    snapshots.set(province.slug, buildProvinceRecordSnapshot(globalSnapshot, province, list))
  }
  return snapshots
}

// ── 企业榜单:全库排序 + 投影,真 Top(非抽样)──────────────
function toCompanyRow(r) {
  const p = PROV_BY_ZH.get(r.province?.zh)
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    province: r.province,
    provinceKey: r.provinceKey,
    provinceSlug: p?.slug,
    business: r.business,
    capital: r.capital,
    paidCapital: r.paidCapital,
    regDate: r.regDate,
    regYear: r.regYear,
    status: r.status,
    isForeign: r.isForeign,
    nationalityCodes: r.nationalityCodes,
  }
}

async function fetchTopCompanies(sort, filters) {
  const page = await fetchEntriesPage({ limit: config.topCompanies, filters, fields: COMPANY_FIELDS, sort, order: 'desc' })
  return (page.items ?? []).map(toRecord).map(toCompanyRow)
}

// 年度/状态标签:投影大样本(已排除 raw,便宜),多页打散去重
async function fetchSample(filters) {
  const probe = await aggregate({ filters }) // 整体单组,顺带拿 total
  const total = numOf(probe[0]?.count)
  const offsets = distributedOffsets(total, config.sampleSize, config.samplePageSize)
  const pages = await mapLimit(offsets, config.countConcurrency, offset =>
    fetchEntriesPage({ limit: config.samplePageSize, offset, filters, fields: SAMPLE_FIELDS }))
  const seen = new Set()
  const records = []
  for (const page of pages) {
    for (const item of page?.items ?? []) {
      const rec = toRecord(item)
      const key = `${rec.regDate}#${rec.capital}#${records.length}` // 投影样本无稳定 id,弱去重靠 jpno 缺失时退化为不去重
      const id = item.slug || rec.id || key
      if (seen.has(id)) continue
      seen.add(id)
      records.push(rec)
    }
  }
  return { total, records }
}

// ── 全局快照:走物化视图(快,毫秒级),外资/行业仍用 term 计数(本就快)──
async function buildGlobalSnapshotFromFacts() {
  const [facts, foreignRaw] = await Promise.all([
    fetchGlobalFacts(),
    buildForeignComposition([]),
  ])
  if (!facts) throw new Error('facts unavailable')
  const total = numOf(facts.total)
  const totalCapital = numOf(facts.totalCapital)
  const businessTypes = await buildBusinessTypes([], total)

  const snapshot = {
    provinceSlug: null,
    total,
    sampleSize: total,
    requestedSampleSize: total,
    sampleCapital: round2(totalCapital),
    avgCapital: round2(numOf(facts.avgCapital)),
    foreign: foreignRaw,
    provinceRanking: buildProvinceRanking(facts.provinceGroups),
    districtRows: [],
    businessTypes,
    statuses: facts.statuses,
    years: facts.years,            // 全量精确(非抽样)
    yearSampleSize: total,
    companiesByCapital: facts.companiesByCapital,
    companiesByDate: facts.companiesByDate,
    refreshedAt: new Date().toISOString(),
    basis: {
      total: 'accurate', capital: 'accurate', provinceRanking: 'accurate',
      foreignComposition: 'accurate', businessTypes: 'accurate', statuses: 'accurate',
      companies: 'accurate', years: 'accurate',
    },
  }
  snapshot.provinceSnapshots = new Map()
  return snapshot
}

// ── 总装 ─────────────────────────────────────────────────
export async function buildSnapshot(provinceSlug = '') {
  // 全局快照必须走 facts 表/物化视图。生产库直接回退到 WooCMS jsonb 全库聚合会拖慢主站。
  if (!provinceSlug) {
    return await buildGlobalSnapshotFromFacts()
  }
  const filters = provinceSlug ? [['province', provinceSlug]] : []

  const [overall, provinceGroups, statusGroups, foreignRaw, { records: sample }, topByCapital, topByDate] =
    await Promise.all([
      aggregate({ sum: ['capamt', 'paidamt'], avg: 'capamt', filters }),
      aggregate({ groupBy: 'provincezh', sum: ['capamt', 'paidamt'], avg: 'capamt', order: 'desc', limit: 200, filters }),
      aggregate({ groupBy: 'jpstatcode', order: 'desc', limit: 200, filters }),
      buildForeignComposition(filters),
      fetchSample(filters),
      fetchTopCompanies('capamt', filters),
      fetchTopCompanies('regdate', filters),
    ])

  const total = numOf(overall[0]?.count)
  const totalCapital = numOf(overall[0]?.sum_capamt)
  const businessTypes = await buildBusinessTypes(filters, total)

  const snapshot = {
    provinceSlug: provinceSlug || null,
    total,
    sampleSize: total,                 // 多数指标为全量口径
    requestedSampleSize: total,
    sampleCapital: round2(totalCapital),    // 现为全量注册资本合计(精确)
    avgCapital: round2(numOf(overall[0]?.avg_capamt)),
    foreign: foreignRaw,
    provinceRanking: buildProvinceRanking(provinceGroups),
    districtRows: [],
    businessTypes,
    statuses: buildStatuses(statusGroups, sample, total),
    years: buildYears(sample),         // 抽样
    yearSampleSize: sample.length,
    companiesByCapital: topByCapital,  // 全库真 Top
    companiesByDate: topByDate,        // 全库真最新
    refreshedAt: new Date().toISOString(),
    basis: {
      total: 'accurate',
      capital: 'accurate',
      provinceRanking: 'accurate',
      foreignComposition: 'accurate',
      businessTypes: 'accurate',
      statuses: 'accurate',
      companies: 'accurate',
      years: 'sampled',
    },
  }
  snapshot.provinceSnapshots = new Map()
  return snapshot
}

export function buildProvinceFallbackSnapshot(globalSnapshot, provinceSlug) {
  const cached = globalSnapshot.provinceSnapshots?.get(provinceSlug)
  if (cached) return cached

  const province = PROV_BY_SLUG.get(provinceSlug)
  const row = globalSnapshot.provinceRanking.find(item =>
    item.provinceSlug === provinceSlug || (province && item.provinceKey === province.zh))
  const districtRows = (globalSnapshot.districtRows ?? [])
    .filter(item => item.provinceSlug === provinceSlug || (province && item.provinceKey === province.zh))
    .sort((a, b) => b.registeredCapital - a.registeredCapital)
  const total = row?.companyCount ?? 0
  const totalCapital = row?.registeredCapital ?? 0
  return {
    provinceSlug,
    total,
    sampleSize: total,
    requestedSampleSize: total,
    sampleCapital: round2(totalCapital),
    avgCapital: round2(row?.avgCapital ?? (total ? totalCapital / total : 0)),
    foreign: { foreignTotal: 0, thaiTotal: 0, total: 0, top: [] },
    provinceRanking: districtRows.length ? districtRows : (row ? [row] : []),
    districtRows,
    businessTypes: [],
    statuses: [],
    years: [],
    yearSampleSize: 0,
    companiesByCapital: [],
    companiesByDate: [],
    refreshedAt: globalSnapshot.refreshedAt,
    basis: {
      total: 'accurate',
      capital: 'accurate',
      provinceRanking: districtRows.length ? 'district_from_global_cache' : 'accurate',
      foreignComposition: 'unavailable',
      businessTypes: 'unavailable',
      statuses: 'unavailable',
      companies: 'unavailable',
      years: 'unavailable',
      fallback: 'province_from_global_ranking',
    },
  }
}

export async function buildProvinceSnapshot(globalSnapshot, provinceSlug) {
  const cached = globalSnapshot.provinceSnapshots?.get(provinceSlug)
  if (cached) return cached

  const province = PROV_BY_SLUG.get(provinceSlug)
  if (!province) return buildProvinceFallbackSnapshot(globalSnapshot, provinceSlug)

  try {
    const analytics = await fetchProvinceAnalytics(provinceSlug)
    if (analytics && numOf(analytics.total) > 0) {
      return buildProvinceAnalyticsSnapshot(globalSnapshot, province, analytics)
    }
  } catch (err) {
    console.error('[analytics] 按府 SQL 聚合失败:', err.message)
  }

  try {
    const records = await fetchProvinceRecords(provinceSlug)
    if (records.length) {
      return buildProvinceRecordSnapshot(globalSnapshot, province, records, 'province_record_query')
    }
  } catch (err) {
    console.error('[analytics] 按府快照构建失败:', err.message)
  }

  return buildProvinceFallbackSnapshot(globalSnapshot, provinceSlug)
}

export { foreignCompositionResponse }
