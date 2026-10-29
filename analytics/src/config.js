// 配置:优先环境变量,其次 .env(简单解析,无第三方依赖),最后默认值。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env')
const adminEnvPath = process.env.ADMIN_ENV || resolve(here, '../../admin/.env')

function loadDotEnv(path = envPath) {
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
loadDotEnv()
loadDotEnv(adminEnvPath)

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export const config = {
  port: int(process.env.PORT, 8084),
  woocmsBase: (process.env.WOOCMS_BASE || 'http://127.0.0.1:8083').replace(/\/$/, ''),
  model: process.env.MODEL || 'thaicompany',
  sampleSize: int(process.env.SAMPLE_SIZE, 1200),
  samplePageSize: int(process.env.SAMPLE_PAGE_SIZE, 200),
  // 高资本/最新榜单各取多少条(走 sort+投影取全库真 Top,可被 /companies 分页切片)
  topCompanies: int(process.env.TOP_COMPANIES, 50),
  countConcurrency: int(process.env.COUNT_CONCURRENCY, 8),
  refreshMs: int(process.env.REFRESH_MS, 3600000),
  provinceTtlMs: int(process.env.PROVINCE_TTL_MS, 1800000),
  corsOrigin: process.env.CORS_ORIGIN || '',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || '',
    schema: process.env.DB_SCHEMA || 'woocms',
  },
}
