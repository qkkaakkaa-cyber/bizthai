// HTTP 服务:AI 对话 sidecar(8087),经 nginx 反代到 /api/site/v1/ai/。
//   GET  /api/site/v1/ai/health   健康检查
//   POST /api/site/v1/ai/chat     SSE 流式对话(events: meta / status / cards / delta / done / error / gate)
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { systemPrompt, summaryPrompt } from './prompt.js'
import { runAgent } from './deepseek.js'
import { checkGate, peekGate, rateLimit, clientIp } from './gate.js'
import { renderReportPdf } from './pdf.js'
import { renderPoster } from './poster.js'
import { companyIntro } from './intro.js'
import { saveCompanyImage } from './upload.js'
import { getEntry } from './sources.js'
import { renderMarkdown } from './markdown.js'

const BASE = '/api/site/v1/ai'
const MAX_HISTORY = 16

// 搜索页「AI 概览」结果缓存(同一查询 1h 内不重复调 DeepSeek,控成本)
const summaryCache = new Map()
const SUMMARY_TTL = 3600000

function normLocale(v) {
  v = String(v || '').trim().toLowerCase()
  if (v.indexOf('zh') === 0) return 'zh'
  if (v.indexOf('th') === 0) return 'th'
  if (v.indexOf('en') === 0) return 'en'
  return 'en'
}

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

