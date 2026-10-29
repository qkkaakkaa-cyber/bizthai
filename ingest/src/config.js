// 配置:优先环境变量,其次本服务 .env,再次 admin/.env(取 DB 凭据),最后默认值。
// 零依赖,与 directors/analytics sidecar 同风格。
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
  // 91xx 段:9183 WooCMS / 9184 analytics / 9185 directors / 9186 resolver / 9187 ai / 9188 ingest
  port: int(process.env.PORT, 9188),

  // 特权同步 token(Bearer)。留空 = 服务拒绝一切写请求(fail-closed)。
  syncToken: process.env.SYNC_TOKEN || '',

  // 单批条数上限(spec §2.2 建议 500~2000)与单请求体字节上限(spec:单条 1~5MB)
  maxBatchItems: int(process.env.MAX_BATCH_ITEMS, 2000),
  maxBodyBytes: int(process.env.MAX_BODY_BYTES, 64 * 1024 * 1024), // 64MB/批(2000 条 * ~30KB 余量)

  // 每条写的 statement_timeout(ms):都走 slug 唯一键,毫秒级,给足冗余
  statementTimeoutMs: int(process.env.STATEMENT_TIMEOUT_MS, 15000),

  // manifest 单次可查 jpno 数上限
  maxManifestJpnos: int(process.env.MAX_MANIFEST_JPNOS, 5000),

  // 日期相同、content_hash 不同时的策略:'review'(默认,不写,返回 conflict_same_date_changed)| 'overwrite'
  conflictPolicy: (process.env.CONFLICT_POLICY || 'review').toLowerCase(),

  // 本次写入的来源与补采字段版本(落 _patch_meta / _sync)
  patchFieldsVersion: process.env.PATCH_FIELDS_VERSION || '2026-07-03',

  // 与 sync/direct_import.py 完全一致的建模常量
  siteId: int(process.env.SITE_ID, 1),
  modelId: int(process.env.MODEL_ID, 2),      // thaicompany
  authorId: int(process.env.AUTHOR_ID, 1),
  taxProvince: int(process.env.TAX_PROVINCE, 1),
  taxCompanytype: int(process.env.TAX_COMPANYTYPE, 2),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || '',
    schema: process.env.DB_SCHEMA || 'woocms',
  },
}
