// HTTP 服务:DBD 增量同步接收端(内部接口,经 nginx 反代 + IP 白名单)。
//   POST /api/internal/dbd/thaicompany/manifest/query      推送前 manifest 比对
//   POST /api/internal/dbd/thaicompany/upsert-batch         完整企业 upsert(mode=upsert_if_newer)
//   POST /api/internal/dbd/thaicompany/patch-fields-batch   补采 5 字段合并(mode=merge_patch_fields)
//   GET  /api/internal/dbd/sync/batches/{batch_id}          批次核对
//   GET  /api/internal/dbd/health                            健康(不鉴权,只回 ok + db ping)
//
// 鉴权:Authorization: Bearer <SYNC_TOKEN>。未配置 token = 拒绝一切写(fail-closed)。
// 直写 woocms.cms_content_entries.meta_json,详见 db.js。
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { queryManifest, processUpsertBatch, processPatchBatch, getBatchStatus, ping } from './db.js'

const BASE = '/api/internal/dbd'
const VALID_JPNO = /^[A-Za-z0-9-]{1,64}$/
const VALID_BATCH = /^[A-Za-z0-9._:-]{1,128}$/
const BATCH_RE = new RegExp(`^${BASE}/sync/batches/([^/]+)$`)

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

// 常量时间比较 token,避免长度/内容旁路
function tokenOk(provided) {
  if (!config.syncToken || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(config.syncToken)
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

// 返回 null 表示鉴权通过;否则返回应答对象已发送
function authGuard(req, res) {
  if (!config.syncToken) { send(res, 503, { error: 'not_configured', message: 'SYNC_TOKEN 未配置,拒绝写入。' }); return false }
  const h = req.headers['authorization'] || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m || !tokenOk(m[1].trim())) { send(res, 401, { error: 'unauthorized', message: '缺少或无效的同步 token。' }); return false }
  return true
}

function readJsonBody(req, res) {
  return new Promise(resolve => {
    let size = 0
    const chunks = []
    let aborted = false
    req.on('data', c => {
      if (aborted) return
      size += c.length
      if (size > config.maxBodyBytes) {
        aborted = true
        send(res, 413, { error: 'payload_too_large', message: `请求体超过上限 ${config.maxBodyBytes} 字节。` })
        req.destroy()
        return resolve(null)
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (aborted) return
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) }
      catch { send(res, 400, { error: 'invalid_json', message: '请求体不是合法 JSON。' }); resolve(null) }
    })
    req.on('error', () => { if (!aborted) { send(res, 400, { error: 'read_error' }); resolve(null) } })
  })
}

function wantDryRun(url, body) {
  return url.searchParams.get('dry_run') === 'true' || body?.dry_run === true
}

// 批次内每条 jpno 校验;返回 { valid:[...], invalid:[{jpno,error}] }
function partitionByJpno(items) {
  const valid = [], invalid = []
  for (const it of items) {
    const jpno = String(it?.jpno ?? '').trim()
    if (!VALID_JPNO.test(jpno)) invalid.push({ jpno: jpno || null, error: 'invalid_jpno' })
    else valid.push({ ...it, jpno })
  }
  return { valid, invalid }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${config.port}`)
    const path = url.pathname.replace(/\/+$/, '')

    // ── 健康检查(不鉴权)────────────────────────────
    if (path === `${BASE}/health` && req.method === 'GET') {
      const ok = await ping().catch(() => false)
      return send(res, ok ? 200 : 503, { ok, service: 'dbd-ingest', tokenConfigured: !!config.syncToken })
    }

    // ── 批次状态查询(GET,需鉴权)───────────────────
    const bm = path.match(BATCH_RE)
    if (bm && req.method === 'GET') {
      if (!authGuard(req, res)) return
      const batchId = decodeURIComponent(bm[1]).trim()
      if (!VALID_BATCH.test(batchId)) return send(res, 400, { error: 'invalid_batch_id' })
      const st = await getBatchStatus(batchId)
      return st ? send(res, 200, st) : send(res, 404, { error: 'batch_not_found', batch_id: batchId })
    }

    // ── 以下均为 POST 写接口 ─────────────────────────
    if (req.method !== 'POST' || !path.startsWith(`${BASE}/`)) {
      return send(res, 404, { error: 'not_found', hint: `endpoints live under ${BASE}/` })
    }
    if (!authGuard(req, res)) return

    // manifest 查询(读,但归内部接口一并鉴权)
    if (path === `${BASE}/thaicompany/manifest/query`) {
      const body = await readJsonBody(req, res); if (body === null) return
      const jpnos = Array.isArray(body.jpnos) ? body.jpnos.map(v => String(v).trim()).filter(Boolean) : null
      if (!jpnos || !jpnos.length) return send(res, 400, { error: 'missing_jpnos' })
      if (jpnos.length > config.maxManifestJpnos) return send(res, 400, { error: 'too_many_jpnos', max: config.maxManifestJpnos })
      const items = await queryManifest(jpnos)
      return send(res, 200, { items })
    }

    // upsert / patch:共用批次校验
    const isUpsert = path === `${BASE}/thaicompany/upsert-batch`
    const isPatch = path === `${BASE}/thaicompany/patch-fields-batch`
    if (isUpsert || isPatch) {
      const body = await readJsonBody(req, res); if (body === null) return
      const dryRun = wantDryRun(url, body)
      const batchId = String(req.headers['idempotency-key'] || body.batch_id || '').trim()
      const source = body.source ? String(body.source).slice(0, 128) : null
      if (!dryRun && !VALID_BATCH.test(batchId)) return send(res, 400, { error: 'missing_or_invalid_batch_id' })
      if (!Array.isArray(body.items) || !body.items.length) return send(res, 400, { error: 'missing_items' })
      if (body.items.length > config.maxBatchItems) return send(res, 400, { error: 'batch_too_large', max: config.maxBatchItems, received: body.items.length })

      const { valid, invalid } = partitionByJpno(body.items)
      const fn = isUpsert ? processUpsertBatch : processPatchBatch
      const result = await fn({ batchId: batchId || 'dry-run', source, items: valid, dryRun })
      if (result?.error) return send(res, 409, result.error)
      // 非法 jpno 计入 failed 汇报
      if (invalid.length) {
        result.failed = (result.failed || 0) + invalid.length
        result.errors = [...(result.errors || []), ...invalid]
      }
      return send(res, 200, result)
    }

    return send(res, 404, { error: 'not_found', hint: `endpoints live under ${BASE}/` })
  } catch (err) {
    console.error('[ingest] 请求处理失败:', err.message)
    return send(res, 500, { error: 'internal', message: err.message })
  }
})

const BIND = process.env.BIND_HOST || '127.0.0.1'
server.listen(config.port, BIND, () => {
  console.log(`[ingest] 监听 ${BIND}:${config.port}  schema=${config.db.schema}  token=${config.syncToken ? '已配置' : '未配置(拒绝写入)'}`)
})
