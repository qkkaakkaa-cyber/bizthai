import pg from 'pg'
import { config } from './config.js'

// 每列原样返回 wire 协议的文本值(不解析成 JS 类型),让 pool.query 的输出跟旧版
// `psql -A -t -F '\t'` 的纯文本行为完全一致(数字/日期/布尔都是 psql 会打印的原始文本,
// 布尔尤其要注意:原样文本是 't'/'f',不是 JS 的 true/false)。
const identityTypes = { getTypeParser: () => value => value }
const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  max: 8,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'dbd-analytics',
  types: identityTypes,
})
// 空闲连接被 PG 端断开(重启/睡眠恢复/网络抖动)会 emit 'error';不监听时 Node 会把它
// 升级为 uncaughtException 直接杀进程,配合 systemd Restart=always 变成 crash-loop。
pool.on('error', err => console.error('[analytics] 空闲连接错误(已忽略,不影响后续请求):', err.message))

function sqlIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

const num = value => Number(value) || 0
const str = value => value == null ? '' : String(value)
const TOP_COMPANY_LIMIT = 50

// 「正常经营优先」统一排序:jpstatcode='1' 为运营中,其余(含空值)一律排后,
// 与 admin/data/themes/starter/assets/theme.js 的 statusKind() 判定口径一致。
// col 传列名或表达式(facts 视图用裸列名,原始 entries 用 e.meta_json->>'jpstatcode')。
// 2026-07-01 修复:约11.7万条历史记录 jpstatcode 缺失,其中约7.5万条的三语状态文本其实
// 是"运营中"(从 /companies 末页实测发现,这批公司被误判成异常排到了最后)。补上文本
// 兜底,口径与本文件另一处 status_key 的判定(buildProvinceAnalytics,查 entries 原表)
// 完全一致:jpstatcode='1' 或状态文本命中已知的"运营中"三语说法即视为运营中。
function statusRankExpr(col) {
  const prefix = col.endsWith('jpstatcode') ? col.slice(0, -'jpstatcode'.length) : ''
  const statusText = `COALESCE(NULLIF(${prefix}statuszh,''), NULLIF(${prefix}jpstatdesce,''), NULLIF(${prefix}jpstatdesc,''))`
  return `CASE WHEN ${col} = '1' OR ${statusText} IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating') THEN 0 ELSE 1 END`
}

// 硬过滤「仅运营中」条件:与 statusRankExpr 的 THEN 0 分支同口径(含缺码但文案为运营中的历史行)。
// 列表/排行默认套用;详情页与直达 URL 不走这里。传 includeInactive=true 时跳过。
function operatingCondExpr(col) {
  const prefix = col.endsWith('jpstatcode') ? col.slice(0, -'jpstatcode'.length) : ''
  const statusText = `COALESCE(NULLIF(${prefix}statuszh,''), NULLIF(${prefix}jpstatdesce,''), NULLIF(${prefix}jpstatdesc,''))`
  return `(${col} = '1' OR ${statusText} IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating'))`
}

function truthyFlag(v) {
  if (v === true || v === 1) return true
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'all'
}

