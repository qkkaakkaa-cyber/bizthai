// 工具层:给 DeepSeek 的「工具」清单(OpenAI function 格式)+ 执行器。
// execTool 返回 { llm, cards }:
//   llm   —— 回灌给模型的结构化结果(精简,控 token)
//   cards —— 推给前端 UI 的公司卡(可点击跳详情),与模型文本并行展示
import {
  getEntry, resolveProvince, topCompaniesByProvince, browseCompanyList,
  marketSnapshot, rankCompanies, foreignComposition,
  relatedCompanies, searchDirectors, companiesByNationality,
} from './sources.js'

// 纯英文名 URL(与 theme.js companyHref 完全一致):有英文名→/<slug>.html,否则→/<jpno>.html
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}
function companyHref(jpno, enName) {
  const s = slugify(enName)
  if (s) return `/${s}.html`
  if (jpno) return `/${encodeURIComponent(String(jpno))}.html`
  return ''
}

// 把一条记录整形成前端卡片 + 模型精简行。两种来源形态:
//   entries 项:扁平 meta(jpnamee/provincee/capamt…)
//   analytics/directors 项:name/province/business/status 为 {th,en,zh} 对象
function toCard(src) {
  const m = src && src.meta
  if (m) {
    const jpno = String(m.jpno || src.slug || '')
    const nameEn = m.jpnamee || src.title || jpno
      return {
        jpno,
        nameEn,
        nameTh: m.jpname || '',
        nameZh: m.jpnamezh || '',
        provinceEn: m.provincee || '',
        provinceTh: m.province || '',
        provinceZh: m.provincezh || '',
        capital: m.capamt != null ? m.capamt : null,
        status: m.jpstatdesce || m.jpstatdesc || '',
        business: m.setupobjdesce || m.businesstypedesce || '',
        updatedAt: entryDate(src, m),
        href: companyHref(jpno, nameEn),
      }
  }
  const s = src || {}
  const name = s.name || {}
  const prov = s.province || {}
  const biz = s.business || {}
  const stat = s.status || {}
  const jpno = String(s.code || s.jpno || s.slug || s.id || '')
  const nameEn = name.en || name.th || s.jpnamee || jpno
  return {
    jpno,
    nameEn,
    nameTh: name.th || '',
    nameZh: name.zh || '',
    provinceEn: prov.en || '',
    provinceTh: prov.th || '',
    provinceZh: prov.zh || '',
    capital: s.capital != null ? s.capital : (s.capamt != null ? s.capamt : null),
    status: stat.en || stat.th || '',
    business: biz.en || biz.th || '',
    updatedAt: s.updatedAt || s.updated_at || s.updatedate || s.publishedAt || s.published_at || '',
    href: companyHref(jpno, nameEn),
  }
}
function entryDate(src, meta = {}) {
  return src.updated_at || src.updatedAt || meta.updatedate || src.published_at || src.publishedAt || src.created_at || src.createdAt || ''
}
function llmRow(card) {
  return { name: card.nameEn, jpno: card.jpno, province: card.provinceEn, capital: card.capital, status: card.status, business: card.business }
}

// 喂给模型的财务口径。与 resolver/src/server.js 的 SSR 财务卡片保持同源(raw.financialStatements),
// 避免模型讲出的数字和用户在页面上看到的对不上。2026-07-23 加,详见调用处注释。
// DBD 数据每年都预置一整套字段(占位年份的值全是 null),所以不能用「有没有 key」判断该年有无数据,
// 必须检查营收/利润/资产这三个头条字段至少一个是真实数字——判定规则与 resolver 的 FS_HEADLINE_FIELDS 一致。
function financialsForLLM(raw, m) {
  const num = (v) => { const n = Number(v); return (v == null || v === '' || Number.isNaN(n)) ? null : n }
  const fs = (raw && raw.financialStatements) || {}
  const annual = fs.annualData || {}
  const years = Array.isArray(fs.years) ? fs.years.map(String).sort().reverse() : []
  const latest = years.find(y => {
    const rec = annual[y]
    return !!rec && ['revenue', 'profitloss', 'assets'].some(f => num(rec[f]) != null)
  })
  if (latest) {
    const r = annual[latest] || {}
    return {
      fiscalYear: latest,
      totalIncome: r.revenue, netProfit: r.profitloss, netProfitMargin: r.netProfitMargin,
      totalAsset: r.assets, totalEquity: r.equity,
      returnOnEquity: r.returnOnEquity, returnOnAsset: r.returnOnAsset,
      currentRatio: r.currentRatio, debtToEquity: r.debtToEquity,
      incomeGrowth: r.revenuePc, profitGrowth: r.profitlossPc,
    }
  }
  // 回落:无 financialStatements 结构时用遗留扁平字段(此时 resolver SSR 也走同一组字段的兜底分支)
  return {
    fiscalYear: m.finyear || m.fiscalyear,
    totalIncome: m.totalincome, netProfit: m.netprofit, netProfitMargin: m.netprofitmargin,
    totalAsset: m.totalasset, totalEquity: m.totalequity,
    returnOnEquity: m.returnonequity, returnOnAsset: m.returnonasset,
    currentRatio: m.currentratio, debtToEquity: m.debttoequity,
    incomeGrowth: m.totalincomepctgrowth, profitGrowth: m.netprofitpctgrowth,
  }
}

