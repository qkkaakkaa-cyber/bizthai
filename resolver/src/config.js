// 配置:优先环境变量,其次本服务 .env,再次 admin/.env(取 DB 凭据),最后默认值。
// 零依赖,与 analytics / directors sidecar 同风格。
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

// WooCMS 后端 host;单机多端口部署时 analytics/directors 与它同机,只是端口不同
const woocmsHost = process.env.WOOCMS_HOST || '127.0.0.1'

export const config = {
  port: int(process.env.PORT, 8086),
  // 监听地址:原生部署(systemd,同机 nginx)用回环即可;容器化部署(docker-compose)需 0.0.0.0 才能被同网络的 nginx 容器访问
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // WooCMS 后端(被反代的目标);解析出 jpNo 后内部取 /company/{jpNo} 整页返回
  woocmsHost,
  woocmsPort: int(process.env.WOOCMS_PORT, 8083),
  // slug→jpNo 命中短缓存(索引查已 ~1ms,缓存主要削热点峰值;TTL 短即可,backfill 补名后很快生效)
  cacheTtlMs: int(process.env.CACHE_TTL_MS, 300000),
  cacheMax: int(process.env.CACHE_MAX, 5000),
  // resolver 最终 HTML 缓存:页面经 SEO/SSR 注入后的完整结果在内存短缓存，避免每次重复打
  // WooCMS、analytics 和数据库。浏览器短缓存、共享缓存稍长；ETag 供 304 验证。
  htmlCacheTtlMs: int(process.env.HTML_CACHE_TTL_MS, 300000),
  htmlCacheMax: int(process.env.HTML_CACHE_MAX, 5000),
  htmlBrowserMaxAge: int(process.env.HTML_BROWSER_MAX_AGE, 60),
  htmlSharedMaxAge: int(process.env.HTML_SHARED_MAX_AGE, 300),
  disableWarmup: /^(?:1|true|yes)$/i.test(process.env.DISABLE_WARMUP || ''),
  // 行业扁平 URL: term 映射来源(英文名取 dbd 英文子域名)与刷新间隔
  industryNameHost: process.env.INDUSTRY_NAME_HOST || 'dbd.woocms.org',
  industryRefreshMs: int(process.env.REFRESH_MS, 3600000),
  // analytics/directors sidecar(府×行业交叉数据来源:/regions 府映射、/cross 交叉列表;董事反查)
  // 单机多端口部署时与 woocms 同 host,默认回退 woocmsHost 保持该行为不变;
  // 容器化部署(docker-compose)三者是独立容器/独立 hostname,需显式指定 ANALYTICS_HOST/DIRECTORS_HOST
  analyticsHost: process.env.ANALYTICS_HOST || woocmsHost,
  analyticsPort: int(process.env.ANALYTICS_PORT, 8084),
  directorsHost: process.env.DIRECTORS_HOST || woocmsHost,
  directorsPort: int(process.env.DIRECTORS_PORT, 8085),
  // sitemap 密名 token:非空时整套 sitemap 路径带上它(/sitemap-<token>*.xml),旧的 /sitemap*.xml 一律 404、
  // robots.txt 不再声明——防止被轻易枚举/采集(需在 Search Console 手动提交密名地址)。留空=沿用旧的公开路径。
  sitemapToken: (process.env.SITEMAP_TOKEN || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, ''),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || '',
    schema: process.env.DB_SCHEMA || 'woocms',
  },
}
