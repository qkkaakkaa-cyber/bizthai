// 从前端权威源(web/src/data/taxonomy.generated.ts、web/src/api/client.ts)抽取
// 府/行业/国家三语映射,生成本服务自带的静态数据。前端改译文重跑 npm run gen:taxonomy 后,
// 在本目录执行 `node scripts/gen-data.mjs` 同步即可,无需手维护两份。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = resolve(here, '../../web')
const out = resolve(here, '../data')

const gen = readFileSync(resolve(web, 'src/data/taxonomy.generated.ts'), 'utf8')
const cli = readFileSync(resolve(web, 'src/api/client.ts'), 'utf8')

// PROVINCE_ROWS: { slug, th, en, zh }
const provBlock = gen.match(/PROVINCE_ROWS[^[]*\[([\s\S]*?)\n\]/)[1]
const provs = [...provBlock.matchAll(/\{\s*slug:\s*'([^']+)',\s*th:\s*'([^']*)',\s*en:\s*'([^']*)',\s*zh:\s*'([^']*)'\s*\}/g)]
  .map(m => ({ slug: m[1], th: m[2], en: m[3], zh: m[4] }))
writeFileSync(resolve(out, 'provinces.json'), JSON.stringify(provs, null, 2))

// INDUSTRY_LABELS: { 'tsic-a': { en, zh } }
const indBlock = gen.match(/INDUSTRY_LABELS[^{]*\{([\s\S]*?)\n\}/)[1]
const inds = {}
for (const m of indBlock.matchAll(/'([^']+)':\s*\{\s*zh:\s*'([^']*)',\s*en:\s*'([^']*)'\s*\}/g)) inds[m[1]] = { zh: m[2], en: m[3] }
writeFileSync(resolve(out, 'industries.json'), JSON.stringify(inds, null, 2))

// COUNTRY_LABELS: { cn: { zh, en, th } }
const cblock = cli.match(/COUNTRY_LABELS[^{]*\{([\s\S]*?)\n\}/)[1]
const countries = {}
for (const m of cblock.matchAll(/(\w{2}):\s*\{\s*zh:\s*'([^']*)',\s*en:\s*'([^']*)',\s*th:\s*'([^']*)'\s*\}/g)) countries[m[1]] = { zh: m[2], en: m[3], th: m[4] }
writeFileSync(resolve(out, 'countries.json'), JSON.stringify(countries, null, 2))

console.log('provinces:', provs.length, 'industries:', Object.keys(inds).length, 'countries:', Object.keys(countries).length)