// 输出格式特意保持跟旧版 psql 子进程一致(制表符分隔、行末无分隔符),调用方的
// .split('\n')/.split('\t') 解析逻辑不用跟着改。timeout 用 statement_timeout 实现;
// 出错或重置失败一律丢弃这个连接(release(true)),不把可能带脏状态的连接还给池子。
// disableNestloop:见 browseCompanies 里 NESTLOOP_OFF_THRESHOLD 的注释——命中集合很大时
// (如曼谷府单值占全库 40%),planner 对「term_id 关联列」的选择率估算会严重偏低,仍然
// 选择逐行 Nested Loop 回表,量级一高就从几十毫秒退化成挂起。调用方确认命中量后可选择
// 临时关掉 nestloop 逼 planner 改用 Hash Join,用完照样显式恢复,不影响连接池里的其它请求。
async function runPsql(sql, { timeout = 90000, disableNestloop = false } = {}) {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(timeout))}`)
    if (disableNestloop) await client.query('SET enable_nestloop = off')
    const { rows } = await client.query({ text: sql, rowMode: 'array' })
    return rows.map(row => row.map(v => (v === null ? '' : v)).join('\t')).join('\n')
  } catch (err) {
    broken = true
    throw err
  } finally {
    if (!broken) {
      try {
        if (disableNestloop) await client.query('SET enable_nestloop = on')
        await client.query('SET statement_timeout = 0')
      } catch { broken = true }
    }
    client.release(broken)
  }
}

function langText(th, en, zh) {
  const fallback = th || en || zh || ''
  return {
    th: th || fallback,
    en: en || fallback,
    zh: zh || fallback,
  }
}

function parseRecordLine(line) {
  const [
    provinceKey,
    code,
    nameTh,
    nameEn,
    provinceTh,
    provinceEn,
    provinceZh,
    districtCode,
    districtTh,
    districtEn,
    districtZh,
    businessGroup,
    businessTh,
    businessEn,
    businessZh,
    cap,
    paid,
    regDate,
    statusKey,
    statusTh,
    statusEn,
    statusZh,
    mainNatCode,
    countryCodes,
  ] = line.split('\t')
  const year = Number(str(regDate).slice(0, 4))
  const nationalityCodes = (countryCodes || '').split(',').map(code => code.trim()).filter(Boolean)
  const mainNat = (mainNatCode || '').toUpperCase()
  return {
    id: code,
    code,
    name: { th: nameTh || nameEn || code, en: nameEn || nameTh || code, zh: nameEn || nameTh || code },
    provinceKey,
    province: langText(provinceTh, provinceEn, provinceZh || provinceKey),
    districtCode,
    district: {
      th: districtTh || districtEn || districtZh || districtCode || provinceKey,
      en: districtEn || districtTh || districtZh || districtCode || provinceKey,
      zh: districtZh || districtEn || districtTh || districtCode || provinceKey,
    },
    businessGroup: businessGroup ? `tsic-${businessGroup.toLowerCase()}` : '',
    business: langText(businessTh, businessEn, businessZh),
    capital: num(cap),
    paidCapital: num(paid),
    regDate,
    regYear: year >= 1800 ? year : undefined,
    statusKey: statusKey || statusZh || statusEn || statusTh || 'unknown',
    status: langText(statusTh, statusEn, statusZh),
    isForeign: mainNat === 'FRN' || (mainNat !== '' && mainNat !== 'THA' && mainNat !== 'TH') || nationalityCodes.length > 0,
    nationalityCodes,
  }
}

function provinceFilterCte(schema, provinceSlug) {
  return `
    WITH selected_province AS (
      SELECT tx.id AS taxonomy_id, t.id AS root_id
      FROM ${schema}.cms_custom_taxonomies tx
      JOIN ${schema}.cms_custom_terms t ON t.taxonomy_id = tx.id
      WHERE tx.code = 'province'
        AND t.slug = ${sqlLiteral(provinceSlug)}
      LIMIT 1
    ),
    province_terms AS (
      SELECT root_id AS id FROM selected_province
      UNION
      SELECT child.id
      FROM ${schema}.cms_custom_terms child
      JOIN selected_province sp ON child.taxonomy_id = sp.taxonomy_id
      WHERE child.parent_id = sp.root_id
      UNION
      SELECT grandchild.id
      FROM ${schema}.cms_custom_terms child
      JOIN ${schema}.cms_custom_terms grandchild ON grandchild.parent_id = child.id
      JOIN selected_province sp ON child.taxonomy_id = sp.taxonomy_id
      WHERE child.parent_id = sp.root_id
    ),
    province_entries AS MATERIALIZED (
      SELECT DISTINCT et.entry_id
      FROM ${schema}.cms_content_entry_terms et
      JOIN selected_province sp ON et.taxonomy_id = sp.taxonomy_id
      JOIN province_terms pt ON pt.id = et.term_id
    )
  `
}

// 体检发现:原先 7 个并行子查询(districtRows 除外)都对原始大表(entries,由本函数
// 的旧版 provinceEntriesCte 产出)重复抽取/detoast meta_json——province_entries 本身走
// term_id 索引很快,真正慢的是 JOIN 回 cms_content_entries 后每个子查询各自重新解压一次
// JSONB。改用已经把标量列抽好、建了索引的 thaicompany_facts(与 fetchGlobalFacts/
// browseCompanies 同一张表),曼谷这种大府(全库占比约 40%)的聚合能从原本的数十秒级
// 降到近毫秒级。
function provinceFactsEntriesCte(schema, provinceSlug) {
  return `
    ${provinceFilterCte(schema, provinceSlug).trim()},
    facts_entries AS MATERIALIZED (
      SELECT f.*
      FROM province_entries pe
      JOIN ${schema}.thaicompany_facts f ON f.entry_id = pe.entry_id
    )
  `
}

// districtRows 原本对 entries(原始大表)按 ampur* jsonb 字段分组——实测曼谷单这一条
// 子查询就能吃满 45s statement_timeout(全库占比~40%,detoast 逐行 meta_json 的代价
// 在这种量级下比其它 7 条子查询加起来还高)。改走"区/县本来就是 province 分类下的
// 子级 taxonomy term"这条路(与 province/industry 筛选同一套机制,见 provinceFilterCte),
// 用 cms_content_entry_terms 的 term_id 索引 + thaicompany_facts 的 entry_id 索引,
// 完全不碰 JSONB。曼谷实测:50 个区级 term,30.4 万家公司直接挂在区级(非只挂省级根term)。
function districtTermsCte(schema, provinceSlug) {
  return `
    WITH province_root AS (
      SELECT t.id FROM ${schema}.cms_custom_terms t
      JOIN ${schema}.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id
      WHERE tx.code = 'province' AND t.slug = ${sqlLiteral(provinceSlug)}
      LIMIT 1
    ),
    district_terms AS (
      SELECT c.id AS term_id, c.slug AS district_key, c.name AS name_th,
        (SELECT tr.name FROM ${schema}.cms_term_translations tr WHERE tr.term_id = c.id AND tr.locale = 'en' LIMIT 1) AS name_en,
        (SELECT tr.name FROM ${schema}.cms_term_translations tr WHERE tr.term_id = c.id AND tr.locale LIKE 'zh%' LIMIT 1) AS name_zh
      FROM ${schema}.cms_custom_terms c
      JOIN province_root r ON c.parent_id = r.id
    ),
    district_entries AS MATERIALIZED (
      SELECT dt.district_key, dt.name_th, dt.name_en, dt.name_zh, et.entry_id
      FROM ${schema}.cms_content_entry_terms et
      JOIN district_terms dt ON dt.term_id = et.term_id
    )
  `
}

export async function fetchProvinceAnalytics(provinceSlug) {
  if (!config.db.user || !config.db.name || !provinceSlug) return null
  const schema = sqlIdent(config.db.schema)
  const withFacts = selectSql => `${provinceFactsEntriesCte(schema, provinceSlug)} ${selectSql}`
  // 体检发现:EXPLAIN ANALYZE 实测曼谷(78万行)下,province_entries JOIN thaicompany_facts
  // 被规划器选成了 Nested Loop——对 78 万行逐行回表 idx_tcf_entry,单条子查询就要 6~11s。
  // 与 browseCompanies 的 NESTLOOP_OFF_THRESHOLD 同一个根因(命中集合一旦到几十万行,
  // planner 对 JOIN 选择率估计仍然低估,继续选 Nested Loop 而不是 Hash Join)。这里统一
  // 强制关 nestloop:小府数据量小,Hash Join 固定开销可忽略;大府能避免这个数量级的退化。
  const queryJson = async (sql, { timeout = 45000 } = {}) => {
    const stdout = await runPsql(sql, { maxBuffer: 16 * 1024 * 1024, timeout, disableNestloop: true })
    const payload = stdout.trim()
    return payload ? JSON.parse(payload) : null
  }

  // 其余 7 个子查询都改走 thaicompany_facts(f):标量列已抽好、类型已转换、有索引,
  // 不用再对每一行重新 detoast/解析 JSONB。字段命名与 fetchGlobalFacts/rankCompaniesByProvince
  // 的 companyJson 保持一致,方便对照。
  const factsCompanyJson = `
    'id', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'code', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'name', jsonb_build_object(
      'th', COALESCE(NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text),
      'en', COALESCE(NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text),
      'zh', COALESCE(NULLIF(f.jpnamezh,''), NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text)
    ),
    'provinceKey', COALESCE(NULLIF(f.provincezh,''), 'unknown'),
    'province', jsonb_build_object('th', COALESCE(f.province_th,''), 'en', COALESCE(f.provincee,''), 'zh', COALESCE(f.provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(f.businesstypedesc,''), 'en', COALESCE(NULLIF(f.businesstypedesce,''), f.businesstypedesc, ''), 'zh', COALESCE(NULLIF(f.businesstypedesczh,''), NULLIF(f.businesstypedesce,''), f.businesstypedesc, '')),
    'capital', COALESCE(f.capamt, 0),
    'paidCapital', COALESCE(f.paidamt, 0),
    'regDate', COALESCE(f.regdate, ''),
    'regYear', f.regyear,
    'status', jsonb_build_object('th', COALESCE(f.jpstatdesc,''), 'en', COALESCE(NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''), 'zh', COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), f.jpstatdesc, '')),
    'isForeign', (f.mainnatcode = 'FRN' OR (f.mainnatcode <> '' AND f.mainnatcode NOT IN ('THA', 'TH'))),
    'nationalityCodes', '[]'::jsonb
  `

  // 体检发现(第二轮):即使把 7 个子查询都改走 thaicompany_facts,曼谷(78万行)仍要 15s+——
  // EXPLAIN ANALYZE 定位到真正原因是"7 个并行子查询各自是独立 SQL 语句",每一条都要重新
  // 计算一次 facts_entries 这个 78 万行的 MATERIALIZED 中间结果,同样的活干了 7 遍;加上
  // planner 对 term 交集行数严重低估(曼谷估2万多,实际78万),哈希表建小了要中途扩容、
  // 溢出到磁盘临时文件。修法:合并成一条 SQL——facts_entries 在同一条语句里被多处引用时,
  // MATERIALIZED 保证 Postgres 只算一次,后面 7 个 jsonb 子查询都白嫖这一份,不再各自重算。
  const [combined, districtRows] = await Promise.all([
    queryJson(withFacts(`
      SELECT jsonb_build_object(
        'summary', (
          SELECT jsonb_build_object(
            'total', COUNT(*),
            'totalCapital', COALESCE(SUM(capamt), 0),
            'paidCapital', COALESCE(SUM(paidamt), 0),
            'avgCapital', COALESCE(AVG(capamt), 0)
          ) FROM facts_entries
        ),
        'businessTypes', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'key', 'business-' || md5(business_key),
            'label', jsonb_build_object('th', business_th, 'en', business_en, 'zh', business_zh),
            'count', company_count,
            'share', CASE WHEN total_count > 0 THEN company_count::numeric / total_count ELSE 0 END
          ) ORDER BY company_count DESC), '[]'::jsonb)
          FROM (
            SELECT
              COALESCE(NULLIF(f.businesstypedesc,''), NULLIF(f.businesstypedesce,''), NULLIF(f.businesstypedesczh,''), 'unknown') AS business_key,
              COALESCE(NULLIF(f.businesstypedesc,''), 'ไม่ระบุ') AS business_th,
              COALESCE(NULLIF(f.businesstypedesce,''), NULLIF(f.businesstypedesc,''), 'Unknown') AS business_en,
              COALESCE(NULLIF(f.businesstypedesczh,''), NULLIF(f.businesstypedesce,''), NULLIF(f.businesstypedesc,''), '未知') AS business_zh,
              COUNT(*) AS company_count,
              SUM(COUNT(*)) OVER () AS total_count
            FROM facts_entries f
            GROUP BY 1, 2, 3, 4
          ) businesses
        ),
        'statuses', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'key', status_key,
            'label', jsonb_build_object('th', status_th, 'en', status_en, 'zh', status_zh),
            'count', company_count,
            'share', CASE WHEN total_count > 0 THEN company_count::numeric / total_count ELSE 0 END
          ) ORDER BY company_count DESC), '[]'::jsonb)
          FROM (
            SELECT
              -- 2026-07-01 修复(见 statusRankExpr 同款口径):约11.7万条历史记录 jpstatcode
              -- 缺失,其中约7.5万条三语状态文本其实是"运营中"——facts 直接搬运 raw 表的
              -- 同一份数据,这条 override 逻辑照搬过来,不因为切到 facts 就丢掉这个修复。
              CASE
                WHEN COALESCE(NULLIF(f.jpstatcode,''), '') = '1'
                  OR COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesc,''), '') IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating')
                  OR COALESCE(NULLIF(f.jpstatdesce,''), '') = 'Operating'
                THEN '1'
                ELSE COALESCE(NULLIF(f.jpstatcode,''), NULLIF(f.statuszh,''), 'unknown')
              END AS status_key,
              CASE
                WHEN COALESCE(NULLIF(f.jpstatcode,''), '') = '1'
                  OR COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesc,''), '') IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating')
                  OR COALESCE(NULLIF(f.jpstatdesce,''), '') = 'Operating'
                THEN 'ยังดำเนินกิจการอยู่'
                ELSE COALESCE(NULLIF(f.jpstatdesc,''), 'ไม่ระบุ')
              END AS status_th,
              CASE
                WHEN COALESCE(NULLIF(f.jpstatcode,''), '') = '1'
                  OR COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesc,''), '') IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating')
                  OR COALESCE(NULLIF(f.jpstatdesce,''), '') = 'Operating'
                THEN 'Operating'
                ELSE COALESCE(NULLIF(f.jpstatdesce,''), NULLIF(f.jpstatdesc,''), 'Unknown')
              END AS status_en,
              CASE
                WHEN COALESCE(NULLIF(f.jpstatcode,''), '') = '1'
                  OR COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesc,''), '') IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating')
                  OR COALESCE(NULLIF(f.jpstatdesce,''), '') = 'Operating'
                THEN '运营中'
                ELSE COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), NULLIF(f.jpstatdesc,''), '未知')
              END AS status_zh,
              COUNT(*) AS company_count,
              SUM(COUNT(*)) OVER () AS total_count
            FROM facts_entries f
            GROUP BY 1, 2, 3, 4
          ) status_rows
        ),
        'years', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'year', reg_year,
            'companyCount', company_count,
            'registeredCapital', registered_capital,
            'avgCapital', avg_capital
          ) ORDER BY reg_year), '[]'::jsonb)
          FROM (
            SELECT
              regyear AS reg_year,
              COUNT(*) AS company_count,
              COALESCE(SUM(capamt), 0) AS registered_capital,
              COALESCE(AVG(capamt), 0) AS avg_capital
            FROM facts_entries f
            WHERE regyear IS NOT NULL
            GROUP BY 1
          ) year_rows
        ),
        'foreign', (
          SELECT jsonb_build_object(
            'foreignTotal', COUNT(*) FILTER (WHERE mainnatcode = 'FRN' OR (mainnatcode <> '' AND mainnatcode NOT IN ('THA', 'TH'))),
            'thaiTotal', COUNT(*) FILTER (WHERE NOT (mainnatcode = 'FRN' OR (mainnatcode <> '' AND mainnatcode NOT IN ('THA', 'TH')))),
            'total', COUNT(*),
            'top', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'count', company_count) ORDER BY company_count DESC), '[]'::jsonb)
              FROM (
                SELECT lower(f2.mainnatcode) AS code, COUNT(*) AS company_count
                FROM facts_entries f2
                WHERE (f2.mainnatcode = 'FRN' OR (f2.mainnatcode <> '' AND f2.mainnatcode NOT IN ('THA', 'TH')))
                  AND f2.mainnatcode <> ''
                GROUP BY 1
              ) foreign_rows
            )
          ) FROM facts_entries f
        ),
        'companiesByCapital', (
          SELECT COALESCE(jsonb_agg(item ORDER BY sort_value DESC NULLS LAST), '[]'::jsonb)
          FROM (
            SELECT capamt AS sort_value, jsonb_build_object(${factsCompanyJson}) AS item
            FROM facts_entries f
            ORDER BY capamt DESC NULLS LAST
            LIMIT ${TOP_COMPANY_LIMIT}
          ) ranked
        ),
        'companiesByDate', (
          SELECT COALESCE(jsonb_agg(item ORDER BY sort_value DESC NULLS LAST), '[]'::jsonb)
          FROM (
            SELECT regdate AS sort_value, jsonb_build_object(${factsCompanyJson}) AS item
            FROM facts_entries f
            WHERE NULLIF(regdate, '') IS NOT NULL
            ORDER BY regdate DESC NULLS LAST
            LIMIT ${TOP_COMPANY_LIMIT}
          ) ranked
        )
      )::text
    `), { timeout: 60000 }),
    queryJson(`${districtTermsCte(schema, provinceSlug)}
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'districtKey', district_key,
        'districtCode', district_key,
        'district', jsonb_build_object('th', name_th, 'en', COALESCE(name_en, name_th), 'zh', COALESCE(name_zh, name_th)),
        'companyCount', company_count,
        'registeredCapital', registered_capital,
        'paidCapital', paid_capital,
        'avgCapital', avg_capital
      ) ORDER BY registered_capital DESC), '[]'::jsonb)::text
      FROM (
        SELECT
          de.district_key, de.name_th, de.name_en, de.name_zh,
          COUNT(*) AS company_count,
          COALESCE(SUM(f.capamt), 0) AS registered_capital,
          COALESCE(SUM(f.paidamt), 0) AS paid_capital,
          COALESCE(AVG(f.capamt), 0) AS avg_capital
        FROM district_entries de
        JOIN ${schema}.thaicompany_facts f ON f.entry_id = de.entry_id
        GROUP BY 1, 2, 3, 4
      ) districts
    `),
  ])

  const summary = combined?.summary ?? null
  const businessTypes = combined?.businessTypes ?? null
  const statuses = combined?.statuses ?? null
  const years = combined?.years ?? null
  const foreign = combined?.foreign ?? null
  const companiesByCapital = combined?.companiesByCapital ?? null
  const companiesByDate = combined?.companiesByDate ?? null

  return {
    ...(summary ?? { total: 0, totalCapital: 0, paidCapital: 0, avgCapital: 0 }),
    districtRows: districtRows ?? [],
    businessTypes: businessTypes ?? [],
    statuses: statuses ?? [],
    years: years ?? [],
    foreign: foreign ?? { foreignTotal: 0, thaiTotal: 0, total: 0, top: [] },
    companiesByCapital: companiesByCapital ?? [],
    companiesByDate: companiesByDate ?? [],
  }
}

export async function fetchProvinceRecords(provinceSlug = '') {
  if (!config.db.user || !config.db.name) return []
  const schema = sqlIdent(config.db.schema)
  const provinceFilter = provinceSlug ? provinceFilterCte(schema, provinceSlug) : ''
  const fromClause = provinceSlug
    ? `FROM province_entries pe JOIN ${schema}.cms_content_entries e ON e.id = pe.entry_id`
    : `FROM ${schema}.cms_content_entries e`
  const sql = `
    ${provinceFilter}
    SELECT
      COALESCE(NULLIF(e.meta_json->>'provincezh',''), 'unknown') AS province_key,
      COALESCE(NULLIF(e.slug,''), NULLIF(e.meta_json->>'jpno',''), e.id::text) AS code,
      COALESCE(NULLIF(e.meta_json->>'jpname',''), NULLIF(e.title,''), NULLIF(e.meta_json->>'jpno',''), e.id::text) AS name_th,
      COALESCE(NULLIF(e.meta_json->>'jpnamee',''), NULLIF(e.meta_json->>'jpname',''), NULLIF(e.title,''), NULLIF(e.meta_json->>'jpno',''), e.id::text) AS name_en,
      COALESCE(NULLIF(e.meta_json->>'province',''), e.meta_json->'i18n'->'th'->>'province', '') AS province_th,
      COALESCE(NULLIF(e.meta_json->>'provincee',''), e.meta_json->'i18n'->'en'->>'province', '') AS province_en,
      COALESCE(NULLIF(e.meta_json->>'provincezh',''), e.meta_json->'i18n'->'zh'->>'province', '') AS province_zh,
      COALESCE(NULLIF(e.meta_json->>'ampurcode',''), '') AS district_code,
      COALESCE(NULLIF(e.meta_json->>'ampurdesc',''), '') AS district_th,
      COALESCE(NULLIF(e.meta_json->>'ampurdesce',''), '') AS district_en,
      COALESCE(NULLIF(e.meta_json->>'ampurdesczh',''), '') AS district_zh,
      '' AS business_group,
      COALESCE(NULLIF(e.meta_json->>'businesstypedesc',''), e.meta_json->'i18n'->'th'->>'industryGroup', '') AS business_th,
      COALESCE(NULLIF(e.meta_json->>'businesstypedesce',''), e.meta_json->'i18n'->'en'->>'industryGroup', NULLIF(e.meta_json->>'businesstypedesc',''), '') AS business_en,
      COALESCE(NULLIF(e.meta_json->>'businesstypedesczh',''), e.meta_json->'i18n'->'zh'->>'industryGroup', NULLIF(e.meta_json->>'businesstypedesce',''), NULLIF(e.meta_json->>'businesstypedesc',''), '') AS business_zh,
      COALESCE(NULLIF(e.meta_json->>'capamt','')::numeric, 0) AS registered_capital,
      COALESCE(NULLIF(e.meta_json->>'paidamt','')::numeric, 0) AS paid_capital,
      COALESCE(NULLIF(e.meta_json->>'regdate',''), '') AS reg_date,
      COALESCE(NULLIF(e.meta_json->>'jpstatcode',''), '') AS status_key,
      COALESCE(e.meta_json->'i18n'->'th'->>'status', NULLIF(e.meta_json->>'jpstatdesc',''), NULLIF(e.meta_json->>'status',''), '') AS status_th,
      COALESCE(e.meta_json->'i18n'->'en'->>'status', NULLIF(e.meta_json->>'jpstatdesce',''), NULLIF(e.meta_json->>'jpstatdesc',''), NULLIF(e.meta_json->>'status',''), '') AS status_en,
      COALESCE(e.meta_json->'i18n'->'zh'->>'status', NULLIF(e.meta_json->>'statuszh',''), NULLIF(e.meta_json->>'jpstatdesce',''), NULLIF(e.meta_json->>'jpstatdesc',''), NULLIF(e.meta_json->>'status',''), '') AS status_zh,
      COALESCE(NULLIF(e.meta_json->>'mainnatcode',''), '') AS main_nat_code,
      '' AS country_codes
    ${fromClause}
    WHERE e.content_model_id = 2
      AND e.deleted_at IS NULL
      AND COALESCE(e.meta_json->>'_probe','') <> 'true'
  `
  const stdout = await runPsql(sql)
  return stdout.split('\n').filter(line => line.length > 0).map(parseRecordLine)
}

// ── 府×行业交叉(精确,直查 DB term 关联;WooCMS site API 不支持多 taxonomy AND)──
// 曾用 itt.slug = 'X' 这种 JOIN 写法(entry_terms 交集),但这跟 browseCompanies 修复前
// 是同一个根因:planner 对「JOIN 关联列取值」选择率估算不准(曼谷×tsic-g 实测交集
// 105542 行,估算只有 862 行,~122倍低估),选了逐行 Nested Loop 回表 cms_content_entries
// 排序,30s statement_timeout 都跑不完。crossCompanies 本质就是 browseCompanies 的两维度
// (industry+province)特例,两者列集合(CROSS_COLS/FACTS_BROWSE_NAMES)完全一致,直接委托
// 复用其字面量 term_id 解析 + thaicompany_facts 视图(无 TOAST,避免为排序拖全量 meta_json)
// + NESTLOOP_OFF_THRESHOLD 阈值三件套,而不是重复维护一份同根因的 SQL。
export async function crossCompanies(indSlug, provSlug, limit, offset, { includeInactive } = {}) {
  const lim = Math.max(1, Math.min(num(limit) || 20, 100))
  return browseCompanies({ industry: indSlug, province: provSlug, limit: lim, offset, includeInactive })
}

// ── 77 个府(parent_id IS NULL)+ 三语名,供府筛选 chips ──
export async function listProvinces() {
  const sql = `
    SELECT t.slug, t.name AS th,
      max(tr.name) FILTER (WHERE tr.locale = 'en') AS en,
      max(tr.name) FILTER (WHERE tr.locale LIKE 'zh%') AS zh
    FROM woocms.cms_custom_terms t
    JOIN woocms.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id AND tx.code = 'province'
    LEFT JOIN woocms.cms_term_translations tr ON tr.term_id = t.id
    WHERE t.parent_id IS NULL
    GROUP BY t.id, t.slug, t.name
    ORDER BY en
  `
  const out = await runPsql(sql)
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const [slug, th, en, zh] = line.split('\t')
    const engslug = String(en || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return { slug, engslug, name: langText(th, en, zh) }
  })
}

// ── 全局快照:直查物化视图 woocms.thaicompany_facts(精简扁平列,无 TOAST)──
// WooCMS 的 jsonb 全库聚合在 76 万行 × 11KB meta_json 上每条 ~140s 且 planner 不计 detoast 故不走索引;
// 物化视图把标量字段抽出来 + 普通小列索引,聚合从 90s+ 降到毫秒级。年度趋势顺带升级为全量精确。
export async function fetchGlobalFacts() {
  if (!config.db.user || !config.db.name) return null
  const F = `${sqlIdent(config.db.schema)}.thaicompany_facts`
  const queryJson = async selectSql => {
    const stdout = await runPsql(selectSql, { maxBuffer: 32 * 1024 * 1024, timeout: 60000 })
    const payload = stdout.trim()
    return payload ? JSON.parse(payload) : null
  }
  // 榜单单条公司 JSON(toRecord/toCompanyRow 等价形,展示三语取扁平字段)
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'code', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'name', jsonb_build_object(
      'th', COALESCE(NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text),
      'en', COALESCE(NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text),
      'zh', COALESCE(NULLIF(jpnamezh,''), NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text)
    ),
    'provinceKey', COALESCE(NULLIF(provincezh,''), 'unknown'),
    'province', jsonb_build_object('th', COALESCE(province_th,''), 'en', COALESCE(provincee,''), 'zh', COALESCE(provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(businesstypedesc,''), 'en', COALESCE(NULLIF(businesstypedesce,''), businesstypedesc, ''), 'zh', COALESCE(NULLIF(businesstypedesczh,''), NULLIF(businesstypedesce,''), businesstypedesc, '')),
    'capital', COALESCE(capamt, 0),
    'paidCapital', COALESCE(paidamt, 0),
    'regDate', COALESCE(regdate, ''),
    'regYear', regyear,
    'status', jsonb_build_object('th', COALESCE(jpstatdesc,''), 'en', COALESCE(NULLIF(jpstatdesce,''), jpstatdesc, ''), 'zh', COALESCE(NULLIF(statuszh,''), NULLIF(jpstatdesce,''), jpstatdesc, '')),
    'isForeign', (mainnatcode = 'FRN' OR (mainnatcode <> '' AND mainnatcode NOT IN ('THA','TH'))),
    'nationalityCodes', '[]'::jsonb
  )`
  const [summary, provinceGroups, statuses, years, companiesByCapital, companiesByDate] = await Promise.all([
    queryJson(`SELECT jsonb_build_object('total',COUNT(*),'totalCapital',COALESCE(SUM(capamt),0),'paidCapital',COALESCE(SUM(paidamt),0),'avgCapital',COALESCE(AVG(capamt),0))::text FROM ${F}`),
    queryJson(`SELECT COALESCE(jsonb_agg(jsonb_build_object('key',provincezh,'count',c,'sum_capamt',sc,'sum_paidamt',sp,'avg_capamt',ac) ORDER BY sc DESC),'[]')::text FROM (SELECT provincezh, COUNT(*) c, COALESCE(SUM(capamt),0) sc, COALESCE(SUM(paidamt),0) sp, COALESCE(AVG(capamt),0) ac FROM ${F} WHERE NULLIF(provincezh,'') IS NOT NULL GROUP BY provincezh) g`),
    queryJson(`SELECT COALESCE(jsonb_agg(jsonb_build_object('key',skey,'label',jsonb_build_object('th',th,'en',en,'zh',zh),'count',c,'share',CASE WHEN tot>0 THEN round(c::numeric/tot,4) ELSE 0 END) ORDER BY c DESC),'[]')::text FROM (SELECT COALESCE(NULLIF(jpstatcode,''),'unknown') skey, COALESCE(max(NULLIF(jpstatdesc,'')),'') th, COALESCE(max(NULLIF(jpstatdesce,'')),'') en, COALESCE(max(NULLIF(statuszh,'')),'') zh, COUNT(*) c, SUM(COUNT(*)) OVER() tot FROM ${F} GROUP BY 1) s`),
    queryJson(`SELECT COALESCE(jsonb_agg(jsonb_build_object('year',regyear,'companyCount',c,'registeredCapital',sc,'avgCapital',ac) ORDER BY regyear),'[]')::text FROM (SELECT regyear, COUNT(*) c, COALESCE(SUM(capamt),0) sc, COALESCE(AVG(capamt),0) ac FROM ${F} WHERE regyear IS NOT NULL GROUP BY regyear) y`),
    queryJson(`SELECT COALESCE(jsonb_agg(item ORDER BY srank ASC, sv DESC),'[]')::text FROM (SELECT ${statusRankExpr('jpstatcode')} srank, capamt sv, ${companyJson} item FROM ${F} WHERE capamt IS NOT NULL AND ${operatingCondExpr('jpstatcode')} ORDER BY srank ASC, sv DESC LIMIT ${config.topCompanies}) r`),
    queryJson(`SELECT COALESCE(jsonb_agg(item ORDER BY srank ASC, sv DESC),'[]')::text FROM (SELECT ${statusRankExpr('jpstatcode')} srank, regdate sv, ${companyJson} item FROM ${F} WHERE NULLIF(regdate,'') IS NOT NULL AND ${operatingCondExpr('jpstatcode')} ORDER BY srank ASC, sv DESC LIMIT ${config.topCompanies}) r`),
  ])
  return {
    total: num(summary?.total),
    totalCapital: num(summary?.totalCapital),
    paidCapital: num(summary?.paidCapital),
    avgCapital: num(summary?.avgCapital),
    provinceGroups: provinceGroups ?? [],
    statuses: statuses ?? [],
    years: years ?? [],
    companiesByCapital: companiesByCapital ?? [],
    companiesByDate: companiesByDate ?? [],
  }
}

