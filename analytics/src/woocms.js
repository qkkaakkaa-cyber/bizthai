// WooCMS 站点接口客户端 —— 读取已入库 DBD DataWarehouse+ 数据的通道。
// 只读公开接口(无需鉴权):
//   GET /api/site/v1/models/{model}/entries?limit&offset[&taxonomy&term ...]   列表 + total
//   GET /api/site/v1/taxonomies/{code}/terms?limit&offset                       分类法词条
// 计数策略:列表带 taxonomy/term 过滤、limit=1,只读 data.total —— 全量精确且极轻。
import { config } from './config.js'

const SITE = `${config.woocmsBase}/api/site/v1`

async function apiGet(path) {
  const r = await fetch(`${SITE}${path}`)
  if (!r.ok) throw new Error(`WooCMS ${r.status} ${path}`)
  const j = await r.json()
  return j?.data ?? null
}

// 把若干 [taxonomy, term] 过滤对拼进 query(WooCMS 多对为 AND)
function withFilters(params, filters = []) {
  for (const [taxonomy, term] of filters) {
    if (taxonomy && term) {
      params.append('taxonomy', taxonomy)
      params.append('term', term)
    }
  }
  return params
}

// 取某组过滤条件下的企业总数(limit=1,只回 1 条,读 total)
export async function countEntries(filters = []) {
  const params = withFilters(new URLSearchParams({ limit: '1', offset: '0' }), filters)
  const data = await apiGet(`/models/${config.model}/entries?${params.toString()}`)
  return Number(data?.total) || 0
}

// 取某分类法的顶层词条名(slug -> 泰文 name)。分页上限 200,大类数量少,一页足够。
export async function fetchRootTermNames(taxonomy) {
  const map = new Map()
  let offset = 0
  for (;;) {
    const data = await apiGet(`/taxonomies/${taxonomy}/terms?limit=200&offset=${offset}`)
    const items = data?.items ?? []
    for (const t of items) {
      if (t.parent_id == null) map.set(t.slug, t.name)
    }
    const total = Number(data?.total) || items.length
    offset += 200
    if (items.length === 0 || offset >= total) break
  }
  return map
}

// 取一页企业列表。支持(后端新增能力):
//   fields  —— 字段投影(只回这些 meta 键,排除笨重 raw)
//   sort/order —— 按 meta 字段排序(取全库真 Top,无需抽样)
export async function fetchEntriesPage({ limit, offset = 0, filters = [], fields, sort, order }) {
  const params = withFilters(
    new URLSearchParams({ limit: String(limit), offset: String(offset) }),
    filters,
  )
  if (fields) params.set('fields', Array.isArray(fields) ? fields.join(',') : fields)
  if (sort) { params.set('sort', sort); params.set('order', order || 'desc') }
  const data = await apiGet(`/models/${config.model}/entries?${params.toString()}`)
  return data ?? { items: [], total: 0, limit, offset }
}

// 通用聚合端点(后端新增):对 meta 字段 group-by + count/sum/avg,支持分类法过滤。
// 返回 groups: [{ key, count, sum_<f>, avg_<f> }];不传 groupBy = 整体单组。
export async function aggregate({ groupBy, sum, avg, order, limit, filters = [] }) {
  const params = withFilters(new URLSearchParams(), filters)
  if (groupBy) params.set('group_by', groupBy)
  if (sum) params.set('sum', Array.isArray(sum) ? sum.join(',') : sum)
  if (avg) params.set('avg', Array.isArray(avg) ? avg.join(',') : avg)
  params.set('count', '1')
  if (order) params.set('order', order)
  if (limit) params.set('limit', String(limit))
  const data = await apiGet(`/models/${config.model}/aggregate?${params.toString()}`)
  return data?.groups ?? []
}

// 受限并发 map(避免一次性打爆回环上游)
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) break
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// 把样本量按数据集均匀打散成多页 offset,提升抽样代表性(移植自前端 distributedOffsets)
export function distributedOffsets(total, sampleSize, pageSize) {
  if (total <= 0) return [0]
  const pageCount = Math.max(1, Math.ceil(sampleSize / pageSize))
  const maxOffset = Math.max(0, total - pageSize)
  if (pageCount === 1) return [Math.floor(Math.random() * (maxOffset + 1))]
  const offsets = Array.from({ length: pageCount }, (_, i) => {
    const ratio = i / (pageCount - 1)
    const anchor = maxOffset * ratio
    const jitter = (maxOffset / pageCount) * 0.35
    return Math.min(maxOffset, Math.max(0, Math.floor(anchor + (Math.random() * 2 - 1) * jitter)))
  })
  return Array.from(new Set(offsets))
}
