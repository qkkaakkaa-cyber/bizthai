// 脱敏 + 配额代理:挡在 WooCMS(9183)前面,只处理公网 /api/site/v1/models/ 路径。
// 内部 SSR / analytics 走 127.0.0.1:9183 直连,不经本服务,拿全量数据不受影响。
//
// 职责(对应用户三项要求):
//   ① 服务端字段脱敏:cmtNo(证件号)任何情况都剥;董事个人 phoneNo/地址匿名剥、登录保留。
//   ② 按账号+按IP访问配额:登录按 acct:{uid} 计数、匿名按 ip 计数,超软限 429。
//   ③ 爬虫判定+拦截:超 软限×hardMultiplier → 403 并写日志(供封号/告警)。
//
// 关键:登录用户也计数(与 ai/gate.js 的"登录不限次"相反)——因为爬虫正是登录后来爬的。
import { createServer } from 'node:http'
import { config } from './config.js'

// ── 身份解析(cookie/Authorization/X-Session-Token → uid),带 60s 缓存,避免每请求都打 /auth/me ──
// 小程序端 wx.request() 不会像浏览器那样自动带 Cookie,登录态改用 Authorization: Bearer <session_token>
// 或 X-Session-Token 头传递(resolver 反代给 WooCMS 时本就原样透传这两个头,这里之前漏转发,
// 导致小程序登录会员在这层被误判成匿名,配额从 800/h 降到 400/h)。三种凭证任一存在即尝试识别。
const idCache = new Map() // idKey -> { uid, at }
const ID_TTL = 60000
async function whoAmI(cookie, authHeader, sessionTokenHeader) {
  const idKey = cookie || authHeader || sessionTokenHeader
  if (!idKey) return null
  const hit = idCache.get(idKey)
  if (hit && Date.now() - hit.at < ID_TTL) return hit.uid
  let uid = null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const headers = {}
    if (cookie) headers.cookie = cookie
    if (authHeader) headers.authorization = authHeader
    if (sessionTokenHeader) headers['x-session-token'] = sessionTokenHeader
    const r = await fetch(`http://${config.woocmsHost}:${config.woocmsPort}/api/site/v1/auth/me`, { headers, signal: ctrl.signal })
    clearTimeout(t)
    if (r.ok) { const j = await r.json(); uid = (j?.data?.user?.id ?? j?.data?.id) || null }
  } catch { uid = null } // 校验失败按匿名处理(会落到更严的匿名配额,不会误放行)
  idCache.set(idKey, { uid, at: Date.now() })
  return uid
}

// ── 配额计数(进程内滚动窗口,与 ai/gate.js 同风格)──
const counters = new Map() // key -> { count, resetAt }
function bump(key) {
  const now = Date.now()
  let e = counters.get(key)
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + config.windowMs }; counters.set(key, e) }
  e.count += 1
  return { count: e.count, resetAt: e.resetAt }
}
const sweep = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of counters) if (now > v.resetAt) counters.delete(k)
  for (const [k, v] of idCache) if (now - v.at > ID_TTL) idCache.delete(k)
}, 600000)
if (sweep.unref) sweep.unref()

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}