// 外资构成的按国家计数,一次 GROUP BY 拿全部(取代 buildForeignComposition 里按
// countries.json 精选的~31个国家逐个发 HTTP 请求问 WooCMS 的写法)。capital 分类法
// 实际有 203 个 term(远多于 countries.json 精选的~31个),slug 与 countries.json 的
// key 格式一致(如 cn/jp/fr)。注意 thaicompany_facts.mainnatcode 只有 THA/FRN 两种粗
// 粒度值,做不了按国家细分,所以这里绕回 taxonomy 表本身,不走 facts 视图。
export async function fetchCapitalCompositionCounts() {
  const schema = sqlIdent(config.db.schema)
  const sql = `
    SELECT jsonb_object_agg(code, n)::text FROM (
      SELECT ct.slug AS code, count(*) AS n
      FROM ${schema}.cms_content_entry_terms cet
      JOIN ${schema}.cms_custom_terms ct ON ct.id = cet.term_id
      JOIN ${schema}.cms_custom_taxonomies tx ON tx.id = ct.taxonomy_id
      JOIN ${schema}.cms_content_entries e ON e.id = cet.entry_id
      WHERE tx.code = 'capital' AND e.status = 'published' AND e.deleted_at IS NULL
      GROUP BY 1
    ) counts
  `
  const out = (await runPsql(sql, { timeout: 15000 })).trim()
  return out ? JSON.parse(out) : {}
}

