// 快照缓存:
//   - 全局快照(无府筛选):进程内常驻,定时(REFRESH_MS)后台刷新;总量增长即重算。
//   - 按府快照:按需计算,带 TTL(PROVINCE_TTL_MS)缓存,过期重算。
// 刷新失败时保留上一份快照,避免抖动;首份就绪前请求会 await 进行中的构建。
import { config } from './config.js'
import { buildProvinceSnapshot, buildSnapshot } from './aggregate.js'

let globalSnapshot = null
let globalInflight = null
let refreshTimer = null

const provinceCache = new Map() // slug -> { snapshot, ts, inflight }

async function refreshGlobal() {
  if (globalInflight) return globalInflight
  globalInflight = buildSnapshot('')
    .then(snap => { globalSnapshot = snap; return snap })
    .catch(err => {
      console.error('[analytics] 全局快照刷新失败:', err.message)
      if (!globalSnapshot) throw err // 首份都没有则向上抛
      return globalSnapshot
    })
    .finally(() => { globalInflight = null })
  return globalInflight
}

export async function getGlobalSnapshot() {
  if (globalSnapshot) return globalSnapshot
  return refreshGlobal()
}

export async function getProvinceSnapshot(slug) {
  if (!slug) return getGlobalSnapshot()
  const now = Date.now()
  const cached = provinceCache.get(slug)
  if (cached?.snapshot && now - cached.ts < config.provinceTtlMs) return cached.snapshot
  if (cached?.inflight) return cached.inflight

  const inflight = getGlobalSnapshot().then(async global => {
    const snap = await buildProvinceSnapshot(global, slug)
    provinceCache.set(slug, { snapshot: snap, ts: Date.now(), inflight: null })
    return snap
  })
  provinceCache.set(slug, { snapshot: cached?.snapshot ?? null, ts: cached?.ts ?? 0, inflight })
  return inflight
}

export function startScheduler() {
  refreshGlobal().catch(err => console.error('[analytics] 首次快照构建失败:', err.message))
  refreshTimer = setInterval(() => {
    refreshGlobal().catch(() => {})
  }, config.refreshMs)
  refreshTimer.unref?.()
}

export function snapshotMeta() {
  return {
    ready: Boolean(globalSnapshot),
    refreshedAt: globalSnapshot?.refreshedAt ?? null,
    provinceCacheSize: provinceCache.size,
  }
}
