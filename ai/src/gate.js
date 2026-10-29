// 门控:匿名试用 N 条后引导登录。
//   已登录会员(WooCMS /auth/me 命中)→ 按 uid 计数,每日额度更高。
//   匿名 → 按 ai_anon cookie(无则按 IP)计数,达 trialLimit 即 need_login。
// 计数是进程内内存窗口(单实例足够;多实例需换共享存储)。
import { whoAmI } from './sources.js'
import { config } from './config.js'

const hits = new Map() // key -> { count, resetAt }

function bump(key, limit) {
  const now = Date.now()
  let e = hits.get(key)
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + config.gate.windowMs }
    hits.set(key, e)
  }
  e.count += 1
  return { count: e.count, limit, remaining: Math.max(0, limit - e.count), resetAt: e.resetAt, over: e.count > limit }
}

// 定期清理过期键(避免内存无限增长)
const sweep = setInterval(() => {
  const now = Date.now()
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
}, 3600000)
if (sweep.unref) sweep.unref()

// 只读查询当前计数(不自增),供额度展示端点(GET /quota)用
function peek(key, limit) {
  const now = Date.now()
  const e = hits.get(key)
  const active = e && now <= e.resetAt
  const count = active ? e.count : 0
  return { count, limit, remaining: Math.max(0, limit - count), resetAt: active ? e.resetAt : null, over: count > limit }
}

// 通用按键限流(供 /summary 等用,独立于会话试用额度)
export function rateLimit(key, limit, windowMs = config.gate.windowMs) {
  const now = Date.now()
  let e = hits.get(key)
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e) }
  e.count += 1
  return { count: e.count, over: e.count > limit }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return (req.socket && req.socket.remoteAddress) || 'unknown'
}

// 返回 { user, anonymous, unlimited, count?, limit, remaining, over }
// anonId 参数保留仅为兼容旧调用点(现已改为按 IP 计数,不再使用 ai_anon cookie 计次)。
export async function checkGate(req, anonId) {
  const cookie = req.headers.cookie || ''
  const user = await whoAmI(cookie, req.headers['authorization'] || '', req.headers['x-session-token'] || '')
  // 登录会员:不限次(不计数、门控恒不触发)
  if (user && user.id) {
    return { user, anonymous: false, unlimited: true, limit: null, remaining: null, over: false }
  }
  // 匿名:按 IP 每日额度(单 IP 每天 trialLimit 次)
  return { user: null, anonymous: true, unlimited: false, ...bump(`ip:${clientIp(req)}`, config.gate.trialLimit) }
}

// 只读版本:查询当前额度但不消耗一次(供 GET /quota 在页面展示"今日剩余次数")
export async function peekGate(req, anonId) {
  const cookie = req.headers.cookie || ''
  const user = await whoAmI(cookie, req.headers['authorization'] || '', req.headers['x-session-token'] || '')
  if (user && user.id) {
    return { user, anonymous: false, unlimited: true, limit: null, remaining: null, over: false }
  }
  return { user: null, anonymous: true, unlimited: false, ...peek(`ip:${clientIp(req)}`, config.gate.trialLimit) }
}