// 行业19大类计数,一次 GROUP BY 拿全部(取代 buildBusinessTypes 里按 industries.json 19个
// slug 逐个发 HTTP 请求问 WooCMS 的 N+1 写法——每小时全局快照刷新触发一次 19×8并发,是
// entries 列表接口(/models/thaicompany/entries)间歇性超时的触发源,见 bizthai-entries-
// list-timeout-root-cause 记忆)。industry 分类法实际是两级:19 个大类根词条(tsic-a..t,
// parent_id IS NULL)+ 571 个具体 TSIC 子行业叶子词条,entry 会同时打根+叶子两个标签(样本
// 核实过),故这里限定 parent_id IS NULL 只取根词条计数,与原按 19 个 slug 逐个精确匹配
// term_id 的语义完全一致(已用 tsic-a/tsic-r 两个样本核对新旧查询计数逐一对上)。
export async function fetchIndustryCompositionCounts() {
  const schema = sqlIdent(config.db.schema)
  const sql = `
    SELECT jsonb_object_agg(code, n)::text FROM (
      SELECT ct.slug AS code, count(*) AS n
      FROM ${schema}.cms_content_entry_terms cet
      JOIN ${schema}.cms_custom_terms ct ON ct.id = cet.term_id
      JOIN ${schema}.cms_custom_taxonomies tx ON tx.id = ct.taxonomy_id
      JOIN ${schema}.cms_content_entries e ON e.id = cet.entry_id
      WHERE tx.code = 'industry' AND ct.parent_id IS NULL
        AND e.status = 'published' AND e.deleted_at IS NULL
      GROUP BY 1
    ) counts
  `
  const out = (await runPsql(sql, { timeout: 15000 })).trim()
  return out ? JSON.parse(out) : {}
}

