// 会员公司图片处理:用 ImageMagick 裁切优化后存进 woocms 的 web/uploads/company/,回 /uploads URL。
//   logo:限制 512 内、保留透明、PNG;hero:16:9 cover 裁 1600×900、JPEG。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, unlink, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const run = promisify(execFile)
const UPLOAD_DIR = process.env.COMPANY_UPLOAD_DIR || '/data/projects/dbd-thai/admin/web/uploads/company'
const rid = () => Math.random().toString(36).slice(2, 9)

export async function saveCompanyImage({ buf, kind, entryId }) {
  await mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {})
  const tmp = resolve(UPLOAD_DIR, `.tmp-${entryId}-${kind}-${rid()}`)
  await writeFile(tmp, buf)
  // 换图:先删该 entry+kind 的旧文件
  try {
    const files = await readdir(UPLOAD_DIR)
    for (const f of files) if (f.startsWith(`${entryId}-${kind}-`)) await unlink(resolve(UPLOAD_DIR, f)).catch(() => {})
  } catch { /* ignore */ }
  const name = `${entryId}-${kind}-${rid()}.` + (kind === 'logo' ? 'png' : 'jpg')
  const out = resolve(UPLOAD_DIR, name)
  try {
    if (kind === 'logo') {
      await run('convert', [tmp + '[0]', '-auto-orient', '-resize', '512x512>', '-strip', out], { timeout: 20000 })
    } else {
      await run('convert', [tmp + '[0]', '-auto-orient', '-resize', '1600x900^', '-gravity', 'center', '-extent', '1600x900', '-strip', '-quality', '85', out], { timeout: 20000 })
    }
  } finally { await unlink(tmp).catch(() => {}) }
  return '/uploads/company/' + name
}
