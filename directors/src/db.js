// DB 访问:通过连接池直查 woocms.director_index 倒排表(与 analytics/resolver sidecar 同手法)。
import pg from 'pg'
import { config } from './config.js'

// 每列原样返回 wire 协议文本值,行为对齐旧版 `psql -A -t` 纯文本输出(本文件所有查询
// 都是单行单列的 jsonb::text,类型解析方式实际不影响任何调用方,但统一手法方便三个
// sidecar 互相对照)。
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
  application_name: 'dbd-directors',
  types: identityTypes,
})
// 空闲连接被 PG 端断开(重启/睡眠恢复/网络抖动)会 emit 'error';不监听时 Node 会把它
// 升级为 uncaughtException 直接杀进程,配合 systemd Restart=always 变成 crash-loop。
pool.on('error', err => console.error('[directors] 空闲连接错误(已忽略,不影响后续请求):', err.message))

function sqlIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

// 「正常经营优先」统一排序:与 analytics/src/db.js 的 statusRankExpr 口径一致
// (jpstatcode='1' 为运营中,其余含空值一律排后)。
function statusRankExpr(col) {
  return `CASE WHEN ${col} = '1' THEN 0 ELSE 1 END`
}

async function runPsql(sql, { timeout = 20000 } = {}) {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(timeout))}`)
    const { rows } = await client.query({ text: sql, rowMode: 'array' })
    return rows.map(row => row.map(v => (v === null ? '' : v)).join('\t')).join('\n')
  } catch (err) {
    broken = true
    throw err
  } finally {
    if (!broken) {
      try { await client.query('SET statement_timeout = 0') } catch { broken = true }
    }
    client.release(broken)
  }
}

// 反查:给定(已校验的)cmt_no,返回 person + 分页 companies + total。一条 SQL 出 JSON。
export async function lookupDirector(cmtNo, { limit, offset }) {
  const schema = sqlIdent(config.db.schema)
  const lit = sqlLiteral(cmtNo)
  const lim = Math.max(0, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  const sql = `
    WITH hits AS (
      SELECT * FROM ${schema}.director_index WHERE cmt_no = ${lit}
    )
    SELECT jsonb_build_object(
      'cmtNo', ${lit},
      'total', (SELECT COUNT(*) FROM hits),
      'person', (
        SELECT jsonb_build_object('nameTh', name_th, 'nameEn', name_en, 'ntCode', nt_code)
        FROM hits
        WHERE name_th IS NOT NULL OR name_en IS NOT NULL OR nt_code IS NOT NULL
        ORDER BY update_date DESC NULLS LAST
        LIMIT 1
      ),
      'companies', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'jpNo',          jp_no,
          'companyNameTh', company_name_th,
          'companyNameEn', company_name_en,
          'cmtTypeCode',   cmt_type_code,
          'cmtSeq',        cmt_seq,
          'investAmt',     invest_amt,
          'investType',    invest_type,
          'updateDate',    update_date,
          'companyStatus', company_status,
          'province',      province,
          'registeredCapital', cap_amt,
          'capAmt',        cap_amt
        ) ORDER BY update_date DESC NULLS LAST, jp_no)
        FROM (
          SELECT * FROM hits ORDER BY update_date DESC NULLS LAST, jp_no
          LIMIT ${lim} OFFSET ${off}
        ) page
      ), '[]'::jsonb)
    )::text
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : null
}