// 按注册年份取公司(facts 视图,regyear 已索引,毫秒级)。用于 /new-companies-<年> SSR 列表页。
export async function fetchCompaniesByYear(year, { limit, offset, includeInactive } = {}) {
  if (!config.db.user || !config.db.name) return null
  const y = parseInt(year, 10)
  if (!Number.isFinite(y) || y < 1900 || y > 3000) return null
  const F = `${sqlIdent(config.db.schema)}.thaicompany_facts`
  const lim = Math.max(1, Math.floor(limit)), off = Math.max(0, Math.floor(offset))
  const inactive = truthyFlag(includeInactive)
  const opCond = inactive ? '' : ` AND ${operatingCondExpr('jpstatcode')}`
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'code', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text), 'en', COALESCE(NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text), 'zh', COALESCE(NULLIF(jpnamezh,''), NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text)),
    'province', jsonb_build_object('th', COALESCE(province_th,''), 'en', COALESCE(provincee,''), 'zh', COALESCE(provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(businesstypedesc,''), 'en', COALESCE(NULLIF(businesstypedesce,''), businesstypedesc, ''), 'zh', COALESCE(NULLIF(businesstypedesczh,''), NULLIF(businesstypedesce,''), businesstypedesc, '')),
    'capital', COALESCE(capamt, 0),
    'regDate', COALESCE(regdate, ''),
    'regYear', regyear,
    'status', jsonb_build_object('th', COALESCE(jpstatdesc,''), 'en', COALESCE(NULLIF(jpstatdesce,''), jpstatdesc, ''), 'zh', COALESCE(NULLIF(statuszh,''), NULLIF(jpstatdesce,''), jpstatdesc, ''))
  )`
  const runJson = async sql => { const out = (await runPsql(sql, { timeout: 30000 })).trim(); return out ? JSON.parse(out) : null }
  const [total, list] = await Promise.all([
    runJson(`SELECT to_jsonb(COUNT(*))::text FROM ${F} WHERE regyear=${y}${opCond}`),
    runJson(`SELECT COALESCE(jsonb_agg(item ORDER BY srank ASC, sv DESC),'[]')::text FROM (SELECT ${statusRankExpr('jpstatcode')} srank, regdate sv, ${companyJson} item FROM ${F} WHERE regyear=${y}${opCond} ORDER BY srank ASC, sv DESC NULLS LAST LIMIT ${lim} OFFSET ${off}) r`),
  ])
  return { year: y, total: num(total), companies: list ?? [], limit: lim, offset: off, includeInactive: inactive }
}

// ── 统一「正常经营优先」浏览列表(/companies 默认视图 + 筛选)──
// WooCMS 核心的 <wc-data source="cpt:thaicompany" sort="..."> 与 REST /entries?sort=
// 均已实测确认是 no-op(见 woocms-upstream-bugs.md),排序只能在这里直连 DB 做。
// province/industry/capital(含具体国家)/keyword 四个筛选按 AND 组合——之前 theme.js
// 只会取其中一个 taxonomy 传过来,是前端限制(已改),不是这里的限制;这里本来就按
// 传入的每个维度分别相交(INTERSECT)+ keyword 再叠加一层 ILIKE,四者天然是 AND 关系。
const FACTS_BROWSE_COLUMNS = [
  ['jpno', null], ['entry_id', null], ['jpnamee', null], ['jpname', null], ['jpnamezh', null],
  ['province_th', 'province'], ['provincee', null], ['provincezh', null],
  ['businesstypedesc', 'setupobjdesc'], ['businesstypedesce', 'setupobjdesce'], ['businesstypedesczh', 'setupobjdesczh'],
  ['capamt', null], ['jpstatdesc', null], ['jpstatdesce', null], ['statuszh', null],
]
const FACTS_BROWSE_SELECT = FACTS_BROWSE_COLUMNS.map(([col, as]) => `f.${col}${as ? ` AS ${as}` : ''}`).join(', ')
const FACTS_BROWSE_NAMES = FACTS_BROWSE_COLUMNS.map(([col, as]) => as || col)

function parseBrowseRows(out, lim, off) {
  const lines = out.split('\n').filter(l => l.length > 0)
  let total = 0
  const items = lines.map(line => {
    const f = line.split('\t')
    total = num(f[0])
    const meta = {}
    FACTS_BROWSE_NAMES.forEach((c, i) => { meta[c] = f[i + 1] === undefined ? '' : f[i + 1] })
    return { slug: meta.jpno, title: meta.jpname, meta }
  })
  return { items, total, limit: lim, offset: off }
}

function rowsToItems(out) {
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const vals = line.split('\t')
    const meta = {}
    FACTS_BROWSE_NAMES.forEach((c, i) => { meta[c] = vals[i] === undefined ? '' : vals[i] })
    return { slug: meta.jpno, title: meta.jpname, meta }
  })
}

// keyword 拼进 ILIKE 前把 LIKE 通配符(% _)和反斜杠都转义成字面量,避免用户输入里的
// % / _ 被当成通配符;顺序不能换(必须先转义反斜杠,否则会把上一步加出来的反斜杠也转义掉)。
function likeLiteral(value) {
  const esc = String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/'/g, "''")
  return `'%${esc}%'`
}

// 把 (taxonomy code, term slug) 批量解析成字面量整数 term_id,不直接拿 slug 参与主查询的
// JOIN 条件——原因见 browseCompanies 里 NESTLOOP_OFF_THRESHOLD 的注释,同一根因。
async function resolveTermIds(dims) {
  if (!dims.length) return new Map()
  const pairs = dims.map(d => `(${sqlLiteral(d.code)}, ${sqlLiteral(d.slug)})`).join(', ')
  const sql = `
    SELECT tx.code, t.slug, t.id FROM woocms.cms_custom_terms t
      JOIN woocms.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id
    WHERE (tx.code, t.slug) IN (${pairs})
  `
  const out = await runPsql(sql)
  const map = new Map()
  out.split('\n').filter(Boolean).forEach(line => {
    const [code, slug, id] = line.split('\t')
    map.set(`${code}:${slug}`, id)
  })
  return map
}

// "最近有更新"徽标(见 theme.js hydrate()):按 slug 批量查 cms_content_entries.updated_at,
// 走 (site_id, content_model_id, slug) 唯一索引精确匹配——不查 thaicompany_facts,那个物化
// 视图每天才刷新一次(见 ops/refresh_facts.sh 的 systemd timer),24 小时判定必须查实时数据源。
// 批量上限 + slug 格式白名单双重限制,单次几十条走索引查找,不是大表扫描。
const SLUG_RE = /^[a-z0-9-]{1,120}$/
const UPDATED_BADGE_MAX = 60
export async function recentlyUpdatedMap(slugs) {
  const clean = Array.from(new Set((slugs || []).filter(s => SLUG_RE.test(s)))).slice(0, UPDATED_BADGE_MAX)
  if (!clean.length) return {}
  const list = clean.map(sqlLiteral).join(', ')
  const sql = `
    SELECT slug, updated_at FROM ${sqlIdent(config.db.schema)}.cms_content_entries
    WHERE site_id = 1 AND content_model_id = 2 AND slug IN (${list})
  `
  const out = await runPsql(sql, { timeout: 5000 })
  const map = {}
  out.split('\n').filter(Boolean).forEach(line => {
    const [slug, updatedAt] = line.split('\t')
    if (slug) map[slug] = updatedAt || null
  })
  return map
}

// 命中集合超过这个数量级时,强制关掉 nestloop(见 runPsql 的 disableNestloop 注释)。
// 取值依据:实测 idx_tcf_entry 逐行回表约 0.03~0.2ms/行,几千行时 Nested Loop 仍比
// Hash Join 的固定开销(建 hash 表 + 扫一遍 facts,约 1~1.5s)划算;门槛设在两者交叉点
// 附近(约 6000~7000 行)再留点余量。
const NESTLOOP_OFF_THRESHOLD = 10000

// 深分页硬上限:体检发现 OFFSET 之前无上限,恶意/无意深翻页时数据库仍要在索引里
// 跳过前面全部行才能定位到本页——即使走 thaicompany_facts 的索引也不是零成本。
// 4000 页(单页 24 条)对任何真实用户/爬虫使用场景都绰绰有余。
const MAX_BROWSE_OFFSET = 96000

export async function browseCompanies({ province, industry, capital, keyword, limit, offset, includeInactive } = {}) {
  const lim = Math.max(1, Math.min(num(limit) || 24, 100))
  const off = Math.max(0, Math.min(num(offset), MAX_BROWSE_OFFSET))
  const kw = str(keyword).trim()
  // 默认硬过滤运营中;includeInactive=1 时放开(搜索「含已解散」开关 / AI 按名精确查)。
  const inactive = truthyFlag(includeInactive)
  const dims = [
    str(province).trim() && { code: 'province', slug: str(province).trim() },
    str(industry).trim() && { code: 'industry', slug: str(industry).trim() },
    str(capital).trim() && { code: 'capital', slug: str(capital).trim() },
  ].filter(Boolean)

  const F = `${sqlIdent(config.db.schema)}.thaicompany_facts`
  const rank = statusRankExpr('f.jpstatcode')
  const kwCond = kw
    ? `(f.jpnamee ILIKE ${likeLiteral(kw)} OR f.jpname ILIKE ${likeLiteral(kw)} OR f.jpnamezh ILIKE ${likeLiteral(kw)} OR f.jpno ILIKE ${likeLiteral(kw)})`
    : ''
  const opCond = inactive ? '' : operatingCondExpr('f.jpstatcode')
  const andParts = (...parts) => parts.filter(Boolean).join(' AND ')

  if (!dims.length) {
    // 没有 taxonomy 筛选:纯关键词或纯默认浏览,直接在 facts 上扫,不需要 entry_terms 交集
    const whereSql = andParts(kwCond, opCond)
    const where = whereSql ? `WHERE ${whereSql}` : ''
    const sql = `
      WITH page AS (
        SELECT entry_id FROM ${F} f ${where}
        ORDER BY ${rank} ASC, f.entry_id DESC
        LIMIT ${lim} OFFSET ${off}
      )
      SELECT (SELECT count(*) FROM ${F} f ${where}) AS _total, ${FACTS_BROWSE_SELECT}
      FROM ${F} f JOIN page ON page.entry_id = f.entry_id
      ORDER BY ${rank} ASC, f.entry_id DESC
    `
    const out = await runPsql(sql)
    return { ...parseBrowseRows(out, lim, off), includeInactive: inactive }
  }

  // 有 1~3 个 taxonomy 维度:各自解析出字面量 term_id 后各自取 entry_id 集合再 INTERSECT
  // 求交集(AND);任一维度的 slug 在 taxonomy 里找不到对应 term,交集必然为空,直接短路。
  const resolved = await resolveTermIds(dims)
  if (resolved.size < dims.length) return { items: [], total: 0, limit: lim, offset: off, includeInactive: inactive }

  const ctes = dims.map((d, i) => `m${i} AS MATERIALIZED (SELECT entry_id FROM woocms.cms_content_entry_terms WHERE term_id = ${resolved.get(`${d.code}:${d.slug}`)})`)
  const intersectSql = dims.map((_, i) => `SELECT entry_id FROM m${i}`).join('\n      INTERSECT\n      ')
  const withClause = `WITH ${ctes.join(',\n    ')},\n    m AS MATERIALIZED (\n      ${intersectSql}\n    )`
  const matchWhere = andParts('f.entry_id IN (SELECT entry_id FROM m)', kwCond, opCond)

  // 命中量可能极大(曼谷单府就占全库 40%),先单独拿到真实总数,才能决定下面主查询
  // 要不要关 nestloop——这一步顺便就是分页要用的 total,不是额外浪费。
  const total = num((await runPsql(`${withClause}\n    SELECT count(*) FROM ${F} f WHERE ${matchWhere}`)).trim())
  if (!total) return { items: [], total: 0, limit: lim, offset: off, includeInactive: inactive }

  const pageSql = `
    ${withClause},
    page AS (
      SELECT f.entry_id FROM ${F} f
      WHERE ${matchWhere}
      ORDER BY ${rank} ASC, f.entry_id DESC
      LIMIT ${lim} OFFSET ${off}
    )
    SELECT ${FACTS_BROWSE_SELECT}
    FROM ${F} f JOIN page ON page.entry_id = f.entry_id
    ORDER BY ${rank} ASC, f.entry_id DESC
  `
  const out = await runPsql(pageSql, { disableNestloop: total > NESTLOOP_OFF_THRESHOLD })
  return { items: rowsToItems(out), total, limit: lim, offset: off, includeInactive: inactive }
}

// 搜索命中计数:关键词搜索命中、出现在结果第一页的公司各 +1(调用方负责判断"带关键词
// 且 offset=0 且非爬虫"才调用这个函数,这里不重复判断)。与 bumpCompanyViews(浏览量,
// resolver/src/db.js)是两个独立指标,不合并。一条 SQL 批量 UPSERT 一整页,不逐行往返;
// entry_id 缺失(理论上不会,防御性处理)时存 NULL,不强行塞 0 污染后续 join。
export async function bumpSearchHits(rows) {
  const list = (rows || []).filter(r => r && r.jpno)
  if (!list.length) return
  const T = `${sqlIdent(config.db.schema)}.thaicompany_search_hits`
  const values = list
    .map(r => `(${sqlLiteral(String(r.jpno))}, ${Number.isFinite(r.entryId) ? r.entryId : 'NULL'}, 1, now())`)
    .join(', ')
  const sql = `
    INSERT INTO ${T} (jpno, entry_id, hits, updated_at)
    VALUES ${values}
    ON CONFLICT (jpno) DO UPDATE SET
      hits = ${T}.hits + 1,
      entry_id = COALESCE(EXCLUDED.entry_id, ${T}.entry_id),
      updated_at = now()
  `
  await runPsql(sql, { timeout: 4000 })
  // 按天汇总桶(/trending-companies 时间窗口用,见 ops/create_thaicompany_search_hits_daily_table.sql),
  // 失败不影响上面已经写入的累计命中数——这张表只是聚合用的旁路。
  try {
    const TD = `${sqlIdent(config.db.schema)}.thaicompany_search_hits_daily`
    const dailyValues = list
      .map(r => `(${sqlLiteral(String(r.jpno))}, ${Number.isFinite(r.entryId) ? r.entryId : 'NULL'}, CURRENT_DATE, 1, now())`)
      .join(', ')
    const dailySql = `
      INSERT INTO ${TD} (jpno, entry_id, day, hits, updated_at)
      VALUES ${dailyValues}
      ON CONFLICT (jpno, day) DO UPDATE SET
        hits = ${TD}.hits + 1,
        entry_id = COALESCE(EXCLUDED.entry_id, ${TD}.entry_id),
        updated_at = now()
    `
    await runPsql(dailySql, { timeout: 4000 })
  } catch (e) { console.error('[analytics] thaicompany_search_hits_daily 写入失败(已忽略):', e.message) }
}

// 府级公司排名(按注册资本或注册日期),直查物化视图 thaicompany_facts。
// 索引安全:走 idx_tcf_capamt / idx_tcf_regdate(DESC)+ provincezh 过滤,毫秒级(可扩到数百万)。
// 取代「entries 对 jsonb capamt 全表/子集排序」(34 万行子集即 35s+,数百万必卡死)。
export async function rankCompaniesByProvince(provinceZh, sort, { limit, includeInactive } = {}) {
  if (!config.db.user || !config.db.name || !provinceZh) return null
  const F = `${sqlIdent(config.db.schema)}.thaicompany_facts`
  const lim = Math.max(1, Math.min(Math.floor(limit) || 10, 20))
  const orderCol = sort === 'reg_date_desc' ? 'regdate' : 'capamt'
  const inactive = truthyFlag(includeInactive)
  const opCond = inactive ? '' : ` AND ${operatingCondExpr('jpstatcode')}`
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'code', COALESCE(NULLIF(slug,''), NULLIF(jpno,''), entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text), 'en', COALESCE(NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text), 'zh', COALESCE(NULLIF(jpnamezh,''), NULLIF(jpnamee,''), NULLIF(jpname,''), NULLIF(jpno,''), entry_id::text)),
    'province', jsonb_build_object('th', COALESCE(province_th,''), 'en', COALESCE(provincee,''), 'zh', COALESCE(provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(businesstypedesc,''), 'en', COALESCE(NULLIF(businesstypedesce,''), businesstypedesc, ''), 'zh', COALESCE(NULLIF(businesstypedesczh,''), NULLIF(businesstypedesce,''), businesstypedesc, '')),
    'capital', COALESCE(capamt, 0), 'regDate', COALESCE(regdate, ''), 'regYear', regyear,
    'status', jsonb_build_object('th', COALESCE(jpstatdesc,''), 'en', COALESCE(NULLIF(jpstatdesce,''), jpstatdesc, ''), 'zh', COALESCE(NULLIF(statuszh,''), NULLIF(jpstatdesce,''), jpstatdesc, ''))
  )`
  const sql = `SELECT COALESCE(jsonb_agg(item ORDER BY srank ASC, sv DESC NULLS LAST),'[]')::text FROM (
      SELECT ${statusRankExpr('jpstatcode')} srank, ${orderCol} sv, ${companyJson} item FROM ${F}
      WHERE provincezh = ${sqlLiteral(provinceZh)} AND ${orderCol} IS NOT NULL${opCond}
      ORDER BY srank ASC, sv DESC NULLS LAST LIMIT ${lim}
    ) r`
  const out = (await runPsql(sql, { timeout: 15000 })).trim()
  return { province: provinceZh, sort, items: out ? JSON.parse(out) : [], includeInactive: inactive }
}

