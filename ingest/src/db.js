// DB 访问:pg 连接池直写 woocms.cms_content_entries.meta_json(与 directors/resolver sidecar 同手法;
// 直接写 meta_json 是本项目既定做法,见 sync/direct_import.py 批量 INSERT 与 sync/backfill_zh.py 的
// `meta_json || patch` 精准合并)。本文件所有写都以 slug(=jpno)唯一键定位,天然幂等、毫秒级。
import pg from 'pg'
import { config } from './config.js'

const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  max: 6,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'dbd-ingest',
})
// 空闲连接被 PG 端断开会 emit 'error';不监听会被升级为 uncaughtException 杀进程(配合
// Restart=always 变 crash-loop)。见 directors/src/db.js 同处理。
pool.on('error', err => console.error('[ingest] 空闲连接错误(已忽略):', err.message))

const SCHEMA = `"${String(config.db.schema).replace(/"/g, '""')}"`
const T_ENTRIES = `${SCHEMA}.cms_content_entries`
const T_TERMS = `${SCHEMA}.cms_custom_terms`
const T_ENTRY_TERMS = `${SCHEMA}.cms_content_entry_terms`
const T_BATCHES = `${SCHEMA}.dbd_sync_batches`
const T_BATCH_ITEMS = `${SCHEMA}.dbd_sync_batch_items`

const { siteId: SITE, modelId: MODEL, authorId: AUTHOR, taxProvince: TAX_PROV, taxCompanytype: TAX_CTYPE } = config

// ── 工具 ────────────────────────────────────────────────
export async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok')
  return rows[0]?.ok === 1
}

// 单条写用的 summary:与 sync/mapping.short_summary 同口径(可搜索文本)
function shortSummary(meta) {
  const parts = [meta.jpnamee, meta.jpno, meta.statuszh || meta.status, meta.province]
  if (meta.capamt) parts.push(`ทุน ${meta.capamt}`)
  return parts.filter(v => v != null && v !== '').map(String).join(' · ').slice(0, 255)
}

// PostgreSQL 的 text/jsonb 不接受 NUL();采集数据偶有脏 NUL,统一剥除
const stripNul = s => (typeof s === 'string' ? s.replace(/\u0000/g, '') : s)

// ── 批次幂等:领用/回放/收尾 ─────────────────────────────
// 返回 { claimed:true } 表示本次领用可处理;{ replay:<存储结果> } 表示已 completed,直接回放。
async function claimBatch(client, batchId, kind, source) {
  const ins = await client.query(
    `INSERT INTO ${T_BATCHES} (batch_id, kind, status, source, started_at)
     VALUES ($1,$2,'processing',$3, now())
     ON CONFLICT (batch_id) DO NOTHING
     RETURNING batch_id`,
    [batchId, kind, source || null]
  )
  if (ins.rows.length) return { claimed: true }
  const cur = await client.query(`SELECT * FROM ${T_BATCHES} WHERE batch_id = $1`, [batchId])
  const row = cur.rows[0]
  if (row && row.status === 'completed') return { replay: batchSummary(row) }
  // processing/failed(上次崩溃)→ 重新领用,幂等重跑;kind 不一致则拒绝
  if (row && row.kind !== kind) {
    return { error: { code: 'batch_kind_mismatch', message: `batch_id ${batchId} 已作为 ${row.kind} 使用` } }
  }
  await client.query(`UPDATE ${T_BATCHES} SET status='processing', started_at=now(), finished_at=NULL WHERE batch_id=$1`, [batchId])
  return { claimed: true }
}

async function finishBatch(client, batchId, counts, errors) {
  await client.query(
    `UPDATE ${T_BATCHES} SET status='completed',
       received_count=$2, inserted_count=$3, updated_count=$4, patched_count=$5,
       skipped_count=$6, conflict_count=$7, missing_count=$8, failed_count=$9,
       error_json=$10, finished_at=now()
     WHERE batch_id=$1`,
    [batchId, counts.received, counts.inserted, counts.updated, counts.patched,
     counts.skipped, counts.conflict, counts.missing, counts.failed,
     errors.length ? JSON.stringify(errors.slice(0, 100)) : null]
  )
}

