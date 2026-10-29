// 配置:优先环境变量,其次本服务 .env,再次 admin/.env,最后默认值。零依赖,与其它 sidecar 同风格。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env')
const adminEnvPath = process.env.ADMIN_ENV || resolve(here, '../../admin/.env')

function loadDotEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim()
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch { /* 无 .env 时静默用默认 */ }
}
loadDotEnv(envPath)
loadDotEnv(adminEnvPath)

const int = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d }

export const config = {
  port: int(process.env.SANITIZER_PORT, 9189),
  // 上游 WooCMS(v2=9183),既是被脱敏的数据源,也是 /auth/me 会话校验来源
  woocmsHost: process.env.WOOCMS_HOST || '127.0.0.1',
  woocmsPort: int(process.env.WOOCMS_PORT, 9183),
  // 配额窗口 & 阈值(反爬:登录用户也计数,因为爬虫会登录后来爬)。窗口默认 1 小时,滚动。
  windowMs: int(process.env.QUOTA_WINDOW_MS, 3600000),
  anonLimit: int(process.env.QUOTA_ANON, 400),   // 匿名/IP 每小时上限(真人翻页远达不到)
  acctLimit: int(process.env.QUOTA_ACCT, 800),   // 登录账号每小时上限(会员放宽一倍)
  hardMultiplier: int(process.env.QUOTA_HARD_MULT, 3), // 超过 软限×此倍数 → 判定爬虫,硬拒 403 并记日志
  // WooCMS 的数据库连接池很小。限制全局并发并快速释放卡住的请求，避免公开 API
  // 在分布式爬虫压力下绕过 Nginx 的按 IP 限流，把整个站点的连接池占满。
  maxInflight: int(process.env.MAX_INFLIGHT, 3),
  upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 15000),
}