// 人气排行(浏览量 thaicompany_views / 搜索次数 thaicompany_search_hits),两个指标各自
// 独立排行,不合并成一个分数(产品要求:两个指标衡量的行为不同,量级也差很多,合并会被
// 浏览量主导)。两张计数表结构一致(jpno PK, entry_id, <score列>, updated_at),都从写入时
// 就带 entry_id,直接 join thaicompany_facts.entry_id(唯一索引),不必再靠 jpno 兜底。
// scope=province|industry 时复用 browseCompanies 同一套 term_id 解析(resolveTermIds)+
// MATERIALIZED CTE 防 planner 对大府/大行业选择率低估(原因见 browseCompanies 顶部注释,
// 同一根因)。返回形状对齐 rankCompaniesByProvince(name/province/business/status 都是
// {th,en,zh}),resolver 侧可以直接复用 companyCardHtml 渲染,不用再造一套。
const TRENDING_METRICS = {
  views: { table: 'thaicompany_views', col: 'views' },
  search: { table: 'thaicompany_search_hits', col: 'hits' },
}
// 时间窗口:按天汇总表(<table>_daily,见 ops/create_thaicompany_*_daily_table.sql)只有
// 天粒度,'24h' 取的是"今天"这一个桶,不是严格滚动过去24小时(已与产品侧确认接受这个精度
// 取舍)。不传 window(undefined)时走原来的全量累计表,行为完全不变。
const TRENDING_WINDOWS = { '24h': 1, '7d': 7, '30d': 30 }

export async function fetchTrending({ metric, scope, value, limit, window } = {}) {
  const cfg = TRENDING_METRICS[metric]
  if (!cfg) return null
  const lim = Math.max(1, Math.min(Math.floor(limit) || 20, 50))
  const days = TRENDING_WINDOWS[window]
  const M = `${sqlIdent(config.db.schema)}.${cfg.table}${days ? '_daily' : ''}`
  const F = `${sqlIdent(config.db.schema)}.thaicompany_facts`

  const ctes = []
  let scopedJoin = ''
  if (scope === 'province' || scope === 'industry') {
    const slug = str(value).trim()
    if (!slug) return { metric, scope, value: slug, items: [] }
    const resolved = await resolveTermIds([{ code: scope, slug }])
    const termId = resolved.get(`${scope}:${slug}`)
    if (!termId) return { metric, scope, value: slug, items: [] }
    ctes.push(`scoped AS MATERIALIZED (SELECT entry_id FROM woocms.cms_content_entry_terms WHERE term_id = ${termId})`)
    scopedJoin = 'JOIN scoped sc ON sc.entry_id = m.entry_id'
  }
  // 人气榜默认只出运营中公司(与 browse/排行一致);先在 ranked 阶段 JOIN facts 过滤,
  // 避免「先按全量热度取 top N、再丢掉异常」导致名额被非运营公司占满。
  const opJoin = `JOIN ${F} fop ON fop.entry_id = m.entry_id AND ${operatingCondExpr('fop.jpstatcode')}`
  const rankedSelect = days
    ? `SELECT m.entry_id, SUM(m.${cfg.col}) AS score
    FROM ${M} m
    ${opJoin}
    ${scopedJoin}
    WHERE m.entry_id IS NOT NULL AND m.day >= CURRENT_DATE - INTERVAL '${days - 1} days'
    GROUP BY m.entry_id
    HAVING SUM(m.${cfg.col}) > 0
    ORDER BY SUM(m.${cfg.col}) DESC
    LIMIT ${lim}`
    : `SELECT m.entry_id, m.${cfg.col} AS score
    FROM ${M} m
    ${opJoin}
    ${scopedJoin}
    WHERE m.entry_id IS NOT NULL AND m.${cfg.col} > 0
    ORDER BY m.${cfg.col} DESC
    LIMIT ${lim}`
  ctes.push(`ranked AS MATERIALIZED (${rankedSelect})`)

  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'code', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text), 'en', COALESCE(NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text), 'zh', COALESCE(NULLIF(f.jpnamezh,''), NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text)),
    'province', jsonb_build_object('th', COALESCE(f.province_th,''), 'en', COALESCE(f.provincee,''), 'zh', COALESCE(f.provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(f.businesstypedesc,''), 'en', COALESCE(NULLIF(f.businesstypedesce,''), f.businesstypedesc, ''), 'zh', COALESCE(NULLIF(f.businesstypedesczh,''), NULLIF(f.businesstypedesce,''), f.businesstypedesc, '')),
    'capital', COALESCE(f.capamt, 0), 'regDate', COALESCE(f.regdate, ''), 'regYear', f.regyear,
    'status', jsonb_build_object('th', COALESCE(f.jpstatdesc,''), 'en', COALESCE(NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''), 'zh', COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), f.jpstatdesc, '')),
    'score', r.score
  )`

  const sql = `
    WITH ${ctes.join(',\n')}
    SELECT COALESCE(jsonb_agg(${companyJson} ORDER BY r.score DESC), '[]')::text
    FROM ranked r JOIN ${F} f ON f.entry_id = r.entry_id
  `
  const out = (await runPsql(sql, { timeout: 8000 })).trim()
  const items = out ? JSON.parse(out) : []
  return { metric, scope: scope || 'global', value: value || null, window: days ? window : null, items }
}

// 某府的县(二级)列表 + 各县公司数(府 term slug → 子 term;entry_terms 计数)。
export async function districtList(provSlug) {
  if (!config.db.user || !config.db.name) return null
  const schema = sqlIdent(config.db.schema)
  const lit = sqlLiteral(provSlug)
  const sql = `
    WITH p AS (SELECT id FROM ${schema}.cms_custom_terms WHERE slug = ${lit}),
    dist AS (SELECT d.id, d.slug FROM ${schema}.cms_custom_terms d JOIN p ON d.parent_id = p.id),
    cnt AS (SELECT et.term_id, COUNT(*) c FROM ${schema}.cms_content_entry_terms et JOIN dist ON dist.id = et.term_id GROUP BY et.term_id)
    SELECT jsonb_build_object(
      'provinceSlug', ${lit},
      'districts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', nm, 'companyCount', c) ORDER BY c DESC, slug)
        FROM (
          SELECT d.slug, COALESCE(cnt.c, 0) c,
            jsonb_build_object(
              'en', COALESCE(max(tr.name) FILTER (WHERE tr.locale = 'en'), ''),
              'th', COALESCE(max(tr.name) FILTER (WHERE tr.locale LIKE 'th%'), ''),
              'zh', COALESCE(max(tr.name) FILTER (WHERE tr.locale LIKE 'zh%'), '')
            ) nm
          FROM dist d LEFT JOIN cnt ON cnt.term_id = d.id
          LEFT JOIN ${schema}.cms_term_translations tr ON tr.term_id = d.id
          GROUP BY d.id, d.slug, cnt.c
        ) g
      ), '[]'::jsonb)
    )::text
  `
  const out = (await runPsql(sql, { timeout: 30000 })).trim()
  return out ? JSON.parse(out) : null
}

// 某县(二级)的公司报告:县 term slug → entry_terms → JOIN facts(三语 + 资本),分页 + 总数/总资本。
export async function districtCompanies(dSlug, { limit, offset, includeInactive } = {}) {
  if (!config.db.user || !config.db.name) return null
  const schema = sqlIdent(config.db.schema)
  const F = `${schema}.thaicompany_facts`
  const lit = sqlLiteral(dSlug)
  const lim = Math.max(1, Math.floor(limit)), off = Math.max(0, Math.floor(offset))
  const inactive = truthyFlag(includeInactive)
  const opCond = inactive ? 'TRUE' : operatingCondExpr('f.jpstatcode')
  const names = pfx => `jsonb_build_object('en', COALESCE(max(${pfx}.name) FILTER (WHERE ${pfx}.locale='en'),''), 'th', COALESCE(max(${pfx}.name) FILTER (WHERE ${pfx}.locale LIKE 'th%'),''), 'zh', COALESCE(max(${pfx}.name) FILTER (WHERE ${pfx}.locale LIKE 'zh%'),''))`
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'code', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(f.jpname,''), f.entry_id::text), 'en', COALESCE(NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), f.entry_id::text), 'zh', COALESCE(NULLIF(f.jpnamezh,''), NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), f.entry_id::text)),
    'province', jsonb_build_object('th', COALESCE(f.province_th,''), 'en', COALESCE(f.provincee,''), 'zh', COALESCE(f.provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(f.businesstypedesc,''), 'en', COALESCE(NULLIF(f.businesstypedesce,''), f.businesstypedesc, ''), 'zh', COALESCE(NULLIF(f.businesstypedesczh,''), NULLIF(f.businesstypedesce,''), f.businesstypedesc, '')),
    'capital', COALESCE(f.capamt, 0), 'regDate', COALESCE(f.regdate, ''), 'regYear', f.regyear,
    'status', jsonb_build_object('th', COALESCE(f.jpstatdesc,''), 'en', COALESCE(NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''), 'zh', COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''))
  )`
  const sql = `
    WITH dt AS (SELECT id FROM ${schema}.cms_custom_terms WHERE slug = ${lit}),
    hits AS (SELECT et.entry_id FROM ${schema}.cms_content_entry_terms et JOIN dt ON dt.id = et.term_id),
    active AS (SELECT h.entry_id FROM hits h JOIN ${F} f ON f.entry_id = h.entry_id WHERE ${opCond}),
    pg AS (
      SELECT a.entry_id FROM active a JOIN ${F} f ON f.entry_id = a.entry_id
      ORDER BY ${statusRankExpr('f.jpstatcode')} ASC, f.entry_id DESC
      LIMIT ${lim} OFFSET ${off}
    )
    SELECT jsonb_build_object(
      'districtSlug', ${lit},
      'district', (SELECT ${names('tr')} FROM ${schema}.cms_custom_terms t LEFT JOIN ${schema}.cms_term_translations tr ON tr.term_id = t.id WHERE t.slug = ${lit}),
      'province', (SELECT ${names('ptr')} FROM ${schema}.cms_custom_terms t JOIN ${schema}.cms_custom_terms p ON p.id = t.parent_id LEFT JOIN ${schema}.cms_term_translations ptr ON ptr.term_id = p.id WHERE t.slug = ${lit}),
      'provinceSlug', (SELECT p.slug FROM ${schema}.cms_custom_terms t JOIN ${schema}.cms_custom_terms p ON p.id = t.parent_id WHERE t.slug = ${lit}),
      'total', (SELECT COUNT(*) FROM active),
      'totalCapital', (SELECT COALESCE(round(SUM(f.capamt)),0) FROM active a JOIN ${F} f ON f.entry_id = a.entry_id),
      'companies', COALESCE((SELECT jsonb_agg(${companyJson} ORDER BY ${statusRankExpr('f.jpstatcode')} ASC, f.capamt DESC NULLS LAST, f.entry_id DESC) FROM pg JOIN ${F} f ON f.entry_id = pg.entry_id), '[]'::jsonb),
      'includeInactive', to_jsonb(${inactive ? 'true' : 'false'}::boolean)
    )::text
  `
  const out = (await runPsql(sql, { timeout: 30000 })).trim()
  return out ? JSON.parse(out) : null
}