// 搜索股东/老板(统一搜索):默认 mode='auto' —— 同一个查询同时匹配「证件号精确(大小写兼容)」+「姓名子串」,
// 命中什么就返回什么;mode='id'(模糊)/'name'/'company' 仍保留供直接 API 调用。
// allowIdMatch=false(公网调用默认走这条):不管 mode 传什么,一律只按姓名/公司名匹配,绝不摸 cmt_no——
// 证件号反查是只留给内部调用的能力(见 server.js isInternalCall),不作为公开产品功能,即使调用方
// 忘记显式传 mode=name 也不会漏出去。
// 按人(cmt_no)聚合,返回去重的人 + 名下公司数 + matchedById(是否由证件号命中),证件号命中者排在最前。
// includeCmtNo=true:内部调用使用,在结果里附带证件号。公开 API 默认 false。
export async function searchDirectors(query, { mode, limit, offset, includeCmtNo = false, allowIdMatch = false }) {
  const schema = sqlIdent(config.db.schema)
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  const raw = String(query)
  // 证件号大小写兼容:库内证件号既有纯大写(护照如 EJ6192356)也有纯小写(如 03te33807),
  // 用「原值 / 全大写 / 全小写」三变体精确匹配,走 cmt_no btree 索引(<1ms),覆盖用户任意大小写输入。
  const idIn = `cmt_no IN (${[...new Set([raw, raw.toUpperCase(), raw.toLowerCase()])].map(sqlLiteral).join(',')})` // auto/matched_by_id 用
  const escd = raw.replace(/[\\%_]/g, c => '\\' + c) // 转义 ILIKE 通配符
  const pat = sqlLiteral('%' + escd + '%')
  const nameMatch = `(name_en ILIKE ${pat} OR name_th ILIKE ${pat})`
  let whereHits
  if (mode === 'id' && allowIdMatch) {
    // 证件号模糊查询:大小写不敏感子串匹配,走 cmt_no GIN trigram 索引(仅内部调用可用)
    whereHits = `cmt_no ILIKE ${pat}`
  } else if (mode === 'company') {
    // 公司名模糊搜索:走 company_name_th/en GIN trigram 索引
    whereHits = `cmt_no ~ '^[A-Za-z0-9]{6,}$' AND (company_name_th ILIKE ${pat} OR company_name_en ILIKE ${pat})`
  } else if (mode === 'auto' && allowIdMatch) {
    // auto(仅内部调用):证件号精确 OR 姓名子串,一次 BitmapOr 走三索引(~3ms)
    whereHits = `cmt_no ~ '^[A-Za-z0-9]{6,}$' AND (${idIn} OR ${nameMatch})`
  } else {
    // mode='name',或公网调用传了 id/auto 但 allowIdMatch=false——一律退化为纯姓名匹配
    whereHits = `cmt_no ~ '^[A-Za-z0-9]{6,}$' AND ${nameMatch}`
  }
  const sql = `
    WITH hits AS (
      SELECT cmt_no, name_th, name_en, nt_code, jp_no, cmt_seq, update_date
      FROM ${schema}.director_index WHERE ${whereHits}
    ),
    grouped AS (
      SELECT cmt_no,
        (array_agg(name_th ORDER BY length(COALESCE(name_th,'')) DESC))[1] name_th, -- 取最完整(最长)的姓名,避免残缺名("S S")胜出
        (array_agg(name_en ORDER BY length(COALESCE(name_en,'')) DESC))[1] name_en,
        max(nt_code) nt_code,
        count(DISTINCT jp_no) company_count,
        bool_or(${idIn}) matched_by_id, -- 该人是否由证件号命中(grouped by cmt_no,组内恒定)
        (array_agg(jp_no  ORDER BY update_date DESC NULLS LAST, jp_no))[1] jp_no,
        (array_agg(cmt_seq ORDER BY update_date DESC NULLS LAST, jp_no))[1] cmt_seq
      FROM hits GROUP BY cmt_no
    )
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM grouped),
      'persons', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'nameTh', name_th, 'nameEn', name_en, 'ntCode', nt_code,
          'companyCount', company_count, 'matchedById', matched_by_id,
          'jpNo', jp_no, 'cmtSeq', cmt_seq
        ) ${includeCmtNo ? "|| jsonb_build_object('cmtNo', cmt_no)" : ""}
        ORDER BY matched_by_id DESC, company_count DESC, name_en NULLS LAST)
        FROM (SELECT * FROM grouped ORDER BY matched_by_id DESC, company_count DESC, name_en NULLS LAST LIMIT ${lim} OFFSET ${off}) g
      ), '[]'::jsonb)
    )::text
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : null
}

// 外资按国家:给定国籍码(nt_code,如 CN/JP),返回「有该国籍董事/股东」的公司(distinct 去重,按注册资本降序分页)。
// 用于 /foreign-companies-<国> SSR 列表页。公司字段已在 director_index 反规范化(company_name_*/province/status/cap_amt)。
export async function companiesByNationality(ntCode, { limit, offset }) {
  const schema = sqlIdent(config.db.schema)
  const lit = sqlLiteral(String(ntCode).toUpperCase())
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  const F = `${schema}.thaicompany_facts`
  // 按 director_index 自带 cap_amt 排序+分页(无需 join 排序);仅当页 join facts 取三语字段(走 slug 索引,快)。
  // 返回与年份页同形(facts companyJson),resolver 直接复用 companyCardHtml 渲染三语。
  const companyJson = `jsonb_build_object(
    'id', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'code', COALESCE(NULLIF(f.slug,''), NULLIF(f.jpno,''), f.entry_id::text),
    'name', jsonb_build_object('th', COALESCE(NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text), 'en', COALESCE(NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text), 'zh', COALESCE(NULLIF(f.jpnamezh,''), NULLIF(f.jpnamee,''), NULLIF(f.jpname,''), NULLIF(f.jpno,''), f.entry_id::text)),
    'province', jsonb_build_object('th', COALESCE(f.province_th,''), 'en', COALESCE(f.provincee,''), 'zh', COALESCE(f.provincezh,'')),
    'business', jsonb_build_object('th', COALESCE(f.businesstypedesc,''), 'en', COALESCE(NULLIF(f.businesstypedesce,''), f.businesstypedesc, ''), 'zh', COALESCE(NULLIF(f.businesstypedesczh,''), NULLIF(f.businesstypedesce,''), f.businesstypedesc, '')),
    'capital', COALESCE(f.capamt, 0),
    'regDate', COALESCE(f.regdate, ''),
    'regYear', f.regyear,
    'status', jsonb_build_object('th', COALESCE(f.jpstatdesc,''), 'en', COALESCE(NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''), 'zh', COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), f.jpstatdesc, ''))
  )`
  const sql = `
    WITH hits AS (
      SELECT DISTINCT ON (jp_no) jp_no, cap_amt FROM ${schema}.director_index WHERE nt_code = ${lit}
      ORDER BY jp_no, cap_amt DESC NULLS LAST
    ),
    eligible AS (
      -- total 与分页必须基于同一集合。director_index 可能比每日刷新的 facts 更新，
      -- 也可能含非公开站点记录；无法在 facts 中水合的公司不能计入页面总数。
      SELECT h.jp_no, h.cap_amt, f.jpstatcode
      FROM hits h
      JOIN ${F} f ON f.slug = h.jp_no
    ),
    pg AS (
      SELECT e.jp_no FROM eligible e
      ORDER BY ${statusRankExpr('e.jpstatcode')} ASC, e.cap_amt DESC NULLS LAST, e.jp_no
      LIMIT ${lim} OFFSET ${off}
    )
    SELECT jsonb_build_object(
      'ntCode', ${lit},
      'total', (SELECT COUNT(*) FROM eligible),
      'companies', COALESCE((
        SELECT jsonb_agg(${companyJson} ORDER BY ${statusRankExpr('f.jpstatcode')} ASC, f.capamt DESC NULLS LAST, f.slug)
        FROM pg JOIN ${F} f ON f.slug = pg.jp_no
      ), '[]'::jsonb)
    )::text
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : null
}