// ── 递归脱敏:cmtNo 到处都删;person-like 对象(有 cmtSeq/firstName)再剥个人住址;
// 电话/传真/邮箱一律剥,不再看登录状态(2026-07-11 PDPA 投诉修复)——这个通用 API 不知道、也不该
// 自行判断某条联系方式是否已经被认领会员手动确认要公开;"已核验联系方式"改由 resolver SSR 单独算好
// 直接写进公司详情页 HTML(见 resolver/src/server.js 的 data-contact-* 属性),不走这条通用模型接口。
// 公司级字段(公司名/公司地址/省/业务)不是 person-like,不受影响。
// 2026-07-12:committees/signCommittees(董事/签字人名录,含真实姓名)改成未登录一律剥——用户明确
// 要求"公司的全部人事/董事信息都必须登录可见,包括接口渲染出来的数据,避免爬虫抓取(爬虫不会登录)"。
// 跟电话/邮箱不同:董事姓名本身不是"未经同意不能公开"的数据(登记档案合法信息,给登录会员看没问题),
// 这里是"登录墙"而非"仅认领核验后才显示",所以门槛是 keepPersonnel=!!uid,不需要查认领记录。
// 同日再改:认领会员选 'hidden' 时不是把 committees 整段剥掉,是把姓名打码后保留(其它字段如国籍、
// 更新日期原样保留)——committees 因此变成三态(全量/打码/整段剥掉)。
// 2026-07-12 踩坑修的 bug:一开始把 committees 的三态判断从这个通用递归里挪出去,在调用处单独只
// 处理 obj.data.meta.raw.committees 这一条路径——结果漏了 WooCMS 响应里还有一份 obj.data.
// meta_formatted.raw.committees(同一份数据的"格式化后"副本,'hidden'/默认匿名两种场景都该管,
// 结果完全没管,真实姓名原样从这条路径漏出去了)。教训:这个响应形状里凡是"敏感字段",一律不能假设
// 只出现在一个固定路径,必须留在 scrub() 这个本来就会走遍整棵树的通用递归里处理,不要为了图方便
// 单独摘出去只查一条路径——scrub() 的价值就在于它不管字段藏在树的哪个角落都能找到,单独摘出去的
// 那次改动等于放弃了这个保证。committeesMode 现在跟着整个递归一起往下传,树里任何一处 committees
// 数组都会拿到同一个决策('keep' 全量保留 / 'mask' 打码保留 / 'strip' 整段剥掉)。
// signCommittees 是签字权限的自由文本描述,没法像结构化姓名字段那样可靠打码,只有"整段保留"或
// "整段剥掉"两态,继续放 PERSONNEL_KEYS 里用 keepPersonnel 这个二元判断。
const PERSONAL_LOC = ['address', 'zipCode', 'tumbonCode', 'ampurCode', 'pvCode']
const PHONE_KEYS = new Set(['phoneNo', 'phoneno', 'phone', 'faxNo', 'faxno', 'fax', 'tel', 'mobile', 'mobileNo', 'mobileno', 'email', 'Email', 'emailAddress'])
const PERSONNEL_KEYS = new Set(['signCommittees'])
// 跟 resolver/src/server.js 的 ssrMaskName() 保持同一套算法(首尾各留一字符,中间固定 5 个星号,
// 不随原长度变化)——两边独立维护一份,不共享模块,是这个代码库一贯"每个服务零依赖"的风格。
function maskName(name) {
  name = String(name || '').trim()
  if (name.length <= 1) return name
  if (name.length === 2) return name[0] + '*'
  return name[0] + '*****' + name[name.length - 1]
}
// 把 committees 数组每一项的姓名字段(泰文 titleName+firstName+middleName+lastName、英文同名+E 后缀)
// 拼成整串后打码,再摊平塞回 firstName/firstNameE、清空其余拼名字段——下游(theme.js 等走这条公开
// API 的消费方)沿用现成的"拼 title+first+middle+last"逻辑时,自然拼出打码后的姓名,不用额外教会
// 客户端"这条数据已经打码过"这件事。原地修改传入的数组。
function maskCommitteeNames(committees) {
  for (const c of committees) {
    if (!c || typeof c !== 'object') continue
    const th = [c.titleName, c.firstName, c.middleName, c.lastName].map(x => String(x || '').trim()).filter(Boolean).join(' ')
    const en = [c.titleNameE, c.firstNameE, c.middleNameE, c.lastNameE].map(x => String(x || '').trim()).filter(Boolean).join(' ')
    c.titleName = ''; c.middleName = ''; c.lastName = ''
    c.titleNameE = ''; c.middleNameE = ''; c.lastNameE = ''
    c.firstName = th ? maskName(th) : ''
    c.firstNameE = en ? maskName(en) : ''
  }
}
function scrub(node, keepPersonnel, committeesMode) {
  if (Array.isArray(node)) { for (const n of node) scrub(n, keepPersonnel, committeesMode); return }
  if (!node || typeof node !== 'object') return
  if ('cmtNo' in node) delete node.cmtNo                    // 证件号:任何情况都剥
  const isPerson = ('cmtSeq' in node) || ('firstName' in node) || ('firstNameE' in node) || ('titleName' in node)
  if (isPerson) { for (const k of PERSONAL_LOC) if (k in node) delete node[k] }  // 董事个人住址:剥(公司地址不在 person 对象里,不受影响)
  for (const k of Object.keys(node)) if (PHONE_KEYS.has(k)) delete node[k]  // 电话/传真/邮箱:一律剥
  if (!keepPersonnel) { for (const k of Object.keys(node)) if (PERSONNEL_KEYS.has(k)) delete node[k] }  // 签字权限描述:未登录剥
  if (Array.isArray(node.committees)) {  // 董事名录:三态,树里不管出现在哪一层都用同一个决策
    if (committeesMode === 'strip') delete node.committees
    else if (committeesMode === 'mask') maskCommitteeNames(node.committees)
    // 'keep':原样保留,不用做什么
  }
  for (const k in node) scrub(node[k], keepPersonnel, committeesMode)
}

function send(res, status, body, ct = 'application/json; charset=utf-8', extra) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'Content-Type': ct, ...(extra || {}) })
  res.end(body)
}