function stripProtocolText(src) {
  return String(src || '')
    .replace(/[｜︱∣❘❙❚]/g, '|')
    .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?tool_calls\s*>[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?tool_calls\s*>/gi, '')
    .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?invoke\b[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?invoke\s*>/gi, '')
    .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?parameter\b[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?parameter\s*>/gi, '')
    .replace(/^\s*<\s*\|\s*(?:\|\s*)?DSML\s*\|.*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = '', size = 0
    req.on('data', c => {
      size += c.length
      if (size > limit) { reject(new Error('payload_too_large')); req.destroy() }
      else buf += c
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

function sendJSON(res, status, body, extraHeaders = {}) {
  if (res.writableEnded || res.destroyed) return
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

// PDF/海报都会占用无头 Chrome 页面。IP 限流无法阻止分布式请求，进程级总闸门
// 保证最多同时渲染两份，过载时明确返回可重试且不可缓存的临时错误。
let renderInflight = 0
const MAX_RENDER_INFLIGHT = 2
function acquireRender(res) {
  if (renderInflight >= MAX_RENDER_INFLIGHT) {
    sendJSON(res, 503, { error: 'renderer_busy' }, { 'Cache-Control': 'no-store', 'Retry-After': '30' })
    return false
  }
  renderInflight += 1
  return true
}

// 整形客户端传来的历史:只保留 user/assistant 的文本,截断条数与长度
function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return []
  const out = []
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    const content = typeof m.content === 'string' ? m.content.slice(0, 8000) : ''
    if (!content) continue
    out.push({ role: m.role, content })
  }
  return out.slice(-MAX_HISTORY)
}

async function handleChat(req, res) {
  let payload
  try {
    payload = JSON.parse(await readBody(req) || '{}')
  } catch {
    return sendJSON(res, 400, { error: 'bad_json' })
  }
  const locale = normLocale(payload.locale)
  const history = sanitizeHistory(payload.messages)
  if (!history.length || history[history.length - 1].role !== 'user') {
    return sendJSON(res, 400, { error: 'no_user_message' })
  }
  if (!config.deepseek.apiKey) {
    return sendJSON(res, 503, { error: 'ai_not_configured', hint: 'DEEPSEEK_API_KEY missing in ai/.env' })
  }

  // 匿名标识 cookie
  let anonId = readCookie(req, 'ai_anon')
  let setCookie = null
  if (!anonId) {
    anonId = randomUUID()
    setCookie = `ai_anon=${anonId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`
  }

  const gate = await checkGate(req, anonId)

  // SSE 头
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 让 nginx 不缓冲 SSE
  }
  if (setCookie) headers['Set-Cookie'] = setCookie
  if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
  res.writeHead(200, headers)

  const send = (event, data) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // 门控:超额 → 引导登录,不调用 DeepSeek
  if (gate.over) {
    send('gate', { need_login: gate.anonymous, anonymous: gate.anonymous, limit: gate.limit, remaining: 0 })
    send('done', { stopped: 'gate' })
    return res.end()
  }

  send('meta', { anonymous: gate.anonymous, limit: gate.limit, remaining: gate.remaining })

  const messages = [{ role: 'system', content: systemPrompt(locale, gate.user) }, ...history]
  // 心跳:防止中间代理在长工具调用期间断流
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)

  try {
    const result = await runAgent({
      messages,
      onStatus: s => send('status', s), // 工具开始:{tool,args}
      onTool: (name, args, out) => {    // 工具完成:回报数量,前端把该步骤标「✓ 找到 N 家」
        const count = (out && out.cards && out.cards.length) ||
          (out && out.llm && (out.llm.total || out.llm.returned || (Array.isArray(out.llm.companies) && out.llm.companies.length))) || 0
        // get_company 恒返回单张「本尊」卡:随 step 事件带上,前端据此显示更新时间徽标——
        // 不能靠「cards 事件里第一张」猜,并行工具调用(如同时跑 company_relations)会让关联公司抢先到达。
        const card = name === 'get_company' && out && Array.isArray(out.cards) && out.cards[0] ? out.cards[0] : undefined
        send('step', { tool: name, count, card })
      },
      onDelta: t => {
        const text = stripProtocolText(t)
        if (text) send('delta', { text })
      },
      onCards: (cards, tool) => send('cards', { cards, tool }),
    })
    send('done', { truncated: !!result.truncated })
  } catch (e) {
    send('error', { message: String((e && e.message) || e) })
    send('done', { error: true })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
}

// 额度查询:GET,返回当前请求方(登录会员 / 匿名 IP)今日剩余免费提问次数,只读不消耗。
// 供 /ai 页在页面上展示"今日还剩多少次"。
async function handleQuota(req, res) {
  const anonId = readCookie(req, 'ai_anon')
  const gate = await peekGate(req, anonId)
  return sendJSON(res, 200, {
    anonymous: gate.anonymous,
    unlimited: !!gate.unlimited,
    limit: gate.limit,
    remaining: gate.remaining,
  })
}

// 搜索结果页「AI 概览」:给定查询产出一段简短总结(不列公司),SSE 流式。带查询缓存 + IP 限流。
async function handleSummary(req, res) {
  let payload
  try { payload = JSON.parse(await readBody(req) || '{}') } catch { return sendJSON(res, 400, { error: 'bad_json' }) }
  const locale = normLocale(payload.locale)
  const q = String(payload.q || '').trim().slice(0, 300)

  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
  if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
  res.writeHead(200, headers)
  const send = (event, data) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`) }

  if (!q || !config.deepseek.apiKey) { send('done', { skip: true }); return res.end() }

  const cacheKey = `${locale}|${q.toLowerCase()}`
  const hit = summaryCache.get(cacheKey)
  if (hit && Date.now() - hit.at < SUMMARY_TTL) {
    if (hit.search) send('search', hit.search)
    const text = stripProtocolText(hit.text)
    if (text) send('delta', { text })
    send('done', { cached: true })
    return res.end()
  }

  if (rateLimit(`sum:${clientIp(req)}`, 40).over) { send('done', { skip: 'rate' }); return res.end() }

  const messages = [{ role: 'system', content: summaryPrompt(locale) }, { role: 'user', content: q }]
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)
  let acc = ''
  let searchParams = null
  try {
    await runAgent({
      messages,
      maxRounds: 2, // 概览要快:最多 1 次工具 + 收尾作答
      onStatus: s => send('status', s),
      onDelta: t => {
        const text = stripProtocolText(t)
        acc += text
        if (text) send('delta', { text })
      },
      // 捕获 AI 解析后的检索参数(keyword 已翻译、府已解析)→ 前端据此做原生分页检索
      onTool: (name, args, out) => {
        if (name === 'search_companies' && out && out.llm && out.llm._search && !searchParams) {
          searchParams = out.llm._search
          send('search', searchParams)
        }
      },
    })
    if (acc.trim()) {
      if (summaryCache.size > 500) summaryCache.clear()
      summaryCache.set(cacheKey, { at: Date.now(), text: acc, search: searchParams })
    }
    send('done', {})
  } catch (e) {
    send('error', { message: String((e && e.message) || e) })
    send('done', { error: true })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
}

// 企业报告 PDF:接收前端渲染好的报告正文 HTML + 公司信息,服务端无头 Chrome 打成 PDF。
async function handleReportPdf(req, res) {
  let payload
  try { payload = JSON.parse(await readBody(req, 1024 * 1024) || '{}') } catch { return sendJSON(res, 400, { error: 'bad_json' }) }
  const lang = normLocale(payload.locale)
  const title = String(payload.title || '').slice(0, 300)
  const bodyHtml = typeof payload.bodyHtml === 'string' ? payload.bodyHtml.slice(0, 700 * 1024) : ''
  if (!bodyHtml.trim()) return sendJSON(res, 400, { error: 'empty_body' })
  const company = {
    name: String((payload.company && payload.company.name) || '').slice(0, 200),
    nameEn: String((payload.company && payload.company.nameEn) || '').slice(0, 200),
    url: '',
  }
  const rawUrl = String((payload.company && payload.company.url) || '').slice(0, 500)
  if (/^https?:\/\//i.test(rawUrl)) company.url = rawUrl   // 只收本站 http(s) URL,防 SSRF/钓鱼
  // 体检发现:本接口原先匿名即可触发无头 Chrome 渲染(纯 per-IP 限流,换 IP 即绕过),
  // 消耗服务器 CPU/内存;与 /company-report 既有的登录门槛(见上面 handleCompanyReport)对齐。
  const anonId = readCookie(req, 'ai_anon')
  // 用 peekGate(只读、不自增):PDF 有独立的「每 IP 每天 1 次」限流,不应消耗对话免费额度;
  // 否则匿名用户点下载(必被 401 拦)也会白扣一次提问次数。
  const gate = await peekGate(req, anonId)
  if (!gate.user) return sendJSON(res, 401, { error: 'login_required' })
  // 产品要求:登录后每个 IP 每天只能下载 1 次(窗口取 gate.windowMs = 1 天)
  if (rateLimit(`pdf:${clientIp(req)}`, 1).over) return sendJSON(res, 429, { error: 'rate_limited' })
  if (!acquireRender(res)) return
  try {
    const pdf = await renderReportPdf({ title, bodyHtml, company, lang })
    // 文件名优先公司英文名(浏览器端 a.download 已用,这里是直连兜底)
    const fname = ((company.nameEn || company.name || title || 'bizthai-report').replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)) || 'bizthai-report'
    const headers = {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(fname)}.pdf`,
      'Cache-Control': 'no-store',
    }
    if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
    res.writeHead(200, headers)
    res.end(pdf)
  } catch (e) {
    console.error('[ai] PDF 渲染失败:', e.message)
    sendJSON(res, 500, { error: 'pdf_failed', message: e.message })
  } finally {
    renderInflight -= 1
  }
}