// 公司视角:给定 jpNo,返回与之共享董事的其他公司(按共享人数排序、分页)。
// 隐私:共享董事明细只回姓名 + 双方各自职位,绝不返回 cmt_no 等证件号。
export async function lookupRelatedCompanies(jpNo, { limit, offset }) {
  const schema = sqlIdent(config.db.schema)
  const lit = sqlLiteral(jpNo)
  const lim = Math.max(0, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  const sql = `
    WITH src AS (
      -- 来源公司在册的(有效 cmt_no)董事 + 其在本公司的职位
      SELECT cmt_no, name_th, name_en, cmt_type_code AS src_type
      FROM ${schema}.director_index WHERE jp_no = ${lit}
    ),
    other AS (
      -- 这些董事在「其他公司」的任职(经 cmt_no 关联,cmt_no 仅用于内部 JOIN,不外泄)
      SELECT
        di.jp_no, di.company_name_th, di.company_name_en, di.province, di.company_status,
        di.cmt_no,
        COALESCE(di.name_th, s.name_th) AS name_th,
        COALESCE(di.name_en, s.name_en) AS name_en,
        s.src_type,
        di.cmt_type_code AS rel_type
      FROM ${schema}.director_index di
      JOIN src s ON s.cmt_no = di.cmt_no
      WHERE di.jp_no <> ${lit}
    ),
    grouped AS (
      SELECT
        jp_no,
        max(company_name_th)    AS company_name_th,
        max(company_name_en)    AS company_name_en,
        max(province)           AS province,
        max(company_status)     AS company_status,
        COUNT(DISTINCT cmt_no)  AS shared_count,
        jsonb_agg(DISTINCT jsonb_build_object(
          'nameTh',           name_th,
          'nameEn',           name_en,
          'positionInSource', src_type,
          'positionInRelated', rel_type
        )) AS shared_directors
      FROM other
      GROUP BY jp_no
    )
    SELECT jsonb_build_object(
      'company', (
        SELECT jsonb_build_object(
          'nameTh',  max(company_name_th),
          'nameEn',  max(company_name_en),
          'province', max(province),
          'status',  max(company_status)
        )
        FROM ${schema}.director_index WHERE jp_no = ${lit}
      ),
      'total', (SELECT COUNT(*) FROM grouped),
      'related', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'jpNo',            jp_no,
          'companyNameTh',   company_name_th,
          'companyNameEn',   company_name_en,
          'province',        province,
          'companyStatus',   company_status,
          'sharedCount',     shared_count,
          'sharedDirectors', shared_directors
        ) ORDER BY shared_count DESC, jp_no)
        FROM (
          SELECT * FROM grouped ORDER BY shared_count DESC, jp_no
          LIMIT ${lim} OFFSET ${off}
        ) page
      ), '[]'::jsonb)
    )::text
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : null
}

// ── 网络子图(共享董事关系图)──────────────────────────────
// 服务端 BFS 多级展开 + 全局去重 + maxNodes 上限 + 按每条边共享董事数 minShared 剪枝。
// 返回 nodes(含 degree=BFS 层级) + edges(最终节点集内「任意两点」的交叉边,非仅 BFS 树边)。隐私:不回 cmt_no。
function sqlTextArray(arr) {
  return arr.length ? `ARRAY[${arr.map(sqlLiteral).join(',')}]::text[]` : `ARRAY[]::text[]`
}

// 给定一组源公司,返回经 >= minShared 条共享董事相连的邻居 [{jpNo, shared}](shared=与源集合中某一家的最大共享数)。
async function neighborsOf(schema, frontier, minShared) {
  const arr = sqlTextArray(frontier)
  const sql = `
    WITH src AS (SELECT jp_no, cmt_no FROM ${schema}.director_index WHERE jp_no = ANY(${arr})),
    pair AS (
      SELECT s.jp_no AS from_jp, di.jp_no AS to_jp, COUNT(DISTINCT di.cmt_no) AS shared
      FROM src s
      JOIN ${schema}.director_index di ON di.cmt_no = s.cmt_no AND di.jp_no <> s.jp_no
      GROUP BY s.jp_no, di.jp_no
      HAVING COUNT(DISTINCT di.cmt_no) >= ${minShared}
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('jpNo', to_jp, 'shared', shared) ORDER BY shared DESC), '[]'::jsonb)::text
    FROM (SELECT to_jp, MAX(shared) AS shared FROM pair GROUP BY to_jp) n
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : []
}

