// 分享海报:9:16(1080×1920)商务公司名片海报,用无头 Chrome 把 HTML/CSS 截成图。
//   - hero(较矮)商务配图 + 紫色渐变遮罩(公司无主图→按 jpno 从本地图库选)
//   - 白底名片:公司 logo(纯白底大字母章) + 公司名 + AI 公司简介 + 信息字段
//   - 末尾:二维码 + 在线档案 URL + BizThai 品牌
import QRCode from 'qrcode'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getBrowser } from './chrome.js'

const here = dirname(fileURLToPath(import.meta.url))
const POSTER_DIR = resolve(here, '../assets/poster')
const BG_COUNT = 6

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const T = {
  zh: { kicker: '企业名片', reg: '注册号', loc: '所在地', cap: '注册资本', date: '注册日期', upd: '更新日期', type: '公司类型', addr: '注册地址', scan: '扫码查看完整企业档案', by: '由 BizThai AI 整理 · 数据来源 DBD DataWarehouse+' },
  th: { kicker: 'นามบัตรบริษัท', reg: 'เลขทะเบียน', loc: 'ที่ตั้ง', cap: 'ทุนจดทะเบียน', date: 'วันจดทะเบียน', upd: 'อัปเดตล่าสุด', type: 'ประเภทนิติบุคคล', addr: 'ที่อยู่จดทะเบียน', scan: 'สแกนเพื่อดูข้อมูลบริษัทฉบับเต็ม', by: 'จัดทำโดย BizThai AI · ข้อมูล: DBD DataWarehouse+' },
  en: { kicker: 'Company Card', reg: 'Reg. No.', loc: 'Location', cap: 'Capital', date: 'Registered', upd: 'Last updated', type: 'Company type', addr: 'Registered address', scan: 'Scan for the full company profile', by: 'Compiled by BizThai AI · Data: DBD DataWarehouse+' },
}
const FONT = "'Noto Sans CJK SC','Noto Sans Thai','Loma',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"
const LOGO = '<svg viewBox="0 0 40 40" width="40" height="40"><rect width="40" height="40" rx="10" fill="rgba(255,255,255,.22)"/><path fill="#fff" d="M12 11.5h7.4c3.1 0 5.1 1.7 5.1 4.2 0 1.7-.9 3-2.4 3.7 2 .6 3.2 2.2 3.2 4.2 0 3-2.3 4.9-5.9 4.9H12v-17Zm6.8 6.8c1.5 0 2.4-.7 2.4-1.9s-.9-1.9-2.4-1.9h-3.5v3.8h3.5Zm.4 7.1c1.7 0 2.7-.8 2.7-2.1 0-1.4-1-2.2-2.7-2.2h-3.9v4.3h3.9Z"/></svg>'

function pickBg(jpno) {
  const k = String(jpno || 'bizthai')
  let s = 0
  for (let i = 0; i < k.length; i++) s = (s * 31 + k.charCodeAt(i)) % 99991
  const idx = (s % BG_COUNT) + 1
  const buf = readFileSync(resolve(POSTER_DIR, `bg-${idx}.jpg`))
  return 'data:image/jpeg;base64,' + buf.toString('base64')
}
function fmtCap(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''))
  if (!isFinite(n) || n <= 0) return ''
  return '฿ ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function clip(s, n) { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