// 顶层行业大类(TSIC sections)三语名 + slug(投资地图行业 chips 用,wc-data 不本地化 term 名故改这里取译名)
export async function industrySections() {
  if (!config.db.user || !config.db.name) return null
  const schema = sqlIdent(config.db.schema)
  const sql = `
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'slug', slug,
      'name', jsonb_build_object('en', COALESCE(en,''), 'th', COALESCE(th,''), 'zh', COALESCE(zh, en, ''))
    ) ORDER BY sort_order), '[]')::text
    FROM (
      SELECT t.slug, t.sort_order,
        max(tr.name) FILTER (WHERE tr.locale = 'en') AS en,
        max(tr.name) FILTER (WHERE tr.locale LIKE 'th%') AS th,
        max(tr.name) FILTER (WHERE tr.locale LIKE 'zh%') AS zh
      FROM ${schema}.cms_custom_terms t
      JOIN ${schema}.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id AND tx.code = 'industry'
      LEFT JOIN ${schema}.cms_term_translations tr ON tr.term_id = t.id
      WHERE t.parent_id IS NULL
      GROUP BY t.id, t.slug, t.sort_order
    ) s
  `
  const out = (await runPsql(sql)).trim()
  return out ? JSON.parse(out) : []
}

// 行业 → 各府分布(投资地图行业透视用):给行业 term slug,返回该行业在各府的企业数/注册资本。
// taxonomy 交集(行业 term 的 entry)JOIN facts(entry_id 唯一索引,取三语府 + capamt 聚合)。
export async function industryProvinces(indSlug) {
  if (!config.db.user || !config.db.name) return null
  const schema = sqlIdent(config.db.schema)
  const F = `${schema}.thaicompany_facts`
  const lit = sqlLiteral(indSlug)
  const sql = `
    WITH ind AS (
      SELECT it.entry_id FROM ${schema}.cms_content_entry_terms it
      JOIN ${schema}.cms_custom_terms itt ON itt.id = it.term_id
      WHERE itt.slug = ${lit}
    ),
    g AS (
      SELECT f.provincezh, f.province_th, f.provincee, COUNT(*) c, COALESCE(SUM(f.capamt),0) sc, COALESCE(AVG(f.capamt),0) ac
      FROM ind JOIN ${F} f ON f.entry_id = ind.entry_id
      WHERE NULLIF(f.provincee,'') IS NOT NULL
      GROUP BY f.provincezh, f.province_th, f.provincee
    )
    SELECT jsonb_build_object(
      'industrySlug', ${lit},
      'industryName', (
        SELECT jsonb_build_object(
          'en', COALESCE(max(tr.name) FILTER (WHERE tr.locale = 'en'), ''),
          'th', COALESCE(max(tr.name) FILTER (WHERE tr.locale LIKE 'th%'), ''),
          'zh', COALESCE(max(tr.name) FILTER (WHERE tr.locale LIKE 'zh%'), '')
        )
        FROM ${schema}.cms_custom_terms t LEFT JOIN ${schema}.cms_term_translations tr ON tr.term_id = t.id
        WHERE t.slug = ${lit}
      ),
      'total', (SELECT COALESCE(SUM(c),0) FROM g),
      'provinceRanking', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'province', jsonb_build_object('th', province_th, 'en', provincee, 'zh', provincezh),
          'companyCount', c, 'registeredCapital', round(sc), 'avgCapital', round(ac)
        ) ORDER BY sc DESC)
        FROM g
      ), '[]'::jsonb)
    )::text
  `
  const out = (await runPsql(sql, { timeout: 30000 })).trim()
  return out ? JSON.parse(out) : null
}

// 排行榜当前用哪个财年、覆盖多少家公司——由 analytics/scripts/build_financial_facts.js
// 每次跑完回填后重新计算写入 ranking_config,这里只读,不现算(避免每次请求都扫一遍
// thaicompany_financial_facts 算覆盖率)。
async function getRankingYearConfig() {
  const out = (await runPsql(`SELECT value::text FROM woocms.ranking_config WHERE key = 'financial_ranking_year'`)).trim()
  return out ? JSON.parse(out) : null
}

