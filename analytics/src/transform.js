// 把 WooCMS thaicompany entry 解析成统计用的精简记录。
// 解析规则与前端 web/src/api/client.ts 保持一致:小写键优先、驼峰兜底;
// 三语优先取 meta.i18n 版本块,缺失回落扁平字段。
const str = v => (v == null ? '' : String(v))
const num = v => (typeof v === 'number' ? v : Number(v) || 0)

function mv(m, lower, camel) {
  const v = m[lower]
  if (v !== undefined && v !== null && v !== '') return v
  return camel ? m[camel] : undefined
}

function lt(th, en, zh) {
  const t = str(th) || str(en) || str(zh)
  return { th: str(th) || t, en: str(en) || t, zh: str(zh) || t }
}

function i18nText(m, key) {
  const b = m.i18n
  if (!b || typeof b !== 'object') return null
  const th = b.th?.[key] ?? '', en = b.en?.[key] ?? '', zh = b.zh?.[key] ?? ''
  if (!th && !en && !zh) return null
  return { th: th || en || zh, en: en || th || zh, zh: zh || th || en }
}

function dateStr(v) {
  if (Array.isArray(v) && v.length >= 3) {
    const [y, mo, d] = v
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return typeof v === 'string' ? v : ''
}

function rawObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}
function rawObjectList(v) {
  return Array.isArray(v) ? v.map(rawObject).filter(o => Object.keys(o).length > 0) : []
}
function firstObjectValue(o, keys) {
  for (const k of keys) {
    const v = o[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

// 董事/股东里非泰、非 xx、非 world* 的国籍代码 —— 用于 isForeign 判定与 nationalityCodes
function nationalityCodesFromRaw(m) {
  const raw = rawObject(m.raw)
  const people = [...rawObjectList(raw.committees), ...rawObjectList(raw.partners)]
  const codes = people
    .map(p => str(firstObjectValue(p, ['ntCode', 'nationalityCode', 'countryCode'])).toLowerCase())
    .filter(c => c && c !== 'th' && c !== 'xx' && !c.startsWith('world'))
  return Array.from(new Set(codes))
}

export function toRecord(entry) {
  const m = entry.meta ?? {}
  const th = str(mv(m, 'jpname', 'jpName')) || entry.title || str(mv(m, 'jpno', 'jpNo'))
  const en = str(mv(m, 'jpnamee', 'jpNameE')) || th
  const code = entry.slug || str(mv(m, 'jpno', 'jpNo'))

  const province = i18nText(m, 'province') ?? lt(m.province, mv(m, 'provincee', 'provinceE'), mv(m, 'provincezh'))
  const provinceTh = str(m.province) // 原始泰文府名,用于与 provinces.json 的 th 名对齐取 slug
  const provinceKey = str(m.provincezh) || str(mv(m, 'provincee', 'provinceE')) || str(m.province) || 'Unknown'

  const business = i18nText(m, 'industryGroup') ?? lt(
    mv(m, 'businesstypedesc', 'businessTypeDesc') || mv(m, 'setupobjgrpdesc'),
    mv(m, 'businesstypedesce', 'businessTypeDescE') || mv(m, 'businesstypedesc', 'businessTypeDesc'),
    mv(m, 'businesstypedesczh') || mv(m, 'businesstypedesc', 'businessTypeDesc'),
  )
  const status = i18nText(m, 'status') ?? lt(
    m.status || mv(m, 'jpstatdesc', 'jpStatDesc'),
    mv(m, 'jpstatdesce', 'jpStatDescE'),
    mv(m, 'statuszh') || m.status,
  )
  const statusKey = str(mv(m, 'jpstatcode', 'jpStatCode')) || status.en || status.th || 'unknown'

  const regDate = dateStr(mv(m, 'regdate', 'regDate'))
  const year = Number(regDate.slice(0, 4))
  const nationalityCodes = nationalityCodesFromRaw(m)
  const mainNatCode = str(mv(m, 'mainnatcode', 'mainNatCode')).toUpperCase()

  return {
    id: code,
    code,
    name: { th, en, zh: en || th },
    province,
    provinceTh,
    provinceKey,
    business,
    status,
    statusKey,
    capital: num(mv(m, 'capamt', 'capAmt')),
    paidCapital: num(mv(m, 'paidamt', 'paidAmt')),
    regDate,
    regYear: year >= 1800 ? year : undefined,
    isForeign: mainNatCode === 'FRN' || (mainNatCode !== '' && mainNatCode !== 'THA' && mainNatCode !== 'TH') || nationalityCodes.length > 0,
    nationalityCodes,
  }
}
