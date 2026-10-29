// 配置:优先环境变量,其次本服务 .env,再次 admin/.env(取 DB 凭据),最后默认值。
// 零依赖,与 analytics sidecar 同风格。
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
  } catch {
    // 无 .env 时静默使用默认值
  }
}
loadDotEnv(envPath)
loadDotEnv(adminEnvPath)

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export const config = {
  port: int(process.env.PORT, 8085),
  // 会话鉴权用:反查登录态得回打 WooCMS 的 /api/site/v1/auth/me(与 sanitizer 同款 whoAmI 手法)
  woocmsHost: process.env.WOOCMS_HOST || '127.0.0.1',
  woocmsPort: int(process.env.WOOCMS_PORT, 9183),
  // 单次返回上限(职业董事最多挂 ~393 家,默认 50,可分页翻到全部)
  defaultLimit: int(process.env.DEFAULT_LIMIT, 50),
  maxLimit: int(process.env.MAX_LIMIT, 500),
  // 单个 cmtNo 结果缓存 TTL(毫秒,默认 5 分钟;索引表每小时重建,短缓存足够)
  cacheTtlMs: int(process.env.CACHE_TTL_MS, 300000),
  cacheMax: int(process.env.CACHE_MAX, 2000),
  corsOrigin: process.env.CORS_ORIGIN || '',
  // 单 IP 通用限流(令牌桶式滑动窗口):窗口内允许的请求数
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 60),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || '',
    schema: process.env.DB_SCHEMA || 'woocms',
  },
}