// 公司详情页「下载PDF」:通用化——不再自建一套报告内容/PDF渲染,而是复用与 /chat 完全相同的
// systemPrompt + runAgent 工具调用循环(把 jpno 当成用户消息发进去,命中 prompt 里
// 「注册号输入 = 自动生成完整企业报告」规则),拿到叙事正文后再复用 renderReportPdf(与 /report-pdf 同一份)。
async function handleCompanyReport(req, res) {
  let payload
  try { payload = JSON.parse(await readBody(req, 8 * 1024) || '{}') } catch { return sendJSON(res, 400, { error: 'bad_json' }) }
  const locale = normLocale(payload.locale)
  const jpno = String(payload.jpno || '').trim().slice(0, 40)
  if (!jpno) return sendJSON(res, 400, { error: 'no_jpno' })
  if (!config.deepseek.apiKey) return sendJSON(res, 503, { error: 'ai_not_configured' })

  const anonId = readCookie(req, 'ai_anon')
  // peekGate:只读不自增(与 /report-pdf 同理,详情页下载有独立 creport 限流,不消耗对话额度)
  const gate = await peekGate(req, anonId)
  if (!gate.user) return sendJSON(res, 401, { error: 'login_required' }) // 与详情页下载按钮既有的登录门槛一致
  if (gate.over) return sendJSON(res, 429, { error: 'gate_over' })
  if (rateLimit(`creport:${gate.user.id}`, 20).over) return sendJSON(res, 429, { error: 'rate_limited' })

  let entry
  try { entry = await getEntry(jpno) } catch { entry = null }
  if (!entry) return sendJSON(res, 404, { error: 'company_not_found' })
  const m = entry.meta || {}
  const nameEn = m.jpnamee || ''
  const nameTh = m.jpname || ''
  const displayName = (locale === 'th' ? (nameTh || nameEn) : (nameEn || nameTh)) || jpno
  const rawUrl = String(payload.url || '').slice(0, 500)
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : ''

  const messages = [
    { role: 'system', content: systemPrompt(locale, gate.user) },
    { role: 'user', content: jpno },
  ]
  let acc = ''
  if (!acquireRender(res)) return
  try {
    const result = await runAgent({ messages, onDelta: t => { acc += stripProtocolText(t) } })
    if (!acc.trim()) return sendJSON(res, 502, { error: result.truncated ? 'ai_truncated' : 'ai_empty' })
    const bodyHtml = renderMarkdown(acc)
    const company = { name: displayName, nameEn, url }
    const pdf = await renderReportPdf({ title: displayName, bodyHtml, company, lang: locale })
    const fname = ((nameEn || displayName).replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)) || 'bizthai-report'
    const headers = {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(fname)}.pdf`,
      'Cache-Control': 'no-store',
    }
    if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
    res.writeHead(200, headers)
    res.end(pdf)
  } catch (e) {
    console.error('[ai] 公司报告生成失败:', e.message)
    sendJSON(res, 500, { error: 'report_failed', message: e.message })
  } finally {
    renderInflight -= 1
  }
}

// 分享海报:据 jpno 拉公司资料,服务端无头 Chrome 渲染 9:16 商务海报 PNG/JPEG。
async function handlePoster(req, res) {
  let payload
  try { payload = JSON.parse(await readBody(req, 64 * 1024) || '{}') } catch { return sendJSON(res, 400, { error: 'bad_json' }) }
  const lang = normLocale(payload.locale)
  const jpno = String(payload.jpno || '').trim().slice(0, 40)
  if (!jpno) return sendJSON(res, 400, { error: 'no_jpno' })
  let url = String(payload.url || '').slice(0, 500)
  if (!/^https?:\/\//i.test(url)) url = ''
  // 产品要求(2026-07-03):海报免登录、不限"是否会员",但为防匿名刷爆无头 Chrome(耗 CPU/内存),
  // 保留 per-IP 限流:同一 IP 每小时最多 10 张(窗口 1h)。
  if (rateLimit(`poster:${clientIp(req)}`, 10, 3600000).over) return sendJSON(res, 429, { error: 'rate_limited' })
  if (!acquireRender(res)) return
  try {
    const entry = await getEntry(jpno)
    if (!entry) return sendJSON(res, 404, { error: 'company_not_found' })
    const m = entry.meta || {}
    const company = {
      jpno: m.jpno || jpno,
      nameEn: m.jpnamee || '', nameTh: m.jpname || '', nameZh: m.jpnamezh || '',
      province: m.provincee || '', district: m.ampurdesce || '',
      capital: m.capamt || '', status: m.jpstatdesce || m.jpstatdesc || '',
      business: m.businesstypedesce || m.setupobjdesce || '',
      type: m.jptypedesce || m.companytypee || '',
      address: m.addresse || m.address || '',
      regdate: m.regdate || '', updatedate: (entry.updated_at || m.updatedate || '').slice(0, 10), url,
      logo: m.logourl || '', hero: m.herourl || '',   // 会员上传的品牌图(无则海报回退字母章/随机商务图)
    }
    const intro = await companyIntro(company, lang)
    const img = await renderPoster({ company, lang, intro })
    const headers = { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-store' }
    if (config.corsOrigin) { headers['Access-Control-Allow-Origin'] = config.corsOrigin; headers['Vary'] = 'Origin' }
    res.writeHead(200, headers)
    res.end(img)
  } catch (e) {
    console.error('[ai] 海报渲染失败:', e.message)
    sendJSON(res, 500, { error: 'poster_failed', message: e.message })
  } finally {
    renderInflight -= 1
  }
}

// 会员公司图片上传:校验登录 + 认领归属(owner)→ ImageMagick 裁切优化 → 存 web/uploads/company → 回 /uploads URL。
async function handleCompanyImage(req, res) {
  let payload
  try { payload = JSON.parse(await readBody(req, 12 * 1024 * 1024) || '{}') } catch { return sendJSON(res, 400, { error: 'bad_json' }) }
  const cookie = req.headers.cookie || ''
  const entryId = parseInt(payload.entryId, 10)
  const kind = payload.kind === 'logo' ? 'logo' : (payload.kind === 'hero' ? 'hero' : '')
  if (!entryId || !kind) return sendJSON(res, 400, { error: 'bad_params' })
  if (!cookie) return sendJSON(res, 401, { error: 'unauthorized' })
  // 归属校验:该会员必须是这个 entry 的 owner(GET /my-entries/:id 通=拥有)
  let owns = false
  try {
    const r = await fetch(`${config.woocmsBase}/api/site/v1/my-entries/${entryId}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    })
    owns = r.ok
  } catch { /* 网络失败按未授权 */ }
  if (!owns) return sendJSON(res, 403, { error: 'not_owner' })
  const m = String(payload.data || '').match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m) return sendJSON(res, 400, { error: 'bad_image' })
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
  if (!buf.length || buf.length > 8 * 1024 * 1024) return sendJSON(res, 400, { error: 'too_large' })
  if (rateLimit(`img:${clientIp(req)}`, 80).over) return sendJSON(res, 429, { error: 'rate_limited' })
  try {
    const url = await saveCompanyImage({ buf, kind, entryId })
    return sendJSON(res, 200, { url })
  } catch (e) {
    console.error('[ai] 图片处理失败:', e.message)
    return sendJSON(res, 500, { error: 'process_failed', message: e.message })
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${config.port}`)
    const path = url.pathname.replace(/\/$/, '')

    if (req.method === 'OPTIONS') {
      const h = { 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
      if (config.corsOrigin) { h['Access-Control-Allow-Origin'] = config.corsOrigin; h['Access-Control-Allow-Credentials'] = 'true' }
      res.writeHead(204, h); return res.end()
    }
    if (path === `${BASE}/health`) {
      return sendJSON(res, 200, { ok: true, model: config.deepseek.model, hasKey: !!config.deepseek.apiKey, tools: true })
    }
    if (path === `${BASE}/chat` && req.method === 'POST') {
      return handleChat(req, res)
    }
    if (path === `${BASE}/quota` && req.method === 'GET') {
      return handleQuota(req, res)
    }
    if (path === `${BASE}/summary` && req.method === 'POST') {
      return handleSummary(req, res)
    }
    if (path === `${BASE}/report-pdf` && req.method === 'POST') {
      return handleReportPdf(req, res)
    }
    if (path === `${BASE}/company-report` && req.method === 'POST') {
      return handleCompanyReport(req, res)
    }
    if (path === `${BASE}/poster` && req.method === 'POST') {
      return handlePoster(req, res)
    }
    if (path === `${BASE}/company-image` && req.method === 'POST') {
      return handleCompanyImage(req, res)
    }
    return sendJSON(res, 404, { error: 'not_found', hint: `POST ${BASE}/chat` })
  } catch (err) {
    console.error('[ai] 请求处理失败:', err.message)
    if (!res.headersSent) sendJSON(res, 500, { error: 'internal', message: err.message })
    else try { res.end() } catch { /* noop */ }
  }
})

server.listen(config.port, config.bindHost, () => {
  console.log(`[ai] 监听 ${config.bindHost}:${config.port},模型 ${config.deepseek.model},工具 ${config.deepseek.apiKey ? '就绪' : '缺 KEY'}`)
})