export async function lookupNetwork(jpNo, { depth, maxNodes, minShared }) {
  const schema = sqlIdent(config.db.schema)
  const degree = new Map([[jpNo, 0]])
  let frontier = [jpNo]
  let truncated = false

  for (let lvl = 1; lvl <= depth && degree.size < maxNodes && frontier.length; lvl++) {
    const neighbors = await neighborsOf(schema, frontier, minShared)  // 已按 shared 降序
    const next = []
    for (const nb of neighbors) {
      if (degree.has(nb.jpNo)) continue
      if (degree.size >= maxNodes) { truncated = true; break }
      degree.set(nb.jpNo, lvl)
      next.push(nb.jpNo)
    }
    if (degree.size >= maxNodes && neighbors.some(nb => !degree.has(nb.jpNo))) truncated = true
    frontier = next
  }

  const nodeIds = [...degree.keys()]
  const arr = sqlTextArray(nodeIds)

  // 节点展示字段 + 最终节点集内的全部交叉边(a.jp_no < b.jp_no 去无向重复)
  const [nodeRows, edgeRows] = await Promise.all([
    runPsql(`
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'jpNo', jp_no, 'nameTh', name_th, 'nameEn', name_en, 'province', province, 'status', status
      )), '[]'::jsonb)::text
      FROM (
        SELECT jp_no,
          max(company_name_th) AS name_th, max(company_name_en) AS name_en,
          max(province) AS province, max(company_status) AS status
        FROM ${schema}.director_index WHERE jp_no = ANY(${arr}) GROUP BY jp_no
      ) q
    `).then(s => JSON.parse(s.trim() || '[]')),
    runPsql(`
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'source', src, 'target', tgt, 'sharedCount', shared, 'sharedDirectors', dirs
      )), '[]'::jsonb)::text
      FROM (
        SELECT a.jp_no AS src, b.jp_no AS tgt, COUNT(DISTINCT a.cmt_no) AS shared,
          jsonb_agg(DISTINCT jsonb_build_object('nameTh', a.name_th, 'nameEn', a.name_en)) AS dirs
        FROM ${schema}.director_index a
        JOIN ${schema}.director_index b ON a.cmt_no = b.cmt_no AND a.jp_no < b.jp_no
        WHERE a.jp_no = ANY(${arr}) AND b.jp_no = ANY(${arr})
        GROUP BY a.jp_no, b.jp_no
        HAVING COUNT(DISTINCT a.cmt_no) >= ${minShared}
      ) e
    `).then(s => JSON.parse(s.trim() || '[]')),
  ])

  // 合并节点字段 + degree(确保每个 BFS 节点都在,缺字段则置空,如根公司无在册董事)
  const fieldsByJp = new Map(nodeRows.map(r => [r.jpNo, r]))
  const nodes = nodeIds.map(jp => {
    const f = fieldsByJp.get(jp) || { jpNo: jp, nameTh: null, nameEn: null, province: null, status: null }
    return { ...f, degree: degree.get(jp) }
  })

  return { nodes, edges: edgeRows, truncated }
}