let activeRequests = 0
const server = createServer(async (req, res) => {
  let admitted = false
  let upstreamCtrl = null
  let upstreamTimer = null
  const cancelUpstream = () => {
    if (upstreamCtrl && !upstreamCtrl.signal.aborted) upstreamCtrl.abort()
  }
  try {
    if (req.url === '/healthz') return send(res, 200, '{"ok":true}')

    if (activeRequests >= config.maxInflight) {
      return send(res, 503, '{"error":"temporarily_busy"}', 'application/json; charset=utf-8', {
        'Cache-Control': 'no-store',
        'Retry-After': '30',
      })
    }
    activeRequests += 1
    admitted = true
    req.once('aborted', cancelUpstream)
    res.once('close', cancelUpstream)

    const ip = clientIp(req)
    const cookie = req.headers.cookie || ''
    const authHeader = req.headers['authorization'] || ''
    const sessionTokenHeader = req.headers['x-session-token'] || ''
    const uid = await whoAmI(cookie, authHeader, sessionTokenHeader)
    const key = uid ? `acct:${uid}` : `ip:${ip}`
    const soft = uid ? config.acctLimit : config.anonLimit
    const hard = soft * config.hardMultiplier
    const { count, resetAt } = bump(key)
    const retry = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))

    if (count > hard) {
      // 爬虫判定:短时间内远超真人可能的访问量。记日志供封号/告警。
      console.log(JSON.stringify({ evt: 'scraper_blocked', key, count, soft, ip, uid: uid || null, ua: req.headers['user-agent'] || '', at: new Date(resetAt - config.windowMs).toISOString() }))
      return send(res, 403, '{"error":"access_blocked","reason":"abuse_detected"}', 'application/json; charset=utf-8', { 'Retry-After': retry })
    }
    if (count > soft) {
      return send(res, 429, '{"error":"quota_exceeded"}', 'application/json; charset=utf-8', { 'Retry-After': retry })
    }

    // ── 反代到 WooCMS,缓冲响应,脱敏后返回 ──
    upstreamCtrl = new AbortController()
    upstreamTimer = setTimeout(() => upstreamCtrl.abort(), config.upstreamTimeoutMs)
    const up = await fetch(`http://${config.woocmsHost}:${config.woocmsPort}${req.url}`, {
      method: req.method,
      headers: {
        cookie, accept: 'application/json', host: req.headers['host'] || 'bizthai.com',
        ...(authHeader ? { authorization: authHeader } : {}),
        ...(sessionTokenHeader ? { 'x-session-token': sessionTokenHeader } : {}),
      },
      signal: upstreamCtrl.signal,
    })

    const ctype = up.headers.get('content-type') || ''
    const text = await up.text()

    if (ctype.includes('application/json')) {
      try {
        const obj = JSON.parse(text)
        // 2026-07-12:认领会员能在会员中心针对自己名下公司单独设置 meta.directorsPublic,覆盖
        // 下面这条全局的"未登录一律剥"门槛。这个字段是 meta 顶层字段(跟 phoneno/email 同级),
        // 只在 obj.data.meta 这一个地方读一次决定"整份响应"该怎么处理 committees——但committees
        // 数组本身在响应树里不止一处(WooCMS 同时给了 meta.raw.committees 和 meta_formatted.raw.
        // committees 两份,踩过一次坑,见 scrub() 里的教训注释),所以决策只读一次,执行(mask/strip/
        // keep)必须交给 scrub() 的通用递归去处理每一处,不能自己单独摘一条路径出来处理。
        const entryMeta = obj && obj.data && obj.data.meta
        const dp = entryMeta ? entryMeta.directorsPublic : undefined
        const committeesMode = dp === 'public' ? 'keep' : (dp === 'hidden' ? 'mask' : (uid ? 'keep' : 'strip'))
        // signCommittees(自由文本,只有二态):'public' 保留,其它(含 'hidden',这段文本没法可靠
        // 打码)一律看登录态。三态字符串不是布尔——理由见 resolver/src/server.js 同名变量注释。
        const keepPersonnel = dp === 'public' ? true : (dp === 'hidden' ? false : !!uid)
        scrub(obj, keepPersonnel, committeesMode)
        return send(res, up.status, JSON.stringify(obj))
      } catch { /* 解析失败,走下面的兜底 */ }
    }
    // 非 JSON 或解析失败:兜底防泄漏——含敏感字段又没脱成的,一律不返回原文
    if (/"cmtNo"|"phoneNo"|"email"/i.test(text) || (!uid && /"committees"|"signCommittees"/i.test(text))) {
      return send(res, 502, '{"error":"sanitize_failed"}')
    }
    return send(res, up.status, text, ctype || 'application/json; charset=utf-8')
  } catch (e) {
    return send(res, 503, '{"error":"upstream_unavailable"}', 'application/json; charset=utf-8', {
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    })
  } finally {
    if (upstreamTimer) clearTimeout(upstreamTimer)
    if (admitted) {
      req.off('aborted', cancelUpstream)
      res.off('close', cancelUpstream)
      activeRequests -= 1
    }
  }
})

server.listen(config.port, '127.0.0.1', () => {
  console.log(`[sanitizer] listening on 127.0.0.1:${config.port} → woocms ${config.woocmsHost}:${config.woocmsPort} | maxInflight=${config.maxInflight} timeout=${config.upstreamTimeoutMs}ms anon=${config.anonLimit}/win acct=${config.acctLimit}/win hard×${config.hardMultiplier}`)
})