// ── 工具清单(交给 DeepSeek) ─────────────────────────────
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_companies',
      description: 'Search registered Thai companies, optionally by free-text keyword (company name, registration number, director name or industry words), optionally filtered by province, and sorted. Use this whenever the user is looking for companies matching some criteria. To list the top companies of a province with no text query, pass only province + sort and OMIT keyword entirely (do not pass a blank/space keyword).',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'OPTIONAL free-text query, e.g. "food export", "logistics", a company name or a registration number. MUST be ENGLISH or Thai — NEVER Chinese: the data is indexed in Thai/English only. For a generic industry/product term, translate to English first (物流→logistics). For a specific company/brand/shop name (a proper noun), English is unreliable — many small Thai businesses have no English name on file at all — so if an English/romanized name search returns nothing, retry once with a Thai-script transliteration of the name before reporting no match. Omit entirely when filtering only by province/criteria.' },
          province: { type: 'string', description: 'Optional province name in any language (e.g. "Bangkok", "Chonburi", "曼谷", "ชลบุรี").' },
          sort: { type: 'string', enum: ['capital', 'newest', 'relevance'], description: 'capital = largest registered capital first; newest = most recently registered first; relevance = best keyword match (default).' },
          limit: { type: 'integer', description: 'How many companies to return (default 10, max 20).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_company',
      description: 'Get the full profile of ONE company by its registration number (jpno): names, status, registration, address, capital, business scope, financial figures (revenue, net profit, assets, equity, ratios) and directors. Use for deep questions about a specific company.',
      parameters: {
        type: 'object',
        properties: { jpno: { type: 'string', description: 'The 13-digit company registration number (jpno).' } },
        required: ['jpno'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'company_relations',
      description: 'Find companies related to a given company through shared directors/board members. Useful for mapping a corporate group, potential partners or affiliated entities.',
      parameters: {
        type: 'object',
        properties: { jpno: { type: 'string', description: 'The company registration number (jpno) to expand from.' } },
        required: ['jpno'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_person',
      description: 'Look up a director / board member by name, and list the companies they are associated with. Use for "who is behind X" or "what else does this person run". Does not support lookup by passport/national-ID number.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A person name (>=3 chars).' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'market_snapshot',
      description: 'Get an aggregate market snapshot of Thai company registrations: totals, average capital, province ranking, foreign-capital share, registrations by year, top business types and statuses. Optionally scope to one province. Use for market/industry/regional insight questions.',
      parameters: {
        type: 'object',
        properties: { province: { type: 'string', description: 'Optional province name to scope the snapshot to (any language).' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rank_companies',
      description: 'Get a ranked list of companies across the whole dataset by registered capital (largest) or by registration date (newest). Use for "biggest companies" / "newest companies" questions.',
      parameters: {
        type: 'object',
        properties: {
          by: { type: 'string', enum: ['capital', 'newest'], description: 'Ranking dimension.' },
          limit: { type: 'integer', description: 'How many to return (default 10, max 20).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'foreign_companies',
      description: 'Show the composition of foreign-capital companies, or list companies tied to a specific foreign nationality. Use for foreign-investment questions.',
      parameters: {
        type: 'object',
        properties: {
          countryCode: { type: 'string', description: 'Optional ISO-like country code (e.g. "CN", "JP", "US"). Omit to get the overall foreign-capital composition / top origin countries.' },
        },
      },
    },
  },
]

const clampLimit = (n, d, max) => Math.max(1, Math.min(Number(n) || d, max))

// ── 执行器 ───────────────────────────────────────────────
export async function execTool(name, args = {}) {
  switch (name) {
    case 'search_companies': {
      // 索引安全架构(数据将达数百万):
      //   · 排名/排序(资本·注册时间)→ 物化视图 thaicompany_facts(真实列+btree,毫秒级):
      //       有府 → analytics /top-companies;无府 → analytics /business/companies(全国)。
      //   · 关键词文本检索 → WooCMS 全文(entries keyword,自带索引),绝不叠加 jsonb capamt 排序。
      // 永不对 jsonb meta 字段做(子)表排序 —— 那是 34 万行就 35s、数百万必卡死的路径。
      const limit = clampLimit(args.limit, 8, 24)
      const kw = String(args.keyword || '').trim()
      const prov = args.province ? await resolveProvince(args.province) : null
      const by = args.sort === 'newest' ? 'reg_date_desc' : 'capital_desc'

      // _search:给搜索页分页用的「AI 解析后」检索参数(keyword 已翻译、府已解析成 slug)
      const _search = { keyword: kw, provinceSlug: prov ? prov.slug : '' }

      if (!kw) {
        // 纯浏览/排名:走物化视图
        const data = prov
          ? await topCompaniesByProvince(prov.zh, by, limit)
          : await rankCompanies({ sort: by, limit })
        const cards = (data?.items || []).map(toCard)
        return { llm: { scope: prov ? args.province : 'Thailand (all)', basis: 'indexed view', sort: by, companies: cards.map(llmRow), _search }, cards }
      }

      // 有关键词:走 analytics company-list(与站点搜索同口径)。按名/注册号查找时
      // includeInactive=true,确保已解散公司仍能被精确命中;纯浏览/排行仍默认仅运营中。
      const data = await browseCompanyList({
        keyword: kw,
        provinceSlug: prov ? prov.slug : '',
        limit,
        includeInactive: true,
      })
      const cards = (data.items || []).map(toCard)
      return { llm: { total: data.total ?? cards.length, returned: cards.length, keyword: kw, province_filter: prov ? args.province : null, companies: cards.map(llmRow), _search }, cards }
    }
    case 'get_company': {
      const entry = await getEntry(args.jpno)
      if (!entry) return { llm: { error: 'company_not_found', jpno: args.jpno } }
      const m = entry.meta || {}
      const raw = m.raw || {}
      const card = toCard({ meta: m, title: entry.title, updated_at: entry.updated_at })
      // 董事名:用真实字段(firstNameE/lastNameE 驼峰)拼干净英文名,回退泰文名;
      // 旧代码用 c.cmtname/c.firstname(小写)取不到→整个对象漏给模型→诱发音译瞎编中文名
      const cleanName = s => String(s || '').replace(/[\/\\,]+\s*$/, '').trim()
      const directors = Array.isArray(raw.committees)
        ? raw.committees.slice(0, 15).map(c => {
            if (!c || typeof c !== 'object') return cleanName(c)
            const en = [c.firstNameE, c.middleNameE, c.lastNameE].map(cleanName).filter(Boolean).join(' ')
            const th = [c.firstName, c.middleName, c.lastName].map(cleanName).filter(Boolean).join(' ')
            return en || th || cleanName(c.cmtname || c.name || c.fullname) || null
          }).filter(Boolean)
        : []
      const llm = {
        identity: { nameEn: m.jpnamee, nameTh: m.jpname, nameZh: m.jpnamezh, jpno: m.jpno, type: m.jptypedesce || m.companytypee, status: m.jpstatdesce || m.jpstatdesc },
        record: { createdAt: entry.created_at || entry.createdAt || '', updatedAt: entry.updated_at || entry.updatedAt || '', publishedAt: entry.published_at || entry.publishedAt || '' },
        registration: { regdate: m.regdate, updatedate: m.updatedate, province: m.provincee, district: m.ampurdesce, address: m.addresse, zipcode: m.zipcode },
        business: { objective: m.setupobjdesce, group: m.businesstypedesce },
        // paidamt 有一批脏数据是源头(DBD/对端同步系统)32位有符号整数溢出出的负数,实缴资本不可能为负,
        // 出现负数时回退用注册资本估算,避免模型把荒谬负数原样讲给用户
        capital: { registered: m.capamt, paid: (Number(m.paidamt) < 0 ? m.capamt : m.paidamt) },
        // 电话/邮箱不再喂给模型:多是 DBD 抓取的股东/董事个人手机号/邮箱而非公司公开联系渠道,
        // AI 服务这一层拿不到"是否已被认领会员核验"的状态(那套判定只在 resolver SSR 里,见其 data-contact-* 注入),
        // 没法安全展示就一律不展示(2026-07-11 PDPA 投诉修复)。
        contact: { website: m.website1 || m.website2 },
        // 财务口径(2026-07-23 修复):原先直接读 m.totalincome/netprofit/totalasset/totalequity 这组
        // 遗留扁平字段——它们全项目 0 处写入(早期导入流程留下、已停更),而 m.finyear 仍由 sync 每日更新,
        // 于是模型拿到的是「新财年 + 旧金额」,和页面上方财务卡片(读 raw.financialStatements)对不上。
        // 用户看到 637,447 却问出 42,013 的情况就是这么来的。现与 resolver SSR 统一:优先取
        // financialStatements 中最新「有头条数据」的年份,结构缺失时才回落遗留字段。
        financials: financialsForLLM(raw, m),
        directors,
        href: card.href,
      }
      return { llm, cards: [card] }
    }
    case 'company_relations': {
      const data = await relatedCompanies(args.jpno, 12)
      const items = data?.items || data?.related || data?.companies || []
      const cards = items.map(toCard)
      return { llm: { jpno: args.jpno, count: cards.length, related: cards.map(llmRow) }, cards }
    }
    case 'lookup_person': {
      const data = await searchDirectors(args.query, 12)
      const items = data?.items || data?.results || data?.persons || []
      // 反查结果可能是「人」也可能直接是「公司」,统一抽公司卡
      const companies = []
      for (const it of items) {
        if (Array.isArray(it.companies)) for (const c of it.companies) companies.push(toCard(c))
        else companies.push(toCard(it))
      }
      const cards = companies.filter(c => c.jpno).slice(0, 20)
      return { llm: { query: args.query, matches: items.length, companies: cards.map(llmRow) }, cards }
    }
    case 'market_snapshot': {
      // 全国快照走 analytics 缓存(物化视图,毫秒级),不走慢的 jsonb 府聚合路径。
      const snap = await marketSnapshot('')
      if (!snap) return { llm: { error: 'snapshot_unavailable' } }
      const llm = {
        scope: 'Thailand (all)',
        total: snap.total,
        avgCapital: snap.avgCapital,
        foreignShare: snap.foreignShare,
        provinceRanking: (snap.provinceRanking || []).slice(0, 10).map(p => ({ province: p.province?.en || p.provinceKey, companies: p.companyCount, capital: p.registeredCapital })),
        foreignTop: (snap.foreignComposition?.top || []).slice(0, 8),
        newByYear: (snap.newCompaniesByYear || []).map(y => ({ year: y.year, companies: y.companyCount })),
        topBusinessTypes: (snap.businessTypes || []).slice(0, 8).map(b => ({ type: b.label?.en || b.key, count: b.count })),
        statuses: (snap.statuses || []).slice(0, 6).map(s => ({ status: s.label?.en || s.key, count: s.count })),
      }
      // 市场快照是「统计」工具,不推公司卡(避免在非清单问题里硬列公司)。
      // 模型需要时,数据仍在 llm 里(含某府 top,走物化视图);要列清单请改用 search_companies。
      if (args.province) {
        const prov = await resolveProvince(args.province)
        if (prov) {
          const pv = await topCompaniesByProvince(prov.zh, 'capital_desc', 6)
          const pvRows = (pv?.items || []).map(toCard).map(llmRow)
          if (pvRows.length) { llm.scope = args.province; llm.provinceTopByCapital = pvRows }
        }
      }
      return { llm }
    }
    case 'rank_companies': {
      const by = args.by === 'newest' ? 'reg_date_desc' : 'capital_desc'
      const limit = clampLimit(args.limit, 8, 10)
      const data = await rankCompanies({ sort: by, limit })
      const cards = (data?.items || []).map(toCard)
      return { llm: { by: args.by || 'capital', companies: cards.map(llmRow) }, cards }
    }
    case 'foreign_companies': {
      if (args.countryCode) {
        const data = await companiesByNationality(args.countryCode, 15)
        const items = data?.items || data?.companies || []
        const cards = items.map(toCard)
        return { llm: { countryCode: args.countryCode, total: data?.total ?? cards.length, companies: cards.map(llmRow) }, cards }
      }
      const data = await foreignComposition(12)
      return { llm: { foreignTotal: data?.foreignTotal, thaiTotal: data?.thaiTotal, total: data?.total, topOrigins: (data?.top || []).slice(0, 12) } }
    }
    default:
      return { llm: { error: 'unknown_tool', name } }
  }
}
