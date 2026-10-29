// 公司简介:据已知工商数据,用 DeepSeek 生成一段客观介绍(非流式,带缓存)。
//   严格约束:只用给定事实,禁止编造产品/历史/客户等;AI 不可用时回退模板句。
import { config } from './config.js'

const DS = config.deepseek
const cache = new Map() // jpno|lang -> { at, text }
const TTL = 24 * 3600 * 1000

function fmtCap(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''))
  if (!isFinite(n) || n <= 0) return ''
  return '฿ ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fallback(c, lang) {
  const name = c.nameEn || c.nameTh || c.nameZh || ''
  const cap = fmtCap(c.capital)
  if (lang === 'zh') {
    let s = `${name} 是一家在泰国登记注册的企业`
    if (c.province) s += `，位于${c.province}`
    if (cap) s += `，注册资本 ${cap}`
    return s + '。'
  }
  if (lang === 'th') {
    let s = `${name} เป็นบริษัทที่จดทะเบียนในประเทศไทย`
    if (c.province) s += ` ตั้งอยู่ที่ ${c.province}`
    if (cap) s += ` ทุนจดทะเบียน ${cap}`
    return s
  }
  let s = `${name} is a company registered in Thailand`
  if (c.province) s += `, based in ${c.province}`
  if (cap) s += `, with registered capital of ${cap}`
  return s + '.'
}

export async function companyIntro(company, lang) {
  const key = (company.jpno || company.nameEn || '') + '|' + lang
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.text
  let text = ''
  if (DS.apiKey) {
    const langName = lang === 'zh' ? '简体中文' : lang === 'th' ? 'ภาษาไทย' : 'English'
    const facts = [
      `Name (EN): ${company.nameEn || ''}`,
      company.nameTh ? `Name (TH): ${company.nameTh}` : '',
      company.business ? `Business / objective: ${company.business}` : '',
      company.province ? `Province: ${company.province}` : '',
      fmtCap(company.capital) ? `Registered capital: ${fmtCap(company.capital)}` : '',
      company.status ? `Status: ${company.status}` : '',
      company.regdate ? `Registered date: ${company.regdate}` : '',
    ].filter(Boolean).join('\n')
    const sys = `You write a brief, natural company introduction for a profile card, in ${langName}. Write 2–3 short, smoothly flowing sentences that read like the opening of a real company profile — professional and engaging, NOT a list of data points. Lead with what kind of company it is, based on its name, business nature and location. Do NOT recite the registration number, the exact registered-capital figure, or the registration date — those are shown separately on the card, and repeating them reads stiff. Do NOT invent products, founders, history, clients, revenue, partnerships or achievements that are not in the facts. Keep the company name EXACTLY as given (English/Thai) — do NOT translate it or invent a Chinese name for the company. Keep it truthful but well-written. Output only the introduction — no markdown, no quotes, no labels.`
    const user = `Company facts:\n${facts}\n\nWrite the ${langName} introduction now.`
    try {
      const r = await fetch(DS.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DS.apiKey}` },
        // deepseek-v4-flash 是推理模型,reasoning_content 会吃 token;max_tokens 须给推理+答案留足空间,否则 content 被截成空(finish_reason=length)
        body: JSON.stringify({ model: DS.model, stream: false, temperature: 0.4, max_tokens: 1024, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(20000),
      })
      if (r.ok) {
        const j = await r.json()
        text = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim()
        text = text.replace(/^["'「」“”]+|["'「」“”]+$/g, '').replace(/\s*\n\s*/g, ' ').trim()
      } else {
        console.error('[ai] 简介生成 HTTP', r.status)
      }
    } catch (e) { console.error('[ai] 简介生成失败:', e.name, e.message) }
  }
  // 只缓存 AI 成功结果;失败用回退但不缓存,下次请求重试 AI(避免一次抖动毒化缓存)
  if (text) { cache.set(key, { at: Date.now(), text }); return text }
  return fallback(company, lang)
}
