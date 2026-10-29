import { createHash } from 'node:crypto'

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function etagForHtml(body) {
  const digest = createHash('sha256').update(String(body || '')).digest('base64url').slice(0, 24)
  return `"${digest}"`
}

export function htmlCacheKey(req, url) {
  const internalHost = String(req.headers.host || '').toLowerCase()
  const publicHost = String(req.headers['x-forwarded-host'] || internalHost).split(',')[0].trim().toLowerCase()
  return `${publicHost}|${internalHost}|${url.pathname}${url.search}`
}

export function requestAllowsSharedHtmlCache(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (req.headers.authorization || req.headers['x-session-token']) return false
  const cookie = String(req.headers.cookie || '')
  return !/(?:^|;\s*)(?:woocms_session|wc_session)=/i.test(cookie)
}

export function matchesIfNoneMatch(header, etag) {
  if (!header) return false
  return String(header).split(',').some(value => {
    const candidate = value.trim()
    return candidate === '*' || candidate === etag || candidate.replace(/^W\//, '') === etag
  })
}

export function createHtmlCache(options = {}) {
  const ttlMs = positiveInt(options.ttlMs, 300000)
  const maxEntries = positiveInt(options.maxEntries, 5000)
  const now = typeof options.now === 'function' ? options.now : Date.now
  const entries = new Map()

  function get(key) {
    const hit = entries.get(key)
    if (!hit) return null
    const current = now()
    if (hit.expiresAt <= current) {
      entries.delete(key)
      return null
    }
    // Map 的插入顺序作为轻量 LRU；热点条目移到队尾。
    entries.delete(key)
    entries.set(key, hit)
    return hit
  }

  function set(key, body) {
    const current = now()
    const entry = {
      body: String(body || ''),
      etag: etagForHtml(body),
      storedAt: current,
      expiresAt: current + ttlMs,
    }
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    return entry
  }

  return {
    get,
    set,
    clear: () => entries.clear(),
    get size() { return entries.size },
  }
}