async function recordItem(client, batchId, jpno, action, entryId, oldDate, oldHash, error) {
  await client.query(
    `INSERT INTO ${T_BATCH_ITEMS} (batch_id, jpno, action, entry_id, old_source_update_date, old_content_hash, error, processed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (batch_id, jpno) DO UPDATE SET
       action=EXCLUDED.action, entry_id=EXCLUDED.entry_id,
       old_source_update_date=EXCLUDED.old_source_update_date,
       old_content_hash=EXCLUDED.old_content_hash, error=EXCLUDED.error, processed_at=now()`,
    [batchId, jpno, action, entryId || null, oldDate || null, oldHash || null, error || null]
  )
}

function batchSummary(row) {
  return {
    batch_id: row.batch_id,
    kind: row.kind,
    status: row.status,
    source: row.source,
    received: row.received_count,
    inserted: row.inserted_count,
    updated: row.updated_count,
    patched: row.patched_count,
    skipped: row.skipped_count,
    conflict: row.conflict_count,
    missing: row.missing_count,
    failed: row.failed_count,
    errors: row.error_json || [],
    started_at: row.started_at,
    finished_at: row.finished_at,
  }
}

// ── 建模:关联 province / companytype term(复刻 sync/direct_import.link_terms)──
// 缺失 term 先补建(slug = prefix||md5(name)[:10],与 woocms._slugify 同口径),再插 entry_terms。
async function linkTerm(client, entryId, tax, name, prefix, isPrimary) {
  if (!name) return
  await client.query(
    `INSERT INTO ${T_TERMS} (site_id, taxonomy_id, name, slug, sort_order, status, created_at, updated_at)
     SELECT $1, $2, $3, $4 || substr(md5($3), 1, 10), 0, 'active', now(), now()
     WHERE NOT EXISTS (SELECT 1 FROM ${T_TERMS} WHERE taxonomy_id=$2 AND name=$3)
     ON CONFLICT DO NOTHING`,
    [SITE, tax, name, prefix]
  )
  await client.query(
    `INSERT INTO ${T_ENTRY_TERMS} (site_id, entry_id, taxonomy_id, term_id, is_primary, created_at)
     SELECT $1, $2, $3, t.id, $4, now()
     FROM ${T_TERMS} t WHERE t.taxonomy_id=$3 AND t.name=$5
     ON CONFLICT DO NOTHING`,
    [SITE, entryId, tax, isPrimary, name]
  )
}

// ── A. manifest 查询 ───────────────────────────────────
// 输入 jpnos[](=slug),返回每个的 exists/entry_id/source_update_date/content_hash/updated_at。
export async function queryManifest(jpnos) {
  const uniq = [...new Set(jpnos)]
  const { rows } = await pool.query(
    `SELECT slug AS jpno, id AS entry_id,
            meta_json->>'updatedate' AS source_update_date,
            meta_json #>> '{_sync,content_hash}' AS content_hash,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at
     FROM ${T_ENTRIES}
     WHERE site_id=$1 AND content_model_id=$2 AND deleted_at IS NULL
       AND slug = ANY($3::text[])`,
    [SITE, MODEL, uniq]
  )
  const found = new Map(rows.map(r => [r.jpno, r]))
  return jpnos.map(jpno => {
    const r = found.get(jpno)
    if (!r) return { jpno, exists: false }
    return {
      jpno, exists: true, entry_id: Number(r.entry_id),
      source_update_date: r.source_update_date,
      content_hash: r.content_hash, updated_at: r.updated_at,
    }
  })
}

