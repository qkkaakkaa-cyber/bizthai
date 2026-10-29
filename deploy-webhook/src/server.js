// HTTP 服务:GitHub push webhook 接收端(公网可达,经 nginx `^~ /api/deploy/` 反代)。
//   POST /api/deploy/github-webhook   校验签名 → git pull → 按路径决定是否重启对应服务
//   GET  /api/deploy/health            健康检查(不鉴权)
//
// 鉴权:X-Hub-Signature-256(HMAC-SHA256(WEBHOOK_SECRET, 原始请求体))。未配置 secret = 拒绝一切(fail-closed)。
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { openSync, closeSync, unlinkSync, appendFileSync, existsSync, statSync } from 'node:fs'
import { config } from './config.js'
import { deploy } from './deploy.js'

const ROUTE = '/api/deploy/github-webhook'
const LOCK_PATH = `${config.repoDir}/dbd-thai/deploy-webhook/.deploy.lock`
const STALE_LOCK_MS = 10 * 60 * 1000 // 部署正常不会超过这个时长,超过视为上次异常退出留下的死锁

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function logLine(file, obj) {
  try {
    appendFileSync(`${config.logDir}/${file}`, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n')
  } catch {
    // 日志写失败不影响主流程
  }
}

function sigOk(rawBody, signatureHeader) {
  if (!config.webhookSecret || !signatureHeader) return false
  const expected = 'sha256=' + createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signatureHeader)
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

function acquireLock() {
  if (existsSync(LOCK_PATH)) {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs
    if (age < STALE_LOCK_MS) return false
    try { unlinkSync(LOCK_PATH) } catch { /* 已被并发释放,忽略 */ }
  }
  try {
    closeSync(openSync(LOCK_PATH, 'wx'))
    return true
  } catch {
    return false // 输给了并发请求
  }
}

function releaseLock() {
  try { unlinkSync(LOCK_PATH) } catch { /* 不存在就算了 */ }
}

function readRawBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    const MAX = 10 * 1024 * 1024 // GitHub push payload 上限给够余量
    req.on('data', c => {
      size += c.length
      if (size > MAX) { rejectPromise(new Error('payload_too_large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks)))
    req.on('error', rejectPromise)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/api/deploy/health') {
    return send(res, 200, { ok: true })
  }

  if (req.method !== 'POST' || url.pathname !== ROUTE) {
    return send(res, 404, { error: 'not_found' })
  }

  if (!config.webhookSecret) {
    return send(res, 503, { error: 'not_configured', message: 'WEBHOOK_SECRET 未配置,拒绝一切请求。' })
  }

  let rawBody
  try {
    rawBody = await readRawBody(req)
  } catch {
    return send(res, 413, { error: 'payload_too_large' })
  }

  if (!sigOk(rawBody, req.headers['x-hub-signature-256'])) {
    return send(res, 401, { error: 'bad_signature' })
  }

  const event = req.headers['x-github-event']
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return send(res, 400, { error: 'bad_json' })
  }

  if (event !== 'push' || payload.ref !== 'refs/heads/main') {
    return send(res, 200, { ignored: true, event, ref: payload && payload.ref })
  }

  if (!acquireLock()) {
    return send(res, 200, { skipped: 'deploy-in-progress' })
  }

  try {
    const result = await deploy()
    logLine('dbddeploy.app.log', result)
    send(res, 200, result)
  } catch (err) {
    logLine('dbddeploy.app-error.log', { error: String(err && err.message || err) })
    send(res, 500, { ok: false, error: String(err && err.message || err) })
  } finally {
    releaseLock()
  }
})

server.listen(config.port, '127.0.0.1', () => {
  console.log(`dbd-deploy-webhook listening on 127.0.0.1:${config.port}`)
})