// 公开「认领状态」:某企业(jpNo=slug)是否已被认领并经管理员批准。
// 批准会把 cms_content_entries.owner_id 置为所有者 id;此处只回布尔(owner_id IS NOT NULL),
// 不暴露所有者身份,供前端对所有访客展示「已认证」徽章。
export async function lookupClaimStatus(jpNo) {
  const schema = sqlIdent(config.db.schema)
  const lit = sqlLiteral(jpNo)
  const sql = `
    SELECT COALESCE((
      SELECT (e.owner_id IS NOT NULL)
      FROM ${schema}.cms_content_entries e
      JOIN ${schema}.cms_content_models m ON m.id = e.content_model_id
      WHERE m.code = 'thaicompany' AND e.slug = ${lit} AND e.deleted_at IS NULL
      LIMIT 1
    ), false)::text
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout === 't' || stdout === 'true'
}

// 健康/索引状态:读取 build meta。
export async function indexMeta() {
  const schema = sqlIdent(config.db.schema)
  const sql = `
    SELECT jsonb_build_object(
      'builtAt', built_at,
      'totalRows', total_rows,
      'distinctPeople', distinct_people
    )::text
    FROM ${schema}.director_index_meta
    LIMIT 1
  `
  const stdout = (await runPsql(sql)).trim()
  return stdout ? JSON.parse(stdout) : null
}