// ── 校验闸门:payload 必须是"成品"形状(展平字段 + i18n),不能是把 raw 详情对象
// 直接当 entry.meta_json 发过来(2026-07-04 事故:这种畸形 payload 曾把一条好记录整体
// 覆盖成空壳 —— jpname/jpnamee/province/i18n 全空,且没有任何报错)。
// 只认 jpname(泰文名,DBD 数据里恒有)+ i18n 对象;jpnamee(英文名)允许缺(沿用 sync.py
// 的 draft 门控惯例,详情/富集补录前本就可能没有英文名)。
function hasDisplayShape(meta) {
  const jpname = String(meta?.jpname ?? '').trim()
  const i18n = meta?.i18n
  return Boolean(jpname) && i18n !== null && typeof i18n === 'object' && !Array.isArray(i18n)
}

// ── B. upsert 完整企业(mode=upsert_if_newer)──────────────
// 逐条以 slug 唯一键 INSERT ... ON CONFLICT DO NOTHING RETURNING id;命中已存在则按日期决定 update/skip/conflict。
export async function processUpsertBatch({ batchId, source, items, dryRun }) {
  const counts = { received: items.length, inserted: 0, updated: 0, patched: 0, skipped: 0, conflict: 0, missing: 0, failed: 0 }
  const errors = []
  const perItem = []

  // dry_run:只按现状分类,不写、不记日志
  if (dryRun) {
    const manifest = new Map((await queryManifest(items.map(i => i.jpno))).map(m => [m.jpno, m]))
    for (const it of items) {
      const meta = { ...(it.entry?.meta_json || {}) }
      let action
      if (!hasDisplayShape(meta)) {
        action = 'rejected_invalid_shape'
      } else {
        const m = manifest.get(it.jpno)
        if (!m || !m.exists) action = 'inserted'
        else if ((it.source_update_date || '') > (m.source_update_date || '')) action = 'updated'
        else if ((it.source_update_date || '') === (m.source_update_date || '') && it.content_hash && it.content_hash !== m.content_hash)
          action = config.conflictPolicy === 'overwrite' ? 'updated' : 'conflict_same_date_changed'
        else action = 'skipped_not_newer'
      }
      bump(counts, action)
      perItem.push({ jpno: it.jpno, action })
    }
    return { dryRun: true, ...summarize(counts), items: perItem, errors }
  }

  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${config.statementTimeoutMs}`)
    const claim = await claimBatch(client, batchId, 'upsert', source)
    if (claim.replay) return { replayed: true, ...claim.replay }
    if (claim.error) return { error: claim.error }

    for (const it of items) {
      try {
        const action = await upsertOne(client, it, batchId, source)
        bump(counts, action)
        if (action === 'rejected_invalid_shape') {
          errors.push({ jpno: it.jpno, error: 'invalid_payload_shape: meta_json 缺少 jpname 或 i18n,疑似把 raw 详情对象直接当 meta_json 发送,已拒绝写入(未新建/未覆盖)' })
        }
      } catch (e) {
        counts.failed++
        errors.push({ jpno: it.jpno, error: String(e.message || e).slice(0, 300) })
        await recordItem(client, batchId, it.jpno, 'failed', null, null, null, String(e.message || e).slice(0, 300)).catch(() => {})
      }
    }
    await finishBatch(client, batchId, counts, errors)
  } finally {
    try { await client.query('SET statement_timeout = 0') } catch { /* ignore */ }
    client.release()
  }
  return summarizeUpsert(batchId, counts, errors)
}

async function upsertOne(client, it, batchId, source) {
  const meta = { ...(it.entry?.meta_json || {}) }
  meta.jpno = it.jpno                       // 以顶层 jpno 为准(= slug)

  // 闸门:形状不对(缺 jpname/i18n,像是把 raw 详情对象直接当 meta_json 发送)一律拒绝,
  // 不新建、不覆盖已有记录 —— 在任何 INSERT/UPDATE 之前拦下,不留半写状态。
  if (!hasDisplayShape(meta)) {
    await recordItem(client, batchId, it.jpno, 'rejected_invalid_shape', null, null, null,
      'meta_json 缺少 jpname 或 i18n,已拒绝写入')
    return 'rejected_invalid_shape'
  }

  meta._sync = syncMeta(it, source, batchId)
  const title = stripNul(it.entry?.title || meta.jpname || it.jpno)
  const summary = stripNul(it.entry?.summary || shortSummary(meta))
  const status = it.entry?.status === 'published' || (!it.entry?.status && (meta.jpnamee || '').trim())
    ? 'published' : (it.entry?.status || 'draft')
  // 独立的 published_at 参数:避免把 status 参数复用到「varchar 列赋值」+「= 'published' 比较」
  // 两种类型上下文,否则 pg 报 "inconsistent types deduced for parameter"。
  const publishedAt = status === 'published' ? new Date() : null
  const metaText = stripNul(JSON.stringify(meta))

  await client.query('BEGIN')
  try {
    const ins = await client.query(
      `INSERT INTO ${T_ENTRIES}
         (site_id, content_model_id, title, slug, summary, body, status, published_at,
          author_id, meta_json, created_at, updated_at, access_mode, required_capability)
       VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9::jsonb, now(), now(), 'public','')
       ON CONFLICT (site_id, content_model_id, slug) DO NOTHING
       RETURNING id`,
      [SITE, MODEL, title, it.jpno, summary, status, publishedAt, AUTHOR, metaText]
    )

    if (ins.rows.length) {
      const entryId = Number(ins.rows[0].id)
      await linkTerm(client, entryId, TAX_PROV, meta.province, 'prov', true)
      await linkTerm(client, entryId, TAX_CTYPE, meta.jptypedesc, 'ctype', false)
      await recordItem(client, batchId, it.jpno, 'inserted', entryId, null, null, null)
      await client.query('COMMIT')
      return 'inserted'
    }

    // 已存在:取旧 updatedate / content_hash 决定 update/skip/conflict
    const cur = await client.query(
      `SELECT id, meta_json->>'updatedate' AS old_date, meta_json #>> '{_sync,content_hash}' AS old_hash
       FROM ${T_ENTRIES}
       WHERE site_id=$1 AND content_model_id=$2 AND slug=$3 FOR UPDATE`,
      [SITE, MODEL, it.jpno]
    )
    const row = cur.rows[0]
    const entryId = Number(row.id)
    const oldDate = row.old_date || ''
    const oldHash = row.old_hash || null
    const inDate = it.source_update_date || ''

    let action
    if (inDate > oldDate) {
      await client.query(
        `UPDATE ${T_ENTRIES}
            SET meta_json=$2::jsonb, title=$3, summary=$4,
                status = CASE WHEN $5='published' THEN 'published' ELSE status END,
                published_at = CASE WHEN $5='published' AND published_at IS NULL THEN now() ELSE published_at END,
                updated_at = now()
          WHERE id=$1`,
        [entryId, metaText, title, summary, status]
      )
      action = 'updated'
    } else if (inDate === oldDate && it.content_hash && it.content_hash !== oldHash && config.conflictPolicy === 'overwrite') {
      await client.query(`UPDATE ${T_ENTRIES} SET meta_json=$2::jsonb, updated_at=now() WHERE id=$1`, [entryId, metaText])
      action = 'updated'
    } else if (inDate === oldDate && it.content_hash && it.content_hash !== oldHash) {
      action = 'conflict_same_date_changed'
    } else {
      action = 'skipped_not_newer'
    }
    await recordItem(client, batchId, it.jpno, action, entryId, oldDate || null, oldHash, null)
    await client.query('COMMIT')
    return action
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// ── C. 补采字段合并(mode=merge_patch_fields)—— 126M 补采主力 ──
// UPDATE ... SET meta_json = meta_json || patch::jsonb;patch 只含传入字段 + _patch_meta(不写 _sync)。
// 顶层浅合并自动保留 profile/raw/i18n/_sync 等一切未传字段。命中 0 行 → missing_company。
// 2026-07-04:新增 jpNationCharts(泰国/外国汇总图表),基础财务图表 basicFinCharts。
// 2026-07-04:新增 capamt(注册资本标量,number,来源 raw.profile.capAmt)——注意小写,
// 这是正常 upsert 展平字段已在用的键名;不能是驼峰 capAmt,否则会另开一个没人读的字段
// (今天稍早出过这个命名不一致的事故)。
const PATCH_FIELDS = ['nameHists', 'capitalHists', 'jpNationCharts', 'basicFinCharts', 'extSecLic', 'capamt']

// resolver/theme.js 的国籍饼图读的是 meta_json.raw.jpNations(嵌套),不是顶层 meta_json.jpNations——
// 跟上面这批"补采即读顶层"的字段不是同一套约定(committees/signCommittees 同理,也读 raw.*)。
// jpNations 曾经误放进顶层 PATCH_FIELDS(写了但没人读,2026-07-04 发现并改到这里)。
// 这里列的字段会安全合并进 meta_json.raw.<key>,不覆盖 raw 的其他内容。
// 2026-07-04:新增 extTrademarks(DBD 商标资料,源接口 POST /api/v1/company-profiles/ext/tms,
// 对方解密后落 raw.extTrademarks;数组,单条形如 {tr_no/reg_no/fil_date/reg_date/exp_date/status/pic/product[]}),
// 与 jpNations 同一套约定,只安全合并 raw.extTrademarks 这一个 key,不动 raw 其他字段。
const RAW_PATCH_FIELDS = ['jpNations', 'extTrademarks']

export async function processPatchBatch({ batchId, source, items, dryRun }) {
  const counts = { received: items.length, inserted: 0, updated: 0, patched: 0, skipped: 0, conflict: 0, missing: 0, failed: 0 }
  const errors = []
  const perItem = []

  if (dryRun) {
    const manifest = new Map((await queryManifest(items.map(i => i.jpno))).map(m => [m.jpno, m]))
    for (const it of items) {
      const m = manifest.get(it.jpno)
      const action = m && m.exists ? 'patched' : 'missing_company'
      bump(counts, action)
      perItem.push({ jpno: it.jpno, action })
    }
    return { dryRun: true, ...summarize(counts), items: perItem, errors }
  }

  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${config.statementTimeoutMs}`)
    const claim = await claimBatch(client, batchId, 'patch_fields', source)
    if (claim.replay) return { replayed: true, ...claim.replay }
    if (claim.error) return { error: claim.error }

    for (const it of items) {
      try {
        const action = await patchOne(client, it, batchId, source)
        bump(counts, action)
      } catch (e) {
        counts.failed++
        errors.push({ jpno: it.jpno, error: String(e.message || e).slice(0, 300) })
        await recordItem(client, batchId, it.jpno, 'failed', null, null, null, String(e.message || e).slice(0, 300)).catch(() => {})
      }
    }
    await finishBatch(client, batchId, counts, errors)
  } finally {
    try { await client.query('SET statement_timeout = 0') } catch { /* ignore */ }
    client.release()
  }
  return summarizePatch(batchId, counts, errors)
}

