// 核心部署逻辑:git pull → diff → 路径映射 → npm ci(按需) → systemctl restart(按需)。
// 路径映射表写死在这里,不做成任意可配置项,避免被用来打偏(见 CLAUDE.md「数据库安全约定」的同一种谨慎)。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { config } from './config.js'

const pExecFile = promisify(execFile)

// 只有这 7 个是当前生产 v2 服务名,systemctl restart 只允许打这个白名单,
// 即使上面规则表以后被改错也不会重启到意料之外的单元。
const ALLOWED_SERVICES = new Set([
  'dbdadmin-woocms-v2',
  'dbdresolver-v2',
  'dbdai-v2',
  'dbdanalytics-v2',
  'dbddirectors-v2',
  'dbdingest-v2',
  'dbdsanitizer-v2',
])

// 按前缀匹配,数组顺序不重要,取最长前缀命中(admin/data/themes/ 要盖过 admin/ 这条通用规则)。
const SERVICE_RULES = [
  { prefix: 'dbd-thai/admin/data/themes/', restart: null }, // WooCMS 直接读盘即时渲染,不需要重启
  { prefix: 'dbd-thai/admin/migrations/', restart: 'dbdadmin-woocms-v2' }, // 触发启动时自动应用新迁移
  { prefix: 'dbd-thai/admin/', restart: null }, // 其余(文档/.env.dist 等)
  { prefix: 'dbd-thai/resolver/', restart: 'dbdresolver-v2', npmDir: 'dbd-thai/resolver' },
  { prefix: 'dbd-thai/ai/', restart: 'dbdai-v2', npmDir: 'dbd-thai/ai' },
  { prefix: 'dbd-thai/analytics/', restart: 'dbdanalytics-v2', npmDir: 'dbd-thai/analytics' },
  { prefix: 'dbd-thai/directors/', restart: 'dbddirectors-v2', npmDir: 'dbd-thai/directors' },
  { prefix: 'dbd-thai/ingest/', restart: 'dbdingest-v2', npmDir: 'dbd-thai/ingest' },
  { prefix: 'dbd-thai/sanitizer/', restart: 'dbdsanitizer-v2' }, // 无 package.json
  { prefix: 'dbd-thai/sync/', restart: null }, // 定时器/一次性脚本,下次触发自动读新代码
  { prefix: 'dbd-thai/ops/', restart: null }, // 只同步文件,绝不自动执行 .sql/.sh,也不自动装 systemd unit
]

function matchRule(path) {
  let best = null
  for (const rule of SERVICE_RULES) {
    if (path.startsWith(rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) best = rule
  }
  return best
}

export function planActions(changedFiles) {
  const restarts = new Set()
  const npmDirs = new Set()
  for (const f of changedFiles) {
    const rule = matchRule(f)
    if (!rule || !rule.restart) continue
    restarts.add(rule.restart)
    if (rule.npmDir && (f.endsWith('/package.json') || f.endsWith('/package-lock.json'))) {
      npmDirs.add(rule.npmDir)
    }
  }
  return { restarts: [...restarts], npmDirs: [...npmDirs] }
}

function gitEnv() {
  return {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${config.sshKeyPath} -o UserKnownHostsFile=${config.sshKnownHosts} -o IdentitiesOnly=yes -o BatchMode=yes`,
  }
}

async function run(cmd, args, opts = {}) {
  return pExecFile(cmd, args, {
    cwd: config.repoDir,
    timeout: config.deployTimeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  })
}

export async function deploy() {
  const t0 = Date.now()
  const oldHead = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim()

  await run('git', ['pull', '--ff-only', 'origin', 'main'], { env: gitEnv() })

  const newHead = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim()

  if (oldHead === newHead) {
    return { ok: true, oldHead, newHead, changed: [], restarts: [], npmRan: [], durationMs: Date.now() - t0, note: 'no-op' }
  }

  const diffOut = (await run('git', ['diff', '--name-only', oldHead, newHead])).stdout
  const changed = diffOut.split('\n').map(s => s.trim()).filter(Boolean)

  const { restarts, npmDirs } = planActions(changed)
  const allowedRestarts = restarts.filter(s => ALLOWED_SERVICES.has(s))

  const npmRan = []
  for (const dir of npmDirs) {
    await run('npm', ['ci', '--omit=dev'], { cwd: resolve(config.repoDir, dir) })
    npmRan.push(dir)
  }

  const restarted = []
  for (const svc of allowedRestarts) {
    await run('sudo', ['/usr/bin/systemctl', 'restart', svc])
    restarted.push(svc)
  }

  return { ok: true, oldHead, newHead, changed, restarts: restarted, npmRan, durationMs: Date.now() - t0 }
}
