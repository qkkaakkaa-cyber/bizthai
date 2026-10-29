// 配置:优先环境变量,其次本服务 .env,最后默认值。零依赖,与 ingest/analytics/directors 同风格。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env')

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

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export const config = {
  // 91xx 段:9183 WooCMS/9184 analytics/9185 directors/9186 resolver/9187 ai/9188 ingest/9189 sanitizer/9190 deploy-webhook
  port: int(process.env.PORT, 9190),

  // GitHub webhook secret。留空 = 服务拒绝一切请求(fail-closed)。
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  repoDir: process.env.REPO_DIR || '/www/wwwroot/bizthai',
  sshKeyPath: process.env.DEPLOY_SSH_KEY || resolve(here, '../.ssh/deploy_key'),
  sshKnownHosts: process.env.DEPLOY_SSH_KNOWN_HOSTS || resolve(here, '../.ssh/known_hosts'),
  deployTimeoutMs: int(process.env.DEPLOY_TIMEOUT_MS, 180000),

  logDir: resolve(here, '../../logs'),
}