async function patchOne(client, it, batchId, source) {
  const fields = it.fields || {}
  // 只取传入且已知的补采字段(缺失字段不进 patch → 原字段不动;[]/{} 照写表示源站确认无数据)
  const patch = {}
  for (const k of PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) patch[k] = fields[k]
  }
  const rawPatch = {}
  for (const k of RAW_PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) rawPatch[k] = fields[k]
  }
  patch._patch_meta = {
    patch_fields_version: config.patchFieldsVersion,
    patch_fields: [...Object.keys(patch).filter(k => k !== '_patch_meta'), ...Object.keys(rawPatch)],
    patch_source: source || 'dbd-backfill-patches',
    patch_batch_id: batchId,
    patch_collected_at: it.patch_collected_at || null,
    jp_type_code: it.jpTypeCode || null,
  }
  // 注意:不写 _sync —— 补采包不带 content_hash,顶层 `||` 浅合并会整体替换 _sync 键,
  // 会把上一次完整 upsert 存的 _sync.content_hash(manifest 用)抹成 null。补采出处只记在 _patch_meta。
  const patchText = stripNul(JSON.stringify(patch))
  const rawPatchText = stripNul(JSON.stringify(rawPatch))

  // 取旧值(供审计回滚),再合并
  const cur = await client.query(
    `SELECT id, meta_json->>'updatedate' AS old_date, meta_json #>> '{_sync,content_hash}' AS old_hash
     FROM ${T_ENTRIES}
     WHERE site_id=$1 AND content_model_id=$2 AND deleted_at IS NULL AND slug=$3`,
    [SITE, MODEL, it.jpno]
  )
  if (!cur.rows.length) {
    await recordItem(client, batchId, it.jpno, 'missing_company', null, null, null, null)
    return 'missing_company'
  }
  const row = cur.rows[0]
  if (Object.keys(rawPatch).length) {
    // 顶层浅合并(patch) + raw 子路径浅合并(rawPatch)一条 UPDATE 原子完成;
    // raw 内部同样是浅合并(coalesce(...) || rawPatch),只动 rawPatch 传入的 key,不碰 raw 其他内容。
    await client.query(
      `UPDATE ${T_ENTRIES}
         SET meta_json = jsonb_set(
               meta_json || $2::jsonb,
               '{raw}',
               coalesce(meta_json->'raw', '{}'::jsonb) || $3::jsonb,
               true
             ),
             updated_at = now()
       WHERE id=$1`,
      [Number(row.id), patchText, rawPatchText]
    )
  } else {
    await client.query(
      `UPDATE ${T_ENTRIES} SET meta_json = meta_json || $2::jsonb, updated_at=now()
       WHERE id=$1`,
      [Number(row.id), patchText]
    )
  }
  await recordItem(client, batchId, it.jpno, 'patched', Number(row.id), row.old_date || null, row.old_hash || null, null)
  return 'patched'
}