// 只接受本站 /uploads 路径的图片,服务端抓取转 data URL(供无头 Chrome 用:绕过外网请求拦截 + 防 SSRF)
async function fetchImageData(url) {
  const m = String(url || '').match(/^(?:https?:\/\/[^/]+)?(\/uploads\/[A-Za-z0-9/._-]+)$/)
  if (!m) return ''
  try {
    const r = await fetch('http://127.0.0.1:8183' + m[1], { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return ''
    const ct = r.headers.get('content-type') || ''
    if (!/^image\//i.test(ct)) return ''
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 6 * 1024 * 1024) return ''
    return `data:${ct};base64,` + buf.toString('base64')
  } catch { return '' }
}

function buildHtml({ company, lang, intro }) {
  const t = T[lang]
  const nameEn = company.nameEn || company.nameTh || company.nameZh || company.jpno || 'Company'
  const second = (lang === 'zh' && company.nameZh) ? company.nameZh : (company.nameTh || (lang !== 'zh' ? company.nameZh : '') || '')
  const mono = (String(nameEn).match(/[A-Za-z0-9一-龥]/) || ['B'])[0].toUpperCase()
  // hero 优先用会员上传图(已转 data URL),否则按 jpno 选本地商务图;logo 优先用上传图,否则字母章
  const bg = company._heroData || pickBg(company.jpno)
  const monoHtml = company._logoData
    ? `<div class="mono mono-img"><img src="${company._logoData}" alt=""></div>`
    : `<div class="mono">${esc(mono)}</div>`

  const cap = fmtCap(company.capital)
  const facts = []
  if (company.jpno) facts.push({ k: t.reg, v: esc(company.jpno) })
  if (cap) facts.push({ k: t.cap, v: esc(cap) })
  if (company.type) facts.push({ k: t.type, v: esc(clip(company.type, 34)) })
  if (company.province) facts.push({ k: t.loc, v: esc(clip(company.district ? company.district + ', ' + company.province : company.province, 40)) })
  if (company.regdate) facts.push({ k: t.date, v: esc(clip(company.regdate, 24)) })
  if (company.updatedate) facts.push({ k: t.upd, v: esc(clip(company.updatedate, 24)) })
  if (company.address) facts.push({ k: t.addr, v: esc(clip(company.address, 72)), wide: true })
  const factsHtml = facts.map(f => `<div class="fact${f.wide ? ' wide' : ''}"><div class="fact-k">${f.k}</div><div class="fact-v">${f.v}</div></div>`).join('')

  const introHtml = intro ? `<div class="intro">${esc(clip(intro, 230))}</div>` : ''
  const qrBlock = company._qr ? `<div class="qr"><img src="${company._qr}" alt="QR"></div>` : ''
  const urlBlock = company.url ? `<div class="cta-url">${esc(company.url)}</div>` : ''

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:1080px;height:1920px;font-family:${FONT};background:#fff;overflow:hidden}
.poster{width:1080px;height:1920px;display:flex;flex-direction:column}
.hero{position:relative;height:600px;flex:0 0 600px;overflow:hidden}
.hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero-ov{position:absolute;inset:0;background:linear-gradient(180deg,rgba(18,11,26,.30)0%,rgba(18,11,26,.10)34%,rgba(86,3,128,.5)74%,rgba(60,2,92,.92)100%)}
.hero-in{position:absolute;inset:0;display:flex;flex-direction:column;padding:60px 64px 56px}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:14px;color:#fff}
.brand-n{font-size:32px;font-weight:800;letter-spacing:-.02em}
.kicker{font-size:19px;font-weight:700;letter-spacing:.16em;color:rgba(255,255,255,.94);text-transform:uppercase;border:1.5px solid rgba(255,255,255,.42);padding:9px 18px;border-radius:30px}
.hero-bottom{margin-top:auto;display:flex;justify-content:flex-end}
.pill{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.32);color:#fff;font-size:22px;font-weight:600;padding:10px 20px;border-radius:30px}
.pill .dot{width:12px;height:12px;border-radius:50%;background:#46e08a;box-shadow:0 0 0 4px rgba(70,224,138,.3)}
.sheet{flex:1;background:#fff;border-radius:54px 54px 0 0;margin-top:-46px;position:relative;z-index:2;padding:0 64px 54px;display:flex;flex-direction:column}
.head{display:flex;align-items:flex-end;gap:32px;margin-top:-48px}
.mono{flex:0 0 auto;width:184px;height:184px;border-radius:42px;background:#fff;box-shadow:0 18px 46px rgba(20,10,30,.20);border:1px solid #efe9f4;color:#7901b2;font-size:104px;font-weight:800;line-height:1;display:grid;place-items:center}
.mono-img{overflow:hidden;padding:14px}
.mono-img img{width:100%;height:100%;object-fit:contain}
.htext{min-width:0;padding-bottom:14px}
.name{font-size:48px;font-weight:800;color:#170f22;line-height:1.12;letter-spacing:-.02em;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.name2{font-size:28px;color:#8b8595;font-weight:500;margin-top:10px}
.intro{margin-top:42px;font-size:32px;line-height:1.64;color:#3a3346;font-weight:500}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:48px 40px;margin-top:56px}
.fact.wide{grid-column:1/-1}
.fact-k{font-size:21px;color:#9a93a6;font-weight:600;letter-spacing:.02em;margin-bottom:8px}
.fact-v{font-size:33px;color:#170f22;font-weight:700;line-height:1.3;word-break:break-word}
.fact.wide .fact-v{font-size:27px;font-weight:600;color:#3a3346;line-height:1.42}
.foot{margin-top:auto;padding-top:46px;border-top:2px solid #efecf4;display:flex;align-items:center;gap:30px}
.qr{width:182px;height:182px;flex:0 0 auto;background:#fff;border:2px solid #efecf4;border-radius:18px;padding:12px}
.qr img{display:block;width:100%;height:100%}
.cta{flex:1;min-width:0}
.cta-h{font-size:28px;font-weight:800;color:#170f22;margin-bottom:8px}
.cta-url{font-size:23px;color:#7901b2;font-weight:600;word-break:break-all;line-height:1.35}
.by{margin-top:24px;font-size:19px;color:#aaa3b4}
</style></head><body><div class="poster">
  <div class="hero">
    <img class="hero-img" src="${bg}" alt="">
    <div class="hero-ov"></div>
    <div class="hero-in">
      <div class="top"><div class="brand">${LOGO}<span class="brand-n">BizThai</span></div><span class="kicker">${esc(t.kicker)}</span></div>
      <div class="hero-bottom">${company.status ? `<div class="pill"><span class="dot"></span>${esc(clip(company.status, 28))}</div>` : ''}</div>
    </div>
  </div>
  <div class="sheet">
    <div class="head">
      ${monoHtml}
      <div class="htext"><div class="name">${esc(nameEn)}</div>${second ? `<div class="name2">${esc(second)}</div>` : ''}</div>
    </div>
    ${introHtml}
    <div class="facts">${factsHtml}</div>
    <div class="foot">
      ${qrBlock}
      <div class="cta"><div class="cta-h">${esc(t.scan)}</div>${urlBlock}<div class="by">${esc(t.by)}</div></div>
    </div>
  </div>
</div></body></html>`
}

// 主入口:返回海报图 Buffer(JPEG)
export async function renderPoster({ company = {}, lang = 'en', intro = '' }) {
  lang = T[lang] ? lang : 'en'
  if (company.url) {
    try { company._qr = await QRCode.toDataURL(String(company.url), { margin: 0, width: 320, errorCorrectionLevel: 'M' }) } catch { /* 无码也继续 */ }
  }
  // 会员上传的 logo/hero(本站 /uploads)→ 服务端抓取转 data URL
  company._heroData = await fetchImageData(company.hero)
  company._logoData = await fetchImageData(company.logo)
  const html = buildHtml({ company, lang, intro })
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setJavaScriptEnabled(false)
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 })
    await page.setRequestInterception(true)
    page.on('request', r => {
      const u = r.url()
      if (u.startsWith('data:') || u.startsWith('about:') || u.startsWith('blob:')) r.continue()
      else r.abort()
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 })
    return await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1920 } })
  } finally {
    await page.close().catch(() => {})
  }
}