// 企业营收/利润排行榜(自算,替代 DBD 透传但口径不透明的 rankRevenueAll 等字段——
// 详情页那批数字连 BizThai 自己都没法验证参照人群是谁,这里换成完全基于本地已入库
// 财报数据、口径可以逐字讲清楚的排名)。
//
// 数据来自 thaicompany_financial_facts(见 ops/create_thaicompany_financial_facts_table.sql
// 与同目录 ETL 脚本的说明)——一家公司一个真实财年一行,只保留通过 yearHasData 判断
// 「这年真的有报数据」的行,取代 DBD 原始的、BizThai 没法验证参照人群的 rank 字段。
//
// industry/province 筛选复用 browseCompanies 的 resolveTermIds + MATERIALIZED CTE +
// INTERSECT 写法(同一根因:大府/大行业 term 命中量极大,直接 JOIN 让 planner 低估选择率);
// 排序复用 statusRankExpr(运营中优先),命中量与深分页的安全阀也和 browseCompanies 同一套
// (NESTLOOP_OFF_THRESHOLD / MAX_BROWSE_OFFSET),不重新发明。
// industry 可传单个 slug 或 slug 数组(策展榜单跨多个细分类目 OR,比如"食品企业"要合并十几个
// 细分制造/批发/零售 TSIC 叶子类目——这套分类法是扁平两层,没有"食品制造大类"这种中间分组,
// 只能自己枚举叶子 slug 再 OR 起来)。
// natCode:具体国家 2 位代码(如 'CN'/'JP'/'KR',按用户要求——同一家公司可能同时有多个国家的
// 资本来源,一家公司会同时出现在多个国别榜单里,不挑一个"主要"国籍)或特殊值 'FOREIGN'
// (只要有任意非泰国的资本来源就算,替代原来 thaicompany_facts.mainnatcode 那个粗粒度 THA/FRN
// 字段——那个字段实测把 PTT 这种泰国国企也标成 FRN,精度不够撑不起"外资企业榜"这种招牌功能;
// thaicompany_nationality_facts 是从 raw.jpNations 逐股东解析出来的真实占比,PTT 这类大型
// 上市公司没有这张表的记录,自然不会出现在任何国别/外资榜单里)。
export async function rankCompaniesByFinancials({ metric, industry, province, sizeCode, natCode, fiscalYear, limit, offset, includeInactive } = {}) {
  if (!config.db.user || !config.db.name) return null
  const isGrowth = metric === 'growth'
  const m = metric === 'profitloss' ? 'profitloss' : 'revenue'    // 白名单,不接受任意字符串拼进 SQL;growth 内部按 revenue 算同比
  const size = ['S', 'M', 'L'].includes(String(sizeCode || '').toUpperCase()) ? String(sizeCode).toUpperCase() : ''
  const nat = /^[A-Z]{2}$/.test(String(natCode || '').toUpperCase()) ? String(natCode).toUpperCase() : (String(natCode || '').toUpperCase() === 'FOREIGN' ? 'FOREIGN' : '')
  const lim = Math.max(1, Math.min(num(limit) || 24, 100))
  const off = Math.max(0, Math.min(num(offset), MAX_BROWSE_OFFSET))
  const inactive = truthyFlag(includeInactive)

  const yearCfg = await getRankingYearConfig()
  const year = num(fiscalYear) || (yearCfg ? yearCfg.fiscalYearBe : 0)
  // 年份选择器可选项:复用 ETL 挑默认财年的同一套"覆盖量 >= 最大年份 30%"门槛,排除刚起步、
  // 企业还没怎么申报的最新年和早年数字化覆盖率断崖式下跌的历史年份,避免选项里混进几乎
  // 没有数据的年份误导用户。放在两处提前 return 之前算好,保证每条路径返回形状一致——
  // 尤其是"当前筛选组合在这年没有结果"那条 return,前端恰恰需要靠这份列表提示切到别的年份。
  const byYear = (yearCfg && Array.isArray(yearCfg.byYear)) ? yearCfg.byYear : []
  const maxRevN = byYear.reduce((mx, r) => Math.max(mx, Number(r.revenueCoverage) || 0), 0)
  const yearThreshold = maxRevN * 0.3
  const availableYears = byYear
    .filter(r => (Number(r.revenueCoverage) || 0) >= yearThreshold)
    .map(r => r.fiscalYearBe)
    .sort((a, b) => b - a)
  // 覆盖率必须按"实际生效的 year"去 byYear 里查那一年的数字,不能一律用 yearCfg 顶层的
  // revenueCoverage/profitCoverage——那两个字段永远是默认财年的覆盖率,?fiscalYear= 覆盖
  // 到别的年份时如果还读顶层字段,页面上的"共 N 家企业"就会跟当前实际展示的年份对不上。
  const yearRow = byYear.find(r => r.fiscalYearBe === year)
  const coverageFor = mm => yearRow ? (mm === 'revenue' ? yearRow.revenueCoverage : yearRow.profitCoverage) : 0
  if (!year) return { items: [], total: 0, limit: lim, offset: off, fiscalYearBe: null, defaultFiscalYearBe: yearCfg ? yearCfg.fiscalYearBe : 0, coverage: 0, availableYears }

  const schema = sqlIdent(config.db.schema)
  const F = `${schema}.thaicompany_facts`
  const TFF = `${schema}.thaicompany_financial_facts`
  const TNF = `${schema}.thaicompany_nationality_facts`

  const industryList = (Array.isArray(industry) ? industry : [industry]).map(s => str(s).trim()).filter(Boolean)
  const provinceSlug = str(province).trim()
  const dims = [
    ...industryList.map(slug => ({ code: 'industry', slug })),
    provinceSlug && { code: 'province', slug: provinceSlug },
  ].filter(Boolean)

  let termJoin = ''
  if (dims.length) {
    const resolved = await resolveTermIds(dims)
    if (resolved.size < dims.length) return { items: [], total: 0, limit: lim, offset: off, fiscalYearBe: year, coverage: 0 }
    const parts = []
    // 同一维度(industry)多个 slug 之间是 OR(UNION),不同维度(industry vs province)之间是 AND(INTERSECT)
    if (industryList.length) {
      const ids = industryList.map(slug => resolved.get(`industry:${slug}`))
      parts.push(`ind_match AS MATERIALIZED (SELECT DISTINCT entry_id FROM ${schema}.cms_content_entry_terms WHERE term_id IN (${ids.join(',')}))`)
    }
    if (provinceSlug) {
      parts.push(`prov_match AS MATERIALIZED (SELECT entry_id FROM ${schema}.cms_content_entry_terms WHERE term_id = ${resolved.get(`province:${provinceSlug}`)})`)
    }
    const pieces = []
    if (industryList.length) pieces.push('SELECT entry_id FROM ind_match')
    if (provinceSlug) pieces.push('SELECT entry_id FROM prov_match')
    const intersectSql = pieces.join('\n        INTERSECT\n        ')
    termJoin = `, ${parts.join(',\n    ')},\n    term_match AS MATERIALIZED (\n        ${intersectSql}\n    )`
  }

  // 三个条件统一按 yf.(year_facts 在外层查询里的别名)取列,不是 CTE 定义内部的 ff——
  // size/industry/province 过滤放外层主查询做,不塞进 year_facts 自己的 WHERE,因为 growth
  // 模式的 year_facts 是 cur/prev 两次 JOIN 出来的,不能重复套用同一句 WHERE 片段。
  const sizeCond = size ? `AND yf.business_size_code = ${sqlLiteral(size)}` : ''
  const natCond = nat
    ? (nat === 'FOREIGN'
        ? `AND EXISTS (SELECT 1 FROM ${TNF} nf WHERE nf.entry_id = yf.entry_id AND nf.nat_code <> 'TH')`
        : `AND EXISTS (SELECT 1 FROM ${TNF} nf WHERE nf.entry_id = yf.entry_id AND nf.nat_code = ${sqlLiteral(nat)})`)
    : ''
  const termCond = dims.length ? 'AND yf.entry_id IN (SELECT entry_id FROM term_match)' : ''
  // 财报榜默认只保留运营中(status_rank=0);与文案「仅运营中」对齐。includeInactive=1 时放开。
  const statusCond = inactive ? '' : 'AND COALESCE(yf.status_rank, 1) = 0'

  // 同比增长率:今年 revenue 相对去年 revenue 的变化百分比。要求去年 revenue >= 1000万泰铢才计算——
  // 门槛太低(试过 100万)第一名还是 12 万 6 千 % 这种量级,基数还是太小、噪音没压住。参照
  // Deloitte Fast 500/Inc 5000 这类"最快增长企业"榜单的通行做法(都设最低起始营收门槛,理由
  // 同源:基数太小时增长率没有解释力),提到 1000 万门槛后头部数字才落到几百到几千 % 这种
  // 真实、可信、经得起点进去核实的区间——这类公司直接从增长榜排除,不是漏算。
  // status_rank(运营状态优先级,0=运营中/1=其它)预算在 thaicompany_financial_facts 里
  // (analytics/scripts/build_financial_facts.js 回填,口径跟 statusRankExpr 一致),year_facts
  // 直接带出这一列——不再靠外层 JOIN thaicompany_facts 现算 statusRankExpr('f.jpstatcode')。
  // 这样"全部行业/全部省份"这类没有 term_match 收窄候选集的组合,排序也能用上
  // idx_tff_year_status_revenue/idx_tff_year_status_profit 这两个复合索引,不用先把整年
  // 候选集物化再全量排序(那才是这类组合以前要 4~9 秒的根因,见 ops/add_status_rank_to_financial_facts.sql)。
  // 营收不允许为负——负营收没有业务含义,基本可判定是申报数据的符号/单位错误(参照
  // paidamt 32 位溢出的先例,见 project_bizthai-paidamt-int32-overflow 记忆),之前没有这道
  // 过滤时会被 Math.abs() 在 biz.js valueCell() 里悄悄显示成正数,看不出异常(见
  // project_bizthai-leaderboard-negative-revenue-sign)。profitloss 允许负值,那是合法的
  // "亏损",走 rankingTable 自己的亏损徽标展示,不受此限制。growth 两侧同比都基于 revenue,
  // 同样要排除负值,否则会算出没有意义的百分比。
  const withClause = isGrowth
    ? `WITH cur AS MATERIALIZED (
        SELECT entry_id, revenue, business_size_code, status_rank FROM ${TFF} WHERE fiscal_year_be = ${year} AND revenue IS NOT NULL AND revenue >= 0
      ),
      prev AS MATERIALIZED (
        SELECT entry_id, revenue AS prev_revenue FROM ${TFF} WHERE fiscal_year_be = ${year - 1} AND revenue IS NOT NULL AND revenue >= 10000000
      ),
      year_facts AS MATERIALIZED (
        SELECT cur.entry_id, cur.business_size_code, cur.status_rank, ((cur.revenue - prev.prev_revenue) / prev.prev_revenue * 100) AS metric_value
        FROM cur JOIN prev ON prev.entry_id = cur.entry_id
      )${termJoin}`
    : `WITH year_facts AS MATERIALIZED (
        SELECT entry_id, business_size_code, status_rank, ${m} AS metric_value FROM ${TFF} ff
        WHERE ff.fiscal_year_be = ${year} AND ff.${m} IS NOT NULL ${m === 'revenue' ? 'AND ff.revenue >= 0' : ''}
      )${termJoin}`
  const mainWhere = `WHERE 1=1 ${sizeCond} ${natCond} ${termCond} ${statusCond}`

  const total = num((await runPsql(`${withClause}\n  SELECT count(*) FROM year_facts yf JOIN ${F} f ON f.entry_id = yf.entry_id ${mainWhere}`)).trim())
  if (!total) return { items: [], total: 0, limit: lim, offset: off, fiscalYearBe: year, defaultFiscalYearBe: yearCfg ? yearCfg.fiscalYearBe : 0, coverage: coverageFor(m), availableYears, includeInactive: inactive }

  // id=slug(链接降级);code=jpno(表格注册号展示)。二者不能都取 slug。
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'code', COALESCE(NULLIF(f.jpno,''), NULLIF(f.slug,''), f.entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(f.jpname,''), f.jpno), 'en', COALESCE(NULLIF(f.jpnamee,''), f.jpname, f.jpno), 'zh', COALESCE(NULLIF(f.jpnamezh,''), f.jpnamee, f.jpname, f.jpno)),
    'province', jsonb_build_object('th', COALESCE(f.province_th,''), 'en', COALESCE(f.provincee,''), 'zh', COALESCE(f.provincezh,'')),
    'status', jsonb_build_object('th', COALESCE(f.jpstatdesc,''), 'en', COALESCE(NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''), 'zh', COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), f.jpstatdesc, '')),
    'metricValue', yf.metric_value
  )`
  // LIMIT/OFFSET 必须在被聚合的子查询里生效(只分页、只对分页结果做 jsonb_agg),
  // 不能对整个结果集聚合后再切页——否则每页都会把全量命中集合在 DB 侧序列化一遍。
  const pageSql = `${withClause}
  SELECT COALESCE(jsonb_agg(item ORDER BY srank ASC, sv DESC NULLS LAST), '[]')::text FROM (
    SELECT COALESCE(yf.status_rank, 1) srank, yf.metric_value sv, ${companyJson} item
    FROM year_facts yf JOIN ${F} f ON f.entry_id = yf.entry_id
    ${mainWhere}
    ORDER BY srank ASC, sv DESC NULLS LAST
    LIMIT ${lim} OFFSET ${off}
  ) page`
  const out = (await runPsql(pageSql, { timeout: 15000, disableNestloop: total > NESTLOOP_OFF_THRESHOLD })).trim()
  const items = out ? JSON.parse(out) : []

  return {
    items, total, limit: lim, offset: off,
    metric: isGrowth ? 'growth' : m, fiscalYearBe: year,
    // defaultFiscalYearBe:站点固有默认财年(不随本次请求的 ?fiscalYear= 覆盖而变)——
    // 前端筛选面板要拿它判断"这个链接是不是正好等于默认年,可以省掉 ?year= 参数",
    // 不能拿 fiscalYearBe(会随当前请求变成任何被覆盖的年份)来比,否则在非默认年份下
    // 切其它筛选维度时,生成的链接会把 year 参数悄悄丢掉,点了就跳回默认财年。
    defaultFiscalYearBe: yearCfg ? yearCfg.fiscalYearBe : 0,
    coverage: yearRow ? coverageFor(m) : total,
    availableYears,
    includeInactive: inactive,
  }
}

// 全部 industry term(供 sitemap):大类 eng=英文名 slug、细类 eng=slug 自己;isTop 标记大类
export async function listIndustryTerms() {
  const sql = `
    SELECT t.slug, t.parent_id, max(tr.name) FILTER (WHERE tr.locale = 'en') AS en
    FROM woocms.cms_custom_terms t
    JOIN woocms.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id AND tx.code = 'industry'
    LEFT JOIN woocms.cms_term_translations tr ON tr.term_id = t.id
    GROUP BY t.id, t.slug, t.parent_id
    ORDER BY t.sort_order
  `
  const out = await runPsql(sql)
  return out.split('\n').filter(l => l.length > 0).map(line => {
    const [slug, parent, en] = line.split('\t')
    const isTop = !parent || parent === ''
    const eng = isTop ? String(en || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : slug
    return { slug, eng, isTop }
  })
}