// ── D. 批次状态查询 ───────────────────────────────────
export async function getBatchStatus(batchId) {
  const { rows } = await pool.query(`SELECT * FROM ${T_BATCHES} WHERE batch_id=$1`, [batchId])
  return rows.length ? batchSummary(rows[0]) : null
}

// ── 内部小工具 ────────────────────────────────────────
function syncMeta(it, source, batchId) {
  return {
    content_hash: it.content_hash || null,
    source: source || null,
    batch_id: batchId,
    // 入库时间戳由 DB 侧统一,避免应用时钟漂移;此处仅留标记
    updated_via: 'ingest',
  }
}

function bump(counts, action) {
  if (action === 'inserted') counts.inserted++
  else if (action === 'updated') counts.updated++
  else if (action === 'patched') counts.patched++
  else if (action === 'conflict_same_date_changed') counts.conflict++
  else if (action === 'missing_company') counts.missing++
  else if (action === 'skipped_not_newer') counts.skipped++
  else if (action === 'failed') counts.failed++
  else if (action === 'rejected_invalid_shape') counts.failed++  // 计入 failed,复用既有的失败监控通道
}

function summarize(counts) {
  return {
    received: counts.received, inserted: counts.inserted, updated: counts.updated,
    patched: counts.patched, skipped_not_newer: counts.skipped, conflict_same_date_changed: counts.conflict,
    missing_company: counts.missing, failed: counts.failed,
  }
}

function summarizeUpsert(batchId, counts, errors) {
  return {
    batch_id: batchId, received: counts.received, inserted: counts.inserted,
    updated: counts.updated, skipped_not_newer: counts.skipped,
    conflict_same_date_changed: counts.conflict, failed: counts.failed, errors,
  }
}

function summarizePatch(batchId, counts, errors) {
  return {
    batch_id: batchId, received: counts.received, patched: counts.patched,
    missing_company: counts.missing, skipped: counts.skipped, failed: counts.failed, errors,
  }
}

export { pool }
