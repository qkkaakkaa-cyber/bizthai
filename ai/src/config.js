// 配置:优先环境变量,其次 ai/.env(简单解析,无第三方依赖),最后默认值。
// 注意:本服务跑在 www-data 下,读不到 root:600 的 sync/.env,故 DEEPSEEK_API_KEY 必须
// 复制一份到 ai/.env(同 sync/.env 里那把官方 key)。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../.env')

function loadDotEnv(path = envPath) {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq < 0) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch {
    // 无 .env 时静默使用默认值
  }
}
loadDotEnv()

const int = (v, d) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export const config = {
  port: int(process.env.PORT, 8087),
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // 底层数据通道(均为本机回环,直连各服务自己的端口)
  woocmsBase: (process.env.WOOCMS_BASE || 'http://127.0.0.1:8083').replace(/\/$/, ''),
  analyticsBase: (process.env.ANALYTICS_BASE || 'http://127.0.0.1:8084').replace(/\/$/, ''),
  directorsBase: (process.env.DIRECTORS_BASE || 'http://127.0.0.1:8085').replace(/\/$/, ''),
  model: process.env.MODEL || 'thaicompany',
  corsOrigin: process.env.CORS_ORIGIN || '',
  // DeepSeek(OpenAI 兼容 /chat/completions,直连官方,绕开 WooCMS 网关 —— 同 sync/translate_gaps.py)
  deepseek: {
    apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    maxRounds: int(process.env.AI_MAX_ROUNDS, 6),
    temperature: Number(process.env.AI_TEMPERATURE ?? 0.3),
    roundTimeoutMs: int(process.env.AI_ROUND_TIMEOUT_MS, 90000), // 单轮(fetch+读流)硬上限
    idleMs: int(process.env.AI_IDLE_MS, 25000), // 流空闲(无新数据)看门狗:超时即中止当轮
  },
  // 门控:匿名按 IP 每日试用 N 条后引导登录;登录会员不限次(见 gate.js checkGate)。
  // memberDailyLimit 现已不参与门控(会员不限次),保留字段仅为向后兼容。
  gate: {
    trialLimit: int(process.env.AI_TRIAL_LIMIT, 20),
    memberDailyLimit: int(process.env.AI_MEMBER_DAILY_LIMIT, 60),
    windowMs: int(process.env.AI_WINDOW_MS, 86400000),
  },
}
