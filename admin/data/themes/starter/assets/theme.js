document.documentElement.classList.add('starter-theme-ready');

/* ===== 路径语言落 Cookie:浏览器语言自动跳转后也要持久化选择 ===== */
(function () {
  var first = window.location.pathname.split('/').filter(Boolean)[0] || '';
  var lang = first === 'zh' || first === 'th' || first === 'en' ? first : '';
  if (!lang) return;
  document.cookie = 'bizthai_lang=' + encodeURIComponent(lang) + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
})();

/* ===== 公司详情漂亮 URL:统一改写为 /<英文名slug>-<jpNo>.html(三语子域名一致) =====
   服务端模板渲染基线 /<jpNo>.html(无英文名时即最终形态);此处把页面上所有公司链接
   升级为带英文名 slug 的形态。英文名取自链接的 data-en-name(=meta.jpnamee,无则空)。 */
(function () {
  function text(v) { return v == null ? '' : String(v); }
  // 英文名 → ASCII slug(泰文/中文等非 ASCII 一律剔除;结果为空则退为纯注册号 URL)
  function slugify(name) {
    return text(name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
  function companyHref(jpno, enName) {
    jpno = text(jpno);
    // 纯英文名 URL:有英文名 → /<英文名slug>.html;无英文名 → 降级 /<jpNo>.html(均由 resolver 解析)
    var slug = slugify(enName);
    if (slug) return '/' + slug + '.html';
    if (jpno) return '/' + encodeURIComponent(jpno) + '.html';
    return '';
  }
  // 从 /company/<jpno> 或 /<...>-<jpno>.html 或 /<jpno>.html 抽取 jpno
  function jpnoFromHref(href) {
    var v = text(href).split('?')[0].split('#')[0].replace(/\/+$/, '');
    var m = v.match(/\/company\/(\d{6,})$/);
    if (m) return m[1];
    m = v.match(/(?:^|\/)(?:.*-)?(\d{6,})\.html$/);
    if (m) return m[1];
    return '';
  }
  function rewriteAll(root) {
    var scope = root || document;
    var links = scope.querySelectorAll('a[href]');
    Array.prototype.forEach.call(links, function (a) {
      var jpno = jpnoFromHref(a.getAttribute('href'));
      if (!jpno) return;
      var pretty = companyHref(jpno, a.getAttribute('data-en-name') || '');
      if (pretty) a.setAttribute('href', pretty);
    });
  }
  window.__starterCompanyHref = companyHref;
  window.__starterRewriteCompanyLinks = rewriteAll;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { rewriteAll(document); });
  } else {
    rewriteAll(document);
  }
})();

/* ===== 公司运营状态标签统一规范 ===== */
(function () {
  function text(v) { return v == null ? '' : String(v); }
  function norm(v) { return text(v).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function statusKind(value, code) {
    var c = norm(code);
    var s = norm(value);
    if (c === '1') return 'operating';
    if (!s) return 'unknown';
    if (s === 'operating' || s === 'active' || s === 'ดำเนินกิจการอยู่' || s.indexOf('ยังดำเนินกิจการอยู่') >= 0 || s.indexOf('运营中') >= 0 || s.indexOf('正常') >= 0) return 'operating';
    if (s === '-' || s === 'unknown' || s === 'n/a' || s.indexOf('unknown') >= 0 || s.indexOf('ไม่ระบุ') >= 0 || s.indexOf('未知') >= 0) return 'unknown';
    return 'risk';
  }
  function applyStatusBadge(el, value, code) {
    if (!el) return 'unknown';
    var kind = statusKind(value != null ? value : el.textContent, code);
    el.classList.remove('is-operating', 'is-risk', 'is-unknown', 'is-ok', 'is-muted');
    el.classList.add('is-' + kind);
    el.setAttribute('data-status-kind', kind);
    return kind;
  }
  function applyAll(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.biz-company-status, .biz-industry-item__status, .ai-list__status, .biz-detail-badge[data-company-status]'), function (el) {
      applyStatusBadge(el, el.textContent || el.getAttribute('data-en') || '', el.getAttribute('data-status-code') || '');
    });
  }
  window.__bizthaiStatusKind = statusKind;
  window.__bizthaiApplyStatusBadge = applyStatusBadge;
  window.__bizthaiApplyStatusBadges = applyAll;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { applyAll(document); });
  else applyAll(document);
})();

/* ===== "最近有更新"徽标(公司数据 24 小时内有更新)=====
   数据来源单独一个轻量接口(/api/site/v1/analytics/updated-badges),按 slug 批量查
   cms_content_entries.updated_at(有索引,不碰 thaicompany_facts 物化视图,视图本身
   每天才刷新一次,不适合做 24 小时判定)。行标记元素需内含一个空 <span data-updated-slot>
   作插入点,否则静默跳过(标记缺失不报错)。
   查找 key 优先用 data-slug(SSR wc-data 循环里 {{ .slug }} 就是真实 slug 列,直接可信);
   没有 data-slug 时从 href="/xxx.html" 里取——不能改用分析接口 JSON 里的 it.slug/m.jpno,
   那个字段名叫 slug 实际存的是 jpno(见 analytics/src/db.js parseBrowseRows),公司一旦有
   英文名、真实 URL 走的是名称 slug 不是 jpno,用错字段会导致这批公司永远查不到徽标。
   href 是每一行本来就依赖的真实跳转目标,不会有这个歧义。 */
(function () {
  var API = '/api/site/v1/analytics/updated-badges';
  var MAX_BATCH = 60;
  var DAY_MS = 86400000;
  var TIP = '最近有更新';
  var AUTO_SELECTORS = '.biz-industry-item, .ai-list__row, .biz-rank-table__company';

  function lookupKeyOf(el) {
    var explicit = el.getAttribute('data-slug');
    if (explicit) return explicit;
    var href = el.getAttribute('href') || '';
    var m = href.match(/\/([^\/?#]+)\.html(?:[?#]|$)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function makeBadge(kind) {
    var b = document.createElement('span');
    b.title = TIP;
    if (kind === 'dot') { b.className = 'biz-updated-dot'; }
    else { b.className = 'biz-updated-badge'; b.textContent = TIP; }
    return b;
  }

  // els 可以是 NodeList 或数组;kind 传 'dot' 用极简圆点(首页密集卡片位),不传/其它值用带文字的小标签。
  function hydrate(els, kind) {
    els = Array.prototype.filter.call(els, function (el) { return el && !el.hasAttribute('data-updated-checked'); });
    if (!els.length) return;
    var slugs = [], seen = {};
    els.forEach(function (el) {
      el.setAttribute('data-updated-checked', '1');
      var s = lookupKeyOf(el);
      if (s && !seen[s]) { seen[s] = true; slugs.push(s); }
    });
    if (!slugs.length) return;
    fetch(API + '?slugs=' + encodeURIComponent(slugs.slice(0, MAX_BATCH).join(',')), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var map = (j && j.data) || {}, now = Date.now();
        els.forEach(function (el) {
          var s = lookupKeyOf(el), iso = s && map[s];
          if (!iso) return;
          var t = new Date(iso).getTime();
          if (!isFinite(t) || now - t >= DAY_MS) return;
          var slot = el.querySelector('[data-updated-slot]');
          if (slot && !slot.firstChild) slot.appendChild(makeBadge(kind));
        });
      })
      .catch(function () { /* 徽标可选,失败静默忽略,不影响主内容 */ });
  }

  function apply(root) { hydrate((root || document).querySelectorAll(AUTO_SELECTORS), 'pill'); }
  window.__bizthaiApplyRecentlyUpdated = apply;
  window.__bizthaiApplyRecentlyUpdatedTo = hydrate; // 供首页等自定义元素集合/徽标样式的场景显式调用
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(document); });
  else apply(document);
})();

/* ===== UI 文案三语字典(自动生成,可手工增改) ===== */
var STARTER_UI_I18N = {"Industry composition": {"zh-CN": "行业构成", "th": "องค์ประกอบอุตสาหกรรม"}, "How Thailand's registered companies break down across the 19 TSIC industry sections — tap any section to explore its companies.": {"zh-CN": "泰国注册企业如何分布在 19 个 TSIC 行业大类中——点击任意类别可查看该行业的企业。", "th": "การกระจายตัวของบริษัทจดทะเบียนในไทยตาม 19 หมวดอุตสาหกรรมหลัก TSIC — แตะหมวดใดก็ได้เพื่อดูบริษัทในอุตสาหกรรมนั้น"}, "Ranked comparison": {"zh-CN": "排行对比", "th": "การเปรียบเทียบอันดับ"}, "The same sections, ranked by company count.": {"zh-CN": "同一组行业大类,按企业数量排行。", "th": "หมวดเดียวกัน จัดอันดับตามจำนวนบริษัท"}, "Company Directory": {"zh-CN": "公司名录", "th": "ทำเนียบบริษัท"}, "Company Rankings": {"zh-CN": "公司排名", "th": "การจัดอันดับบริษัท"}, "Foreign Investment": {"zh-CN": "外商投资", "th": "การลงทุนจากต่างชาติ"}, "New Companies": {"zh-CN": "新设公司", "th": "บริษัทใหม่"}, "Industry Analysis": {"zh-CN": "行业分析", "th": "การวิเคราะห์อุตสาหกรรม"}, "Regional Analysis": {"zh-CN": "区域分析", "th": "การวิเคราะห์ภูมิภาค"}, "Featured Thai Companies": {"zh-CN": "精选泰国公司", "th": "บริษัทไทยแนะนำ"}, "Recommended by Thai provinces such as Bangkok, Chonburi, Rayong and Chiang Mai, plus industry, verification and contact activity": {"zh-CN": "按泰国各府推荐,如曼谷、春武里、罗勇和清迈,以及行业、验证和联系活跃度", "th": "แนะนำตามจังหวัดของไทย เช่น กรุงเทพฯ ชลบุรี ระยอง และเชียงใหม่ รวมถึงอุตสาหกรรม การยืนยัน และกิจกรรมการติดต่อ"}, "Company": {"zh-CN": "公司", "th": "บริษัท"}, "Province": {"zh-CN": "府", "th": "จังหวัด"}, "Country": {"zh-CN": "国家", "th": "ประเทศ"}, "Category": {"zh-CN": "类别", "th": "หมวดหมู่"}, "No companies available right now.": {"zh-CN": "目前暂无公司。", "th": "ขณะนี้ยังไม่มีบริษัท"}, "Homepage shortcuts": {"zh-CN": "首页快捷入口", "th": "ทางลัดหน้าแรก"}, "File Theme Active": {"zh-CN": "文件主题已启用", "th": "ธีมไฟล์เปิดใช้งานอยู่"}, "Company Research Portal": {"zh-CN": "公司调研门户", "th": "พอร์ทัลค้นคว้าข้อมูลบริษัท"}, "Thailand Company Search And Investment Intelligence": {"zh-CN": "泰国公司搜索与投资情报", "th": "ค้นหาบริษัทไทยและข้อมูลเชิงลึกด้านการลงทุน"}, "Search Thai registered companies, scan commercial distribution, review foreign-capital signals, and enter regional or industry research from one SEO-ready data hub.": {"zh-CN": "在一个 SEO 就绪的数据中心,搜索泰国注册公司、扫描商业分布、查看外资信号,并进入区域或行业调研。", "th": "ค้นหาบริษัทที่จดทะเบียนในไทย สำรวจการกระจายตัวทางการค้า ตรวจสอบสัญญาณทุนต่างชาติ และเข้าสู่การค้นคว้าระดับภูมิภาคหรืออุตสาหกรรม จากศูนย์ข้อมูลที่พร้อมรองรับ SEO ในที่เดียว"}, "Search by company name, registration number, director or industry": {"zh-CN": "按公司名称、注册号、董事或行业搜索", "th": "ค้นหาตามชื่อบริษัท เลขทะเบียน กรรมการ หรืออุตสาหกรรม"}, "Search": {"zh-CN": "搜索", "th": "ค้นหา"}, "Company Lookup": {"zh-CN": "公司查询", "th": "ค้นหาบริษัท"}, "Industry Overview": {"zh-CN": "行业概览", "th": "ภาพรวมอุตสาหกรรม"}, "Regional Map": {"zh-CN": "区域地图", "th": "แผนที่ภูมิภาค"}, "Investment Snapshot": {"zh-CN": "投资速览", "th": "ภาพรวมการลงทุน"}, "Live data": {"zh-CN": "实时数据", "th": "ข้อมูลสด"}, "Thai company records indexed": {"zh-CN": "已收录泰国公司记录", "th": "ข้อมูลบริษัทไทยที่จัดทำดัชนีแล้ว"}, "Industry taxonomy entries": {"zh-CN": "行业分类条目", "th": "รายการหมวดหมู่อุตสาหกรรม"}, "Province and district terms": {"zh-CN": "府与县分类项", "th": "หมวดจังหวัดและอำเภอ"}, "Capital-origin terms": {"zh-CN": "资本来源分类项", "th": "หมวดแหล่งที่มาของทุน"}, "Entity data": {"zh-CN": "实体数据", "th": "ข้อมูลนิติบุคคล"}, "Registration status, capital, address, objective and business scope": {"zh-CN": "注册状态、资本、地址、目标和经营范围", "th": "สถานะการจดทะเบียน ทุน ที่อยู่ วัตถุประสงค์ และขอบเขตธุรกิจ"}, "Research signals": {"zh-CN": "调研信号", "th": "สัญญาณการค้นคว้า"}, "Province, industry, foreign-capital flags, revenue and profit fields": {"zh-CN": "府、行业、外资标识、营收和利润字段", "th": "จังหวัด อุตสาหกรรม สัญญาณทุนต่างชาติ ข้อมูลรายได้และกำไร"}, "Use cases": {"zh-CN": "应用场景", "th": "กรณีการใช้งาน"}, "Partner checks, market entry, supplier screening and competitor tracking": {"zh-CN": "合作伙伴核查、市场进入、供应商筛选和竞争对手追踪", "th": "การตรวจสอบคู่ค้า การเข้าสู่ตลาด การคัดกรองซัพพลายเออร์ และการติดตามคู่แข่ง"}, "Core Research Entries": {"zh-CN": "核心调研入口", "th": "ช่องทางค้นคว้าหลัก"}, "Each entry opens a server-rendered subpage backed by the Thai company content model, so search engines can read the data without relying on client-side rendering.": {"zh-CN": "每个入口都会打开由泰国公司内容模型支撑的服务端渲染子页面,因此搜索引擎无需依赖客户端渲染即可读取数据。", "th": "แต่ละช่องทางจะเปิดหน้าย่อยที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ซึ่งอิงกับโมเดลเนื้อหาบริษัทไทย ทำให้เครื่องมือค้นหาอ่านข้อมูลได้โดยไม่ต้องพึ่งการเรนเดอร์ฝั่งไคลเอนต์"}, "Search registered entities and browse recent company records with registration number, province, capital and business objective.": {"zh-CN": "搜索已注册实体,并浏览含注册号、府、资本和经营范围的最新公司记录。", "th": "ค้นหานิติบุคคลที่จดทะเบียนและเรียกดูข้อมูลบริษัทล่าสุดพร้อมเลขทะเบียน จังหวัด ทุน และวัตถุประสงค์ทางธุรกิจ"}, "Company lookup": {"zh-CN": "公司查询", "th": "ค้นหาบริษัท"}, "Regional Ranking": {"zh-CN": "区域排名", "th": "การจัดอันดับภูมิภาค"}, "Use province terms and live company records to compare Thai commercial locations and active business concentration.": {"zh-CN": "利用府分类项和实时公司记录,比较泰国各商业地点及活跃业务集中度。", "th": "ใช้หมวดจังหวัดและข้อมูลบริษัทสดเพื่อเปรียบเทียบทำเลทางการค้าในไทยและความหนาแน่นของธุรกิจที่ดำเนินการอยู่"}, "Regional ranking": {"zh-CN": "区域排名", "th": "การจัดอันดับภูมิภาค"}, "Foreign Capital": {"zh-CN": "外资", "th": "ทุนต่างชาติ"}, "Review companies carrying nationality, foreign-license or import-export indicators for investment screening.": {"zh-CN": "审查带有国籍、外资许可或进出口标识的公司,用于投资筛选。", "th": "ตรวจสอบบริษัทที่มีตัวบ่งชี้ด้านสัญชาติ ใบอนุญาตต่างชาติ หรือการนำเข้า-ส่งออก เพื่อการคัดกรองการลงทุน"}, "Foreign capital": {"zh-CN": "外资", "th": "ทุนต่างชาติ"}, "New Registrations": {"zh-CN": "新注册", "th": "การจดทะเบียนใหม่"}, "Track recently published company records and watch early signals from new registrations and updated profiles.": {"zh-CN": "追踪最新发布的公司记录,关注来自新注册和更新档案的早期信号。", "th": "ติดตามข้อมูลบริษัทที่เผยแพร่ล่าสุด และจับสัญญาณเริ่มต้นจากการจดทะเบียนใหม่และโปรไฟล์ที่อัปเดต"}, "New registrations": {"zh-CN": "新注册", "th": "การจดทะเบียนใหม่"}, "Business Investment Summary Navigation": {"zh-CN": "商业投资概要导航", "th": "การนำทางสรุปการลงทุนทางธุรกิจ"}, "Move from a company-level lookup to industry, region, capital and ownership research paths, all backed by server-rendered WooCMS data tags.": {"zh-CN": "从公司级查询进入行业、区域、资本和所有权调研路径,全部由服务端渲染的 WooCMS 数据标签支撑。", "th": "เปลี่ยนจากการค้นหาระดับบริษัทไปสู่เส้นทางค้นคว้าด้านอุตสาหกรรม ภูมิภาค ทุน และความเป็นเจ้าของ ซึ่งทั้งหมดอิงกับแท็กข้อมูล WooCMS ที่เรนเดอร์ฝั่งเซิร์ฟเวอร์"}, "Industry Investment Overview": {"zh-CN": "行业投资概览", "th": "ภาพรวมการลงทุนในอุตสาหกรรม"}, "Industry taxonomy, live company examples and business objectives": {"zh-CN": "行业分类、实时公司示例和经营范围", "th": "หมวดหมู่อุตสาหกรรม ตัวอย่างบริษัทสด และวัตถุประสงค์ทางธุรกิจ"}, "Regional Investment Map": {"zh-CN": "区域投资地图", "th": "แผนที่การลงทุนระดับภูมิภาค"}, "Province terms, regional entry points and company samples": {"zh-CN": "府分类项、区域入口和公司样本", "th": "หมวดจังหวัด จุดเข้าระดับภูมิภาค และตัวอย่างบริษัท"}, "Owner / Shareholder Leads": {"zh-CN": "所有人 / 股东线索", "th": "เบาะแสเจ้าของ / ผู้ถือหุ้น"}, "Director and shareholder research entry using company records": {"zh-CN": "利用公司记录的董事和股东调研入口", "th": "ช่องทางค้นคว้ากรรมการและผู้ถือหุ้นโดยใช้ข้อมูลบริษัท"}, "Regional Rankings Summary": {"zh-CN": "区域排名概要", "th": "สรุปการจัดอันดับภูมิภาค"}, "Compare region-oriented company data and ranking signals": {"zh-CN": "比较以区域为导向的公司数据和排名信号", "th": "เปรียบเทียบข้อมูลบริษัทเชิงภูมิภาคและสัญญาณการจัดอันดับ"}, "Live Server-Rendered Data": {"zh-CN": "实时服务端渲染数据", "th": "ข้อมูลสดที่เรนเดอร์ฝั่งเซิร์ฟเวอร์"}, "Latest Thai Companies": {"zh-CN": "最新泰国公司", "th": "บริษัทไทยล่าสุด"}, "Recent records from the Thai company content model.": {"zh-CN": "来自泰国公司内容模型的最新记录。", "th": "ข้อมูลล่าสุดจากโมเดลเนื้อหาบริษัทไทย"}, "No company records are available.": {"zh-CN": "暂无公司记录。", "th": "ไม่มีข้อมูลบริษัท"}, "Research Taxonomies": {"zh-CN": "调研分类", "th": "หมวดหมู่การค้นคว้า"}, "Industry and province terms served by WooCMS taxonomy sources.": {"zh-CN": "由 WooCMS 分类源提供的行业和府分类项。", "th": "หมวดอุตสาหกรรมและจังหวัดที่ให้บริการโดยแหล่งหมวดหมู่ของ WooCMS"}, "No industry terms are available.": {"zh-CN": "暂无行业分类项。", "th": "ไม่มีหมวดอุตสาหกรรม"}, "No province terms are available.": {"zh-CN": "暂无府分类项。", "th": "ไม่มีหมวดจังหวัด"}, "Company name / registration number / director / industry keyword": {"zh-CN": "公司名称 / 注册号 / 董事 / 行业关键词", "th": "ชื่อบริษัท / เลขทะเบียน / กรรมการ / คำค้นอุตสาหกรรม"}, "Frequent research entries": {"zh-CN": "常用调研入口", "th": "ช่องทางค้นคว้าที่ใช้บ่อย"}, "Business investment snapshot": {"zh-CN": "商业投资速览", "th": "ภาพรวมการลงทุนทางธุรกิจ"}, "All Thai Companies": {"zh-CN": "全部泰国公司", "th": "บริษัทไทยทั้งหมด"}, "Browse the live Thai company directory with server-rendered company rows, registration numbers, provinces, capital amounts and business objectives.": {"zh-CN": "浏览实时泰国公司名录,含服务端渲染的公司行、注册号、府、资本金额和经营范围。", "th": "เรียกดูทำเนียบบริษัทไทยแบบสด พร้อมแถวบริษัทที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ เลขทะเบียน จังหวัด จำนวนทุน และวัตถุประสงค์ทางธุรกิจ"}, "Search all companies": {"zh-CN": "搜索全部公司", "th": "ค้นหาบริษัททั้งหมด"}, "Business Reports": {"zh-CN": "商业报告", "th": "รายงานธุรกิจ"}, "Total indexed company records": {"zh-CN": "已收录公司记录总数", "th": "จำนวนข้อมูลบริษัทที่จัดทำดัชนีทั้งหมด"}, "Industry terms for discovery": {"zh-CN": "用于发现的行业分类项", "th": "หมวดอุตสาหกรรมสำหรับการค้นพบ"}, "Company Directory Index": {"zh-CN": "公司名录索引", "th": "ดัชนีทำเนียบบริษัท"}, "The first directory page is rendered by WooCMS on the server. Use search or taxonomy pages to narrow deeper company research.": {"zh-CN": "首个名录页面由 WooCMS 在服务端渲染。使用搜索或分类页面可深入缩小公司调研范围。", "th": "หน้าทำเนียบแรกเรนเดอร์โดย WooCMS ที่ฝั่งเซิร์ฟเวอร์ ใช้หน้าค้นหาหรือหน้าหมวดหมู่เพื่อจำกัดขอบเขตการค้นคว้าบริษัทให้ลึกยิ่งขึ้น"}, "Company name, registration number, province or objective": {"zh-CN": "公司名称、注册号、府或经营范围", "th": "ชื่อบริษัท เลขทะเบียน จังหวัด หรือวัตถุประสงค์"}, "Company Research": {"zh-CN": "公司调研", "th": "การค้นคว้าข้อมูลบริษัท"}, "Thai Company Lookup": {"zh-CN": "泰国公司查询", "th": "ค้นหาบริษัทไทย"}, "Search Thai company records, then review live registration numbers, provinces, business objectives and capital signals from the server-rendered company index.": {"zh-CN": "搜索泰国公司记录,然后从服务端渲染的公司索引中查看实时注册号、府、经营范围和资本信号。", "th": "ค้นหาข้อมูลบริษัทไทย จากนั้นตรวจสอบเลขทะเบียน จังหวัด วัตถุประสงค์ทางธุรกิจ และสัญญาณทุนแบบสด จากดัชนีบริษัทที่เรนเดอร์ฝั่งเซิร์ฟเวอร์"}, "Search companies": {"zh-CN": "搜索公司", "th": "ค้นหาบริษัท"}, "All Companies": {"zh-CN": "全部公司", "th": "บริษัททั้งหมด"}, "Industries": {"zh-CN": "行业", "th": "อุตสาหกรรม"}, "Regions": {"zh-CN": "区域", "th": "ภูมิภาค"}, "Thai company records": {"zh-CN": "泰国公司记录", "th": "ข้อมูลบริษัทไทย"}, "Latest Company Records": {"zh-CN": "最新公司记录", "th": "ข้อมูลบริษัทล่าสุด"}, "Research Filters": {"zh-CN": "研究筛选", "th": "ตัวกรองการวิจัย"}, "Use the taxonomy pages as entry points for SEO-friendly browsing.": {"zh-CN": "以分类页面作为入口,实现利于 SEO 的浏览。", "th": "ใช้หน้าหมวดหมู่เป็นจุดเริ่มต้นสำหรับการเรียกดูที่เป็นมิตรต่อ SEO"}, "Company name, registration number or industry keyword": {"zh-CN": "公司名称、注册号或行业关键词", "th": "ชื่อบริษัท เลขทะเบียน หรือคำค้นหาอุตสาหกรรม"}, "Company lookup snapshot": {"zh-CN": "公司查询概览", "th": "ภาพรวมการค้นหาบริษัท"}, "Regional Intelligence": {"zh-CN": "区域情报", "th": "ข้อมูลเชิงลึกภูมิภาค"}, "Thai Regional Company Ranking": {"zh-CN": "泰国区域公司排名", "th": "การจัดอันดับบริษัทตามภูมิภาคของไทย"}, "Compare Thai company concentration by province using the server-side aggregate query engine, with counts, share of records and registered capital totals rendered into crawlable HTML.": {"zh-CN": "使用服务端聚合查询引擎按府比较泰国公司的集中度,将公司数、记录占比和注册资本总额渲染为可被抓取的 HTML。", "th": "เปรียบเทียบความหนาแน่นของบริษัทไทยตามจังหวัดด้วยกลไกการสืบค้นแบบรวมที่ฝั่งเซิร์ฟเวอร์ พร้อมจำนวนบริษัท สัดส่วนของข้อมูล และยอดรวมทุนจดทะเบียนที่แสดงผลเป็น HTML ที่สามารถเก็บข้อมูลได้"}, "Search regional company data": {"zh-CN": "搜索区域公司数据", "th": "ค้นหาข้อมูลบริษัทตามภูมิภาค"}, "Ranking Summary": {"zh-CN": "排名摘要", "th": "สรุปการจัดอันดับ"}, "Regional taxonomy terms": {"zh-CN": "区域分类词条", "th": "หมวดหมู่ตามภูมิภาค"}, "Company records connected to research paths": {"zh-CN": "与研究路径关联的公司记录", "th": "ข้อมูลบริษัทที่เชื่อมโยงกับเส้นทางการวิจัย"}, "Top Provinces By Company Count": {"zh-CN": "按公司数排名靠前的府", "th": "จังหวัดที่มีจำนวนบริษัทสูงสุด"}, "Rank": {"zh-CN": "排名", "th": "อันดับ"}, "Companies": {"zh-CN": "公司数", "th": "จำนวนบริษัท"}, "Share": {"zh-CN": "占比", "th": "สัดส่วน"}, "Registered Capital": {"zh-CN": "注册资本", "th": "ทุนจดทะเบียน"}, "No regional aggregate data is available.": {"zh-CN": "暂无区域聚合数据。", "th": "ไม่มีข้อมูลรวมตามภูมิภาค"}, "Province Research Index": {"zh-CN": "府研究索引", "th": "ดัชนีการวิจัยจังหวัด"}, "Server-rendered province and district terms for regional discovery.": {"zh-CN": "服务端渲染的府与县词条,用于区域发现。", "th": "หมวดหมู่จังหวัดและอำเภอที่แสดงผลฝั่งเซิร์ฟเวอร์สำหรับการค้นพบตามภูมิภาค"}, "Open": {"zh-CN": "打开", "th": "เปิด"}, "Province, district, company or business objective": {"zh-CN": "府、县、公司或经营范围", "th": "จังหวัด อำเภอ บริษัท หรือวัตถุประสงค์ทางธุรกิจ"}, "Capital Signals": {"zh-CN": "资本信号", "th": "สัญญาณทุน"}, "Foreign Capital Company Research": {"zh-CN": "外资公司研究", "th": "การวิจัยบริษัททุนต่างชาติ"}, "Review foreign-capital signals with server-rendered aggregate tables for nationality code and foreign-license metadata, plus direct entry points into company records.": {"zh-CN": "通过服务端渲染的聚合表查看外资信号(含国籍代码与外国执照元数据),并提供直达公司记录的入口。", "th": "ตรวจสอบสัญญาณทุนต่างชาติด้วยตารางข้อมูลรวมที่แสดงผลฝั่งเซิร์ฟเวอร์สำหรับรหัสสัญชาติและข้อมูลเมตาใบอนุญาตต่างชาติ พร้อมจุดเข้าถึงข้อมูลบริษัทโดยตรง"}, "Search foreign capital companies": {"zh-CN": "搜索外资公司", "th": "ค้นหาบริษัททุนต่างชาติ"}, "Foreign Capital Term": {"zh-CN": "外资词条", "th": "หมวดหมู่ทุนต่างชาติ"}, "Thai Capital Term": {"zh-CN": "泰资词条", "th": "หมวดหมู่ทุนไทย"}, "Capital-origin taxonomy terms": {"zh-CN": "资本来源分类词条", "th": "หมวดหมู่แหล่งที่มาของทุน"}, "Company records available for screening": {"zh-CN": "可供筛查的公司记录", "th": "ข้อมูลบริษัทที่พร้อมสำหรับการคัดกรอง"}, "Nationality Code Share": {"zh-CN": "国籍代码占比", "th": "สัดส่วนรหัสสัญชาติ"}, "Nationality Code": {"zh-CN": "国籍代码", "th": "รหัสสัญชาติ"}, "No nationality aggregate data is available.": {"zh-CN": "暂无国籍聚合数据。", "th": "ไม่มีข้อมูลรวมตามสัญชาติ"}, "Capital-Origin Terms": {"zh-CN": "资本来源词条", "th": "หมวดหมู่แหล่งที่มาของทุน"}, "Browse capital and nationality terms managed in the backend taxonomy.": {"zh-CN": "浏览后台分类中管理的资本与国籍词条。", "th": "เรียกดูหมวดหมู่ทุนและสัญชาติที่จัดการในระบบหมวดหมู่ส่วนหลังบ้าน"}, "No capital terms are available.": {"zh-CN": "暂无资本词条。", "th": "ไม่มีหมวดหมู่ทุน"}, "Foreign-Capital Company Samples": {"zh-CN": "外资公司样本", "th": "ตัวอย่างบริษัททุนต่างชาติ"}, "Company rows associated with the capital taxonomy remain available for direct entity inspection.": {"zh-CN": "与资本分类关联的公司条目仍可用于直接查看实体。", "th": "รายการบริษัทที่เชื่อมโยงกับหมวดหมู่ทุนยังคงพร้อมให้ตรวจสอบนิติบุคคลโดยตรง"}, "No foreign-capital company records are available through this term yet.": {"zh-CN": "该词条暂无外资公司记录。", "th": "ยังไม่มีข้อมูลบริษัททุนต่างชาติผ่านหมวดหมู่นี้"}, "Nationality, company name, registration number or license keyword": {"zh-CN": "国籍、公司名称、注册号或执照关键词", "th": "สัญชาติ ชื่อบริษัท เลขทะเบียน หรือคำค้นหาใบอนุญาต"}, "Fresh Records": {"zh-CN": "最新记录", "th": "ข้อมูลล่าสุด"}, "Recent Thai Company Registrations": {"zh-CN": "近期泰国公司注册", "th": "การจดทะเบียนบริษัทไทยล่าสุด"}, "Track newly published Thai company records, registration dates, provinces and business objectives from live backend data.": {"zh-CN": "从实时后台数据追踪新发布的泰国公司记录、注册日期、府及经营范围。", "th": "ติดตามข้อมูลบริษัทไทยที่เผยแพร่ใหม่ วันที่จดทะเบียน จังหวัด และวัตถุประสงค์ทางธุรกิจจากข้อมูลส่วนหลังบ้านแบบเรียลไทม์"}, "Search new registrations": {"zh-CN": "搜索新注册", "th": "ค้นหาการจดทะเบียนใหม่"}, "Lookup": {"zh-CN": "查询", "th": "ค้นหา"}, "Published company records": {"zh-CN": "已发布的公司记录", "th": "ข้อมูลบริษัทที่เผยแพร่แล้ว"}, "Industry terms for classification": {"zh-CN": "用于分类的行业词条", "th": "หมวดหมู่อุตสาหกรรมสำหรับการจัดประเภท"}, "Latest Published Companies": {"zh-CN": "最新发布的公司", "th": "บริษัทที่เผยแพร่ล่าสุด"}, "No recent company records are available.": {"zh-CN": "暂无近期公司记录。", "th": "ไม่มีข้อมูลบริษัทล่าสุด"}, "Company name, registration number or province": {"zh-CN": "公司名称、注册号或府", "th": "ชื่อบริษัท เลขทะเบียน หรือจังหวัด"}, "Industry Intelligence": {"zh-CN": "行业情报", "th": "ข้อมูลเชิงลึกอุตสาหกรรม"}, "Thai Industry Investment Overview": {"zh-CN": "泰国行业投资概览", "th": "ภาพรวมการลงทุนในอุตสาหกรรมของไทย"}, "Compare Thai business objectives by company count and registered capital using server-side aggregation over the company metadata field.": {"zh-CN": "使用对公司元数据字段的服务端聚合,按公司数和注册资本比较泰国各类经营范围。", "th": "เปรียบเทียบวัตถุประสงค์ทางธุรกิจของไทยตามจำนวนบริษัทและทุนจดทะเบียนด้วยการรวมข้อมูลฝั่งเซิร์ฟเวอร์จากฟิลด์ข้อมูลเมตาของบริษัท"}, "Search industries": {"zh-CN": "搜索行业", "th": "ค้นหาอุตสาหกรรม"}, "Industry taxonomy terms": {"zh-CN": "行业分类词条", "th": "หมวดหมู่อุตสาหกรรม"}, "Company records for industry research": {"zh-CN": "用于行业研究的公司记录", "th": "ข้อมูลบริษัทสำหรับการวิจัยอุตสาหกรรม"}, "Top Business Objectives": {"zh-CN": "排名靠前的经营范围", "th": "วัตถุประสงค์ทางธุรกิจยอดนิยม"}, "Business Objective": {"zh-CN": "经营范围", "th": "วัตถุประสงค์ทางธุรกิจ"}, "No industry aggregate data is available.": {"zh-CN": "暂无行业聚合数据。", "th": "ไม่มีข้อมูลรวมตามอุตสาหกรรม"}, "Industry Taxonomy": {"zh-CN": "行业分类", "th": "หมวดหมู่อุตสาหกรรม"}, "Backend-managed industry terms rendered directly into HTML.": {"zh-CN": "后台管理的行业词条,直接渲染为 HTML。", "th": "หมวดหมู่อุตสาหกรรมที่จัดการในส่วนหลังบ้านและแสดงผลเป็น HTML โดยตรง"}, "Industry, objective, company name or registration number": {"zh-CN": "行业、经营范围、公司名称或注册号", "th": "อุตสาหกรรม วัตถุประสงค์ ชื่อบริษัท หรือเลขทะเบียน"}, "Market Entry": {"zh-CN": "市场进入", "th": "การเข้าสู่ตลาด"}, "Thailand Regional Investment Map": {"zh-CN": "泰国区域投资地图", "th": "แผนที่การลงทุนตามภูมิภาคของประเทศไทย"}, "Use province terms, company samples and business objectives to plan regional market entry research across Thailand.": {"zh-CN": "利用府词条、公司样本和经营范围,规划面向泰国各区域的市场进入研究。", "th": "ใช้หมวดหมู่จังหวัด ตัวอย่างบริษัท และวัตถุประสงค์ทางธุรกิจเพื่อวางแผนการวิจัยการเข้าสู่ตลาดตามภูมิภาคทั่วประเทศไทย"}, "Search regional investment data": {"zh-CN": "搜索区域投资数据", "th": "ค้นหาข้อมูลการลงทุนตามภูมิภาค"}, "Industry terms for comparison": {"zh-CN": "用于比较的行业词条", "th": "หมวดหมู่อุตสาหกรรมสำหรับการเปรียบเทียบ"}, "Regional Entry Points": {"zh-CN": "区域入口", "th": "จุดเข้าถึงตามภูมิภาค"}, "Open province pages for indexable regional company discovery.": {"zh-CN": "打开府页面,实现可被索引的区域公司发现。", "th": "เปิดหน้าจังหวัดสำหรับการค้นพบบริษัทตามภูมิภาคที่สามารถจัดทำดัชนีได้"}, "Latest Regional Records": {"zh-CN": "最新区域记录", "th": "ข้อมูลตามภูมิภาคล่าสุด"}, "Company examples with province fields for fast market scans.": {"zh-CN": "带有府字段的公司示例,便于快速市场扫描。", "th": "ตัวอย่างบริษัทพร้อมฟิลด์จังหวัดสำหรับการสำรวจตลาดอย่างรวดเร็ว"}, "Province, district, company or industry": {"zh-CN": "府、县、公司或行业", "th": "จังหวัด อำเภอ บริษัท หรืออุตสาหกรรม"}, "Ownership Research": {"zh-CN": "所有权研究", "th": "การวิจัยความเป็นเจ้าของ"}, "Owner And Shareholder Research Leads": {"zh-CN": "所有人与股东研究线索", "th": "เบาะแสการวิจัยเจ้าของและผู้ถือหุ้น"}, "Start from verified company records, then use registration number, company type, capital and province fields as entry points for owner and shareholder follow-up workflows.": {"zh-CN": "从已核实的公司记录入手,再以注册号、公司类型、资本和府字段作为入口,开展所有人与股东的后续跟进流程。", "th": "เริ่มจากข้อมูลบริษัทที่ได้รับการตรวจสอบ จากนั้นใช้เลขทะเบียน ประเภทบริษัท ทุน และฟิลด์จังหวัดเป็นจุดเริ่มต้นสำหรับขั้นตอนการติดตามเจ้าของและผู้ถือหุ้น"}, "Search ownership leads": {"zh-CN": "搜索所有权线索", "th": "ค้นหาเบาะแสความเป็นเจ้าของ"}, "Company records for ownership workflows": {"zh-CN": "用于所有权流程的公司记录", "th": "ข้อมูลบริษัทสำหรับขั้นตอนการตรวจสอบความเป็นเจ้าของ"}, "Company type terms": {"zh-CN": "公司类型词条", "th": "หมวดหมู่ประเภทบริษัท"}, "Company Records For Follow-Up": {"zh-CN": "用于跟进的公司记录", "th": "ข้อมูลบริษัทสำหรับการติดตาม"}, "Open a company detail page, then use the registration number for downstream director or shareholder checks.": {"zh-CN": "打开公司详情页,再用注册号进行后续的董事或股东核查。", "th": "เปิดหน้ารายละเอียดบริษัท จากนั้นใช้เลขทะเบียนสำหรับการตรวจสอบกรรมการหรือผู้ถือหุ้นในขั้นถัดไป"}, "Research Workflow": {"zh-CN": "研究流程", "th": "ขั้นตอนการวิจัย"}, "Use live company metadata as structured lead signals.": {"zh-CN": "将实时公司元数据作为结构化的线索信号。", "th": "ใช้ข้อมูลเมตาของบริษัทแบบเรียลไทม์เป็นสัญญาณเบาะแสที่มีโครงสร้าง"}, "1. Identify the entity.": {"zh-CN": "1. 确定实体。", "th": "1. ระบุนิติบุคคล"}, "Search by company name or registration number and open the company detail route.": {"zh-CN": "按公司名称或注册号搜索,并打开公司详情路由。", "th": "ค้นหาด้วยชื่อบริษัทหรือเลขทะเบียน แล้วเปิดเส้นทางรายละเอียดบริษัท"}, "2. Confirm market context.": {"zh-CN": "2. 确认市场背景。", "th": "2. ยืนยันบริบทตลาด"}, "Review province, company type, capital amount and business objective fields.": {"zh-CN": "查看府、公司类型、资本金额和经营范围字段。", "th": "ตรวจสอบฟิลด์จังหวัด ประเภทบริษัท จำนวนทุน และวัตถุประสงค์ทางธุรกิจ"}, "3. Follow ownership signals.": {"zh-CN": "3. 跟进所有权信号。", "th": "3. ติดตามสัญญาณความเป็นเจ้าของ"}, "Use the registration number for director, owner and shareholder enrichment when upstream datasets are connected.": {"zh-CN": "当上游数据集接入后,使用注册号补全董事、所有人和股东信息。", "th": "ใช้เลขทะเบียนเพื่อเพิ่มข้อมูลกรรมการ เจ้าของ และผู้ถือหุ้น เมื่อเชื่อมต่อชุดข้อมูลต้นทางแล้ว"}, "Company name, registration number or owner keyword": {"zh-CN": "公司名称、注册号或所有人关键词", "th": "ชื่อบริษัท เลขทะเบียน หรือคำค้นเจ้าของ"}, "Regional Summary": {"zh-CN": "区域概览", "th": "สรุปภูมิภาค"}, "A compact summary of server-rendered aggregate rankings for province concentration, business objectives and capital totals.": {"zh-CN": "服务端渲染的聚合排名简要概览,涵盖府集中度、经营范围与资本总额。", "th": "สรุปกระชับของการจัดอันดับแบบรวมที่เรนเดอร์ฝั่งเซิร์ฟเวอร์ สำหรับความหนาแน่นตามจังหวัด วัตถุประสงค์ทางธุรกิจ และยอดทุนรวม"}, "Search regional rankings": {"zh-CN": "搜索区域排名", "th": "ค้นหาการจัดอันดับภูมิภาค"}, "Company records": {"zh-CN": "公司记录", "th": "ข้อมูลบริษัท"}, "Province Ranking Summary": {"zh-CN": "府排名概览", "th": "สรุปการจัดอันดับจังหวัด"}, "Ranking Navigation": {"zh-CN": "排名导航", "th": "การนำทางการจัดอันดับ"}, "Move between aggregate research pages and region-oriented lookup paths.": {"zh-CN": "在聚合研究页面与区域导向的查询路径之间切换。", "th": "สลับไปมาระหว่างหน้าวิจัยแบบรวมและเส้นทางการค้นหาที่เน้นภูมิภาค"}, "Regional Company Ranking": {"zh-CN": "区域公司排名", "th": "การจัดอันดับบริษัทตามภูมิภาค"}, "Province aggregate by company count": {"zh-CN": "按公司数的府聚合", "th": "การรวมตามจังหวัดด้วยจำนวนบริษัท"}, "Business objective aggregate and capital totals": {"zh-CN": "经营范围聚合与资本总额", "th": "การรวมวัตถุประสงค์ทางธุรกิจและยอดทุนรวม"}, "Province entry points for market scans": {"zh-CN": "市场扫描的府入口", "th": "จุดเริ่มต้นตามจังหวัดสำหรับการสำรวจตลาด"}, "Province, industry, company or registration number": {"zh-CN": "府、行业、公司或注册号", "th": "จังหวัด อุตสาหกรรม บริษัท หรือเลขทะเบียน"}, "Search query:": {"zh-CN": "搜索查询:", "th": "คำค้นหา:"}, "Article": {"zh-CN": "文章", "th": "บทความ"}, "Thai Company Profile": {"zh-CN": "泰国公司档案", "th": "โปรไฟล์บริษัทไทย"}, "Search Thai company records": {"zh-CN": "搜索泰国公司记录", "th": "ค้นหาข้อมูลบริษัทไทย"}, "Company records in the Thai company index": {"zh-CN": "泰国公司索引中的公司记录", "th": "ข้อมูลบริษัทในดัชนีบริษัทไทย"}, "Province and district terms for regional checks": {"zh-CN": "用于区域核查的府与县关键词", "th": "คำค้นจังหวัดและอำเภอสำหรับการตรวจสอบตามภูมิภาค"}, "Company Data Summary": {"zh-CN": "公司数据概览", "th": "สรุปข้อมูลบริษัท"}, "The current company title and summary are rendered by WooCMS on the server from the detail route context.": {"zh-CN": "当前公司标题和摘要由 WooCMS 在服务端根据详情路由上下文渲染。", "th": "ชื่อและสรุปบริษัทปัจจุบันถูกเรนเดอร์โดย WooCMS บนเซิร์ฟเวอร์จากบริบทของเส้นทางหน้ารายละเอียด"}, "Company name": {"zh-CN": "公司名称", "th": "ชื่อบริษัท"}, "Record summary": {"zh-CN": "记录摘要", "th": "สรุปข้อมูล"}, "Related Research": {"zh-CN": "相关研究", "th": "งานวิจัยที่เกี่ยวข้อง"}, "Open connected server-rendered entry points for broader due diligence.": {"zh-CN": "打开关联的服务端渲染入口,进行更全面的尽职调查。", "th": "เปิดจุดเริ่มต้นที่เชื่อมโยงและเรนเดอร์ฝั่งเซิร์ฟเวอร์เพื่อการตรวจสอบสถานะที่ครอบคลุมยิ่งขึ้น"}, "Foreign capital screening": {"zh-CN": "外资筛查", "th": "การคัดกรองทุนต่างชาติ"}, "Owner and shareholder leads": {"zh-CN": "所有人与股东线索", "th": "เบาะแสเจ้าของและผู้ถือหุ้น"}, "Industry overview": {"zh-CN": "行业概览", "th": "ภาพรวมอุตสาหกรรม"}, "More Thai Company Records": {"zh-CN": "更多泰国公司记录", "th": "ข้อมูลบริษัทไทยเพิ่มเติม"}, "Recent records from the same backend company model.": {"zh-CN": "来自同一后端公司模型的最新记录。", "th": "ข้อมูลล่าสุดจากโมเดลบริษัทแบ็กเอนด์เดียวกัน"}, "Search another company, registration number or province": {"zh-CN": "搜索其他公司、注册号或府", "th": "ค้นหาบริษัท เลขทะเบียน หรือจังหวัดอื่น"}, "Launch smarter growth.": {"zh-CN": "开启更智慧的增长。", "th": "เริ่มต้นการเติบโตที่ชาญฉลาดยิ่งขึ้น"}, "BizThai helps teams connect content, campaigns, and customer journeys with a clean publishing workflow and a fast, flexible storefront-ready foundation.": {"zh-CN": "BizThai 助力团队以简洁的发布流程和快速、灵活、可即用于店面的基础架构,串联内容、营销活动与客户旅程。", "th": "BizThai ช่วยให้ทีมเชื่อมโยงเนื้อหา แคมเปญ และเส้นทางของลูกค้าเข้าด้วยกัน ด้วยขั้นตอนการเผยแพร่ที่เรียบง่ายและรากฐานที่รวดเร็ว ยืดหยุ่น และพร้อมสำหรับหน้าร้าน"}, "Start a project": {"zh-CN": "启动项目", "th": "เริ่มโครงการ"}, "Learn about us": {"zh-CN": "了解我们", "th": "เรียนรู้เกี่ยวกับเรา"}, "Find what you need": {"zh-CN": "找到所需", "th": "ค้นหาสิ่งที่คุณต้องการ"}, "Search articles, resources, services, and product updates across the site.": {"zh-CN": "在全站搜索文章、资源、服务和产品更新。", "th": "ค้นหาบทความ ทรัพยากร บริการ และการอัปเดตผลิตภัณฑ์ทั่วทั้งเว็บไซต์"}, "Search the site": {"zh-CN": "搜索站点", "th": "ค้นหาในเว็บไซต์"}, "Services": {"zh-CN": "服务", "th": "บริการ"}, "Resources": {"zh-CN": "资源", "th": "ทรัพยากร"}, "Pricing": {"zh-CN": "定价", "th": "ราคา"}, "Case studies": {"zh-CN": "案例研究", "th": "กรณีศึกษา"}, "Explore": {"zh-CN": "探索", "th": "สำรวจ"}, "Home": {"zh-CN": "首页", "th": "หน้าแรก"}, "About": {"zh-CN": "关于我们", "th": "เกี่ยวกับ"}, "Blog": {"zh-CN": "博客", "th": "บล็อก"}, "Solutions": {"zh-CN": "解决方案", "th": "โซลูชัน"}, "Growth strategy": {"zh-CN": "增长策略", "th": "กลยุทธ์การเติบโต"}, "Experience design": {"zh-CN": "体验设计", "th": "การออกแบบประสบการณ์"}, "Content operations": {"zh-CN": "内容运营", "th": "การดำเนินงานด้านเนื้อหา"}, "Commerce enablement": {"zh-CN": "电商赋能", "th": "การส่งเสริมการค้า"}, "Insights": {"zh-CN": "洞察", "th": "ข้อมูลเชิงลึก"}, "Guides": {"zh-CN": "指南", "th": "คู่มือ"}, "Support": {"zh-CN": "支持", "th": "ฝ่ายสนับสนุน"}, "About us": {"zh-CN": "关于我们", "th": "เกี่ยวกับเรา"}, "Contact": {"zh-CN": "联系我们", "th": "ติดต่อ"}, "Privacy policy": {"zh-CN": "隐私政策", "th": "นโยบายความเป็นส่วนตัว"}, "Terms of service": {"zh-CN": "服务条款", "th": "ข้อกำหนดในการให้บริการ"}, "© 2026 BizThai. All rights reserved.": {"zh-CN": "© 2026 BizThai。保留所有权利。", "th": "© 2026 BizThai สงวนลิขสิทธิ์ทั้งหมด"}, "Privacy": {"zh-CN": "隐私", "th": "ความเป็นส่วนตัว"}, "Terms": {"zh-CN": "条款", "th": "ข้อกำหนด"}, "Accessibility": {"zh-CN": "无障碍", "th": "การเข้าถึง"}, "BizThai home": {"zh-CN": "BizThai 首页", "th": "หน้าแรก BizThai"}, "Footer calls to action": {"zh-CN": "页脚行动号召", "th": "คำกระตุ้นการกระทำในส่วนท้าย"}, "Submit search": {"zh-CN": "提交搜索", "th": "ส่งคำค้นหา"}, "Popular searches": {"zh-CN": "热门搜索", "th": "การค้นหายอดนิยม"}, "Legal links": {"zh-CN": "法律链接", "th": "ลิงก์ทางกฎหมาย"}, "All Categories": {"zh-CN": "所有类别", "th": "ทุกหมวดหมู่"}, "Regional Rankings": {"zh-CN": "区域排名", "th": "การจัดอันดับภูมิภาค"}, "Switch language": {"zh-CN": "切换语言", "th": "เปลี่ยนภาษา"}, "Sign in": {"zh-CN": "登录", "th": "เข้าสู่ระบบ"}, "Join free": {"zh-CN": "免费加入", "th": "สมัครฟรี"}, "Thailand B2B marketplace": {"zh-CN": "泰国 B2B 平台", "th": "ตลาด B2B ประเทศไทย"}, "Find trusted Thai manufacturers, products and export partners.": {"zh-CN": "寻找值得信赖的泰国制造商、产品和出口伙伴。", "th": "ค้นหาผู้ผลิต สินค้า และพันธมิตรส่งออกไทยที่เชื่อถือได้"}, "Owners": {"zh-CN": "所有人", "th": "เจ้าของ"}, "Products": {"zh-CN": "产品", "th": "สินค้า"}, "Search companies, owners or products": {"zh-CN": "搜索公司、所有人或产品", "th": "ค้นหาบริษัท เจ้าของ หรือสินค้า"}, "Loading categories...": {"zh-CN": "正在加载类别...", "th": "กำลังโหลดหมวดหมู่..."}, "Business categories": {"zh-CN": "业务类别", "th": "หมวดหมู่ธุรกิจ"}, "Loading business categories...": {"zh-CN": "正在加载业务类别...", "th": "กำลังโหลดหมวดหมู่ธุรกิจ..."}, "Primary navigation": {"zh-CN": "主导航", "th": "การนำทางหลัก"}, "Search companies...": {"zh-CN": "搜索公司...", "th": "ค้นหาบริษัท..."}, "Search modes": {"zh-CN": "搜索模式", "th": "โหมดการค้นหา"}, "Search companies, owners or products...": {"zh-CN": "搜索公司、所有人或产品...", "th": "ค้นหาบริษัท เจ้าของ หรือสินค้า..."}, "Primary business categories": {"zh-CN": "主要业务类别", "th": "หมวดหมู่ธุรกิจหลัก"}, "Search articles across the site.": {"zh-CN": "搜索全站文章。", "th": "ค้นหาบทความทั่วทั้งเว็บไซต์"}, "Why DBD DataWarehouse+": {"zh-CN": "为什么选择 DBD DataWarehouse+", "th": "ทำไมต้อง DBD DataWarehouse+"}, "One hub for Thai company research": {"zh-CN": "泰国企业调研，一站搞定", "th": "ศูนย์รวมเดียวสำหรับการค้นคว้าข้อมูลบริษัทไทย"}, "Verified registration data, multilingual access and investment signals — all served from a single SEO-ready platform.": {"zh-CN": "已核实的注册数据、多语言访问与投资信号 — 全部由一个 SEO 就绪的平台提供。", "th": "ข้อมูลการจดทะเบียนที่ผ่านการตรวจสอบ การเข้าถึงหลายภาษา และสัญญาณการลงทุน — ทั้งหมดจากแพลตฟอร์มเดียวที่พร้อมรองรับ SEO"}, "Full registration coverage": {"zh-CN": "全量注册数据覆盖", "th": "ครอบคลุมข้อมูลการจดทะเบียนครบถ้วน"}, "Verified records for every registered company in Thailand, sourced from DBD DataWarehouse+ and refreshed daily.": {"zh-CN": "覆盖泰国每一家注册企业的已核实记录，数据来源 DBD DataWarehouse+，每日刷新。", "th": "ข้อมูลที่ผ่านการตรวจสอบสำหรับบริษัทจดทะเบียนทุกแห่งในไทย จากแหล่งข้อมูล DBD DataWarehouse+ และอัปเดตทุกวัน"}, "Trilingual search": {"zh-CN": "三语检索", "th": "ค้นหาสามภาษา"}, "Read company names, provinces and business objectives in Thai, English and Chinese from one unified index.": {"zh-CN": "在统一索引中，以泰文、英文和中文查看公司名称、府和经营范围。", "th": "อ่านชื่อบริษัท จังหวัด และวัตถุประสงค์ทางธุรกิจในภาษาไทย อังกฤษ และจีน จากดัชนีเดียวที่รวมเป็นหนึ่ง"}, "Capital & financial signals": {"zh-CN": "资本与财务信号", "th": "สัญญาณทุนและการเงิน"}, "Surface foreign-capital flags, nationality, registered capital and revenue indicators for fast investment screening.": {"zh-CN": "呈现外资标识、国籍、注册资本和营收指标，助力快速投资筛查。", "th": "แสดงสัญญาณทุนต่างชาติ สัญชาติ ทุนจดทะเบียน และตัวชี้วัดรายได้ เพื่อการคัดกรองการลงทุนอย่างรวดเร็ว"}, "Director & ownership links": {"zh-CN": "董事与所有权关系", "th": "ความเชื่อมโยงกรรมการและความเป็นเจ้าของ"}, "Trace shared directors and ownership connections across companies to support partner and due-diligence checks.": {"zh-CN": "追溯企业间共享董事与所有权关联，支撑合作伙伴核查与尽职调查。", "th": "ติดตามกรรมการที่ใช้ร่วมกันและความเชื่อมโยงด้านความเป็นเจ้าของระหว่างบริษัท เพื่อสนับสนุนการตรวจสอบคู่ค้าและการตรวจสอบสถานะ"}, "Platform data coverage": {"zh-CN": "平台数据覆盖", "th": "ความครอบคลุมของข้อมูลแพลตฟอร์ม"}, "Display languages": {"zh-CN": "显示语言", "th": "ภาษาที่แสดง"}, "Data sourced from DBD DataWarehouse+ and refreshed daily.": {"zh-CN": "数据来源 DBD DataWarehouse+，每日刷新。", "th": "ข้อมูลจาก DBD DataWarehouse+ และอัปเดตทุกวัน"}, "Explore Thai companies": {"zh-CN": "探索泰国企业", "th": "สำรวจบริษัทไทย"}, "A live, server-rendered sample of registered Thai companies — open any profile to view registration, location and business scope.": {"zh-CN": "实时、服务端渲染的泰国注册企业样本 — 打开任一档案即可查看注册信息、所在地和经营范围。", "th": "ตัวอย่างบริษัทไทยที่จดทะเบียนแบบเรียลไทม์และเรนเดอร์ฝั่งเซิร์ฟเวอร์ — เปิดโปรไฟล์ใดก็ได้เพื่อดูข้อมูลการจดทะเบียน ที่ตั้ง และขอบเขตธุรกิจ"}, "View all companies": {"zh-CN": "查看全部公司", "th": "ดูบริษัททั้งหมด"}, "Why BizThai": {"zh-CN": "为什么选择 BizThai", "th": "ทำไมต้อง BizThai"}, "Your hub for Thai company research": {"zh-CN": "泰国企业调研，从这里开始", "th": "ศูนย์กลางการค้นคว้าข้อมูลบริษัทไทยของคุณ"}, "Verified registration records, trilingual access and investment signals — all in one place.": {"zh-CN": "已核实的注册记录、三语访问与投资信号 — 尽在一处。", "th": "ข้อมูลการจดทะเบียนที่ผ่านการตรวจสอบ การเข้าถึงสามภาษา และสัญญาณการลงทุน — ครบในที่เดียว"}, "Verified records for every company registered in Thailand, sourced directly from DBD DataWarehouse+.": {"zh-CN": "覆盖每一家在泰国注册的企业的已核实记录，数据直接来源 DBD DataWarehouse+。", "th": "ข้อมูลที่ผ่านการตรวจสอบสำหรับบริษัทที่จดทะเบียนในไทยทุกแห่ง จากแหล่งข้อมูล DBD DataWarehouse+ โดยตรง"}, "Find and read company names, locations and business activities in Thai, English and Chinese.": {"zh-CN": "以泰文、英文和中文查找并阅读公司名称、所在地和经营业务。", "th": "ค้นหาและอ่านชื่อบริษัท ที่ตั้ง และกิจกรรมทางธุรกิจในภาษาไทย อังกฤษ และจีน"}, "Spot foreign-capital, nationality, registered-capital and revenue indicators for faster investment screening.": {"zh-CN": "快速识别外资、国籍、注册资本和营收指标，加速投资筛查。", "th": "ระบุสัญญาณทุนต่างชาติ สัญชาติ ทุนจดทะเบียน และรายได้ เพื่อการคัดกรองการลงทุนที่รวดเร็วขึ้น"}, "Trace shared directors and ownership ties across companies for partner and due-diligence checks.": {"zh-CN": "追溯企业间的共享董事与所有权关联，用于合作伙伴核查与尽职调查。", "th": "ติดตามกรรมการที่ใช้ร่วมกันและความสัมพันธ์ด้านความเป็นเจ้าของระหว่างบริษัท เพื่อการตรวจสอบคู่ค้าและการตรวจสอบสถานะ"}, "Companies indexed": {"zh-CN": "收录企业", "th": "บริษัทที่จัดทำดัชนี"}, "Provinces & districts": {"zh-CN": "府与县", "th": "จังหวัดและอำเภอ"}, "Industry categories": {"zh-CN": "行业门类", "th": "หมวดหมู่อุตสาหกรรม"}, "Languages": {"zh-CN": "语言", "th": "ภาษา"}, "Data sourced from DBD DataWarehouse+.": {"zh-CN": "数据来源 DBD DataWarehouse+。", "th": "ข้อมูลจาก DBD DataWarehouse+"}, "Browse registered Thai companies and open any profile for registration details, location and business scope.": {"zh-CN": "浏览已注册的泰国企业，打开任一档案查看注册详情、所在地和经营范围。", "th": "เรียกดูบริษัทไทยที่จดทะเบียนแล้ว และเปิดโปรไฟล์ใดก็ได้เพื่อดูรายละเอียดการจดทะเบียน ที่ตั้ง และขอบเขตธุรกิจ"}, "Find companies and partners with AI": {"zh-CN": "用 AI 找企业与合作伙伴", "th": "ค้นหาบริษัทและพันธมิตรด้วย AI"}, "Describe the business you're looking for — an industry, a region, a type of supplier — and let AI surface matching Thai companies and partnership opportunities.": {"zh-CN": "描述你要找的业务 — 行业、地区、供应商类型 — 让 AI 为你筛出匹配的泰国企业与合作机会。", "th": "อธิบายธุรกิจที่คุณกำลังมองหา — อุตสาหกรรม ภูมิภาค หรือประเภทซัพพลายเออร์ — แล้วให้ AI ค้นหาบริษัทไทยและโอกาสความร่วมมือที่ตรงกัน"}, "e.g. food export companies in Chonburi": {"zh-CN": "例如：春武里的食品出口企业", "th": "เช่น บริษัทส่งออกอาหารในชลบุรี"}, "Ask AI": {"zh-CN": "问 AI", "th": "ถาม AI"}, "Browse every registered company": {"zh-CN": "浏览每一家注册企业", "th": "เรียกดูบริษัทจดทะเบียนทุกแห่ง"}, "Top firms by region and revenue": {"zh-CN": "按地区和营收排名的头部企业", "th": "บริษัทชั้นนำตามภูมิภาคและรายได้"}, "Companies backed by foreign capital": {"zh-CN": "有外资背景的企业", "th": "บริษัทที่มีทุนต่างชาติหนุนหลัง"}, "Latest business registrations": {"zh-CN": "最新企业注册", "th": "การจดทะเบียนธุรกิจล่าสุด"}, "Trends and breakdowns by sector": {"zh-CN": "按行业的趋势与细分", "th": "แนวโน้มและการแยกย่อยตามภาคธุรกิจ"}, "Investment mapped across provinces": {"zh-CN": "覆盖各府的投资分布", "th": "การลงทุนที่กระจายตามจังหวัด"}, "Industry Sector": {"zh-CN": "行业门类", "th": "ภาคอุตสาหกรรม"}, "companies registered in this industry sector.": {"zh-CN": "家公司注册在该行业门类。", "th": "บริษัทที่จดทะเบียนในภาคอุตสาหกรรมนี้"}, "Browse Thai companies registered in this industry sector, sourced from DBD DataWarehouse+.": {"zh-CN": "浏览注册在该行业门类的泰国公司，数据来源 DBD DataWarehouse+。", "th": "เรียกดูบริษัทไทยที่จดทะเบียนในภาคอุตสาหกรรมนี้ ข้อมูลจาก DBD DataWarehouse+"}, "Search companies in this industry": {"zh-CN": "在该行业内搜索公司", "th": "ค้นหาบริษัทในอุตสาหกรรมนี้"}, "Companies in this sector": {"zh-CN": "该门类公司数", "th": "บริษัทในภาคนี้"}, "Total company records": {"zh-CN": "公司记录总数", "th": "จำนวนบันทึกบริษัททั้งหมด"}, "Companies in this industry": {"zh-CN": "该行业的公司", "th": "บริษัทในอุตสาหกรรมนี้"}, "Business scope": {"zh-CN": "经营范围", "th": "ขอบเขตธุรกิจ"}, "Registered capital": {"zh-CN": "注册资本", "th": "ทุนจดทะเบียน"}, "Loading companies…": {"zh-CN": "正在加载公司…", "th": "กำลังโหลดบริษัท…"}, "Pagination": {"zh-CN": "分页", "th": "การแบ่งหน้า"}, "AI smart search": {"zh-CN": "AI 智能搜索", "th": "ค้นหาอัจฉริยะด้วย AI"}, "Ask AI: describe the company, owner or sector you need": {"zh-CN": "问 AI:描述你要找的公司、所有人或行业", "th": "ถาม AI: อธิบายบริษัท เจ้าของ หรือภาคธุรกิจที่ต้องการ"}, "that reads every Thai company for you": {"zh-CN": "为你读懂每一家泰国企业", "th": "ที่อ่านทุกบริษัทไทยให้คุณ"}, "AI search": {"zh-CN": "AI 搜索", "th": "ค้นหา AI"}, "Come to BizThai.com and use AI to discover your next Thai partner.": {"zh-CN": "来BizThai.com，利用人工智能发现下一个泰国合作伙伴", "th": "มาที่ BizThai.com แล้วใช้ AI ค้นพบพันธมิตรไทยรายถัดไปของคุณ"}, "(optional)": {"zh-CN": "（可选）", "th": "(ไม่บังคับ)"}, "A compact summary of province concentration, business objectives and capital totals in one view.": {"zh-CN": "在一个视图中简洁汇总省份集中度、业务目标和资本总额。", "th": "สรุปย่อความเข้มข้นของจังหวัด วัตถุประสงค์ทางธุรกิจ และทุนรวมในมุมมองเดียว"}, "A company's presence on the platform does not indicate compliance, financial health, legal standing or business reputation.": {"zh-CN": "公司在平台上的存在并不表示其合规性、财务状况、法律地位或商业声誉。", "th": "การปรากฏของบริษัทบนแพลตฟอร์มไม่ได้บ่งชี้ถึงการปฏิบัติตามกฎระเบียบ สุขภาพทางการเงิน สถานะทางกฎหมาย หรือชื่อเสียงทางธุรกิจ"}, "A court order;": {"zh-CN": "法院命令；", "th": "คำสั่งศาล;"}, "A statement confirming that the information provided is accurate": {"zh-CN": "确认所提供信息准确的声明", "th": "คำแถลงยืนยันว่าข้อมูลที่ให้ไว้ถูกต้อง"}, "A suite of research reports built on full-database aggregates of Thai company registrations from DBD DataWarehouse+. Choose a report below to explore companies, capital, industries and regions.": {"zh-CN": "一套基于DBD DataWarehouse+泰国公司注册全数据库汇总的研究报告。选择下方报告，探索公司、资本、行业和地区。", "th": "ชุดรายงานวิจัยที่สร้างจากข้อมูลรวมทะเบียนบริษัทไทยทั้งฐานข้อมูลจาก DBD DataWarehouse+ เลือกรายงานด้านล่างเพื่อสำรวจบริษัท ทุน อุตสาหกรรม และภูมิภาค"}, "AI Company Due Diligence": {"zh-CN": "AI 公司尽职调查", "th": "AI การตรวจสอบสถานะบริษัท"}, "AI Intelligence": {"zh-CN": "AI 智能", "th": "AI ความฉลาด"}, "AI Mode": {"zh-CN": "AI 模式", "th": "โหมด AI"}, "AI Search": {"zh-CN": "AI 搜索", "th": "ค้นหา AI"}, "AI can make mistakes. Verify important details against the official company record. Data: DBD DataWarehouse+.": {"zh-CN": "AI 可能会犯错。请对照官方公司记录核实重要细节。数据来源：DBD DataWarehouse+。", "th": "AI อาจผิดพลาดได้ โปรดตรวจสอบรายละเอียดสำคัญกับบันทึกบริษัททางการ ข้อมูล: DBD DataWarehouse+"}, "AI chat mode": {"zh-CN": "AI 聊天模式", "th": "โหมดแชท AI"}, "AI overview": {"zh-CN": "AI 概览", "th": "ภาพรวม AI"}, "API and Commercial Licensing": {"zh-CN": "API 和商业许可", "th": "API และใบอนุญาตเชิงพาณิชย์"}, "About BizThai": {"zh-CN": "关于 BizThai", "th": "เกี่ยวกับ BizThai"}, "About Our Data": {"zh-CN": "关于我们的数据", "th": "เกี่ยวกับข้อมูลของเรา"}, "Academic research": {"zh-CN": "学术研究", "th": "งานวิจัยทางวิชาการ"}, "Acceptance of Terms": {"zh-CN": "接受条款", "th": "การยอมรับข้อกำหนด"}, "Access to personal information": {"zh-CN": "访问个人信息", "th": "การเข้าถึงข้อมูลส่วนบุคคล"}, "Accessibility statement": {"zh-CN": "无障碍声明", "th": "คำแถลงการเข้าถึง"}, "Accommodation & Food Service": {"zh-CN": "住宿和餐饮服务", "th": "ที่พักและบริการอาหาร"}, "Account Termination": {"zh-CN": "账户终止", "th": "การยกเลิกบัญชี"}, "Accounting advice": {"zh-CN": "会计建议", "th": "คำแนะนำด้านบัญชี"}, "Accuracy": {"zh-CN": "准确性", "th": "ความถูกต้อง"}, "Accurate": {"zh-CN": "准确", "th": "ถูกต้อง"}, "Add missing public information;": {"zh-CN": "添加缺失的公开信息；", "th": "เพิ่มข้อมูลสาธารณะที่ขาดหายไป;"}, "Additional Contact Information": {"zh-CN": "附加联系信息", "th": "ข้อมูลการติดต่อเพิ่มเติม"}, "Additional verification may be required.": {"zh-CN": "可能需要额外验证。", "th": "อาจต้องมีการยืนยันเพิ่มเติม"}, "Administrative & Support Service": {"zh-CN": "行政与支持服务", "th": "บริการด้านการบริหารและการสนับสนุน"}, "Agriculture, Forestry & Fishing": {"zh-CN": "农业、林业和渔业", "th": "เกษตรกรรม ป่าไม้ และการประมง"}, "All industries": {"zh-CN": "所有行业", "th": "ทุกอุตสาหกรรม"}, "All information published on BizThai is provided solely for informational and reference purposes.": {"zh-CN": "BizThai 上发布的所有信息仅供信息和参考之用。", "th": "ข้อมูลทั้งหมดที่เผยแพร่บน BizThai มีไว้เพื่อวัตถุประสงค์ในการให้ข้อมูลและอ้างอิงเท่านั้น"}, "All ownership": {"zh-CN": "所有所有权类型", "th": "ทุกประเภทความเป็นเจ้าของ"}, "All provinces": {"zh-CN": "所有省份", "th": "ทุกจังหวัด"}, "All updates remain subject to BizThai review.": {"zh-CN": "所有更新仍需经过 BizThai 审核。", "th": "การอัปเดตทั้งหมดยังคงต้องผ่านการตรวจสอบโดย BizThai"}, "Although BizThai makes reasonable efforts to maintain accurate information, BizThai does not guarantee that all information is complete, current or error-free.": {"zh-CN": "尽管 BizThai 会尽合理努力维护准确信息，但 BizThai 不保证所有信息完整、最新或无错误。", "th": "แม้ว่า BizThai จะพยายามอย่างสมเหตุสมผลเพื่อรักษาข้อมูลที่ถูกต้อง แต่ BizThai ไม่รับประกันว่าข้อมูลทั้งหมดจะสมบูรณ์ เป็นปัจจุบัน หรือปราศจากข้อผิดพลาด"}, "Analyse a logistics company in Chonburi": {"zh-CN": "分析春武里的一家物流公司", "th": "วิเคราะห์บริษัทโลจิสติกส์ในชลบุรี"}, "Analyze platform performance": {"zh-CN": "分析平台性能", "th": "วิเคราะห์ประสิทธิภาพของแพลตฟอร์ม"}, "Any decisions made by users based on information obtained from BizThai are made entirely at their own risk.": {"zh-CN": "用户根据从 BizThai 获取的信息做出的任何决定完全由其自行承担风险。", "th": "การตัดสินใจใดๆ ที่ผู้ใช้ทำขึ้นโดยอาศัยข้อมูลที่ได้รับจาก BizThai ถือเป็นความเสี่ยงของผู้ใช้เอง"}, "Any dispute arising out of or relating to these Terms shall be subject to the jurisdiction of the competent courts of Thailand unless otherwise required by applicable law.": {"zh-CN": "因本条款引起或与之相关的任何争议应受泰国主管法院管辖，除非适用法律另有规定。", "th": "ข้อพิพาทใดๆ ที่เกิดขึ้นจากหรือเกี่ยวข้องกับข้อกำหนดเหล่านี้จะอยู่ภายใต้เขตอำนาจศาลของศาลที่มีอำนาจในประเทศไทย เว้นแต่กฎหมายที่เกี่ยวข้องจะกำหนดไว้เป็นอย่างอื่น"}, "Applicable laws require removal": {"zh-CN": "适用法律要求删除", "th": "กฎหมายที่เกี่ยวข้องกำหนดให้ลบออก"}, "Applicants may be required to submit:": {"zh-CN": "申请人可能需要提交：", "th": "ผู้สมัครอาจต้องส่ง:"}, "Applicants should submit a request through:": {"zh-CN": "申请人应通过以下方式提交请求：", "th": "ผู้สมัครควรส่งคำขอผ่าน:"}, "Approve or reject the request": {"zh-CN": "批准或拒绝请求", "th": "อนุมัติหรือปฏิเสธคำขอ"}, "Approved companies may receive a \"Verified Business\" badge displayed on their company profile.": {"zh-CN": "获批的公司可能会在其公司资料上显示“已验证企业”徽章。", "th": "บริษัทที่ได้รับการอนุมัติอาจได้รับป้าย \"ธุรกิจที่ได้รับการยืนยัน\" แสดงบนโปรไฟล์บริษัท"}, "Arts, Entertainment & Recreation": {"zh-CN": "艺术、娱乐和休闲", "th": "ศิลปะ ความบันเทิง และนันทนาการ"}, "Associate related public records.": {"zh-CN": "关联相关公共记录。", "th": "เชื่อมโยงบันทึกสาธารณะที่เกี่ยวข้อง"}, "At BizThai, we believe that transparent business information helps create a healthier business environment.": {"zh-CN": "在 BizThai，我们相信透明的商业信息有助于创造更健康的商业环境。", "th": "ที่ BizThai เราเชื่อว่าข้อมูลธุรกิจที่โปร่งใสช่วยสร้างสภาพแวดล้อมทางธุรกิจที่ดีต่อสุขภาพ"}, "At least 8 characters.": {"zh-CN": "至少8个字符。", "th": "อย่างน้อย 8 ตัวอักษร"}, "Attempt unauthorized access": {"zh-CN": "尝试未经授权的访问", "th": "พยายามเข้าถึงโดยไม่ได้รับอนุญาต"}, "Authorized Employee": {"zh-CN": "授权员工", "th": "พนักงานที่ได้รับอนุญาต"}, "Authorized Signatory": {"zh-CN": "授权签字人", "th": "ผู้มีอำนาจลงนาม"}, "Authorized representatives": {"zh-CN": "授权代表", "th": "ตัวแทนที่ได้รับอนุญาต"}, "Availability of source data;": {"zh-CN": "源数据的可用性；", "th": "ความพร้อมของข้อมูลต้นทาง;"}, "Back to sign in": {"zh-CN": "返回登录", "th": "กลับไปที่หน้าเข้าสู่ระบบ"}, "Backend-managed industry terms.": {"zh-CN": "后端管理的行业术语。", "th": "คำศัพท์อุตสาหกรรมที่จัดการโดยระบบแบ็กเอนด์"}, "Bangkok companies": {"zh-CN": "曼谷公司", "th": "บริษัทในกรุงเทพฯ"}, "BizThai (\"BizThai\", \"we\", \"our\", or \"us\") respects your privacy and is committed to protecting your personal information.": {"zh-CN": "BizThai（“BizThai”、“我们”、“我们的”）尊重您的隐私，并致力于保护您的个人信息。", "th": "BizThai (\"BizThai\", \"เรา\", \"ของเรา\") เคารพความเป็นส่วนตัวของคุณและมุ่งมั่นที่จะปกป้องข้อมูลส่วนบุคคลของคุณ"}, "BizThai accepts requests from:": {"zh-CN": "BizThai 接受来自以下方面的请求：", "th": "BizThai รับคำขอจาก:"}, "BizThai aims to review copyright complaints within 7–15 business days.": {"zh-CN": "BizThai 旨在 7-15 个工作日内审查版权投诉。", "th": "BizThai ตั้งเป้าที่จะตรวจสอบข้อร้องเรียนด้านลิขสิทธิ์ภายใน 7-15 วันทำการ"}, "BizThai aims to review requests within 7–15 business days, although complex cases may require additional time.": {"zh-CN": "BizThai 旨在 7-15 个工作日内审查请求，但复杂案件可能需要额外时间。", "th": "BizThai ตั้งเป้าที่จะตรวจสอบคำขอภายใน 7-15 วันทำการ แม้ว่ากรณีที่ซับซ้อนอาจต้องใช้เวลาเพิ่มเติม"}, "BizThai does not accept payment in exchange for removing, hiding or suppressing lawfully published public business information.": {"zh-CN": "BizThai 不接受以付款换取删除、隐藏或压制合法发布的公共商业信息。", "th": "BizThai ไม่รับการชำระเงินเพื่อแลกกับการลบ ซ่อน หรือระงับข้อมูลธุรกิจสาธารณะที่เผยแพร่โดยชอบด้วยกฎหมาย"}, "BizThai does not claim ownership of official government records.": {"zh-CN": "BizThai 不主张对官方政府记录的所有权。", "th": "BizThai ไม่ได้อ้างสิทธิ์ความเป็นเจ้าของบันทึกของรัฐบาลอย่างเป็นทางการ"}, "BizThai does not claim ownership of third-party intellectual property.": {"zh-CN": "BizThai 不主张对第三方知识产权的所有权。", "th": "BizThai ไม่ได้อ้างสิทธิ์ความเป็นเจ้าของทรัพย์สินทางปัญญาของบุคคลที่สาม"}, "BizThai does not control, verify or guarantee the accuracy, completeness or reliability of third-party information and shall not be responsible for any errors or omissions contained therein.": {"zh-CN": "BizThai 不控制、验证或保证第三方信息的准确性、完整性或可靠性，并且不对其中包含的任何错误或遗漏负责。", "th": "BizThai ไม่ได้ควบคุม ตรวจสอบ หรือรับประกันความถูกต้อง ความสมบูรณ์ หรือความน่าเชื่อถือของข้อมูลของบุคคลที่สาม และจะไม่รับผิดชอบต่อข้อผิดพลาดหรือการละเว้นใดๆ ที่มีอยู่ในข้อมูลดังกล่าว"}, "BizThai does not endorse, control or accept responsibility for the content, privacy practices or services of any third-party websites.": {"zh-CN": "BizThai 不认可、控制或对任何第三方网站的内容、隐私做法或服务承担责任。", "th": "BizThai ไม่รับรอง ควบคุม หรือยอมรับความรับผิดชอบต่อเนื้อหา แนวปฏิบัติด้านความเป็นส่วนตัว หรือบริการของเว็บไซต์บุคคลที่สามใดๆ"}, "BizThai does not guarantee real-time updates.": {"zh-CN": "BizThai 不保证实时更新。", "th": "BizThai ไม่รับประกันการอัปเดตแบบเรียลไทม์"}, "BizThai does not independently create official corporate registration records.": {"zh-CN": "BizThai 不独立创建官方公司注册记录。", "th": "BizThai ไม่ได้สร้างบันทึกการจดทะเบียนนิติบุคคลอย่างเป็นทางการโดยอิสระ"}, "BizThai does not intentionally alter the meaning of official public records.": {"zh-CN": "BizThai 不会故意改变官方公共记录的含义。", "th": "BizThai ไม่ได้จงใจเปลี่ยนแปลงความหมายของบันทึกสาธารณะอย่างเป็นทางการ"}, "BizThai does not intentionally manipulate business information to favor or disadvantage any company.": {"zh-CN": "BizThai 不会故意操纵商业信息以偏袒或不利于任何公司。", "th": "BizThai ไม่ได้จงใจจัดการข้อมูลธุรกิจเพื่อเอื้อประโยชน์หรือเสียเปรียบบริษัทใดๆ"}, "BizThai expects all users, companies and content providers to respect the intellectual property rights of others.": {"zh-CN": "BizThai 期望所有用户、公司和内容提供商尊重他人的知识产权。", "th": "BizThai คาดหวังให้ผู้ใช้ บริษัท และผู้ให้บริการเนื้อหาทั้งหมดเคารพสิทธิ์ในทรัพย์สินทางปัญญาของผู้อื่น"}, "BizThai generally does not remove information originating from lawful public records merely upon request.": {"zh-CN": "BizThai 通常不会仅凭请求就删除来自合法公共记录的信息。", "th": "โดยทั่วไป BizThai จะไม่ลบข้อมูลที่มาจากบันทึกสาธารณะที่ชอบด้วยกฎหมายเพียงแค่ตามคำขอ"}, "BizThai generally does not remove information originating from lawful public records solely because a company or individual prefers that such information not be displayed.": {"zh-CN": "BizThai 通常不会仅因为公司或个人不希望显示此类信息而删除来自合法公共记录的信息。", "th": "โดยทั่วไป BizThai จะไม่ลบข้อมูลที่มาจากบันทึกสาธารณะที่ชอบด้วยกฎหมายเพียงเพราะบริษัทหรือบุคคลต้องการให้ไม่แสดงข้อมูลดังกล่าว"}, "BizThai generally does not remove information that originates from lawful public records solely because a company or individual prefers that such information not appear on the platform.": {"zh-CN": "BizThai 通常不会仅因为公司或个人不希望此类信息出现在平台上而删除来自合法公共记录的信息。", "th": "โดยทั่วไป BizThai จะไม่ลบข้อมูลที่มาจากบันทึกสาธารณะที่ชอบด้วยกฎหมายเพียงเพราะบริษัทหรือบุคคลต้องการให้ข้อมูลดังกล่าวไม่ปรากฏบนแพลตฟอร์ม"}, "BizThai generally does not remove public business information solely because a company or individual objects to its publication, unless required by applicable law, a valid court order or a competent government authority. Requests to correct inaccurate information should be submitted in accordance with the BizThai Data Correction Policy.": {"zh-CN": "BizThai 通常不会仅因公司或个人反对发布而删除公共商业信息，除非适用法律、有效法院命令或主管政府机构要求。纠正不准确信息的请求应根据 BizThai 数据更正政策提交。", "th": "โดยทั่วไป BizThai จะไม่ลบข้อมูลธุรกิจสาธารณะเพียงเพราะบริษัทหรือบุคคลคัดค้านการเผยแพร่ เว้นแต่กฎหมายที่เกี่ยวข้อง คำสั่งศาลที่มีผลบังคับ หรือหน่วยงานรัฐที่มีอำนาจกำหนดให้ต้องดำเนินการ คำขอแก้ไขข้อมูลที่ไม่ถูกต้องควรยื่นตามนโยบายการแก้ไขข้อมูลของ BizThai"}, "BizThai implements reasonable technical and organizational measures designed to protect information against unauthorized access, disclosure, alteration or destruction.": {"zh-CN": "BizThai 实施合理的技术和组织措施，旨在保护信息免受未经授权的访问、披露、更改或破坏。", "th": "BizThai ใช้มาตรการทางเทคนิคและการจัดการที่เหมาะสมเพื่อปกป้องข้อมูลจากการเข้าถึง การเปิดเผย การเปลี่ยนแปลง หรือการทำลายโดยไม่ได้รับอนุญาต"}, "BizThai is a business intelligence platform covering more than 800,000 companies registered in Thailand. We organise public registration records into clean company profiles, industry rankings and market reports, and make every record available in English, Thai and Chinese.": {"zh-CN": "BizThai 是一个商业智能平台，覆盖超过 80 万家在泰国注册的公司。我们将公开的注册记录整理成清晰的公司简介、行业排名和市场报告，并提供英文、泰文和中文版本。", "th": "BizThai เป็นแพลตฟอร์มข่าวกรองทางธุรกิจที่ครอบคลุมบริษัทที่จดทะเบียนในประเทศไทยมากกว่า 800,000 แห่ง เราจัดระเบียบข้อมูลทะเบียนสาธารณะเป็นโปรไฟล์บริษัทที่สะอาด การจัดอันดับอุตสาหกรรม และรายงานตลาด และทำให้ทุกบันทึกพร้อมใช้งานในภาษาอังกฤษ ภาษาไทย และภาษาจีน"}, "BizThai is an independent business information platform that collects, organizes and displays publicly available business information.": {"zh-CN": "BizThai 是一个独立的商业信息平台，收集、整理和展示公开可用的商业信息。", "th": "BizThai เป็นแพลตฟอร์มข้อมูลธุรกิจอิสระที่รวบรวม จัดระเบียบ และแสดงข้อมูลธุรกิจที่เปิดเผยต่อสาธารณะ"}, "BizThai is an independent business information platform that provides company and business-related information for general reference purposes only.": {"zh-CN": "BizThai 是一个独立的商业信息平台，仅提供公司和商业相关信息供一般参考。", "th": "BizThai เป็นแพลตฟอร์มข้อมูลธุรกิจอิสระที่ให้ข้อมูลเกี่ยวกับบริษัทและธุรกิจเพื่อการอ้างอิงทั่วไปเท่านั้น"}, "BizThai is an independent business information platform.": {"zh-CN": "BizThai 是一个独立的商业信息平台。", "th": "BizThai เป็นแพลตฟอร์มข้อมูลธุรกิจอิสระ"}, "BizThai is committed to maintaining the accuracy, integrity, independence and transparency of the business information published on the platform.": {"zh-CN": "BizThai 致力于维护平台上发布的商业信息的准确性、完整性、独立性和透明度。", "th": "BizThai มุ่งมั่นที่จะรักษาความถูกต้อง ความสมบูรณ์ ความเป็นอิสระ และความโปร่งใสของข้อมูลธุรกิจที่เผยแพร่บนแพลตฟอร์ม"}, "BizThai is committed to making its platform accessible to as many people as possible. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA and continually improve the experience for all users.": {"zh-CN": "BizThai 致力于让尽可能多的人访问其平台。我们的目标是符合 Web 内容无障碍指南 (WCAG) 2.1 AA 级，并不断改善所有用户的体验。", "th": "BizThai มุ่งมั่นที่จะทำให้แพลตฟอร์มสามารถเข้าถึงได้โดยคนจำนวนมากที่สุด เราตั้งเป้าที่จะปฏิบัติตามแนวทางการเข้าถึงเนื้อหาเว็บ (WCAG) 2.1 ระดับ AA และปรับปรุงประสบการณ์สำหรับผู้ใช้ทุกคนอย่างต่อเนื่อง"}, "BizThai is committed to providing accurate, transparent and reliable business information to the public.": {"zh-CN": "BizThai 致力于向公众提供准确、透明和可靠的商业信息。", "th": "BizThai มุ่งมั่นที่จะให้ข้อมูลธุรกิจที่ถูกต้อง โปร่งใส และเชื่อถือได้แก่สาธารณชน"}, "BizThai is committed to providing transparent, reliable and lawfully obtained business information.": {"zh-CN": "BizThai 致力于提供透明、可靠且合法获取的商业信息。", "th": "BizThai มุ่งมั่นที่จะให้ข้อมูลธุรกิจที่โปร่งใส เชื่อถือได้ และได้มาโดยชอบด้วยกฎหมาย"}, "BizThai is committed to:": {"zh-CN": "BizThai 致力于：", "th": "BizThai มุ่งมั่นที่จะ:"}, "BizThai is not a government agency and is not affiliated with, endorsed by, or acting on behalf of the Department of Business Development (DBD) or any government authority, unless expressly stated.": {"zh-CN": "BizThai 不是政府机构，除非明确说明，否则与商业发展厅 (DBD) 或任何政府机构没有关联、未经其认可或代表其行事。", "th": "BizThai ไม่ใช่หน่วยงานของรัฐ และไม่มีความเกี่ยวข้อง ได้รับการรับรอง หรือดำเนินการในนามของกรมพัฒนาธุรกิจการค้า (DBD) หรือหน่วยงานของรัฐใดๆ เว้นแต่จะระบุไว้อย่างชัดแจ้ง"}, "BizThai is not a government agency and is not affiliated with, endorsed by, or acting on behalf of the Department of Business Development (DBD), the Ministry of Commerce of Thailand, or any other government authority unless expressly stated.": {"zh-CN": "BizThai 不是政府机构，除非明确说明，否则与商业发展厅 (DBD)、泰国商务部或任何其他政府机构没有关联、未经其认可或代表其行事。", "th": "BizThai ไม่ใช่หน่วยงานของรัฐ และไม่มีความเกี่ยวข้อง ได้รับการรับรอง หรือดำเนินการในนามของกรมพัฒนาธุรกิจการค้า (DBD) กระทรวงพาณิชย์ของประเทศไทย หรือหน่วยงานของรัฐอื่นใด เว้นแต่จะระบุไว้อย่างชัดแจ้ง"}, "BizThai is not a government agency, not affiliated with the Department of Business Development (DBD) or any other government authority.": {"zh-CN": "BizThai 不是政府机构，与商业发展厅 (DBD) 或任何其他政府机构没有关联。", "th": "BizThai ไม่ใช่หน่วยงานของรัฐ ไม่มีความเกี่ยวข้องกับกรมพัฒนาธุรกิจการค้า (DBD) หรือหน่วยงานของรัฐอื่นใด"}, "BizThai is not intended for children under the age of 18.": {"zh-CN": "BizThai 不适用于 18 岁以下的儿童。", "th": "BizThai ไม่ได้มีไว้สำหรับเด็กอายุต่ำกว่า 18 ปี"}, "BizThai is not responsible for any consequences arising from the use of information on the website.": {"zh-CN": "BizThai 不对因使用网站信息而产生的任何后果负责。", "th": "BizThai ไม่รับผิดชอบต่อผลกระทบใดๆ ที่เกิดจากการใช้ข้อมูลบนเว็บไซต์"}, "BizThai is not responsible for the accuracy, legality or completeness of third-party content.": {"zh-CN": "BizThai 不对第三方内容的准确性、合法性或完整性负责。", "th": "BizThai ไม่รับผิดชอบต่อความถูกต้อง ความถูกต้องตามกฎหมาย หรือความสมบูรณ์ของเนื้อหาของบุคคลที่สาม"}, "BizThai makes reasonable efforts to ensure that published information is accurate and based on lawful sources.": {"zh-CN": "BizThai 做出合理努力，确保发布的信息准确且基于合法来源。", "th": "BizThai พยายามอย่างสมเหตุสมผลเพื่อให้แน่ใจว่าข้อมูลที่เผยแพร่มีความถูกต้องและอ้างอิงจากแหล่งที่มาที่ชอบด้วยกฎหมาย"}, "BizThai makes reasonable efforts to maintain accurate and up-to-date information.": {"zh-CN": "BizThai 做出合理努力，保持信息的准确性和最新性。", "th": "BizThai พยายามอย่างสมเหตุสมผลเพื่อรักษาข้อมูลให้ถูกต้องและเป็นปัจจุบัน"}, "BizThai makes reasonable efforts to maintain accurate information but does not guarantee that all business information is complete, current or error-free.": {"zh-CN": "BizThai 做出合理努力保持信息准确，但不保证所有商业信息完整、最新或无错误。", "th": "BizThai พยายามอย่างสมเหตุสมผลเพื่อรักษาข้อมูลให้ถูกต้อง แต่ไม่รับประกันว่าข้อมูลธุรกิจทั้งหมดจะสมบูรณ์ เป็นปัจจุบัน หรือปราศจากข้อผิดพลาด"}, "BizThai makes reasonable efforts to maintain accurate information.": {"zh-CN": "BizThai 做出合理努力保持信息准确。", "th": "BizThai พยายามอย่างสมเหตุสมผลเพื่อรักษาข้อมูลให้ถูกต้อง"}, "BizThai may amend this Policy from time to time. The latest version will always be published on the BizThai website.": {"zh-CN": "BizThai 可能会不时修改本政策。最新版本将始终发布在 BizThai 网站上。", "th": "BizThai อาจแก้ไขนโยบายนี้เป็นครั้งคราว เวอร์ชันล่าสุดจะถูกเผยแพร่บนเว็บไซต์ BizThai เสมอ"}, "BizThai may contain information supplied by third parties.": {"zh-CN": "BizThai 可能包含第三方提供的信息。", "th": "BizThai อาจมีข้อมูลที่จัดหาโดยบุคคลที่สาม"}, "BizThai may contain links to third-party websites. Such links are provided solely for convenience.": {"zh-CN": "BizThai 可能包含指向第三方网站的链接。此类链接仅供方便之用。", "th": "BizThai อาจมีลิงก์ไปยังเว็บไซต์ของบุคคลที่สาม ลิงก์ดังกล่าวมีไว้เพื่อความสะดวกเท่านั้น"}, "BizThai may disclose information when:": {"zh-CN": "BizThai 可能在以下情况下披露信息：", "th": "BizThai อาจเปิดเผยข้อมูลเมื่อ:"}, "BizThai may display information obtained from:": {"zh-CN": "BizThai 可能显示从以下来源获取的信息：", "th": "BizThai อาจแสดงข้อมูลที่ได้จาก:"}, "BizThai may display information supplied by third parties.": {"zh-CN": "BizThai 可能显示由第三方提供的信息。", "th": "BizThai อาจแสดงข้อมูลที่จัดหาโดยบุคคลที่สาม"}, "BizThai may expand its database by integrating additional lawful public data sources from Thailand and other jurisdictions.": {"zh-CN": "BizThai 可能通过整合来自泰国及其他司法管辖区的额外合法公共数据源来扩展其数据库。", "th": "BizThai อาจขยายฐานข้อมูลโดยการรวมแหล่งข้อมูลสาธารณะที่ถูกกฎหมายเพิ่มเติมจากประเทศไทยและเขตอำนาจศาลอื่นๆ"}, "BizThai may provide verification services free of charge or as part of a paid subscription.": {"zh-CN": "BizThai 可能免费提供验证服务，或作为付费订阅的一部分。", "th": "BizThai อาจให้บริการยืนยันตัวตนโดยไม่คิดค่าใช้จ่ายหรือเป็นส่วนหนึ่งของการสมัครสมาชิกแบบชำระเงิน"}, "BizThai may publish statistics regarding:": {"zh-CN": "BizThai 可能发布关于以下方面的统计数据：", "th": "BizThai อาจเผยแพร่สถิติเกี่ยวกับ:"}, "BizThai may request additional documents to verify the applicant's identity and authority.": {"zh-CN": "BizThai 可能要求提供额外文件以验证申请人的身份和权限。", "th": "BizThai อาจขอเอกสารเพิ่มเติมเพื่อยืนยันตัวตนและอำนาจของผู้สมัคร"}, "BizThai may request supporting documents before making any changes.": {"zh-CN": "BizThai 可能在进行任何更改前要求提供支持文件。", "th": "BizThai อาจขอเอกสารประกอบก่อนทำการเปลี่ยนแปลงใดๆ"}, "BizThai may suspend, revoke or refuse verification if:": {"zh-CN": "BizThai 可能暂停、撤销或拒绝验证，如果：", "th": "BizThai อาจระงับ เพิกถอน หรือปฏิเสธการยืนยันตัวตน หาก:"}, "BizThai may update this Privacy Policy from time to time.": {"zh-CN": "BizThai 可能不时更新本隐私政策。", "th": "BizThai อาจอัปเดตนโยบายความเป็นส่วนตัวนี้เป็นครั้งคราว"}, "BizThai may use third-party services including:": {"zh-CN": "BizThai 可能使用第三方服务，包括：", "th": "BizThai อาจใช้บริการของบุคคลที่สาม รวมถึง:"}, "BizThai organizes and presents such information but does not create official government records.": {"zh-CN": "BizThai 组织和呈现此类信息，但不创建官方政府记录。", "th": "BizThai จัดระเบียบและนำเสนอข้อมูลดังกล่าว แต่ไม่ได้สร้างบันทึกทางการของรัฐบาล"}, "BizThai periodically updates information from available lawful sources.": {"zh-CN": "BizThai 定期从可用的合法来源更新信息。", "th": "BizThai อัปเดตข้อมูลจากแหล่งที่ถูกกฎหมายที่มีอยู่เป็นระยะ"}, "BizThai primarily provides access to publicly available business information.": {"zh-CN": "BizThai 主要提供对公开商业信息的访问。", "th": "BizThai ให้การเข้าถึงข้อมูลธุรกิจที่เปิดเผยต่อสาธารณะเป็นหลัก"}, "BizThai provides a Business Verification Program to allow authorized representatives of a company to verify ownership of their company profile and manage certain business information available on the BizThai platform.": {"zh-CN": "BizThai 提供企业验证计划，允许公司的授权代表验证其公司资料的所有权，并管理 BizThai 平台上可用的某些商业信息。", "th": "BizThai มีโปรแกรมยืนยันตัวตนทางธุรกิจเพื่อให้ตัวแทนที่ได้รับอนุญาตของบริษัทสามารถยืนยันความเป็นเจ้าของโปรไฟล์บริษัทของตนและจัดการข้อมูลธุรกิจบางอย่างที่มีอยู่ในแพลตฟอร์ม BizThai"}, "BizThai provides business information to promote transparency, support due diligence and facilitate informed business decisions.": {"zh-CN": "BizThai 提供商业信息以促进透明度、支持尽职调查并促进明智的商业决策。", "th": "BizThai ให้ข้อมูลธุรกิจเพื่อส่งเสริมความโปร่งใส สนับสนุนการตรวจสอบสถานะ และอำนวยความสะดวกในการตัดสินใจทางธุรกิจอย่างมีข้อมูล"}, "BizThai reserves the right to amend these Terms at any time.": {"zh-CN": "BizThai 保留随时修改这些条款的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการแก้ไขข้อกำหนดเหล่านี้ได้ตลอดเวลา"}, "BizThai reserves the right to amend this Policy at any time.": {"zh-CN": "BizThai 保留随时修改本政策的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการแก้ไขนโยบายนี้ได้ตลอดเวลา"}, "BizThai reserves the right to determine whether any update or correction is appropriate after reviewing supporting documentation.": {"zh-CN": "BizThai 保留在审查支持文件后决定任何更新或更正是否适当的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการพิจารณาว่าการอัปเดตหรือแก้ไขใดๆ เหมาะสมหรือไม่หลังจากตรวจสอบเอกสารประกอบ"}, "BizThai reserves the right to modify, update, remove or reorganize any information available on the platform without prior notice.": {"zh-CN": "BizThai 保留修改、更新、删除或重新组织平台上任何信息的权利，恕不另行通知。", "th": "BizThai ขอสงวนสิทธิ์ในการแก้ไข อัปเดต ลบ หรือจัดระเบียบข้อมูลใดๆ ที่มีอยู่ในแพลตฟอร์มโดยไม่ต้องแจ้งให้ทราบล่วงหน้า"}, "BizThai reserves the right to request additional documentation.": {"zh-CN": "BizThai 保留要求提供额外文件的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการขอเอกสารเพิ่มเติม"}, "BizThai reserves the right to request proof of authority.": {"zh-CN": "BizThai 保留要求提供授权证明的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการขอหลักฐานการมีอำนาจ"}, "BizThai reserves the right to restrict, suspend or terminate access for users or organizations that repeatedly submit infringing material or abuse the copyright complaint process.": {"zh-CN": "BizThai 保留限制、暂停或终止反复提交侵权材料或滥用版权投诉流程的用户或组织的访问权限的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการจำกัด ระงับ หรือยุติการเข้าถึงสำหรับผู้ใช้หรือองค์กรที่ส่งเนื้อหาที่ละเมิดซ้ำๆ หรือใช้กระบวนการร้องเรียนลิขสิทธิ์ในทางที่ผิด"}, "BizThai reserves the right to review such submissions before publication.": {"zh-CN": "BizThai 保留在发布前审查此类提交内容的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการตรวจสอบการส่งดังกล่าวก่อนการเผยแพร่"}, "BizThai reserves the right to suspend access, restrict services or pursue legal remedies against any person or organization that violates this Policy.": {"zh-CN": "BizThai 保留暂停访问、限制服务或对任何违反本政策的个人或组织寻求法律补救的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการระงับการเข้าถึง จำกัดบริการ หรือดำเนินการทางกฎหมายต่อบุคคลหรือองค์กรใดๆ ที่ละเมิดนโยบายนี้"}, "BizThai reserves the right to suspend or terminate user access without prior notice if users violate these Terms or engage in fraudulent, abusive or unlawful conduct.": {"zh-CN": "BizThai 保留在用户违反这些条款或从事欺诈、滥用或非法行为时，无需事先通知即可暂停或终止用户访问的权利。", "th": "BizThai ขอสงวนสิทธิ์ในการระงับหรือยุติการเข้าถึงของผู้ใช้โดยไม่ต้องแจ้งให้ทราบล่วงหน้า หากผู้ใช้ละเมิดข้อกำหนดเหล่านี้หรือมีส่วนร่วมในการฉ้อโกง การละเมิด หรือการกระทำที่ผิดกฎหมาย"}, "BizThai respects the intellectual property rights of others and is committed to complying with applicable copyright, trademark and other intellectual property laws.": {"zh-CN": "BizThai 尊重他人的知识产权，并致力于遵守适用的版权、商标和其他知识产权法律。", "th": "BizThai เคารพสิทธิในทรัพย์สินทางปัญญาของผู้อื่นและมุ่งมั่นที่จะปฏิบัติตามกฎหมายลิขสิทธิ์ เครื่องหมายการค้า และกฎหมายทรัพย์สินทางปัญญาอื่นๆ ที่เกี่ยวข้อง"}, "BizThai turns the official Thai business registry into a fast, multilingual platform — so you can find, understand and evaluate any registered company in seconds.": {"zh-CN": "BizThai 将泰国官方商业登记册转变为快速的多语言平台，让您能在几秒钟内查找、了解和评估任何注册公司。", "th": "BizThai เปลี่ยนทะเบียนธุรกิจทางการของไทยให้เป็นแพลตฟอร์มที่รวดเร็วและหลายภาษา — เพื่อให้คุณค้นหา ทำความเข้าใจ และประเมินบริษัทที่จดทะเบียนใดๆ ได้ภายในไม่กี่วินาที"}, "BizThai uses cookies and similar technologies to:": {"zh-CN": "BizThai 使用 cookie 和类似技术来：", "th": "BizThai ใช้คุกกี้และเทคโนโลยีที่คล้ายคลึงกันเพื่อ:"}, "BizThai will evaluate each request individually based on the available evidence, applicable law and the nature of the content.": {"zh-CN": "BizThai 将根据现有证据、适用法律和内容性质单独评估每个请求。", "th": "BizThai จะประเมินแต่ละคำขอเป็นรายบุคคลตามหลักฐานที่มีอยู่ กฎหมายที่เกี่ยวข้อง และลักษณะของเนื้อหา"}, "BizThai will generally not remove:": {"zh-CN": "BizThai 通常不会删除：", "th": "โดยทั่วไป BizThai จะไม่ลบ:"}, "BizThai will review the counter-notice in accordance with applicable law.": {"zh-CN": "BizThai 将根据适用法律审查反通知。", "th": "BizThai จะตรวจสอบคำคัดค้านตามกฎหมายที่เกี่ยวข้อง"}, "BizThai will:": {"zh-CN": "BizThai 将：", "th": "BizThai จะ:"}, "Breadcrumb": {"zh-CN": "面包屑导航", "th": "เบรดครัมบ์"}, "Browse Thailand's companies region by region — pick a province, drill into its districts, and open any district for its full company report.": {"zh-CN": "按地区浏览泰国公司 — 选择一个省份，深入其区县，打开任何区县即可查看完整的公司报告。", "th": "เรียกดูบริษัทในไทยตามภูมิภาค — เลือกจังหวัด เจาะลึกอำเภอ และเปิดอำเภอใดก็ได้เพื่อดูรายงานบริษัทแบบเต็ม"}, "Browse and filter every registered company by industry, province and capital.": {"zh-CN": "按行业、省份和注册资本浏览和筛选所有注册公司。", "th": "เรียกดูและกรองบริษัทที่จดทะเบียนทั้งหมดตามอุตสาหกรรม จังหวัด และทุนจดทะเบียน"}, "Browse companies": {"zh-CN": "浏览公司", "th": "เรียกดูบริษัท"}, "Browse companies by industry": {"zh-CN": "按行业浏览公司", "th": "เรียกดูบริษัทตามอุตสาหกรรม"}, "Browse companies by registration year": {"zh-CN": "按注册年份浏览公司", "th": "เรียกดูบริษัทตามปีที่จดทะเบียน"}, "Browse foreign-invested companies by country": {"zh-CN": "按国家浏览外资公司", "th": "เรียกดูบริษัทที่มีการลงทุนจากต่างประเทศตามประเทศ"}, "Browse the company directory": {"zh-CN": "浏览公司目录", "th": "เรียกดูไดเรกทอรีบริษัท"}, "Browser Type": {"zh-CN": "浏览器类型", "th": "ประเภทเบราว์เซอร์"}, "Building Trust Through Transparent Business Information": {"zh-CN": "通过透明的商业信息建立信任", "th": "สร้างความไว้วางใจผ่านข้อมูลธุรกิจที่โปร่งใส"}, "Business Activities": {"zh-CN": "商业活动", "th": "กิจกรรมทางธุรกิจ"}, "Business Data Usage Policy": {"zh-CN": "商业数据使用政策", "th": "นโยบายการใช้ข้อมูลธุรกิจ"}, "Business Description": {"zh-CN": "业务描述", "th": "คำอธิบายธุรกิจ"}, "Business Hours": {"zh-CN": "营业时间", "th": "เวลาทำการ"}, "Business Information": {"zh-CN": "商业信息", "th": "ข้อมูลธุรกิจ"}, "Business Intelligence": {"zh-CN": "商业智能", "th": "ข่าวกรองทางธุรกิจ"}, "Business Licensing": {"zh-CN": "商业许可", "th": "การอนุญาตประกอบธุรกิจ"}, "Business Profiles": {"zh-CN": "商业档案", "th": "โปรไฟล์ธุรกิจ"}, "Business Registration Certificate": {"zh-CN": "商业注册证书", "th": "ใบรับรองการจดทะเบียนธุรกิจ"}, "Business Registration Information": {"zh-CN": "商业注册信息", "th": "ข้อมูลการจดทะเบียนธุรกิจ"}, "Business Verification": {"zh-CN": "企业验证", "th": "การตรวจสอบธุรกิจ"}, "Business Verification Policy": {"zh-CN": "企业验证政策", "th": "นโยบายการตรวจสอบธุรกิจ"}, "Business Verification may be requested by:": {"zh-CN": "企业验证可由以下方请求：", "th": "การตรวจสอบธุรกิจอาจถูกร้องขอโดย:"}, "Business consulting services": {"zh-CN": "商业咨询服务", "th": "บริการให้คำปรึกษาทางธุรกิจ"}, "Business decisions": {"zh-CN": "商业决策", "th": "การตัดสินใจทางธุรกิจ"}, "Business descriptions": {"zh-CN": "业务描述", "th": "คำอธิบายธุรกิจ"}, "Business information displayed on BizThai may come from:": {"zh-CN": "BizThai 上显示的企业信息可能来自：", "th": "ข้อมูลธุรกิจที่แสดงบน BizThai อาจมาจาก:"}, "Business partnerships and paid services never influence editorial or data integrity decisions.": {"zh-CN": "商业合作和付费服务绝不会影响编辑或数据完整性决策。", "th": "ความร่วมมือทางธุรกิจและบริการแบบชำระเงินไม่มีอิทธิพลต่อการตัดสินใจด้านบรรณาธิการหรือความสมบูรณ์ของข้อมูล"}, "Business quality": {"zh-CN": "企业质量", "th": "คุณภาพธุรกิจ"}, "Business reports": {"zh-CN": "商业报告", "th": "รายงานธุรกิจ"}, "Business transactions": {"zh-CN": "商业交易", "th": "ธุรกรรมทางธุรกิจ"}, "Business verification requests;": {"zh-CN": "企业验证请求；", "th": "คำขอตรวจสอบธุรกิจ;"}, "Businesses requiring large-scale access to BizThai data should obtain appropriate authorization or enter into a commercial licensing agreement where applicable.": {"zh-CN": "需要大规模访问 BizThai 数据的企业应获得适当授权或签订商业许可协议（如适用）。", "th": "ธุรกิจที่ต้องการเข้าถึงข้อมูล BizThai ในวงกว้างควรได้รับอนุญาตที่เหมาะสมหรือทำข้อตกลงใบอนุญาตเชิงพาณิชย์ตามที่เกี่ยวข้อง"}, "By accessing or using the BizThai website or any related services, you acknowledge that you have read, understood and agreed to this Disclaimer.": {"zh-CN": "通过访问或使用 BizThai 网站或任何相关服务，您确认已阅读、理解并同意本免责声明。", "th": "การเข้าถึงหรือใช้เว็บไซต์ BizThai หรือบริการที่เกี่ยวข้องใดๆ แสดงว่าคุณรับทราบว่าคุณได้อ่าน ทำความเข้าใจ และยอมรับข้อจำกัดความรับผิดชอบนี้แล้ว"}, "By using our Services, you agree to the practices described in this Privacy Policy.": {"zh-CN": "使用我们的服务即表示您同意本隐私政策中描述的做法。", "th": "การใช้บริการของเราหมายความว่าคุณยอมรับแนวปฏิบัติที่อธิบายไว้ในนโยบายความเป็นส่วนตัวนี้"}, "CDN Providers": {"zh-CN": "CDN 提供商", "th": "ผู้ให้บริการ CDN"}, "Can I Correct My Information?": {"zh-CN": "我可以更正我的信息吗？", "th": "ฉันสามารถแก้ไขข้อมูลของฉันได้หรือไม่?"}, "Can I Remove My Company?": {"zh-CN": "我可以删除我的公司吗？", "th": "ฉันสามารถลบบริษัทของฉันได้หรือไม่?"}, "Capital & industry": {"zh-CN": "资本与行业", "th": "ทุนและอุตสาหกรรม"}, "Capital business districts and opportunity leads": {"zh-CN": "资本商业区和机会线索", "th": "ย่านธุรกิจทุนและโอกาสนำ"}, "Certain information displayed on BizThai originates from publicly available government or lawful public sources. BizThai organizes, indexes and enhances access to such information.": {"zh-CN": "BizThai 上显示的某些信息来自公开可用的政府或合法公共来源。BizThai 组织、索引并增强对此类信息的访问。", "th": "ข้อมูลบางส่วนที่แสดงบน BizThai มาจากแหล่งข้อมูลสาธารณะของรัฐบาลหรือแหล่งข้อมูลสาธารณะที่ถูกกฎหมาย BizThai จัดระเบียบ จัดทำดัชนี และเพิ่มการเข้าถึงข้อมูลดังกล่าว"}, "Change your password or sign out.": {"zh-CN": "更改密码或退出登录。", "th": "เปลี่ยนรหัสผ่านหรือออกจากระบบ"}, "Changes": {"zh-CN": "变更", "th": "การเปลี่ยนแปลง"}, "Changes to Information": {"zh-CN": "信息变更", "th": "การเปลี่ยนแปลงข้อมูล"}, "Changes to official records must first be completed with the relevant government authority.": {"zh-CN": "对官方记录的更改必须首先在相关政府机构完成。", "th": "การเปลี่ยนแปลงบันทึกทางการต้องดำเนินการกับหน่วยงานรัฐที่เกี่ยวข้องก่อน"}, "Charoen Pokphand Foods Public Company Limited": {"zh-CN": "正大食品大众有限公司", "th": "บริษัท เจริญโภคภัณฑ์อาหาร จำกัด (มหาชน)"}, "Checking business partners": {"zh-CN": "检查商业伙伴", "th": "กำลังตรวจสอบคู่ค้าทางธุรกิจ"}, "Children's Privacy": {"zh-CN": "儿童隐私", "th": "ความเป็นส่วนตัวของเด็ก"}, "Chonburi industry": {"zh-CN": "春武里工业", "th": "อุตสาหกรรมชลบุรี"}, "Choose a new password for your account.": {"zh-CN": "为您的账户选择新密码。", "th": "เลือกรหัสผ่านใหม่สำหรับบัญชีของคุณ"}, "Circumvent technical measures intended to protect the platform": {"zh-CN": "规避旨在保护平台的技术措施", "th": "หลีกเลี่ยงมาตรการทางเทคนิคที่ออกแบบมาเพื่อปกป้องแพลตฟอร์ม"}, "Claimed companies": {"zh-CN": "已认领的公司", "th": "บริษัทที่อ้างสิทธิ์แล้ว"}, "Click Activity": {"zh-CN": "点击活动", "th": "กิจกรรมคลิก"}, "Close menu": {"zh-CN": "关闭菜单", "th": "ปิดเมนู"}, "Cloudflare": {"zh-CN": "Cloudflare", "th": "Cloudflare"}, "Combine a keyword with one category filter for the most precise list.": {"zh-CN": "将关键词与一个类别筛选器结合，以获得最精确的列表。", "th": "รวมคำค้นหากับตัวกรองหมวดหมู่เดียวเพื่อรายการที่แม่นยำที่สุด"}, "Commercial relationships, advertising, sponsorships, subscriptions or business partnerships do not influence the publication, correction or removal of business information.": {"zh-CN": "商业关系、广告、赞助、订阅或业务合作不影响商业信息的发布、更正或删除。", "th": "ความสัมพันธ์ทางการค้า การโฆษณา การสนับสนุน การสมัครสมาชิก หรือความร่วมมือทางธุรกิจไม่มีผลต่อการเผยแพร่ แก้ไข หรือลบข้อมูลธุรกิจ"}, "Communicate with users": {"zh-CN": "与用户沟通", "th": "สื่อสารกับผู้ใช้"}, "Companies may voluntarily submit additional information including:": {"zh-CN": "公司可自愿提交额外信息，包括：", "th": "บริษัทอาจส่งข้อมูลเพิ่มเติมโดยสมัครใจ รวมถึง:"}, "Companies represent that they have the legal right to submit such information.": {"zh-CN": "公司声明其拥有提交此类信息的合法权利。", "th": "บริษัทรับรองว่ามีสิทธิ์ตามกฎหมายในการส่งข้อมูลดังกล่าว"}, "Companies with the largest registered capital.": {"zh-CN": "注册资本最大的公司。", "th": "บริษัทที่มีทุนจดทะเบียนมากที่สุด"}, "Companies you have claimed or requested to claim.": {"zh-CN": "您已认领或请求认领的公司。", "th": "บริษัทที่คุณอ้างสิทธิ์หรือขออ้างสิทธิ์แล้ว"}, "Company Description": {"zh-CN": "公司描述", "th": "คำอธิบายบริษัท"}, "Company Director": {"zh-CN": "公司董事", "th": "กรรมการบริษัท"}, "Company Logo": {"zh-CN": "公司标志", "th": "โลโก้บริษัท"}, "Company Logos and Trademarks": {"zh-CN": "公司标志和商标", "th": "โลโก้และเครื่องหมายการค้าของบริษัท"}, "Company Name": {"zh-CN": "公司名称", "th": "ชื่อบริษัท"}, "Company Owner": {"zh-CN": "公司所有者", "th": "เจ้าของบริษัท"}, "Company Registration Number": {"zh-CN": "公司注册号", "th": "เลขทะเบียนบริษัท"}, "Company Seal (if applicable)": {"zh-CN": "公司印章（如适用）", "th": "ตราประทับบริษัท (ถ้ามี)"}, "Company Secretary": {"zh-CN": "公司秘书", "th": "เลขานุการบริษัท"}, "Company Status": {"zh-CN": "公司状态", "th": "สถานะบริษัท"}, "Company Submitted Information": {"zh-CN": "公司提交信息", "th": "ข้อมูลที่บริษัทส่ง"}, "Company Website": {"zh-CN": "公司网站", "th": "เว็บไซต์บริษัท"}, "Company count": {"zh-CN": "公司数量", "th": "จำนวนบริษัท"}, "Company credibility;": {"zh-CN": "公司可信度；", "th": "ความน่าเชื่อถือของบริษัท;"}, "Company directors": {"zh-CN": "公司董事", "th": "กรรมการบริษัท"}, "Company directory": {"zh-CN": "公司目录", "th": "ไดเรกทอรีบริษัท"}, "Company information on BizThai is sourced from DBD DataWarehouse+, the public business registry maintained by Thailand's Department of Business Development. We normalise, translate and enrich these official records — but the underlying registration data remains the authoritative source.": {"zh-CN": "BizThai 上的公司信息来源于 DBD DataWarehouse+，即泰国商业发展局维护的公共商业登记系统。我们对这些官方记录进行规范化、翻译和丰富，但底层注册数据仍为权威来源。", "th": "ข้อมูลบริษัทบน BizThai ได้มาจาก DBD DataWarehouse+ ซึ่งเป็นทะเบียนธุรกิจสาธารณะที่ดูแลโดยกรมพัฒนาธุรกิจการค้าของประเทศไทย เราทำให้ข้อมูลเป็นมาตรฐาน แปล และเพิ่มคุณค่าให้กับบันทึกทางการเหล่านี้ แต่ข้อมูลการจดทะเบียนต้นฉบับยังคงเป็นแหล่งที่มาที่เชื่อถือได้"}, "Company logos": {"zh-CN": "公司标志", "th": "โลโก้บริษัท"}, "Company logos and trademarks displayed on BizThai may originate from:": {"zh-CN": "BizThai 上显示的公司标志和商标可能来源于：", "th": "โลโก้และเครื่องหมายการค้าของบริษัทที่แสดงบน BizThai อาจมาจาก:"}, "Company name (if applicable)": {"zh-CN": "公司名称（如适用）", "th": "ชื่อบริษัท (ถ้ามี)"}, "Company name or registration number": {"zh-CN": "公司名称或注册号", "th": "ชื่อบริษัทหรือเลขทะเบียน"}, "Company names": {"zh-CN": "公司名称", "th": "ชื่อบริษัท"}, "Company profiles displayed on BizThai do not constitute an endorsement, recommendation or certification.": {"zh-CN": "BizThai 上显示的公司简介不构成认可、推荐或认证。", "th": "โปรไฟล์บริษัทที่แสดงบน BizThai ไม่ถือเป็นการรับรอง แนะนำ หรือรับรองคุณภาพ"}, "Company records indexed": {"zh-CN": "已索引的公司记录", "th": "บันทึกบริษัทที่ถูกจัดทำดัชนี"}, "Company records on BizThai are sourced from DBD DataWarehouse+, the official Thai business registry. For the fastest correction, include the company registration number (jpNo) and a short description of the issue in your message.": {"zh-CN": "BizThai 上的公司记录来源于 DBD DataWarehouse+，即泰国官方商业登记系统。为最快更正，请在消息中包含公司注册号 (jpNo) 和问题的简短描述。", "th": "บันทึกบริษัทบน BizThai ได้มาจาก DBD DataWarehouse+ ซึ่งเป็นทะเบียนธุรกิจทางการของไทย เพื่อการแก้ไขที่รวดเร็วที่สุด โปรดรวมเลขทะเบียนบริษัท (jpNo) และคำอธิบายสั้นๆ เกี่ยวกับปัญหาในข้อความของคุณ"}, "Company registration information;": {"zh-CN": "公司注册信息；", "th": "ข้อมูลการจดทะเบียนบริษัท;"}, "Company research": {"zh-CN": "公司研究", "th": "การวิจัยบริษัท"}, "Company status;": {"zh-CN": "公司状态；", "th": "สถานะบริษัท;"}, "Company submissions;": {"zh-CN": "公司提交；", "th": "การส่งของบริษัท;"}, "Company websites": {"zh-CN": "公司网站", "th": "เว็บไซต์บริษัท"}, "Compare Thai company concentration by province using full-database aggregates, with company counts, share of records and registered capital totals.": {"zh-CN": "使用全数据库汇总比较泰国各省的公司集中度，包括公司数量、记录份额和注册资本总额。", "th": "เปรียบเทียบความเข้มข้นของบริษัทไทยตามจังหวัดโดยใช้ข้อมูลรวมทั้งฐานข้อมูล พร้อมจำนวนบริษัท สัดส่วนของบันทึก และทุนจดทะเบียนรวม"}, "Compare industry sections by company count and share across standardized TSIC top-level categories.": {"zh-CN": "按公司数量和份额比较标准化 TSIC 顶级类别下的行业部分。", "th": "เปรียบเทียบหมวดอุตสาหกรรมตามจำนวนบริษัทและสัดส่วนในหมวดหมู่ระดับบนสุดของ TSIC ที่ได้มาตรฐาน"}, "Compare provinces and regions by company count, capital and activity.": {"zh-CN": "按公司数量、资本和活跃度比较各省和地区。", "th": "เปรียบเทียบจังหวัดและภูมิภาคตามจำนวนบริษัท ทุน และกิจกรรม"}, "Compare the information with available public records;": {"zh-CN": "将信息与可用的公共记录进行比较；", "th": "เปรียบเทียบข้อมูลกับบันทึกสาธารณะที่มีอยู่"}, "Complete": {"zh-CN": "完成", "th": "เสร็จสมบูรณ์"}, "Complying with legal obligations": {"zh-CN": "遵守法律义务", "th": "ปฏิบัติตามข้อผูกพันทางกฎหมาย"}, "Conduct automated scraping beyond authorized limits": {"zh-CN": "进行超出授权范围的自动抓取", "th": "ดำเนินการเก็บข้อมูลอัตโนมัติเกินขอบเขตที่ได้รับอนุญาต"}, "Conducting business": {"zh-CN": "开展业务", "th": "ดำเนินธุรกิจ"}, "Confirm company authorization": {"zh-CN": "确认公司授权", "th": "ยืนยันการอนุญาตของบริษัท"}, "Confirm password": {"zh-CN": "确认密码", "th": "ยืนยันรหัสผ่าน"}, "Construction": {"zh-CN": "建筑", "th": "ก่อสร้าง"}, "Contact Information": {"zh-CN": "联系信息", "th": "ข้อมูลติดต่อ"}, "Contact information": {"zh-CN": "联系信息", "th": "ข้อมูลติดต่อ"}, "Contact the relevant parties;": {"zh-CN": "联系相关方；", "th": "ติดต่อฝ่ายที่เกี่ยวข้อง"}, "Contact us": {"zh-CN": "联系我们", "th": "ติดต่อเรา"}, "Content Displayed on BizThai": {"zh-CN": "BizThai 上显示的内容", "th": "เนื้อหาที่แสดงบน BizThai"}, "Content displayed on BizThai may include:": {"zh-CN": "BizThai 上显示的内容可能包括：", "th": "เนื้อหาที่แสดงบน BizThai อาจรวมถึง:"}, "Continue in AI chat": {"zh-CN": "在 AI 聊天中继续", "th": "ดำเนินการต่อในการแชท AI"}, "Continued use of the Services following any update constitutes acceptance of the revised Terms.": {"zh-CN": "在任何更新后继续使用服务即表示接受修订后的条款。", "th": "การใช้งานบริการอย่างต่อเนื่องหลังจากการอัปเดตใดๆ ถือเป็นการยอมรับข้อกำหนดที่แก้ไขแล้ว"}, "Contract disputes": {"zh-CN": "合同纠纷", "th": "ข้อพิพาทตามสัญญา"}, "Contractual disputes": {"zh-CN": "合同纠纷", "th": "ข้อพิพาทตามสัญญา"}, "Cookies": {"zh-CN": "Cookies", "th": "คุกกี้"}, "Copy substantial portions of the BizThai database": {"zh-CN": "复制 BizThai 数据库的大部分内容", "th": "คัดลอกส่วนสำคัญของฐานข้อมูล BizThai"}, "Copyright": {"zh-CN": "版权", "th": "ลิขสิทธิ์"}, "Copyright Complaints": {"zh-CN": "版权投诉", "th": "ข้อร้องเรียนด้านลิขสิทธิ์"}, "Copyright Policy": {"zh-CN": "版权政策", "th": "นโยบายลิขสิทธิ์"}, "Copyright Team": {"zh-CN": "版权团队", "th": "ทีมลิขสิทธิ์"}, "Copyright complaints;": {"zh-CN": "版权投诉；", "th": "การร้องเรียนเรื่องลิขสิทธิ์;"}, "Corporate Email Address": {"zh-CN": "企业邮箱地址", "th": "ที่อยู่อีเมลของบริษัท"}, "Correct inaccurate information;": {"zh-CN": "更正不准确的信息；", "th": "แก้ไขข้อมูลที่ไม่ถูกต้อง;"}, "Correction Requests": {"zh-CN": "更正请求", "th": "คำขอแก้ไข"}, "Correction of inaccurate personal information": {"zh-CN": "更正不准确的个人信息", "th": "การแก้ไขข้อมูลส่วนบุคคลที่ไม่ถูกต้อง"}, "Corrections": {"zh-CN": "更正", "th": "การแก้ไข"}, "Counter-Notice": {"zh-CN": "反通知", "th": "การแจ้งโต้แย้ง"}, "Court Order": {"zh-CN": "法院命令", "th": "คำสั่งศาล"}, "Court Orders, Government Notices, Legal Complaints or other formal legal requests should be sent to:": {"zh-CN": "法院命令、政府通知、法律投诉或其他正式法律请求应发送至：", "th": "คำสั่งศาล หนังสือแจ้งจากหน่วยงานรัฐ ข้อร้องเรียนทางกฎหมาย หรือคำขอทางกฎหมายอื่นๆ ควรส่งไปที่:"}, "Court publications": {"zh-CN": "法院出版物", "th": "สิ่งพิมพ์ของศาล"}, "Court-appointed representatives": {"zh-CN": "法院指定的代表", "th": "ตัวแทนที่ศาลแต่งตั้ง"}, "Create account": {"zh-CN": "创建账户", "th": "สร้างบัญชี"}, "Creditworthiness": {"zh-CN": "信用状况", "th": "ความน่าเชื่อถือทางเครดิต"}, "Current": {"zh-CN": "当前", "th": "ปัจจุบัน"}, "Current password": {"zh-CN": "当前密码", "th": "รหัสผ่านปัจจุบัน"}, "Data & Sources": {"zh-CN": "数据与来源", "th": "ข้อมูลและแหล่งที่มา"}, "Data Accuracy": {"zh-CN": "数据准确性", "th": "ความถูกต้องของข้อมูล"}, "Data Correction": {"zh-CN": "数据更正", "th": "การแก้ไขข้อมูล"}, "Data Correction & Removal": {"zh-CN": "数据更正与删除", "th": "การแก้ไขและลบข้อมูล"}, "Data Correction & Removal Policy": {"zh-CN": "数据更正与删除政策", "th": "นโยบายการแก้ไขและลบข้อมูล"}, "Data Corrections": {"zh-CN": "数据更正", "th": "การแก้ไขข้อมูล"}, "Data Integrity": {"zh-CN": "数据完整性", "th": "ความสมบูรณ์ของข้อมูล"}, "Data Processing": {"zh-CN": "数据处理", "th": "การประมวลผลข้อมูล"}, "Data Retention": {"zh-CN": "数据保留", "th": "การเก็บรักษาข้อมูล"}, "Data Security": {"zh-CN": "数据安全", "th": "ความปลอดภัยของข้อมูล"}, "Data Sources": {"zh-CN": "数据来源", "th": "แหล่งข้อมูล"}, "Data Sources Policy": {"zh-CN": "数据来源政策", "th": "นโยบายแหล่งข้อมูล"}, "Data Updates": {"zh-CN": "数据更新", "th": "การอัปเดตข้อมูล"}, "Data correction requests;": {"zh-CN": "数据更正请求；", "th": "คำขอแก้ไขข้อมูล;"}, "Data corrections": {"zh-CN": "数据更正", "th": "การแก้ไขข้อมูล"}, "Data inaccuracies": {"zh-CN": "数据不准确", "th": "ข้อมูลที่ไม่ถูกต้อง"}, "Data navigation": {"zh-CN": "数据导航", "th": "การนำทางข้อมูล"}, "Data source: DBD DataWarehouse+.": {"zh-CN": "数据来源：DBD DataWarehouse+。", "th": "แหล่งข้อมูล: DBD DataWarehouse+"}, "Data, integrations and business collaboration enquiries.": {"zh-CN": "数据、集成和业务合作咨询。", "th": "สอบถามข้อมูล การบูรณาการ และความร่วมมือทางธุรกิจ"}, "Delayed;": {"zh-CN": "延迟；", "th": "ล่าช้า;"}, "Deletion where legally applicable": {"zh-CN": "在法律适用的情况下删除", "th": "การลบเมื่อกฎหมายอนุญาต"}, "Depending on how you use BizThai, we may collect:": {"zh-CN": "根据您使用BizThai的方式，我们可能会收集：", "th": "ขึ้นอยู่กับวิธีที่คุณใช้ BizThai เราอาจเก็บรวบรวม:"}, "Depending on the request, applicants may be required to provide:": {"zh-CN": "根据请求，申请人可能需要提供：", "th": "ขึ้นอยู่กับคำขอ ผู้สมัครอาจต้องให้ข้อมูล:"}, "Describe the companies you are looking for": {"zh-CN": "描述您正在寻找的公司", "th": "อธิบายบริษัทที่คุณกำลังมองหา"}, "Describe what you need in plain language and let our AI surface the best matches.": {"zh-CN": "用通俗语言描述您的需求，让我们的AI呈现最佳匹配。", "th": "อธิบายสิ่งที่คุณต้องการด้วยภาษาธรรมดา และให้ AI ของเราแสดงผลลัพธ์ที่ตรงที่สุด"}, "Describe what you need in plain language — AI reads the official registry and finds the best-matched companies.": {"zh-CN": "用通俗语言描述您的需求——AI读取官方注册信息并找到最匹配的公司。", "th": "อธิบายสิ่งที่คุณต้องการด้วยภาษาธรรมดา — AI อ่านทะเบียนทางการและค้นหาบริษัทที่ตรงที่สุด"}, "Description of the copyrighted work": {"zh-CN": "受版权保护作品的描述", "th": "คำอธิบายของงานที่มีลิขสิทธิ์"}, "Description of the issue": {"zh-CN": "问题描述", "th": "คำอธิบายปัญหา"}, "Detect security threats": {"zh-CN": "检测安全威胁", "th": "ตรวจจับภัยคุกคามด้านความปลอดภัย"}, "Determine whether an update is appropriate;": {"zh-CN": "确定更新是否合适；", "th": "พิจารณาว่าการอัปเดตเหมาะสมหรือไม่;"}, "Device Identifiers": {"zh-CN": "设备标识符", "th": "ตัวระบุอุปกรณ์"}, "Device Information": {"zh-CN": "设备信息", "th": "ข้อมูลอุปกรณ์"}, "Directors": {"zh-CN": "董事", "th": "กรรมการ"}, "Disclaimer": {"zh-CN": "免责声明", "th": "ข้อจำกัดความรับผิดชอบ"}, "Disclosure": {"zh-CN": "披露", "th": "การเปิดเผยข้อมูล"}, "Display name": {"zh-CN": "显示名称", "th": "ชื่อที่แสดง"}, "Do Companies Pay to Remove Information?": {"zh-CN": "公司是否付费删除信息？", "th": "บริษัทจ่ายเงินเพื่อลบข้อมูลหรือไม่?"}, "Do You Sell My Company's Data?": {"zh-CN": "你们会出售我公司的数据吗？", "th": "คุณขายข้อมูลบริษัทของฉันหรือไม่?"}, "Documents cannot be verified": {"zh-CN": "文件无法验证", "th": "ไม่สามารถยืนยันเอกสารได้"}, "Download business information in bulk": {"zh-CN": "批量下载企业信息", "th": "ดาวน์โหลดข้อมูลธุรกิจเป็นกลุ่ม"}, "Due diligence": {"zh-CN": "尽职调查", "th": "การตรวจสอบสถานะ"}, "Duplicate Company Records": {"zh-CN": "重复公司记录", "th": "บันทึกบริษัทที่ซ้ำกัน"}, "Eastern manufacturing, logistics and foreign investment": {"zh-CN": "东部制造业、物流与外商投资", "th": "การผลิต โลจิสติกส์ และการลงทุนจากต่างประเทศในภาคตะวันออก"}, "Editorial & Data Integrity": {"zh-CN": "编辑与数据完整性", "th": "ความถูกต้องของเนื้อหาและข้อมูล"}, "Editorial & Data Integrity Policy": {"zh-CN": "编辑与数据完整性政策", "th": "นโยบายความถูกต้องของเนื้อหาและข้อมูล"}, "Editorial Independence": {"zh-CN": "编辑独立性", "th": "ความเป็นอิสระของกองบรรณาธิการ"}, "Editorial Team": {"zh-CN": "编辑团队", "th": "ทีมบรรณาธิการ"}, "Editorial decisions and data publication are made independently.": {"zh-CN": "编辑决策和数据发布均独立进行。", "th": "การตัดสินใจด้านบรรณาธิการและการเผยแพร่ข้อมูลดำเนินการอย่างเป็นอิสระ"}, "Education": {"zh-CN": "教育", "th": "การศึกษา"}, "Effective Date: June 2026": {"zh-CN": "生效日期：2026年6月", "th": "วันที่มีผลบังคับใช้: มิถุนายน 2026"}, "Effective date: June 2026": {"zh-CN": "生效日期：2026年6月", "th": "วันที่มีผลบังคับใช้: มิถุนายน 2026"}, "Effective: June 2026": {"zh-CN": "生效：2026年6月", "th": "มีผล: มิถุนายน 2026"}, "Electricity & Gas Supply": {"zh-CN": "电力与燃气供应", "th": "การจัดหาไฟฟ้าและก๊าซ"}, "Eligibility": {"zh-CN": "资格", "th": "คุณสมบัติ"}, "Email": {"zh-CN": "电子邮件", "th": "อีเมล"}, "Email Address": {"zh-CN": "电子邮件地址", "th": "ที่อยู่อีเมล"}, "Email Service Providers": {"zh-CN": "电子邮件服务提供商", "th": "ผู้ให้บริการอีเมล"}, "Email is used to sign in and cannot be changed here.": {"zh-CN": "电子邮件用于登录，无法在此更改。", "th": "ใช้อีเมลในการเข้าสู่ระบบ และไม่สามารถเปลี่ยนแปลงได้ที่นี่"}, "Enforcement": {"zh-CN": "执行", "th": "การบังคับใช้"}, "Enter a Thai company name or registration number. BizThai AI will resolve the company and return a direct enterprise analysis: risk, credit score, industry position, directors, related companies and cooperation recommendation.": {"zh-CN": "输入泰国公司名称或注册号。BizThai AI 将解析该公司并返回直接的企业分析：风险、信用评分、行业地位、董事、关联公司及合作建议。", "th": "ป้อนชื่อบริษัทไทยหรือเลขทะเบียน BizThai AI จะระบุบริษัทและส่งคืนการวิเคราะห์องค์กรโดยตรง: ความเสี่ยง คะแนนเครดิต ตำแหน่งในอุตสาหกรรม กรรมการ บริษัทที่เกี่ยวข้อง และคำแนะนำความร่วมมือ"}, "Enter a company name or registration number…": {"zh-CN": "输入公司名称或注册号…", "th": "ป้อนชื่อบริษัทหรือเลขทะเบียน…"}, "Enter the email for your account and we'll send a password reset link.": {"zh-CN": "输入您账户的电子邮件，我们将发送密码重置链接。", "th": "ป้อนอีเมลสำหรับบัญชีของคุณ แล้วเราจะส่งลิงก์รีเซ็ตรหัสผ่านให้"}, "Entering into contracts": {"zh-CN": "签订合同", "th": "การทำสัญญา"}, "Error-free": {"zh-CN": "无错误", "th": "ไม่มีข้อผิดพลาด"}, "Every country with capital invested in Thai companies, shaded by how many companies it is linked to. Pick any nation on the map — or in the list — to open its companies.": {"zh-CN": "每个在泰国有投资的国家，根据关联公司数量深浅着色。在地图或列表中选取任一国家，即可查看其公司。", "th": "ทุกประเทศที่มีเงินทุนลงทุนในบริษัทไทย แรเงาตามจำนวนบริษัทที่เชื่อมโยง เลือกประเทศใดก็ได้บนแผนที่หรือในรายการเพื่อเปิดดูบริษัทของประเทศนั้น"}, "Evidence of ownership or authorization": {"zh-CN": "所有权或授权证明", "th": "หลักฐานการเป็นเจ้าของหรือการอนุญาต"}, "Evidence supporting the requested correction": {"zh-CN": "支持更正请求的证据", "th": "หลักฐานสนับสนุนการขอแก้ไข"}, "Except for public records and third-party content, all software, design, trademarks, databases, graphics, logos and website content belong to BizThai or its licensors.": {"zh-CN": "除公共记录和第三方内容外，所有软件、设计、商标、数据库、图形、徽标和网站内容均归 BizThai 或其许可方所有。", "th": "ยกเว้นบันทึกสาธารณะและเนื้อหาของบุคคลที่สาม ซอฟต์แวร์ การออกแบบ เครื่องหมายการค้า ฐานข้อมูล กราฟิก โลโก้ และเนื้อหาเว็บไซต์ทั้งหมดเป็นของ BizThai หรือผู้ให้อนุญาต"}, "Explore foreign investment, new registrations and industry overviews from live data.": {"zh-CN": "通过实时数据探索外国投资、新注册和行业概况。", "th": "สำรวจการลงทุนจากต่างประเทศ การจดทะเบียนใหม่ และภาพรวมอุตสาหกรรมจากข้อมูลสด"}, "Extending credit": {"zh-CN": "提供信贷", "th": "การให้สินเชื่อ"}, "External Links": {"zh-CN": "外部链接", "th": "ลิงก์ภายนอก"}, "Factories, processing and supply-chain records": {"zh-CN": "工厂、加工和供应链记录", "th": "โรงงาน การแปรรูป และบันทึกห่วงโซ่อุปทาน"}, "Fairness": {"zh-CN": "公平性", "th": "ความเป็นธรรม"}, "False information is submitted": {"zh-CN": "提交虚假信息", "th": "ส่งข้อมูลเท็จ"}, "Fees, if applicable, will be published separately.": {"zh-CN": "费用（如适用）将另行公布。", "th": "ค่าธรรมเนียม (ถ้ามี) จะประกาศแยกต่างหาก"}, "Fewer": {"zh-CN": "更少", "th": "น้อยลง"}, "Filter by industry": {"zh-CN": "按行业筛选", "th": "กรองตามอุตสาหกรรม"}, "Filter by province, industry or ownership, then open any company for its full registration, capital and shareholding profile.": {"zh-CN": "按省份、行业或所有权筛选，然后打开任意公司查看其完整注册、资本和股权信息。", "th": "กรองตามจังหวัด อุตสาหกรรม หรือความเป็นเจ้าของ จากนั้นเปิดบริษัทใดก็ได้เพื่อดูข้อมูลทะเบียน ทุน และผู้ถือหุ้นแบบเต็ม"}, "Finance & Insurance": {"zh-CN": "金融与保险", "th": "การเงินและการประกันภัย"}, "Financial advice": {"zh-CN": "财务建议", "th": "คำแนะนำทางการเงิน"}, "Financial loss": {"zh-CN": "财务损失", "th": "ความสูญเสียทางการเงิน"}, "Financial stability;": {"zh-CN": "财务稳定性；", "th": "ความมั่นคงทางการเงิน;"}, "Financial strength": {"zh-CN": "财务实力", "th": "ความแข็งแกร่งทางการเงิน"}, "Find a shareholder or owner by name (English or Thai, partial match) or by passport / ID number, then see every company linked to them.": {"zh-CN": "按姓名（英文或泰文，部分匹配）或护照/身份证号码查找股东或所有者，然后查看与其关联的所有公司。", "th": "ค้นหาผู้ถือหุ้นหรือเจ้าของโดยใช้ชื่อ (ภาษาอังกฤษหรือภาษาไทย ค้นหาแบบบางส่วน) หรือหมายเลขพาสปอร์ต/บัตรประชาชน จากนั้นดูทุกบริษัทที่เชื่อมโยงกับบุคคลนั้น"}, "Find any registered company in Thailand": {"zh-CN": "查找泰国任何注册公司", "th": "ค้นหาบริษัทที่จดทะเบียนในประเทศไทย"}, "Find competitors for a food exporter": {"zh-CN": "为食品出口商寻找竞争对手", "th": "ค้นหาคู่แข่งสำหรับผู้ส่งออกอาหาร"}, "Find the right Thai company with AI": {"zh-CN": "用AI找到合适的泰国公司", "th": "ค้นหาบริษัทไทยที่ใช่ด้วย AI"}, "Find your company": {"zh-CN": "查找您的公司", "th": "ค้นหาบริษัทของคุณ"}, "For business analysis only. Not legal evidence. BizThai is non-profit and handles no financial transactions; beware of scams and never transfer money.": {"zh-CN": "仅供商业分析，不具法律效力。BizThai 为非营利平台，不处理任何金融交易；谨防诈骗，切勿转账。", "th": "เพื่อการวิเคราะห์ธุรกิจเท่านั้น ไม่ใช่หลักฐานทางกฎหมาย BizThai เป็นองค์กรไม่แสวงหาผลกำไรและไม่ดำเนินการธุรกรรมทางการเงินใดๆ ระวังการหลอกลวงและอย่าโอนเงิน"}, "For business licensing inquiries, please contact:": {"zh-CN": "有关商业许可证查询，请联系：", "th": "สำหรับสอบถามเกี่ยวกับใบอนุญาตประกอบธุรกิจ โปรดติดต่อ:"}, "For editorial, support or legal matters, you may contact the relevant department below.": {"zh-CN": "有关编辑、支持或法律事宜，请联系以下相关部门。", "th": "สำหรับเรื่องบรรณาธิการ การสนับสนุน หรือกฎหมาย คุณสามารถติดต่อแผนกที่เกี่ยวข้องด้านล่าง"}, "For questions regarding these Terms, please contact the relevant department:": {"zh-CN": "如有关于这些条款的问题，请联系相关部门：", "th": "สำหรับคำถามเกี่ยวกับข้อกำหนดเหล่านี้ โปรดติดต่อแผนกที่เกี่ยวข้อง:"}, "Foreign investment analysis": {"zh-CN": "外商投资分析", "th": "การวิเคราะห์การลงทุนจากต่างประเทศ"}, "Foreign ownership by nationality": {"zh-CN": "按国籍划分的外资所有权", "th": "การถือครองของต่างชาติแยกตามสัญชาติ"}, "Foreign versus Thai ownership": {"zh-CN": "外资与泰资对比", "th": "การถือครองของต่างชาติเทียบกับไทย"}, "Foreign-owned": {"zh-CN": "外资所有", "th": "ถือครองโดยต่างชาติ"}, "Foreign-versus-Thai ownership and the leading investor nationalities behind registered companies, inferred from capital and director signals.": {"zh-CN": "外资与泰资所有权对比，以及注册公司背后的主要投资者国籍（根据资本和董事信号推断）。", "th": "การถือครองของต่างชาติเทียบกับไทยและสัญชาตินักลงทุนหลักที่อยู่เบื้องหลังบริษัทที่จดทะเบียน ซึ่งอนุมานจากสัญญาณทุนและกรรมการ"}, "Forgot password?": {"zh-CN": "忘记密码？", "th": "ลืมรหัสผ่าน?"}, "Fraud is suspected": {"zh-CN": "涉嫌欺诈", "th": "สงสัยว่ามีการฉ้อโกง"}, "Full Name": {"zh-CN": "全名", "th": "ชื่อเต็ม"}, "Future Data Sources": {"zh-CN": "未来数据来源", "th": "แหล่งข้อมูลในอนาคต"}, "General Support": {"zh-CN": "一般支持", "th": "การสนับสนุนทั่วไป"}, "General enquiries": {"zh-CN": "一般咨询", "th": "สอบถามทั่วไป"}, "Generally, no. BizThai does not remove business information that originates from lawful public records simply because a company prefers not to appear on the platform.": {"zh-CN": "通常不会。BizThai 不会仅因公司不愿出现在平台上而删除来自合法公共记录的企业信息。", "th": "โดยทั่วไปแล้วไม่ BizThai จะไม่ลบข้อมูลธุรกิจที่มาจากบันทึกสาธารณะที่ถูกกฎหมายเพียงเพราะบริษัทไม่ต้องการปรากฏบนแพลตฟอร์ม"}, "Get Thai company updates": {"zh-CN": "获取泰国公司更新", "th": "รับข้อมูลอัปเดตบริษัทไทย"}, "Get in touch": {"zh-CN": "联系我们", "th": "ติดต่อเรา"}, "Give us feedback": {"zh-CN": "给我们反馈", "th": "ให้ข้อเสนอแนะแก่เรา"}, "Go to sign in": {"zh-CN": "前往登录", "th": "ไปที่ลงชื่อเข้าใช้"}, "Google Analytics": {"zh-CN": "Google Analytics", "th": "Google Analytics"}, "Google Analytics and Third-Party Services": {"zh-CN": "Google Analytics 和第三方服务", "th": "Google Analytics และบริการของบุคคลที่สาม"}, "Google reCAPTCHA": {"zh-CN": "Google reCAPTCHA", "th": "Google reCAPTCHA"}, "Governing Law": {"zh-CN": "适用法律", "th": "กฎหมายที่ใช้บังคับ"}, "Government Filing Information": {"zh-CN": "政府备案信息", "th": "ข้อมูลการยื่นต่อรัฐบาล"}, "Government Open Data": {"zh-CN": "政府开放数据", "th": "ข้อมูลเปิดของรัฐบาล"}, "Government Open Data platforms": {"zh-CN": "政府开放数据平台", "th": "แพลตฟอร์มข้อมูลเปิดของรัฐบาล"}, "Government Records": {"zh-CN": "政府记录", "th": "บันทึกของรัฐบาล"}, "Government Registration Records": {"zh-CN": "政府注册记录", "th": "บันทึกการจดทะเบียนของรัฐบาล"}, "Government agencies": {"zh-CN": "政府机构", "th": "หน่วยงานรัฐบาล"}, "Government approval": {"zh-CN": "政府批准", "th": "การอนุมัติจากรัฐบาล"}, "Government approval;": {"zh-CN": "政府批准；", "th": "การอนุมัติจากรัฐบาล;"}, "Government business registries": {"zh-CN": "政府企业注册处", "th": "ทะเบียนธุรกิจของรัฐบาล"}, "Government certification;": {"zh-CN": "政府认证；", "th": "การรับรองจากรัฐบาล;"}, "Government publication schedules;": {"zh-CN": "政府发布计划；", "th": "กำหนดการเผยแพร่ของรัฐบาล;"}, "Government recommendation;": {"zh-CN": "政府推荐；", "th": "คำแนะนำจากรัฐบาล;"}, "Government registries": {"zh-CN": "政府注册处", "th": "ทะเบียนของรัฐบาล"}, "Government registries;": {"zh-CN": "政府注册处；", "th": "ทะเบียนของรัฐบาล;"}, "Government-appointed Representative": {"zh-CN": "政府指定代表", "th": "ตัวแทนที่รัฐบาลแต่งตั้ง"}, "Government-issued Identification": {"zh-CN": "政府签发的身份证明", "th": "บัตรประจำตัวที่ออกโดยรัฐบาล"}, "Guarantee favorable presentation.": {"zh-CN": "保证有利的展示。", "th": "รับประกันการนำเสนอที่ดี"}, "Headline totals for the whole company registry, with the leading province and foreign-capital share.": {"zh-CN": "整个公司注册处的总览，包括领先省份和外资比例。", "th": "ยอดรวมของทะเบียนบริษัททั้งหมด พร้อมจังหวัดนำและสัดส่วนทุนต่างประเทศ"}, "Health & Social Work": {"zh-CN": "健康与社会工作", "th": "สุขภาพและงานสังคมสงเคราะห์"}, "High-capital company leads": {"zh-CN": "高资本公司线索", "th": "ข้อมูลบริษัททุนสูง"}, "Highest registered capital": {"zh-CN": "最高注册资本", "th": "ทุนจดทะเบียนสูงสุด"}, "Historical Public Records": {"zh-CN": "历史公共记录", "th": "บันทึกสาธารณะทางประวัติศาสตร์"}, "Historical public records;": {"zh-CN": "历史公共记录；", "th": "บันทึกสาธารณะทางประวัติศาสตร์;"}, "Household Employment Activities": {"zh-CN": "家庭雇佣活动", "th": "กิจกรรมการจ้างงานในครัวเรือน"}, "How BizThai collects, uses, and protects your information": {"zh-CN": "BizThai如何收集、使用和保护您的信息", "th": "BizThai รวบรวม ใช้ และปกป้องข้อมูลของคุณอย่างไร"}, "How BizThai safeguards the accuracy, independence and transparency of business information.": {"zh-CN": "BizThai如何确保商业信息的准确性、独立性和透明度。", "th": "BizThai ปกป้องความถูกต้อง ความเป็นอิสระ และความโปร่งใสของข้อมูลธุรกิจอย่างไร"}, "How Business Information on BizThai May and May Not Be Used": {"zh-CN": "BizThai上的商业信息可以及不可以如何使用", "th": "ข้อมูลธุรกิจบน BizThai สามารถและไม่สามารถใช้ได้อย่างไร"}, "How We Use Information": {"zh-CN": "我们如何使用信息", "th": "เราใช้ข้อมูลอย่างไร"}, "How authorized representatives verify ownership of a company profile on BizThai": {"zh-CN": "授权代表如何验证BizThai上公司资料的所有权", "th": "ตัวแทนที่ได้รับอนุญาตตรวจสอบความเป็นเจ้าของโปรไฟล์บริษัทบน BizThai อย่างไร"}, "How copyright owners may report alleged infringement on BizThai": {"zh-CN": "版权所有者如何举报BizThai上的涉嫌侵权", "th": "เจ้าของลิขสิทธิ์สามารถรายงานการละเมิดที่ถูกกล่าวหาบน BizThai ได้อย่างไร"}, "How registered companies split between Thai and foreign capital, and the leading investor origins behind them.": {"zh-CN": "注册公司如何在泰资和外资之间划分，以及背后的主要投资者来源。", "th": "บริษัทที่จดทะเบียนแบ่งระหว่างทุนไทยและต่างชาติอย่างไร และแหล่งที่มาของนักลงทุนหลักที่อยู่เบื้องหลัง"}, "How to Submit a Request": {"zh-CN": "如何提交请求", "th": "วิธีการส่งคำขอ"}, "How to request the correction, update or review of business information on BizThai": {"zh-CN": "如何请求更正、更新或审查BizThai上的商业信息", "th": "วิธีการขอแก้ไข อัปเดต หรือตรวจสอบข้อมูลธุรกิจบน BizThai"}, "How we source, verify and protect company data — and the rights you have over it.": {"zh-CN": "我们如何获取、验证和保护公司数据——以及您对其拥有的权利。", "th": "เรา sourcing ตรวจสอบ และปกป้องข้อมูลบริษัทอย่างไร — และสิทธิที่คุณมีเหนือข้อมูลนั้น"}, "However, BizThai does not warrant that any information displayed is:": {"zh-CN": "但是，BizThai不保证所显示的任何信息：", "th": "อย่างไรก็ตาม BizThai ไม่รับประกันว่าข้อมูลที่แสดงใดๆ:"}, "However, if information is inaccurate, outdated or published in error, you may submit a correction request.": {"zh-CN": "但是，如果信息不准确、过时或发布有误，您可以提交更正请求。", "th": "อย่างไรก็ตาม หากข้อมูลไม่ถูกต้อง ล้าสมัย หรือเผยแพร่โดยผิดพลาด คุณสามารถส่งคำขอแก้ไขได้"}, "However, information may occasionally be:": {"zh-CN": "但是，信息有时可能：", "th": "อย่างไรก็ตาม ข้อมูลอาจเป็นครั้งคราว:"}, "However, no Internet transmission or electronic storage method is completely secure.": {"zh-CN": "但是，没有任何互联网传输或电子存储方法是完全安全的。", "th": "อย่างไรก็ตาม ไม่มีวิธีการส่งผ่านอินเทอร์เน็ตหรือการจัดเก็บข้อมูลอิเล็กทรอนิกส์ใดที่ปลอดภัยอย่างสมบูรณ์"}, "IP Address": {"zh-CN": "IP地址", "th": "ที่อยู่ IP"}, "If a logo or trademark is displayed incorrectly or without authorization, the rights holder may request a review by contacting support@bizthai.com.": {"zh-CN": "如果徽标或商标显示不正确或未经授权，权利人可以通过联系 support@bizthai.com 请求审查。", "th": "หากโลโก้หรือเครื่องหมายการค้าแสดงไม่ถูกต้องหรือไม่ได้รับอนุญาต เจ้าของสิทธิ์สามารถขอให้ตรวจสอบได้โดยติดต่อ support@bizthai.com"}, "If content has been removed or restricted following a copyright complaint and you believe the action was made in error, you may submit a counter-notice with supporting evidence.": {"zh-CN": "如果内容因版权投诉被删除或限制，而您认为该操作有误，您可以提交反通知并附上支持证据。", "th": "หากเนื้อหาถูกลบหรือจำกัดหลังจากการร้องเรียนเรื่องลิขสิทธิ์ และคุณเชื่อว่าการดำเนินการดังกล่าวเกิดจากความผิดพลาด คุณสามารถส่งคำคัดค้านพร้อมหลักฐานสนับสนุน"}, "If you believe information displayed on BizThai is inaccurate or incomplete, you may submit a correction request.": {"zh-CN": "如果您认为BizThai上显示的信息不准确或不完整，您可以提交更正请求。", "th": "หากคุณเชื่อว่าข้อมูลที่แสดงบน BizThai ไม่ถูกต้องหรือไม่สมบูรณ์ คุณสามารถส่งคำขอแก้ไข"}, "If you believe information is incorrect, we encourage you to contact us.": {"zh-CN": "如果您认为信息不正确，我们鼓励您联系我们。", "th": "หากคุณเชื่อว่าข้อมูลไม่ถูกต้อง เราขอแนะนำให้คุณติดต่อเรา"}, "If you believe that copyrighted material has been displayed on BizThai without proper authorization, you may submit a copyright complaint. Please send your notice to:": {"zh-CN": "如果您认为受版权保护的材料未经适当授权显示在BizThai上，您可以提交版权投诉。请将通知发送至：", "th": "หากคุณเชื่อว่ามีการแสดงเนื้อหาที่มีลิขสิทธิ์บน BizThai โดยไม่ได้รับอนุญาตอย่างถูกต้อง คุณสามารถส่งเรื่องร้องเรียนลิขสิทธิ์ โปรดส่งหนังสือแจ้งไปที่:"}, "If you do not agree with these Terms, you must discontinue using the Services immediately.": {"zh-CN": "如果您不同意这些条款，您必须立即停止使用服务。", "th": "หากคุณไม่เห็นด้วยกับข้อกำหนดเหล่านี้ คุณต้องหยุดใช้บริการทันที"}, "If you encounter an accessibility barrier, please tell us so we can fix it. Describe the page and the problem and we will respond as quickly as we can.": {"zh-CN": "如果您遇到无障碍访问障碍，请告诉我们，以便我们修复。描述页面和问题，我们将尽快回复。", "th": "หากคุณพบอุปสรรคในการเข้าถึง โปรดแจ้งให้เราทราบเพื่อเราจะได้แก้ไข อธิบายหน้าเว็บและปัญหา แล้วเราจะตอบกลับโดยเร็วที่สุด"}, "If you have any questions regarding this Disclaimer, please contact:": {"zh-CN": "如果您对本免责声明有任何疑问，请联系：", "th": "หากคุณมีคำถามใดๆ เกี่ยวกับข้อจำกัดความรับผิดชอบนี้ โปรดติดต่อ:"}, "Images submitted by verified companies": {"zh-CN": "由已验证公司提交的图片", "th": "รูปภาพที่ส่งโดยบริษัทที่ได้รับการยืนยัน"}, "Important information about relying on content published on the BizThai platform.": {"zh-CN": "关于依赖BizThai平台发布内容的重要信息。", "th": "ข้อมูลสำคัญเกี่ยวกับการพึ่งพาเนื้อหาที่เผยแพร่บนแพลตฟอร์ม BizThai"}, "Improve search ranking;": {"zh-CN": "提高搜索排名；", "th": "ปรับปรุงอันดับการค้นหา;"}, "Improve search results": {"zh-CN": "改善搜索结果", "th": "ปรับปรุงผลการค้นหา"}, "Improve searchability;": {"zh-CN": "提高可搜索性；", "th": "ปรับปรุงความสามารถในการค้นหา;"}, "Improve website functionality": {"zh-CN": "改善网站功能", "th": "ปรับปรุงฟังก์ชันการทำงานของเว็บไซต์"}, "Improve website performance": {"zh-CN": "提高网站性能", "th": "ปรับปรุงประสิทธิภาพของเว็บไซต์"}, "Incomplete requests may delay processing.": {"zh-CN": "不完整的请求可能会延迟处理。", "th": "คำขอที่ไม่สมบูรณ์อาจทำให้การดำเนินการล่าช้า"}, "Incomplete requests may not be processed.": {"zh-CN": "不完整的请求可能无法处理。", "th": "คำขอที่ไม่สมบูรณ์อาจไม่ได้รับการดำเนินการ"}, "Incomplete;": {"zh-CN": "不完整；", "th": "ไม่สมบูรณ์;"}, "Incorrect Public Information": {"zh-CN": "不正确的公开信息", "th": "ข้อมูลสาธารณะที่ไม่ถูกต้อง"}, "Indemnification": {"zh-CN": "赔偿", "th": "การชดใช้ค่าเสียหาย"}, "Independence": {"zh-CN": "独立性", "th": "ความเป็นอิสระ"}, "Independent Verification": {"zh-CN": "独立验证", "th": "การตรวจสอบโดยอิสระ"}, "Index registration numbers;": {"zh-CN": "索引注册号；", "th": "หมายเลขทะเบียนดัชนี;"}, "Industry": {"zh-CN": "行业", "th": "อุตสาหกรรม"}, "Industry Ranking": {"zh-CN": "行业排名", "th": "การจัดอันดับอุตสาหกรรม"}, "Industry classifications": {"zh-CN": "行业分类", "th": "การจำแนกประเภทอุตสาหกรรม"}, "Industry groups": {"zh-CN": "行业组", "th": "กลุ่มอุตสาหกรรม"}, "Industry sections by company count": {"zh-CN": "按公司数量划分的行业板块", "th": "ส่วนอุตสาหกรรมตามจำนวนบริษัท"}, "Industry taxonomy": {"zh-CN": "行业分类法", "th": "อนุกรมวิธานอุตสาหกรรม"}, "Influence editorial decisions;": {"zh-CN": "影响编辑决策；", "th": "มีอิทธิพลต่อการตัดสินใจด้านบรรณาธิการ;"}, "Information & Communication": {"zh-CN": "信息与通信", "th": "ข้อมูลและการสื่อสาร"}, "Information Covered": {"zh-CN": "涵盖的信息", "th": "ข้อมูลที่ครอบคลุม"}, "Information Purpose": {"zh-CN": "信息目的", "th": "วัตถุประสงค์ของข้อมูล"}, "Information That Cannot Be Modified": {"zh-CN": "无法修改的信息", "th": "ข้อมูลที่ไม่สามารถแก้ไขได้"}, "Information That May Be Updated": {"zh-CN": "可能更新的信息", "th": "ข้อมูลที่อาจได้รับการอัปเดต"}, "Information That Will Normally Not Be Removed": {"zh-CN": "通常不会被删除的信息", "th": "ข้อมูลที่โดยปกติจะไม่ถูกลบ"}, "Information We Collect": {"zh-CN": "我们收集的信息", "th": "ข้อมูลที่เราเก็บรวบรวม"}, "Information available from official public registries.": {"zh-CN": "来自官方公共登记处的信息。", "th": "ข้อมูลที่มีจากทะเบียนสาธารณะอย่างเป็นทางการ"}, "Information displayed about companies generally originates from lawful public sources and does not necessarily constitute personal information under applicable law.": {"zh-CN": "显示的公司信息通常来自合法的公共来源，不一定构成适用法律下的个人信息。", "th": "ข้อมูลที่แสดงเกี่ยวกับบริษัทโดยทั่วไปมาจากแหล่งสาธารณะที่ถูกกฎหมาย และไม่จำเป็นต้องถือเป็นข้อมูลส่วนบุคคลภายใต้กฎหมายที่เกี่ยวข้อง"}, "Information displayed may originate from:": {"zh-CN": "显示的信息可能来源于：", "th": "ข้อมูลที่แสดงอาจมาจาก:"}, "Information displayed on BizThai may be collected from one or more lawful sources, including but not limited to:": {"zh-CN": "BizThai 上显示的信息可能从一个或多个合法来源收集，包括但不限于：", "th": "ข้อมูลที่แสดงบน BizThai อาจถูกรวบรวมจากแหล่งที่ถูกกฎหมายหนึ่งแห่งหรือมากกว่า รวมถึงแต่ไม่จำกัดเพียง:"}, "Information displayed on BizThai may originate from one or more lawful sources, including but not limited to:": {"zh-CN": "BizThai 上显示的信息可能源自一个或多个合法来源，包括但不限于：", "th": "ข้อมูลที่แสดงบน BizThai อาจมาจากแหล่งที่ถูกกฎหมายหนึ่งแห่งหรือมากกว่า รวมถึงแต่ไม่จำกัดเพียง:"}, "Information may be changed, corrected or updated without prior notice.": {"zh-CN": "信息可能随时更改、更正或更新，恕不另行通知。", "th": "ข้อมูลอาจมีการเปลี่ยนแปลง แก้ไข หรืออัปเดตโดยไม่ต้องแจ้งให้ทราบล่วงหน้า"}, "Information may change without notice.": {"zh-CN": "信息可能随时更改，恕不另行通知。", "th": "ข้อมูลอาจเปลี่ยนแปลงโดยไม่ต้องแจ้งให้ทราบ"}, "Information on this website does not constitute and BizThai does not provide:": {"zh-CN": "本网站上的信息不构成，且 BizThai 不提供：", "th": "ข้อมูลบนเว็บไซต์นี้ไม่ถือเป็น และ BizThai ไม่ได้ให้:"}, "Information submitted by verified companies": {"zh-CN": "经核实公司提交的信息", "th": "ข้อมูลที่ส่งโดยบริษัทที่ได้รับการยืนยัน"}, "Information violates applicable privacy laws.": {"zh-CN": "信息违反适用的隐私法律。", "th": "ข้อมูลละเมิดกฎหมายความเป็นส่วนตัวที่เกี่ยวข้อง"}, "Information voluntarily provided by companies remains subject to BizThai's review and publication policies.": {"zh-CN": "公司自愿提供的信息仍受 BizThai 的审核和发布政策约束。", "th": "ข้อมูลที่บริษัทให้โดยสมัครใจยังคงอยู่ภายใต้นโยบายการตรวจสอบและการเผยแพร่ของ BizThai"}, "Information voluntarily submitted by companies": {"zh-CN": "公司自愿提交的信息", "th": "ข้อมูลที่บริษัทส่งโดยสมัครใจ"}, "Information was published in error;": {"zh-CN": "信息被错误发布；", "th": "ข้อมูลถูกเผยแพร่โดยผิดพลาด;"}, "Information will be retained only as long as reasonably necessary for:": {"zh-CN": "信息将仅在合理必要的期限内保留，用于：", "th": "ข้อมูลจะถูกเก็บไว้เท่าที่จำเป็นอย่างสมเหตุสมผลสำหรับ:"}, "Informational Purposes Only": {"zh-CN": "仅供参考", "th": "เพื่อวัตถุประสงค์ในการให้ข้อมูลเท่านั้น"}, "Intellectual Property": {"zh-CN": "知识产权", "th": "ทรัพย์สินทางปัญญา"}, "Interfere with system security": {"zh-CN": "干扰系统安全", "th": "รบกวนความปลอดภัยของระบบ"}, "Internal review procedures.": {"zh-CN": "内部审查程序。", "th": "ขั้นตอนการตรวจสอบภายใน"}, "International Users": {"zh-CN": "国际用户", "th": "ผู้ใช้ต่างประเทศ"}, "Introduction": {"zh-CN": "介绍", "th": "บทนำ"}, "Investment": {"zh-CN": "投资", "th": "การลงทุน"}, "Investment advice": {"zh-CN": "投资建议", "th": "คำแนะนำการลงทุน"}, "Investment decisions": {"zh-CN": "投资决策", "th": "การตัดสินใจลงทุน"}, "Is BizThai a Government Website?": {"zh-CN": "BizThai 是政府网站吗？", "th": "BizThai เป็นเว็บไซต์ของรัฐบาลหรือไม่?"}, "Job Title": {"zh-CN": "职位", "th": "ตำแหน่งงาน"}, "Join free to save companies, claim your business and download company profiles.": {"zh-CN": "免费加入，保存公司、认领企业并下载公司简介。", "th": "สมัครฟรีเพื่อบันทึกบริษัท อ้างสิทธิ์ธุรกิจของคุณ และดาวน์โหลดโปรไฟล์บริษัท"}, "Keyword": {"zh-CN": "关键词", "th": "คำสำคัญ"}, "Known limitations": {"zh-CN": "已知限制", "th": "ข้อจำกัดที่ทราบ"}, "Language Preference": {"zh-CN": "语言偏好", "th": "การตั้งค่าภาษา"}, "Last updated: June 2026": {"zh-CN": "最后更新：2026年6月", "th": "อัปเดตล่าสุด: มิถุนายน 2026"}, "Lawful public records.": {"zh-CN": "合法的公共记录。", "th": "บันทึกสาธารณะที่ถูกต้องตามกฎหมาย"}, "Legal": {"zh-CN": "法律", "th": "กฎหมาย"}, "Legal Department": {"zh-CN": "法律部门", "th": "ฝ่ายกฎหมาย"}, "Legal Requests": {"zh-CN": "法律请求", "th": "คำขอทางกฎหมาย"}, "Legal advice": {"zh-CN": "法律建议", "th": "คำแนะนำทางกฎหมาย"}, "Legal compliance": {"zh-CN": "法律合规", "th": "การปฏิบัติตามกฎหมาย"}, "Legal compliance.": {"zh-CN": "法律合规。", "th": "การปฏิบัติตามกฎหมาย"}, "Legal entity status verification": {"zh-CN": "法人实体状态验证", "th": "การตรวจสอบสถานะนิติบุคคล"}, "Legal requests.": {"zh-CN": "法律请求。", "th": "คำขอทางกฎหมาย"}, "Letter of Authorization": {"zh-CN": "授权书", "th": "หนังสือมอบอำนาจ"}, "Licensed Lawyer": {"zh-CN": "持牌律师", "th": "ทนายความที่ได้รับใบอนุญาต"}, "Licensed commercial data providers": {"zh-CN": "持牌商业数据提供商", "th": "ผู้ให้บริการข้อมูลเชิงพาณิชย์ที่ได้รับใบอนุญาต"}, "Licensed data providers": {"zh-CN": "持牌数据提供商", "th": "ผู้ให้บริการข้อมูลที่ได้รับใบอนุญาต"}, "Licensed lawyers": {"zh-CN": "持牌律师", "th": "ทนายความที่ได้รับใบอนุญาต"}, "Limitation of Liability": {"zh-CN": "责任限制", "th": "ข้อจำกัดความรับผิด"}, "Limitation of Verification": {"zh-CN": "验证限制", "th": "ข้อจำกัดในการตรวจสอบ"}, "Live": {"zh-CN": "实时", "th": "สด"}, "Loading claims…": {"zh-CN": "正在加载索赔…", "th": "กำลังโหลดการเรียกร้อง…"}, "Loading company record…": {"zh-CN": "正在加载公司记录…", "th": "กำลังโหลดข้อมูลบริษัท…"}, "Loading saved companies…": {"zh-CN": "正在加载已保存的公司…", "th": "กำลังโหลดบริษัทที่บันทึกไว้…"}, "Loading your account…": {"zh-CN": "正在加载您的账户…", "th": "กำลังโหลดบัญชีของคุณ…"}, "Looking for a company?": {"zh-CN": "在找公司吗？", "th": "กำลังมองหาบริษัทอยู่หรือ?"}, "Loss of business opportunities": {"zh-CN": "商业机会损失", "th": "การสูญเสียโอกาสทางธุรกิจ"}, "Loss of profits": {"zh-CN": "利润损失", "th": "การสูญเสียผลกำไร"}, "Maintain readable colour contrast and scalable text.": {"zh-CN": "保持可读的颜色对比度和可缩放文本。", "th": "รักษาความคมชัดของสีที่อ่านได้และข้อความที่ปรับขนาดได้"}, "Manufacturing": {"zh-CN": "制造业", "th": "การผลิต"}, "Manufacturing companies": {"zh-CN": "制造公司", "th": "บริษัทผู้ผลิต"}, "Many businesses appear on BizThai because their information has been lawfully published by government authorities or other public sources.": {"zh-CN": "许多企业出现在BizThai上，因为其信息已由政府机构或其他公共来源合法发布。", "th": "ธุรกิจจำนวนมากปรากฏบน BizThai เนื่องจากข้อมูลของพวกเขาได้รับการเผยแพร่โดยชอบด้วยกฎหมายจากหน่วยงานรัฐบาลหรือแหล่งข้อมูลสาธารณะอื่นๆ"}, "Many company profiles displayed on BizThai are based on information lawfully available from public records.": {"zh-CN": "BizThai上显示的许多公司资料基于从公共记录中合法获取的信息。", "th": "โปรไฟล์บริษัทจำนวนมากที่แสดงบน BizThai มาจากข้อมูลที่เปิดเผยต่อสาธารณะโดยชอบด้วยกฎหมาย"}, "Market research": {"zh-CN": "市场调研", "th": "การวิจัยตลาด"}, "Matching companies": {"zh-CN": "匹配的公司", "th": "บริษัทที่ตรงกัน"}, "Measure website traffic": {"zh-CN": "衡量网站流量", "th": "วัดปริมาณการเข้าชมเว็บไซต์"}, "Member center": {"zh-CN": "会员中心", "th": "ศูนย์สมาชิก"}, "Member sections": {"zh-CN": "会员专区", "th": "ส่วนของสมาชิก"}, "Menu": {"zh-CN": "菜单", "th": "เมนู"}, "Merge duplicate records;": {"zh-CN": "合并重复记录；", "th": "รวมบันทึกที่ซ้ำกัน;"}, "Message the assistant": {"zh-CN": "给助手留言", "th": "ส่งข้อความถึงผู้ช่วย"}, "Mining & Quarrying": {"zh-CN": "采矿业", "th": "เหมืองแร่และเหมืองหิน"}, "Mirror or reproduce the BizThai website": {"zh-CN": "镜像或复制BizThai网站", "th": "ทำมิเรอร์หรือทำซ้ำเว็บไซต์ BizThai"}, "Misuse the platform": {"zh-CN": "滥用平台", "th": "ใช้แพลตฟอร์มในทางที่ผิด"}, "More companies": {"zh-CN": "更多公司", "th": "บริษัทเพิ่มเติม"}, "National registry snapshot": {"zh-CN": "国家注册快照", "th": "ภาพรวมทะเบียนแห่งชาติ"}, "Necessary to protect BizThai's legal rights": {"zh-CN": "保护BizThai法律权利所必需", "th": "จำเป็นเพื่อปกป้องสิทธิทางกฎหมายของ BizThai"}, "New companies registered so far this year, plus how the latest full year compares with the one before.": {"zh-CN": "今年迄今新注册的公司，以及最近一个完整年度与上一年度的比较。", "th": "บริษัทที่จดทะเบียนใหม่ตั้งแต่ต้นปีนี้ พร้อมการเปรียบเทียบปีเต็มล่าสุดกับปีก่อนหน้า"}, "New password": {"zh-CN": "新密码", "th": "รหัสผ่านใหม่"}, "New registrations over the years": {"zh-CN": "历年新注册数量", "th": "การจดทะเบียนใหม่ในแต่ละปี"}, "Newest published company records.": {"zh-CN": "最新发布的公司记录。", "th": "บันทึกบริษัทที่เผยแพร่ล่าสุด"}, "No Government Endorsement": {"zh-CN": "无政府认可", "th": "ไม่มีการรับรองจากรัฐบาล"}, "No Guarantee": {"zh-CN": "无保证", "th": "ไม่มีการรับประกัน"}, "No Paid Removal": {"zh-CN": "无付费删除", "th": "ไม่มีการลบโดยเสียค่าใช้จ่าย"}, "No Professional Advice": {"zh-CN": "无专业建议", "th": "ไม่มีคำแนะนำจากผู้เชี่ยวชาญ"}, "No Warranty": {"zh-CN": "无担保", "th": "ไม่มีการรับประกัน"}, "No articles yet.": {"zh-CN": "暂无文章。", "th": "ยังไม่มีบทความ"}, "No companies in this industry yet.": {"zh-CN": "该行业暂无公司。", "th": "ยังไม่มีบริษัทในอุตสาหกรรมนี้"}, "No companies in this province yet.": {"zh-CN": "该省份暂无公司。", "th": "ยังไม่มีบริษัทในจังหวัดนี้"}, "No content may be copied, reproduced, distributed or commercially exploited without prior written permission except where permitted by applicable law.": {"zh-CN": "除非适用法律允许，未经事先书面许可，不得复制、转载、分发或商业利用任何内容。", "th": "ห้ามคัดลอก ทำซ้ำ แจกจ่าย หรือใช้ประโยชน์ในเชิงพาณิชย์โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษรล่วงหน้า ยกเว้นที่กฎหมายที่เกี่ยวข้องอนุญาต"}, "No. BizThai does not accept payment to remove or hide lawfully published public business information.": {"zh-CN": "不。BizThai不接受付费删除或隐藏合法发布的公共商业信息。", "th": "ไม่ BizThai ไม่รับชำระเงินเพื่อลบหรือซ่อนข้อมูลธุรกิจสาธารณะที่เผยแพร่โดยชอบด้วยกฎหมาย"}, "No. BizThai does not sell confidential company information.": {"zh-CN": "不。BizThai不出售机密公司信息。", "th": "ไม่ BizThai ไม่ขายข้อมูลบริษัทที่เป็นความลับ"}, "No. BizThai is an independent business information platform.": {"zh-CN": "不。BizThai是一个独立的商业信息平台。", "th": "ไม่ BizThai เป็นแพลตฟอร์มข้อมูลธุรกิจอิสระ"}, "Not every company profile will contain information from every source.": {"zh-CN": "并非每个公司档案都包含来自所有来源的信息。", "th": "ไม่ใช่ทุกโปรไฟล์บริษัทจะมีข้อมูลจากทุกแหล่ง"}, "Nothing contained on the platform constitutes legal advice, financial advice, tax advice, accounting advice, investment advice or any professional recommendation.": {"zh-CN": "平台上的任何内容均不构成法律建议、财务建议、税务建议、会计建议、投资建议或任何专业推荐。", "th": "ไม่มีสิ่งใดในแพลตฟอร์มนี้ที่ถือเป็นคำแนะนำทางกฎหมาย คำแนะนำทางการเงิน คำแนะนำด้านภาษี คำแนะนำด้านบัญชี คำแนะนำด้านการลงทุน หรือคำแนะนำทางวิชาชีพใดๆ"}, "Nothing in this Policy limits any rights users may have under applicable laws regarding access to public records.": {"zh-CN": "本政策中的任何内容均不限制用户根据适用法律享有的访问公共记录的任何权利。", "th": "ไม่มีสิ่งใดในนโยบายนี้จำกัดสิทธิใดๆ ที่ผู้ใช้อาจมีภายใต้กฎหมายที่เกี่ยวข้องเกี่ยวกับการเข้าถึงบันทึกสาธารณะ"}, "Nothing on this website constitutes legal advice, financial advice, accounting advice, tax advice, investment advice, or any other professional advice.": {"zh-CN": "本网站上的任何内容均不构成法律建议、财务建议、会计建议、税务建议、投资建议或任何其他专业建议。", "th": "ไม่มีสิ่งใดในเว็บไซต์นี้ที่ถือเป็นคำแนะนำทางกฎหมาย คำแนะนำทางการเงิน คำแนะนำด้านบัญชี คำแนะนำด้านภาษี คำแนะนำด้านการลงทุน หรือคำแนะนำทางวิชาชีพอื่นใด"}, "Notify the applicant by email": {"zh-CN": "通过电子邮件通知申请人", "th": "แจ้งผู้สมัครทางอีเมล"}, "Notify the applicant where applicable.": {"zh-CN": "在适用的情况下通知申请人。", "th": "แจ้งผู้สมัครตามความเหมาะสม"}, "Offer the platform in English, Thai and Chinese.": {"zh-CN": "提供英文、泰文和中文的平台。", "th": "ให้บริการแพลตฟอร์มเป็นภาษาอังกฤษ ไทย และจีน"}, "Official Director Records": {"zh-CN": "官方董事记录", "th": "บันทึกกรรมการอย่างเป็นทางการ"}, "Official Gazettes": {"zh-CN": "官方公报", "th": "ราชกิจจานุเบกษาอย่างเป็นทางการ"}, "Official Government Documents": {"zh-CN": "官方政府文件", "th": "เอกสารราชการของรัฐบาล"}, "Official Registration Status": {"zh-CN": "官方注册状态", "th": "สถานะการจดทะเบียนอย่างเป็นทางการ"}, "Official announcements": {"zh-CN": "官方公告", "th": "ประกาศอย่างเป็นทางการ"}, "Official business registries": {"zh-CN": "官方商业登记", "th": "ทะเบียนธุรกิจอย่างเป็นทางการ"}, "Official company submissions;": {"zh-CN": "官方公司提交文件；", "th": "การยื่นเอกสารบริษัทอย่างเป็นทางการ;"}, "Official filing information;": {"zh-CN": "官方备案信息；", "th": "ข้อมูลการยื่นเอกสารอย่างเป็นทางการ;"}, "Official government action;": {"zh-CN": "官方政府行动；", "th": "การดำเนินการของรัฐบาลอย่างเป็นทางการ;"}, "Official government records shall prevail in the event of any inconsistency.": {"zh-CN": "如有任何不一致，以官方政府记录为准。", "th": "ในกรณีที่มีความไม่สอดคล้องกัน ให้ยึดถือบันทึกของรัฐบาลอย่างเป็นทางการ"}, "Official public filings": {"zh-CN": "官方公开备案", "th": "การยื่นเอกสารสาธารณะอย่างเป็นทางการ"}, "Official public records": {"zh-CN": "官方公开记录", "th": "บันทึกสาธารณะอย่างเป็นทางการ"}, "Official publications": {"zh-CN": "官方出版物", "th": "สิ่งพิมพ์อย่างเป็นทางการ"}, "Official publications;": {"zh-CN": "官方出版物；", "th": "สิ่งพิมพ์อย่างเป็นทางการ;"}, "Open report": {"zh-CN": "公开报告", "th": "รายงานเปิดเผย"}, "Operating System": {"zh-CN": "操作系统", "th": "ระบบปฏิบัติการ"}, "Operating vs other states.": {"zh-CN": "运营状态与其他州比较。", "th": "การดำเนินงานเทียบกับรัฐอื่น"}, "Opinions expressed by third parties do not necessarily reflect the views of BizThai.": {"zh-CN": "第三方表达的意见不一定反映BizThai的观点。", "th": "ความคิดเห็นที่แสดงโดยบุคคลที่สามไม่จำเป็นต้องสะท้อนมุมมองของ BizThai"}, "Ordered by a competent court;": {"zh-CN": "由有管辖权的法院命令；", "th": "โดยคำสั่งของศาลที่มีอำนาจ;"}, "Organize public records;": {"zh-CN": "整理公共记录；", "th": "จัดระเบียบบันทึกสาธารณะ;"}, "Other Service Activities": {"zh-CN": "其他服务活动", "th": "กิจกรรมบริการอื่นๆ"}, "Other lawful public information sources": {"zh-CN": "其他合法公共信息来源", "th": "แหล่งข้อมูลสาธารณะที่ถูกต้องตามกฎหมายอื่นๆ"}, "Other lawful public sources": {"zh-CN": "其他合法公共来源", "th": "แหล่งข้อมูลสาธารณะที่ถูกต้องตามกฎหมายอื่นๆ"}, "Other lawful public sources.": {"zh-CN": "其他合法公共来源。", "th": "แหล่งข้อมูลสาธารณะที่ถูกต้องตามกฎหมายอื่นๆ"}, "Other persons with sufficient legal authority": {"zh-CN": "其他具有充分法律授权的人", "th": "บุคคลอื่นที่มีอำนาจทางกฎหมายเพียงพอ"}, "Other publicly available and lawful information sources": {"zh-CN": "其他公开可用且合法的信息来源", "th": "แหล่งข้อมูลอื่นที่เปิดเผยต่อสาธารณะและถูกต้องตามกฎหมาย"}, "Other supporting documents": {"zh-CN": "其他支持文件", "th": "เอกสารสนับสนุนอื่นๆ"}, "Our Commitment": {"zh-CN": "我们的承诺", "th": "ความมุ่งมั่นของเรา"}, "Our commitment": {"zh-CN": "我们的承诺", "th": "ความมุ่งมั่นของเรา"}, "Our goal is to improve transparency rather than create new information.": {"zh-CN": "我们的目标是提高透明度，而非创造新信息。", "th": "เป้าหมายของเราคือการเพิ่มความโปร่งใส ไม่ใช่สร้างข้อมูลใหม่"}, "Our mission is to organize publicly available business information, improve accessibility, and help individuals and organizations make informed decisions.": {"zh-CN": "我们的使命是整理公开的商业信息，提高可访问性，并帮助个人和组织做出明智的决策。", "th": "พันธกิจของเราคือการจัดระเบียบข้อมูลธุรกิจที่เปิดเผยต่อสาธารณะ เพิ่มการเข้าถึง และช่วยให้บุคคลและองค์กรตัดสินใจอย่างมีข้อมูล"}, "Our team reviews every request individually.": {"zh-CN": "我们的团队会逐一审核每个请求。", "th": "ทีมงานของเราจะตรวจสอบทุกคำขอเป็นรายกรณี"}, "Outdated;": {"zh-CN": "已过时；", "th": "ล้าสมัย;"}, "Owner & Shareholder Leads": {"zh-CN": "所有者与股东线索", "th": "ลีดเจ้าของและผู้ถือหุ้น"}, "Owner Research": {"zh-CN": "所有者研究", "th": "การวิจัยเจ้าของ"}, "Ownership": {"zh-CN": "所有权", "th": "ความเป็นเจ้าของ"}, "Page not found": {"zh-CN": "页面未找到", "th": "ไม่พบหน้า"}, "Pages Visited": {"zh-CN": "已访问页面", "th": "หน้าที่เข้าชม"}, "Participation in the Business Verification Program does not:": {"zh-CN": "参与企业验证计划并不意味着：", "th": "การเข้าร่วมโปรแกรมตรวจสอบธุรกิจไม่ได้:"}, "Partnerships": {"zh-CN": "合作伙伴关系", "th": "ความร่วมมือ"}, "Passport": {"zh-CN": "护照", "th": "หนังสือเดินทาง"}, "Password": {"zh-CN": "密码", "th": "รหัสผ่าน"}, "Permitted Use": {"zh-CN": "允许用途", "th": "การใช้งานที่ได้รับอนุญาต"}, "Personal Information": {"zh-CN": "个人信息", "th": "ข้อมูลส่วนบุคคล"}, "Personal reference": {"zh-CN": "个人参考", "th": "ข้อมูลอ้างอิงส่วนบุคคล"}, "Phone": {"zh-CN": "电话", "th": "โทรศัพท์"}, "Pick an industry to see where its capital flows across Thailand — every province shaded by that sector's registered capital, with a direct path into the companies behind it.": {"zh-CN": "选择一个行业，查看其资本在泰国的流向——每个省份按该行业的注册资本着色，并可直接进入背后的公司。", "th": "เลือกอุตสาหกรรมเพื่อดูว่าทุนไหลไปที่ไหนทั่วประเทศไทย — แต่ละจังหวัดถูกแรเงาตามทุนจดทะเบียนของภาคส่วนนั้น พร้อมเส้นทางตรงไปยังบริษัทที่อยู่เบื้องหลัง"}, "Pick the channel that fits your question — general enquiries, data corrections or partnerships. We read every message.": {"zh-CN": "选择适合您问题的渠道——一般咨询、数据更正或合作伙伴关系。我们会阅读每一条消息。", "th": "เลือกช่องทางที่เหมาะกับคำถามของคุณ — สอบถามทั่วไป แก้ไขข้อมูล หรือความร่วมมือ เราอ่านทุกข้อความ"}, "Pinpoint Thailand's busiest business hubs. Compare every province by registered capital and company count, then open any province to explore its companies.": {"zh-CN": "精准定位泰国最繁忙的商业中心。按注册资本和公司数量比较每个省份，然后打开任意省份探索其公司。", "th": "ระบุศูนย์กลางธุรกิจที่คึกคักที่สุดของไทย เปรียบเทียบทุกจังหวัดตามทุนจดทะเบียนและจำนวนบริษัท จากนั้นเปิดจังหวัดใดก็ได้เพื่อสำรวจบริษัทในนั้น"}, "Plan market entry with province terms, company samples and business objectives mapped across Thailand.": {"zh-CN": "利用省份条款、公司样本和业务目标在泰国各地规划市场进入策略。", "th": "วางแผนการเข้าสู่ตลาดด้วยเงื่อนไขจังหวัด ตัวอย่างบริษัท และวัตถุประสงค์ทางธุรกิจที่映射ทั่วประเทศไทย"}, "Please send all correction requests to:": {"zh-CN": "请将所有更正请求发送至：", "th": "โปรดส่งคำขอแก้ไขทั้งหมดไปที่:"}, "Please wait a moment.": {"zh-CN": "请稍等片刻。", "th": "กรุณารอสักครู่"}, "Policy Updates": {"zh-CN": "政策更新", "th": "การอัปเดตนโยบาย"}, "Prevent fraud and abuse": {"zh-CN": "防止欺诈和滥用", "th": "ป้องกันการฉ้อโกงและการละเมิด"}, "Preventing fraud": {"zh-CN": "防止欺诈", "th": "การป้องกันการฉ้อโกง"}, "Privacy Officer": {"zh-CN": "隐私官", "th": "เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล"}, "Privacy Policy": {"zh-CN": "隐私政策", "th": "นโยบายความเป็นส่วนตัว"}, "Process correction requests": {"zh-CN": "处理更正请求", "th": "ดำเนินการตามคำขอแก้ไข"}, "Professional, Scientific & Technical": {"zh-CN": "专业、科学和技术", "th": "วิชาชีพ วิทยาศาสตร์ และเทคนิค"}, "Profile": {"zh-CN": "个人资料", "th": "โปรไฟล์"}, "Prohibited Use": {"zh-CN": "禁止使用", "th": "การใช้งานที่ต้องห้าม"}, "Protect platform security": {"zh-CN": "保护平台安全", "th": "ปกป้องความปลอดภัยของแพลตฟอร์ม"}, "Protecting platform integrity": {"zh-CN": "保护平台完整性", "th": "การปกป้องความสมบูรณ์ของแพลตฟอร์ม"}, "Provide our Services": {"zh-CN": "提供我们的服务", "th": "ให้บริการของเรา"}, "Providing Services": {"zh-CN": "提供服务", "th": "การให้บริการ"}, "Province entry points": {"zh-CN": "省份入口点", "th": "จุดเข้าสู่จังหวัด"}, "Province ranking by registered capital": {"zh-CN": "按注册资本排名省份", "th": "อันดับจังหวัดตามทุนจดทะเบียน"}, "Provinces covered": {"zh-CN": "覆盖省份", "th": "จังหวัดที่ครอบคลุม"}, "Provinces covered nationwide": {"zh-CN": "全国覆盖省份", "th": "จังหวัดที่ครอบคลุมทั่วประเทศ"}, "Public Business Records": {"zh-CN": "公共商业记录", "th": "บันทึกธุรกิจสาธารณะ"}, "Public Data": {"zh-CN": "公共数据", "th": "ข้อมูลสาธารณะ"}, "Public Records": {"zh-CN": "公共记录", "th": "บันทึกสาธารณะ"}, "Public company information serves the public interest by promoting transparency and informed business decisions.": {"zh-CN": "公共公司信息通过促进透明度和明智的商业决策来服务于公共利益。", "th": "ข้อมูลบริษัทสาธารณะเป็นประโยชน์ต่อสาธารณะโดยส่งเสริมความโปร่งใสและการตัดสินใจทางธุรกิจที่มีข้อมูล"}, "Public databases;": {"zh-CN": "公共数据库；", "th": "ฐานข้อมูลสาธารณะ;"}, "Public filings": {"zh-CN": "公共备案", "th": "การยื่นเอกสารสาธารณะ"}, "Public gazettes": {"zh-CN": "政府公报", "th": "ราชกิจจานุเบกษา"}, "Public government records": {"zh-CN": "政府公开记录", "th": "บันทึกของรัฐบาลที่เปิดเผยต่อสาธารณะ"}, "Public records are displayed based on objective information available from lawful sources.": {"zh-CN": "公开记录基于合法来源的客观信息显示。", "th": "บันทึกสาธารณะจะแสดงตามข้อมูลที่เป็นกลางจากแหล่งที่มาที่ถูกต้องตามกฎหมาย"}, "Public registration information": {"zh-CN": "公开注册信息", "th": "ข้อมูลการจดทะเบียนสาธารณะ"}, "Publication of such statistics does not disclose confidential information.": {"zh-CN": "发布此类统计信息不会泄露机密信息。", "th": "การเผยแพร่สถิติดังกล่าวไม่เปิดเผยข้อมูลที่เป็นความลับ"}, "Publicly accessible databases": {"zh-CN": "可公开访问的数据库", "th": "ฐานข้อมูลที่เข้าถึงได้สาธารณะ"}, "Publicly available company websites": {"zh-CN": "公开可用的公司网站", "th": "เว็บไซต์บริษัทที่เปิดเผยต่อสาธารณะ"}, "Publicly available information obtained from lawful sources": {"zh-CN": "从合法来源获得的公开信息", "th": "ข้อมูลที่เปิดเผยต่อสาธารณะซึ่งได้จากแหล่งที่มาที่ถูกต้องตามกฎหมาย"}, "Publicly available sources;": {"zh-CN": "公开可用来源；", "th": "แหล่งที่มาที่เปิดเผยต่อสาธารณะ;"}, "Purpose": {"zh-CN": "目的", "th": "วัตถุประสงค์"}, "Questions about the platform, accounts or how to use BizThai.": {"zh-CN": "关于平台、账户或如何使用BizThai的问题。", "th": "คำถามเกี่ยวกับแพลตฟอร์ม บัญชี หรือวิธีการใช้ BizThai"}, "Questions, data corrections or partnership ideas are always welcome.": {"zh-CN": "欢迎提出疑问、数据更正或合作想法。", "th": "ยินดีต้อนรับคำถาม การแก้ไขข้อมูล หรือแนวคิดความร่วมมือเสมอ"}, "Rank by": {"zh-CN": "排名依据", "th": "จัดอันดับตาม"}, "Rank provinces by registered company count and total registered capital using full-database aggregates.": {"zh-CN": "使用全数据库汇总，按注册公司数量和总注册资本对省份进行排名。", "th": "จัดอันดับจังหวัดตามจำนวนบริษัทที่จดทะเบียนและทุนจดทะเบียนรวมโดยใช้ข้อมูลรวมจากฐานข้อมูลทั้งหมด"}, "Real Estate": {"zh-CN": "房地产", "th": "อสังหาริมทรัพย์"}, "Recently registered companies": {"zh-CN": "最近注册的公司", "th": "บริษัทที่จดทะเบียนล่าสุด"}, "Referring Website": {"zh-CN": "引荐网站", "th": "เว็บไซต์อ้างอิง"}, "Regional intelligence": {"zh-CN": "区域情报", "th": "ข้อมูลเชิงลึกระดับภูมิภาค"}, "Regional rankings": {"zh-CN": "区域排名", "th": "การจัดอันดับระดับภูมิภาค"}, "Registered Address": {"zh-CN": "注册地址", "th": "ที่อยู่จดทะเบียน"}, "Registered Company Name": {"zh-CN": "注册公司名称", "th": "ชื่อบริษัทที่จดทะเบียน"}, "Registered capital across Thailand": {"zh-CN": "泰国全境注册资本", "th": "ทุนจดทะเบียนทั่วประเทศไทย"}, "Registered companies indexed": {"zh-CN": "已索引的注册公司", "th": "บริษัทที่จดทะเบียนซึ่งถูกจัดทำดัชนี"}, "Registration Number": {"zh-CN": "注册号", "th": "เลขทะเบียน"}, "Registration numbers;": {"zh-CN": "注册号；", "th": "เลขทะเบียน;"}, "Registration status": {"zh-CN": "注册状态", "th": "สถานะการจดทะเบียน"}, "Regulatory authorities": {"zh-CN": "监管机构", "th": "หน่วยงานกำกับดูแล"}, "Reliable": {"zh-CN": "可靠", "th": "เชื่อถือได้"}, "Reliance on displayed information": {"zh-CN": "依赖显示的信息", "th": "การพึ่งพาข้อมูลที่แสดง"}, "Reliance upon information displayed on the platform": {"zh-CN": "依赖平台上显示的信息", "th": "การพึ่งพาข้อมูลที่แสดงบนแพลตฟอร์ม"}, "Remember user preferences": {"zh-CN": "记住用户偏好", "th": "จดจำการตั้งค่าผู้ใช้"}, "Removal Requests": {"zh-CN": "删除请求", "th": "คำขอให้ลบ"}, "Removal requests may be considered only where:": {"zh-CN": "删除请求仅在以下情况下可能被考虑：", "th": "คำขอให้ลบจะได้รับการพิจารณาเฉพาะในกรณีที่:"}, "Removal requests may only be considered where:": {"zh-CN": "删除请求仅在以下情况下可能被考虑：", "th": "คำขอให้ลบจะได้รับการพิจารณาเฉพาะในกรณีที่:"}, "Remove duplicate records;": {"zh-CN": "删除重复记录；", "th": "ลบบันทึกที่ซ้ำกัน;"}, "Remove or retain the content based on applicable law and available evidence.": {"zh-CN": "根据适用法律和可用证据删除或保留内容。", "th": "ลบหรือเก็บรักษาเนื้อหาตามกฎหมายที่เกี่ยวข้องและหลักฐานที่มีอยู่"}, "Remove public records;": {"zh-CN": "删除公共记录；", "th": "ลบบันทึกสาธารณะ;"}, "Remove risk information;": {"zh-CN": "删除风险信息；", "th": "ลบข้อมูลความเสี่ยง;"}, "Repeat Infringement": {"zh-CN": "重复侵权", "th": "การละเมิดซ้ำ"}, "Report an issue": {"zh-CN": "报告问题", "th": "รายงานปัญหา"}, "Republish or redistribute BizThai data for commercial purposes": {"zh-CN": "为商业目的重新发布或分发BizThai数据", "th": "เผยแพร่ซ้ำหรือแจกจ่ายข้อมูล BizThai เพื่อวัตถุประสงค์ทางการค้า"}, "Request additional supporting documents;": {"zh-CN": "要求提供额外的支持文件；", "th": "ขอเอกสารสนับสนุนเพิ่มเติม;"}, "Requested by competent government authorities": {"zh-CN": "由主管政府当局要求", "th": "ได้รับการร้องขอจากหน่วยงานรัฐที่มีอำนาจ"}, "Requested correction": {"zh-CN": "请求更正", "th": "การแก้ไขที่ร้องขอ"}, "Requests concerning public business information should follow the Data Correction Policy.": {"zh-CN": "关于公共商业信息的请求应遵循数据更正政策。", "th": "คำขอเกี่ยวกับข้อมูลธุรกิจสาธารณะควรปฏิบัติตามนโยบายการแก้ไขข้อมูล"}, "Requests for removal are evaluated solely on the basis of applicable law, court orders, official government action or verified factual errors.": {"zh-CN": "删除请求仅根据适用法律、法院命令、官方政府行动或经核实的事实错误进行评估。", "th": "คำขอให้ลบจะได้รับการประเมินตามกฎหมายที่เกี่ยวข้อง คำสั่งศาล การดำเนินการของรัฐบาล หรือข้อผิดพลาดข้อเท็จจริงที่ได้รับการยืนยันเท่านั้น"}, "Requests may be submitted regarding, but not limited to:": {"zh-CN": "可提交关于以下方面的请求，但不限于：", "th": "สามารถยื่นคำขอเกี่ยวกับเรื่องต่อไปนี้ แต่ไม่จำกัดเพียง:"}, "Requests should be submitted to:": {"zh-CN": "请求应提交至：", "th": "ควรส่งคำขอไปที่:"}, "Requests will be reviewed in accordance with the BizThai Data Correction Policy.": {"zh-CN": "请求将根据BizThai数据更正政策进行审查。", "th": "คำขอจะได้รับการตรวจสอบตามนโยบายการแก้ไขข้อมูลของ BizThai"}, "Required Documents": {"zh-CN": "所需文件", "th": "เอกสารที่จำเป็น"}, "Required by a court order": {"zh-CN": "根据法院命令要求", "th": "ตามคำสั่งศาล"}, "Required by a government authority;": {"zh-CN": "政府机构要求；", "th": "จำเป็นโดยหน่วยงานของรัฐ;"}, "Required by applicable law;": {"zh-CN": "适用法律要求；", "th": "จำเป็นตามกฎหมายที่เกี่ยวข้อง;"}, "Required by law": {"zh-CN": "法律要求", "th": "จำเป็นตามกฎหมาย"}, "Required to investigate fraud or abuse": {"zh-CN": "调查欺诈或滥用行为所需", "th": "จำเป็นในการสอบสวนการฉ้อโกงหรือการละเมิด"}, "Required under applicable privacy legislation.": {"zh-CN": "适用隐私法规要求。", "th": "จำเป็นภายใต้กฎหมายความเป็นส่วนตัวที่เกี่ยวข้อง"}, "Reset filters": {"zh-CN": "重置筛选条件", "th": "รีเซ็ตตัวกรอง"}, "Reset your password": {"zh-CN": "重置密码", "th": "รีเซ็ตรหัสผ่านของคุณ"}, "Resolving disputes": {"zh-CN": "解决争议", "th": "การแก้ไขข้อพิพาท"}, "Respect for Intellectual Property": {"zh-CN": "尊重知识产权", "th": "เคารพทรัพย์สินทางปัญญา"}, "Respond to legal obligations": {"zh-CN": "履行法律义务", "th": "ตอบสนองต่อภาระผูกพันทางกฎหมาย"}, "Responsible data practices": {"zh-CN": "负责任的数据实践", "th": "แนวปฏิบัติด้านข้อมูลที่รับผิดชอบ"}, "Restriction of processing": {"zh-CN": "限制处理", "th": "ข้อจำกัดในการประมวลผล"}, "Review Procedure": {"zh-CN": "审查程序", "th": "ขั้นตอนการตรวจสอบ"}, "Review Process": {"zh-CN": "审查流程", "th": "กระบวนการตรวจสอบ"}, "Review foreign-capital signals: shareholder and director nationality, plus Thai versus foreign capital-origin share.": {"zh-CN": "审查外资信号：股东和董事国籍，以及泰资与外资来源比例。", "th": "ตรวจสอบสัญญาณทุนต่างประเทศ: สัญชาติผู้ถือหุ้นและกรรมการ รวมถึงสัดส่วนทุนไทยเทียบกับทุนต่างประเทศ"}, "Review submitted documents": {"zh-CN": "审查已提交文件", "th": "ตรวจสอบเอกสารที่ส่ง"}, "Review supporting documents;": {"zh-CN": "审查支持文件；", "th": "ตรวจสอบเอกสารประกอบ;"}, "Review the submitted materials;": {"zh-CN": "审查已提交材料；", "th": "ตรวจสอบวัสดุที่ส่ง;"}, "Save changes": {"zh-CN": "保存更改", "th": "บันทึกการเปลี่ยนแปลง"}, "Saved companies": {"zh-CN": "已保存的公司", "th": "บริษัทที่บันทึกไว้"}, "Scope": {"zh-CN": "范围", "th": "ขอบเขต"}, "Search Companies": {"zh-CN": "搜索公司", "th": "ค้นหาบริษัท"}, "Search History": {"zh-CN": "搜索历史", "th": "ประวัติการค้นหา"}, "Search Owners": {"zh-CN": "搜索所有者", "th": "ค้นหาเจ้าของ"}, "Search Thai company records across all 77 provinces, including profiles, contacts, credentials and industry insights.": {"zh-CN": "搜索泰国所有77个省份的公司记录，包括简介、联系方式、资质和行业洞察。", "th": "ค้นหาบันทึกบริษัทไทยทั่วทั้ง 77 จังหวัด รวมถึงโปรไฟล์ ผู้ติดต่อ ข้อมูลรับรอง และข้อมูลเชิงลึกของอุตสาหกรรม"}, "Search and filter Thailand's complete business registry by name, province and industry. Every profile carries the official registration number, registered capital and business activity — sourced from DBD DataWarehouse+.": {"zh-CN": "按名称、省份和行业搜索和筛选泰国完整的企业注册信息。每个档案都包含官方注册号、注册资本和业务活动——数据来源于DBD DataWarehouse+。", "th": "ค้นหาและกรองทะเบียนธุรกิจทั้งหมดของไทยตามชื่อ จังหวัด และอุตสาหกรรม ทุกโปรไฟล์มีหมายเลขทะเบียนทางการ ทุนจดทะเบียน และกิจกรรมทางธุรกิจ — ที่มาจาก DBD DataWarehouse+"}, "Search shareholders and owners": {"zh-CN": "搜索股东和所有者", "th": "ค้นหาผู้ถือหุ้นและเจ้าของ"}, "Search the live company index, then review registration number, province, business objective and capital for any matching record.": {"zh-CN": "搜索实时公司索引，然后查看匹配记录的注册号、省份、经营目标和资本。", "th": "ค้นหาดัชนีบริษัทแบบเรียลไทม์ จากนั้นตรวจสอบหมายเลขทะเบียน จังหวัด วัตถุประสงค์ทางธุรกิจ และทุนของบันทึกที่ตรงกัน"}, "Search with AI, companies or owners": {"zh-CN": "使用AI、公司或所有者搜索", "th": "ค้นหาด้วย AI บริษัท หรือเจ้าของ"}, "Security Providers": {"zh-CN": "安全提供商", "th": "ผู้ให้บริการด้านความปลอดภัย"}, "See Thailand's newest registered companies the moment they are filed — explore fresh registrations by date, province and industry, and watch how new-business activity is trending nationwide.": {"zh-CN": "查看泰国最新注册的公司——按日期、省份和行业浏览新注册信息，并观察全国新企业活动的趋势。", "th": "ดูบริษัทที่จดทะเบียนใหม่ล่าสุดของไทยทันทีที่ยื่น — สำรวจการจดทะเบียนใหม่ตามวันที่ จังหวัด และอุตสาหกรรม และดูแนวโน้มกิจกรรมธุรกิจใหม่ทั่วประเทศ"}, "See how much of Thailand's business capital is foreign-owned, then browse the companies behind every investor nation on an interactive world map.": {"zh-CN": "查看泰国企业资本中外资所占比例，然后在交互式世界地图上浏览每个投资国背后的公司。", "th": "ดูว่าทุนธุรกิจของไทยเป็นของต่างชาติเท่าใด จากนั้นเรียกดูบริษัทที่อยู่เบื้องหลังประเทศนักลงทุนแต่ละประเทศบนแผนที่โลกแบบโต้ตอบ"}, "See which industries drive Thailand's economy — compare sectors by the number of registered companies and spot where business activity concentrates.": {"zh-CN": "查看哪些行业推动泰国经济——按注册公司数量比较各行业，并发现商业活动集中的领域。", "th": "ดูว่าอุตสาหกรรมใดขับเคลื่อนเศรษฐกิจไทย — เปรียบเทียบภาคส่วนตามจำนวนบริษัทที่จดทะเบียน และดูว่ากิจกรรมทางธุรกิจกระจุกตัวอยู่ที่ใด"}, "See who is behind Thailand's companies — track foreign-versus-Thai ownership, the leading investor nationalities, and the country's highest-capital businesses, with a direct path into each company's director network.": {"zh-CN": "查看泰国公司背后的所有者——追踪外资与泰资所有权、主要投资者国籍以及该国资本最高的企业，并直接进入每家公司的董事网络。", "th": "ดูว่าใครอยู่เบื้องหลังบริษัทไทย — ติดตามความเป็นเจ้าของต่างชาติเทียบกับไทย สัญชาตินักลงทุนชั้นนำ และธุรกิจที่มีทุนสูงที่สุดของประเทศ พร้อมเส้นทางตรงสู่เครือข่ายกรรมการของแต่ละบริษัท"}, "Sell, license or commercially exploit BizThai data": {"zh-CN": "出售、许可或商业利用BizThai数据", "th": "ขาย ให้สิทธิ์ หรือใช้ประโยชน์เชิงพาณิชย์จากข้อมูล BizThai"}, "Send": {"zh-CN": "发送", "th": "ส่ง"}, "Send code": {"zh-CN": "发送验证码", "th": "ส่งรหัส"}, "Send reset link": {"zh-CN": "发送重置链接", "th": "ส่งลิงก์รีเซ็ต"}, "Server-rendered province and district terms.": {"zh-CN": "服务器渲染的省份和地区术语。", "th": "เงื่อนไขจังหวัดและอำเภอที่เรนเดอร์จากเซิร์ฟเวอร์"}, "Service interruption": {"zh-CN": "服务中断", "th": "การหยุดชะงักของบริการ"}, "Service interruptions": {"zh-CN": "服务中断", "th": "การหยุดชะงักของบริการ"}, "Session Duration": {"zh-CN": "会话时长", "th": "ระยะเวลาเซสชัน"}, "Set a new password": {"zh-CN": "设置新密码", "th": "ตั้งรหัสผ่านใหม่"}, "Settings": {"zh-CN": "设置", "th": "การตั้งค่า"}, "Shade the map by industry": {"zh-CN": "按行业着色地图", "th": "แรเงาแผนที่ตามอุตสาหกรรม"}, "Share by email": {"zh-CN": "通过电子邮件分享", "th": "แชร์ทางอีเมล"}, "Share on Facebook": {"zh-CN": "在Facebook上分享", "th": "แชร์บน Facebook"}, "Share on LinkedIn": {"zh-CN": "在LinkedIn上分享", "th": "แชร์บน LinkedIn"}, "Share on X": {"zh-CN": "在X上分享", "th": "แชร์บน X"}, "Shareholder name (EN/TH), passport or ID number": {"zh-CN": "股东姓名（英文/泰文）、护照或身份证号码", "th": "ชื่อผู้ถือหุ้น (EN/TH) หมายเลขหนังสือเดินทางหรือบัตรประจำตัว"}, "Shareholders (where legally available)": {"zh-CN": "股东（在法律允许的情况下）", "th": "ผู้ถือหุ้น (ตามที่กฎหมายอนุญาต)"}, "Show": {"zh-CN": "显示", "th": "แสดง"}, "Siam Commercial Bank Public Company Limited": {"zh-CN": "暹罗商业银行公众有限公司", "th": "ธนาคารไทยพาณิชย์ จำกัด (มหาชน)"}, "Sign in or create account": {"zh-CN": "登录或创建账户", "th": "เข้าสู่ระบบหรือสร้างบัญชี"}, "Sign in to manage your saved companies, claims and downloads.": {"zh-CN": "登录以管理您保存的公司、认领和下载。", "th": "เข้าสู่ระบบเพื่อจัดการบริษัทที่บันทึกไว้ การอ้างสิทธิ์ และการดาวน์โหลด"}, "Sign out": {"zh-CN": "退出登录", "th": "ออกจากระบบ"}, "Sign up to finish claiming this company.": {"zh-CN": "注册以完成认领该公司。", "th": "สมัครสมาชิกเพื่อดำเนินการอ้างสิทธิ์บริษัทนี้"}, "Social Media Links": {"zh-CN": "社交媒体链接", "th": "ลิงก์โซเชียลมีเดีย"}, "Social links": {"zh-CN": "社交链接", "th": "ลิงก์โซเชียล"}, "Some data-dense tables and interactive charts are still being improved for assistive technologies. We are actively working to close these gaps.": {"zh-CN": "部分数据密集的表格和交互式图表仍在为辅助技术进行改进。我们正积极努力弥补这些不足。", "th": "ตารางข้อมูลหนาแน่นและแผนภูมิแบบโต้ตอบบางส่วนยังอยู่ระหว่างการปรับปรุงสำหรับเทคโนโลยีช่วยเหลือ เรากำลังดำเนินการอย่างแข็งขันเพื่อปิดช่องว่างเหล่านี้"}, "Sort by": {"zh-CN": "排序方式", "th": "เรียงตาม"}, "Sources of Information": {"zh-CN": "信息来源", "th": "แหล่งข้อมูล"}, "Sourcing, distribution and channel partners": {"zh-CN": "采购、分销和渠道合作伙伴", "th": "พันธมิตรด้านการจัดหา การจัดจำหน่าย และช่องทาง"}, "Sponsored Content": {"zh-CN": "赞助内容", "th": "เนื้อหาที่ได้รับการสนับสนุน"}, "Sponsored content does not represent the opinions or editorial position of BizThai.": {"zh-CN": "赞助内容不代表BizThai的观点或编辑立场。", "th": "เนื้อหาที่ได้รับการสนับสนุนไม่ได้แสดงถึงความคิดเห็นหรือจุดยืนของ BizThai"}, "Sponsored content or advertising will be identified where required.": {"zh-CN": "赞助内容或广告将在必要时予以标识。", "th": "เนื้อหาที่ได้รับการสนับสนุนหรือโฆษณาจะถูกระบุตามที่กำหนด"}, "Spotted something inaccurate in a company profile? Let us know the registration number.": {"zh-CN": "发现公司资料中有不准确之处？请告知我们注册号。", "th": "พบข้อมูลไม่ถูกต้องในโปรไฟล์บริษัท? แจ้งเลขทะเบียนให้เราทราบ"}, "Standardize company names;": {"zh-CN": "标准化公司名称；", "th": "กำหนดมาตรฐานชื่อบริษัท;"}, "Subject to applicable law, users may request:": {"zh-CN": "根据适用法律，用户可请求：", "th": "ภายใต้กฎหมายที่เกี่ยวข้อง ผู้ใช้อาจขอ:"}, "Subject to correction by the original source.": {"zh-CN": "以原始来源更正为准。", "th": "ขึ้นอยู่กับการแก้ไขโดยแหล่งข้อมูลต้นทาง"}, "Submission of a copyright complaint does not automatically result in the removal of content.": {"zh-CN": "提交版权投诉不会自动导致内容被删除。", "th": "การยื่นเรื่องร้องเรียนลิขสิทธิ์ไม่ได้ส่งผลให้เนื้อหาถูกลบโดยอัตโนมัติ"}, "Subscribe": {"zh-CN": "订阅", "th": "สมัครรับข้อมูล"}, "Suitable for any particular purpose": {"zh-CN": "适用于任何特定目的", "th": "เหมาะสมสำหรับวัตถุประสงค์เฉพาะใดๆ"}, "Suitable for any specific purpose": {"zh-CN": "适用于任何特定目的", "th": "เหมาะสมสำหรับวัตถุประสงค์เฉพาะใดๆ"}, "Supplier and partner verification": {"zh-CN": "供应商和合作伙伴验证", "th": "การตรวจสอบซัพพลายเออร์และพันธมิตร"}, "Support full keyboard navigation, with visible focus indicators.": {"zh-CN": "支持完整的键盘导航，并带有可见的焦点指示器。", "th": "รองรับการนำทางด้วยแป้นพิมพ์แบบเต็มรูปแบบ พร้อมตัวบ่งชี้โฟกัสที่มองเห็นได้"}, "Supporting documents": {"zh-CN": "支持文件", "th": "เอกสารสนับสนุน"}, "TSIC top-level sections across the company index.": {"zh-CN": "公司索引中的TSIC顶级分类。", "th": "ส่วนระดับบนสุดของ TSIC ทั่วทั้งดัชนีบริษัท"}, "Talk to the BizThai team": {"zh-CN": "与BizThai团队交流", "th": "พูดคุยกับทีม BizThai"}, "Tax advice": {"zh-CN": "税务建议", "th": "คำแนะนำด้านภาษี"}, "Technical Information": {"zh-CN": "技术信息", "th": "ข้อมูลทางเทคนิค"}, "Technical limitations;": {"zh-CN": "技术限制；", "th": "ข้อจำกัดทางเทคนิค;"}, "Telephone Number": {"zh-CN": "电话号码", "th": "หมายเลขโทรศัพท์"}, "Temporarily restrict access to the reported content where appropriate;": {"zh-CN": "在适当情况下临时限制对所报告内容的访问；", "th": "จำกัดการเข้าถึงเนื้อหาที่ถูกรายงานเป็นการชั่วคราวตามความเหมาะสม;"}, "Terms & Notices": {"zh-CN": "条款与声明", "th": "ข้อกำหนดและประกาศ"}, "Terms of Use": {"zh-CN": "使用条款", "th": "ข้อกำหนดการใช้งาน"}, "Thai Business Reports": {"zh-CN": "泰国商业报告", "th": "รายงานธุรกิจไทย"}, "Thai-owned": {"zh-CN": "泰国所有", "th": "เป็นเจ้าของโดยคนไทย"}, "Thailand Company Directory": {"zh-CN": "泰国公司目录", "th": "ไดเรกทอรีบริษัทในประเทศไทย"}, "Thailand Industry Investment Map": {"zh-CN": "泰国产业投资地图", "th": "แผนที่การลงทุนอุตสาหกรรมในประเทศไทย"}, "Thailand's company data, made searchable": {"zh-CN": "泰国公司数据，可搜索", "th": "ข้อมูลบริษัทในประเทศไทย ทำให้ค้นหาได้"}, "Thailand's largest industries": {"zh-CN": "泰国最大的产业", "th": "อุตสาหกรรมที่ใหญ่ที่สุดในประเทศไทย"}, "The BizThai database structure, search system, classifications, indexing, software, website design and other original content are protected by applicable intellectual property laws.": {"zh-CN": "BizThai的数据库结构、搜索系统、分类、索引、软件、网站设计及其他原创内容均受适用的知识产权法律保护。", "th": "โครงสร้างฐานข้อมูล ระบบค้นหา การจัดหมวดหมู่ การจัดทำดัชนี ซอฟต์แวร์ การออกแบบเว็บไซต์ และเนื้อหาต้นฉบับอื่นๆ ของ BizThai ได้รับการคุ้มครองตามกฎหมายทรัพย์สินทางปัญญาที่เกี่ยวข้อง"}, "The TSIC sections with the most registered companies across the database.": {"zh-CN": "数据库中注册公司最多的TSIC分类。", "th": "ส่วน TSIC ที่มีบริษัทจดทะเบียนมากที่สุดทั่วทั้งฐานข้อมูล"}, "The appearance of a company on BizThai does not indicate:": {"zh-CN": "公司在BizThai上出现并不表示：", "th": "การปรากฏของบริษัทบน BizThai ไม่ได้บ่งชี้:"}, "The frequency of updates may vary depending on:": {"zh-CN": "更新频率可能因以下因素而异：", "th": "ความถี่ในการอัปเดตอาจแตกต่างกันไปขึ้นอยู่กับ:"}, "The information displayed on BizThai is collected, organized and presented from publicly available sources, official government records, publicly accessible databases and other lawful information sources.": {"zh-CN": "BizThai上显示的信息是从公开来源、官方政府记录、可公开访问的数据库及其他合法信息来源收集、整理和呈现的。", "th": "ข้อมูลที่แสดงบน BizThai ถูกรวบรวม จัดระเบียบ และนำเสนอจากแหล่งข้อมูลสาธารณะ บันทึกของรัฐบาลอย่างเป็นทางการ ฐานข้อมูลที่เข้าถึงได้สาธารณะ และแหล่งข้อมูลที่ถูกต้องตามกฎหมายอื่นๆ"}, "The information provided by BizThai is intended solely for informational and reference purposes.": {"zh-CN": "BizThai提供的信息仅供信息和参考之用。", "th": "ข้อมูลที่ให้โดย BizThai มีวัตถุประสงค์เพื่อใช้เป็นข้อมูลและอ้างอิงเท่านั้น"}, "The largest businesses by registered capital — strong starting points for owner and shareholder research.": {"zh-CN": "按注册资本计算的最大企业——是进行所有者与股东研究的良好起点。", "th": "ธุรกิจที่ใหญ่ที่สุดตามทุนจดทะเบียน — จุดเริ่มต้นที่ดีสำหรับการวิจัยเจ้าของและผู้ถือหุ้น"}, "The latest version will always be available on the BizThai website.": {"zh-CN": "最新版本将始终在BizThai网站上提供。", "th": "เวอร์ชันล่าสุดจะพร้อมใช้งานบนเว็บไซต์ BizThai เสมอ"}, "The latest version will always be published on this website.": {"zh-CN": "最新版本将始终在本网站上发布。", "th": "เวอร์ชันล่าสุดจะถูกเผยแพร่บนเว็บไซต์นี้เสมอ"}, "The newest company records published from official filings.": {"zh-CN": "来自官方文件的最新公司记录。", "th": "บันทึกบริษัทล่าสุดที่เผยแพร่จากเอกสารทางการ"}, "The page you requested was not found.": {"zh-CN": "您请求的页面未找到。", "th": "ไม่พบหน้าที่คุณร้องขอ"}, "The terms governing your access to and use of the BizThai platform": {"zh-CN": "管理您访问和使用BizThai平台的条款", "th": "ข้อกำหนดที่ควบคุมการเข้าถึงและการใช้แพลตฟอร์ม BizThai ของคุณ"}, "These Terms of Use govern your access to and use of the BizThai website, services and APIs. Please read them carefully.": {"zh-CN": "这些使用条款管理您对BizThai网站、服务和API的访问和使用。请仔细阅读。", "th": "ข้อกำหนดการใช้งานเหล่านี้ควบคุมการเข้าถึงและการใช้เว็บไซต์ บริการ และ API ของ BizThai โปรดอ่านอย่างละเอียด"}, "These Terms shall be governed by the laws of the Kingdom of Thailand.": {"zh-CN": "这些条款应受泰王国法律管辖。", "th": "ข้อกำหนดเหล่านี้อยู่ภายใต้กฎหมายของราชอาณาจักรไทย"}, "These providers may collect technical information in accordance with their own privacy policies.": {"zh-CN": "这些提供商可能根据其自身的隐私政策收集技术信息。", "th": "ผู้ให้บริการเหล่านี้อาจรวบรวมข้อมูลทางเทคนิคตามนโยบายความเป็นส่วนตัวของตนเอง"}, "Third-Party Content": {"zh-CN": "第三方内容", "th": "เนื้อหาของบุคคลที่สาม"}, "Third-Party Information": {"zh-CN": "第三方信息", "th": "ข้อมูลของบุคคลที่สาม"}, "This Business Data Usage Policy explains how information available on the BizThai platform may and may not be used.": {"zh-CN": "本商业数据使用政策解释了BizThai平台上的信息可以如何使用以及不得如何使用。", "th": "นโยบายการใช้ข้อมูลธุรกิจนี้อธิบายว่าข้อมูลที่มีอยู่ในแพลตฟอร์ม BizThai อาจใช้หรือไม่ใช้อย่างไร"}, "This Copyright Policy explains how copyright owners may report alleged infringement and how BizThai handles such requests.": {"zh-CN": "本版权政策解释了版权所有者如何报告涉嫌侵权以及BizThai如何处理此类请求。", "th": "นโยบายลิขสิทธิ์นี้อธิบายว่าเจ้าของลิขสิทธิ์สามารถรายงานการละเมิดที่ถูกกล่าวหาได้อย่างไร และ BizThai จัดการกับคำขอดังกล่าวอย่างไร"}, "This Data Correction & Removal Policy explains how businesses, authorized representatives and other interested parties may request the correction, update or review of information displayed on the BizThai platform.": {"zh-CN": "本数据更正与删除政策解释了企业、授权代表和其他相关方如何请求更正、更新或审查BizThai平台上显示的信息。", "th": "นโยบายการแก้ไขและลบข้อมูลนี้อธิบายว่าธุรกิจ ตัวแทนที่ได้รับอนุญาต และผู้มีส่วนได้ส่วนเสียอื่นๆ สามารถขอแก้ไข อัปเดต หรือตรวจสอบข้อมูลที่แสดงบนแพลตฟอร์ม BizThai ได้อย่างไร"}, "This Data Sources Policy explains where the information displayed on BizThai comes from, how it is processed, and the principles governing its publication.": {"zh-CN": "本数据来源政策解释了BizThai上显示的信息来自何处、如何处理以及管理其发布的原则。", "th": "นโยบายแหล่งข้อมูลนี้อธิบายว่าข้อมูลที่แสดงบน BizThai มาจากที่ใด ประมวลผลอย่างไร และหลักการที่ควบคุมการเผยแพร่"}, "This Editorial & Data Integrity Policy explains the principles governing the collection, review, publication and correction of business information.": {"zh-CN": "本编辑与数据完整性政策解释了管理商业信息收集、审查、发布和更正的原则。", "th": "นโยบายบรรณาธิการและความสมบูรณ์ของข้อมูลนี้อธิบายหลักการที่ควบคุมการรวบรวม ทบทวน เผยแพร่ และแก้ไขข้อมูลธุรกิจ"}, "This Policy applies to all company information, business records, search results, reports, directories, datasets and other business-related information displayed through the BizThai website, applications and related services.": {"zh-CN": "本政策适用于通过BizThai网站、应用程序和相关服务显示的所有公司信息、商业记录、搜索结果、报告、目录、数据集和其他商业相关信息。", "th": "นโยบายนี้ใช้กับข้อมูลบริษัท บันทึกธุรกิจ ผลการค้นหา รายงาน ไดเรกทอรี ชุดข้อมูล และข้อมูลที่เกี่ยวข้องกับธุรกิจอื่นๆ ทั้งหมดที่แสดงผ่านเว็บไซต์ แอปพลิเคชัน และบริการที่เกี่ยวข้องของ BizThai"}, "This Policy may be updated from time to time without prior notice.": {"zh-CN": "本政策可能会不时更新，恕不另行通知。", "th": "นโยบายนี้อาจได้รับการปรับปรุงเป็นครั้งคราวโดยไม่ต้องแจ้งให้ทราบล่วงหน้า"}, "This Privacy Policy explains how we collect, use, store, disclose and protect your information when you visit or use the BizThai website, services and related products.": {"zh-CN": "本隐私政策解释了当您访问或使用BizThai网站、服务和相关产品时，我们如何收集、使用、存储、披露和保护您的信息。", "th": "นโยบายความเป็นส่วนตัวนี้อธิบายว่าเรารวบรวม ใช้ จัดเก็บ เปิดเผย และปกป้องข้อมูลของคุณอย่างไรเมื่อคุณเยี่ยมชมหรือใช้เว็บไซต์ บริการ และผลิตภัณฑ์ที่เกี่ยวข้องของ BizThai"}, "This year at a glance": {"zh-CN": "今年概览", "th": "ภาพรวมปีนี้"}, "Time Zone": {"zh-CN": "时区", "th": "เขตเวลา"}, "To improve usability, BizThai may:": {"zh-CN": "为提高可用性，BizThai 可能：", "th": "เพื่อปรับปรุงการใช้งาน BizThai อาจ:"}, "To the fullest extent permitted by applicable law, BizThai, its directors, employees, affiliates and service providers shall not be liable for any direct, indirect, incidental, consequential, punitive or special damages arising from:": {"zh-CN": "在适用法律允许的最大范围内，BizThai、其董事、员工、关联公司和服务提供商不对因以下原因引起的任何直接、间接、附带、后果性、惩罚性或特殊损害承担责任：", "th": "เท่าที่กฎหมายที่เกี่ยวข้องอนุญาตสูงสุด BizThai กรรมการ พนักงาน บริษัทในเครือ และผู้ให้บริการจะไม่รับผิดชอบต่อความเสียหายใดๆ ไม่ว่าโดยตรง โดยอ้อม อันเป็นผลสืบเนื่อง เป็นการลงโทษ หรือพิเศษที่เกิดจาก:"}, "To the maximum extent permitted by applicable law, BizThai shall not be liable for any direct, indirect, incidental, consequential or special damages arising from:": {"zh-CN": "在适用法律允许的最大范围内，BizThai 不对因以下原因引起的任何直接、间接、附带、后果性或特殊损害承担责任：", "th": "เท่าที่กฎหมายที่เกี่ยวข้องอนุญาตสูงสุด BizThai จะไม่รับผิดชอบต่อความเสียหายใดๆ ไม่ว่าโดยตรง โดยอ้อม อันเป็นผลสืบเนื่อง หรือพิเศษที่เกิดจาก:"}, "Toggle menu": {"zh-CN": "切换菜单", "th": "สลับเมนู"}, "Top 10": {"zh-CN": "前10名", "th": "10 อันดับแรก"}, "Top 20": {"zh-CN": "前20名", "th": "20 อันดับแรก"}, "Top 50": {"zh-CN": "前50名", "th": "50 อันดับแรก"}, "Top provinces by total registered capital and company count.": {"zh-CN": "按总注册资本和公司数量排名前列的省份。", "th": "จังหวัดชั้นนำตามทุนจดทะเบียนรวมและจำนวนบริษัท"}, "Track the newest published company records with registration dates, provinces and business objectives.": {"zh-CN": "追踪最新发布的公司记录，包括注册日期、省份和业务目标。", "th": "ติดตามบันทึกบริษัทที่เผยแพร่ใหม่ล่าสุด พร้อมวันที่จดทะเบียน จังหวัด และวัตถุประสงค์ทางธุรกิจ"}, "Trading or transactions": {"zh-CN": "交易或交易", "th": "การซื้อขายหรือธุรกรรม"}, "Translate selected information;": {"zh-CN": "翻译所选信息；", "th": "แปลข้อมูลที่เลือก;"}, "Transparency": {"zh-CN": "透明度", "th": "ความโปร่งใส"}, "Transparency and your data rights": {"zh-CN": "透明度与您的数据权利", "th": "ความโปร่งใสและสิทธิ์ในข้อมูลของคุณ"}, "Transportation & Storage": {"zh-CN": "运输与仓储", "th": "การขนส่งและการจัดเก็บ"}, "Trust & Compliance": {"zh-CN": "信任与合规", "th": "ความไว้วางใจและการปฏิบัติตามข้อกำหนด"}, "Try AI search": {"zh-CN": "尝试AI搜索", "th": "ลองค้นหา AI"}, "URL(s) of the allegedly infringing content": {"zh-CN": "涉嫌侵权内容的URL", "th": "URL ของเนื้อหาที่ถูกกล่าวหาว่าละเมิด"}, "Unauthorized reproduction or commercial use may result in legal action.": {"zh-CN": "未经授权的复制或商业使用可能导致法律诉讼。", "th": "การทำซ้ำหรือใช้เพื่อการค้าโดยไม่ได้รับอนุญาตอาจส่งผลให้ถูกดำเนินคดีทางกฎหมาย"}, "Update company contact details;": {"zh-CN": "更新公司联系方式；", "th": "อัปเดตรายละเอียดการติดต่อของบริษัท;"}, "Update company logos submitted by authorized representatives.": {"zh-CN": "更新由授权代表提交的公司标志。", "th": "อัปเดตโลโก้บริษัทที่ส่งโดยตัวแทนที่ได้รับอนุญาต"}, "Update how your name and contact details appear.": {"zh-CN": "更新您的姓名和联系方式的显示方式。", "th": "อัปเดตวิธีการแสดงชื่อและรายละเอียดการติดต่อของคุณ"}, "Update outdated information;": {"zh-CN": "更新过时信息；", "th": "อัปเดตข้อมูลที่ล้าสมัย;"}, "Update password": {"zh-CN": "更新密码", "th": "อัปเดตรหัสผ่าน"}, "Updated continuously": {"zh-CN": "持续更新", "th": "อัปเดตอย่างต่อเนื่อง"}, "Upload malicious software": {"zh-CN": "上传恶意软件", "th": "อัปโหลดซอฟต์แวร์ที่เป็นอันตราย"}, "Upon receiving a complete request, BizThai will:": {"zh-CN": "收到完整请求后，BizThai 将：", "th": "เมื่อได้รับคำขอที่สมบูรณ์ BizThai จะ:"}, "Upon receiving a valid copyright complaint, BizThai may:": {"zh-CN": "收到有效的版权投诉后，BizThai 可能：", "th": "เมื่อได้รับการร้องเรียนเรื่องลิขสิทธิ์ที่ถูกต้อง BizThai อาจ:"}, "Usage Information": {"zh-CN": "使用信息", "th": "ข้อมูลการใช้งาน"}, "Use BizThai data to train artificial intelligence or machine learning models": {"zh-CN": "使用 BizThai 数据训练人工智能或机器学习模型", "th": "ใช้ข้อมูล BizThai เพื่อฝึกอบรมปัญญาประดิษฐ์หรือโมเดลการเรียนรู้ของเครื่อง"}, "Use automated tools, bots or crawlers to collect data beyond reasonable browsing": {"zh-CN": "使用自动化工具、机器人或爬虫收集超出合理浏览范围的数据", "th": "ใช้เครื่องมืออัตโนมัติ บอท หรือโปรแกรมรวบรวมข้อมูลเพื่อเก็บข้อมูลเกินกว่าการเรียกดูที่สมเหตุสมผล"}, "Use of BizThai must comply with applicable laws and these Terms of Use.": {"zh-CN": "使用 BizThai 必须遵守适用法律和这些使用条款。", "th": "การใช้ BizThai ต้องปฏิบัติตามกฎหมายที่เกี่ยวข้องและข้อกำหนดการใช้งานเหล่านี้"}, "Use of the platform": {"zh-CN": "平台使用", "th": "การใช้แพลตฟอร์ม"}, "Use of the website": {"zh-CN": "网站使用", "th": "การใช้เว็บไซต์"}, "Use registration number, company type, capital and province as entry points for owner and shareholder follow-up.": {"zh-CN": "使用注册号、公司类型、资本和省份作为所有者及股东追踪的入口点。", "th": "ใช้เลขทะเบียน ประเภทบริษัท ทุนและจังหวัดเป็นจุดเริ่มต้นในการติดตามเจ้าของและผู้ถือหุ้น"}, "Use semantic HTML and ARIA labels so the site works with screen readers.": {"zh-CN": "使用语义化HTML和ARIA标签，使网站兼容屏幕阅读器。", "th": "ใช้ HTML เชิงความหมายและป้าย ARIA เพื่อให้เว็บไซต์ทำงานร่วมกับโปรแกรมอ่านหน้าจอได้"}, "Use the platform for unlawful activities": {"zh-CN": "将平台用于非法活动", "th": "ใช้แพลตฟอร์มเพื่อกิจกรรมที่ผิดกฎหมาย"}, "User Responsibilities": {"zh-CN": "用户责任", "th": "ความรับผิดชอบของผู้ใช้"}, "User Responsibility": {"zh-CN": "用户责任", "th": "ความรับผิดชอบของผู้ใช้"}, "User Rights": {"zh-CN": "用户权利", "th": "สิทธิของผู้ใช้"}, "Users accessing BizThai from outside Thailand acknowledge that information may be processed and stored in Thailand or other jurisdictions where our service providers operate.": {"zh-CN": "从泰国境外访问BizThai的用户确认，信息可能在泰国或我们的服务提供商运营的其他司法管辖区进行处理和存储。", "th": "ผู้ใช้ที่เข้าถึง BizThai จากนอกประเทศไทยรับทราบว่าข้อมูลอาจถูกประมวลผลและจัดเก็บในประเทศไทยหรือเขตอำนาจอื่นที่ผู้ให้บริการของเราดำเนินการอยู่"}, "Users agree not to:": {"zh-CN": "用户同意不：", "th": "ผู้ใช้ตกลงที่จะไม่:"}, "Users agree to indemnify and hold harmless BizThai, its employees, directors and affiliates against any claims, liabilities, damages, losses and legal expenses arising from misuse of the Services or violation of these Terms.": {"zh-CN": "用户同意赔偿并使BizThai、其员工、董事和关联方免受因滥用服务或违反这些条款而产生的任何索赔、责任、损害、损失和法律费用的损害。", "th": "ผู้ใช้ตกลงที่จะชดใช้ค่าเสียหายและปกป้อง BizThai พนักงาน กรรมการ และบริษัทในเครือจากข้อเรียกร้อง ความรับผิด ความเสียหาย การสูญเสีย และค่าใช้จ่ายทางกฎหมายใดๆ ที่เกิดจากการใช้บริการในทางที่ผิดหรือการละเมิดข้อกำหนดเหล่านี้"}, "Users are solely responsible for verifying any information before relying upon it.": {"zh-CN": "用户全权负责在依赖任何信息之前对其进行核实。", "th": "ผู้ใช้มีหน้าที่รับผิดชอบแต่เพียงผู้เดียวในการตรวจสอบข้อมูลใดๆ ก่อนที่จะนำไปใช้"}, "Users are solely responsible for verifying important information directly with the relevant government authorities or official sources before relying upon any information published on BizThai.": {"zh-CN": "用户全权负责在依赖BizThai上发布的任何信息之前，直接向相关政府机构或官方来源核实重要信息。", "th": "ผู้ใช้มีหน้าที่รับผิดชอบแต่เพียงผู้เดียวในการตรวจสอบข้อมูลสำคัญโดยตรงกับหน่วยงานรัฐบาลที่เกี่ยวข้องหรือแหล่งข้อมูลทางการก่อนที่จะนำข้อมูลใดๆ ที่เผยแพร่บน BizThai ไปใช้"}, "Users may disable cookies through browser settings, although certain features may not function correctly.": {"zh-CN": "用户可以通过浏览器设置禁用cookies，但某些功能可能无法正常运行。", "th": "ผู้ใช้อาจปิดการใช้งานคุกกี้ผ่านการตั้งค่าเบราว์เซอร์ แม้ว่าฟีเจอร์บางอย่างอาจทำงานไม่ถูกต้อง"}, "Users may use BizThai for legitimate purposes, including:": {"zh-CN": "用户可以将BizThai用于合法目的，包括：", "th": "ผู้ใช้อาจใช้ BizThai เพื่อวัตถุประสงค์ที่ถูกต้อง รวมถึง:"}, "Users must not submit, upload or distribute any material that infringes the copyright, trademark or other proprietary rights of any third party.": {"zh-CN": "用户不得提交、上传或分发任何侵犯第三方版权、商标或其他专有权利的材料。", "th": "ผู้ใช้ต้องไม่ส่ง อัปโหลด หรือแจกจ่ายเนื้อหาใดๆ ที่ละเมิดลิขสิทธิ์ เครื่องหมายการค้า หรือสิทธิ์ในทรัพย์สินอื่นๆ ของบุคคลที่สาม"}, "Users must verify information themselves before relying on it for purposes such as:": {"zh-CN": "用户必须在依赖信息用于以下目的之前自行核实信息：", "th": "ผู้ใช้ต้องตรวจสอบข้อมูลด้วยตนเองก่อนนำไปใช้เพื่อวัตถุประสงค์ เช่น:"}, "Users should conduct their own independent due diligence before making business decisions.": {"zh-CN": "用户应在做出商业决策前自行进行独立尽职调查。", "th": "ผู้ใช้ควรดำเนินการตรวจสอบสถานะอย่างอิสระของตนเองก่อนตัดสินใจทางธุรกิจ"}, "Users should continue conducting independent due diligence.": {"zh-CN": "用户应继续进行独立尽职调查。", "th": "ผู้ใช้ควรดำเนินการตรวจสอบสถานะอย่างอิสระต่อไป"}, "Users should independently verify all information before making business, legal, financial or commercial decisions.": {"zh-CN": "用户应在做出商业、法律、财务或商业决策前独立核实所有信息。", "th": "ผู้ใช้ควรตรวจสอบข้อมูลทั้งหมดอย่างอิสระก่อนตัดสินใจทางธุรกิจ กฎหมาย การเงิน หรือการค้า"}, "Users should verify important information directly with the relevant government authority before making business decisions.": {"zh-CN": "用户应在做出商业决策前直接向相关政府机构核实重要信息。", "th": "ผู้ใช้ควรตรวจสอบข้อมูลสำคัญโดยตรงกับหน่วยงานรัฐบาลที่เกี่ยวข้องก่อนตัดสินใจทางธุรกิจ"}, "Users should verify important information directly with the relevant government authority before making legal, financial or commercial decisions.": {"zh-CN": "用户应在做出法律、财务或商业决策前直接向相关政府机构核实重要信息。", "th": "ผู้ใช้ควรตรวจสอบข้อมูลสำคัญโดยตรงกับหน่วยงานรัฐบาลที่เกี่ยวข้องก่อนตัดสินใจทางกฎหมาย การเงิน หรือการค้า"}, "Users who believe information is inaccurate should submit a request under the Data Correction Policy.": {"zh-CN": "认为信息不准确的用户应根据数据更正政策提交请求。", "th": "ผู้ใช้ที่เชื่อว่าข้อมูลไม่ถูกต้องควรส่งคำขอภายใต้นโยบายการแก้ไขข้อมูล"}, "Verification Badge": {"zh-CN": "验证徽章", "th": "ป้ายยืนยัน"}, "Verification Fee": {"zh-CN": "验证费", "th": "ค่าธรรมเนียมการยืนยัน"}, "Verification Process": {"zh-CN": "验证流程", "th": "กระบวนการตรวจสอบ"}, "Verification Review": {"zh-CN": "验证审核", "th": "การตรวจสอบการยืนยัน"}, "Verification Team": {"zh-CN": "验证团队", "th": "ทีมตรวจสอบ"}, "Verification code": {"zh-CN": "验证码", "th": "รหัสยืนยัน"}, "Verification confirms only the identity or authority of the applicant.": {"zh-CN": "验证仅确认申请人的身份或权限。", "th": "การตรวจสอบยืนยันเฉพาะตัวตนหรืออำนาจของผู้สมัครเท่านั้น"}, "Verification does not constitute an endorsement or guarantee of any company.": {"zh-CN": "验证不构成对任何公司的认可或担保。", "th": "การตรวจสอบไม่ถือเป็นการรับรองหรือรับประกันบริษัทใดๆ"}, "Verification does not represent:": {"zh-CN": "验证不代表：", "th": "การตรวจสอบไม่ได้หมายถึง:"}, "Verification improves data accuracy and helps users identify official company representatives.": {"zh-CN": "验证提高数据准确性，帮助用户识别公司官方代表。", "th": "การตรวจสอบช่วยเพิ่มความแม่นยำของข้อมูลและช่วยให้ผู้ใช้ระบุตัวแทนบริษัทอย่างเป็นทางการ"}, "Verification indicates only that BizThai has verified the identity or authority of the applicant.": {"zh-CN": "验证仅表示 BizThai 已核实申请人的身份或权限。", "th": "การตรวจสอบบ่งชี้เพียงว่า BizThai ได้ตรวจสอบตัวตนหรืออำนาจของผู้สมัครแล้ว"}, "Verification is abused": {"zh-CN": "验证被滥用", "th": "การตรวจสอบถูกใช้ในทางที่ผิด"}, "Verification only confirms the identity or authority of the applicant.": {"zh-CN": "验证仅确认申请人的身份或权限。", "th": "การตรวจสอบยืนยันเฉพาะตัวตนหรืออำนาจของผู้สมัครเท่านั้น"}, "Verified companies generally may not modify:": {"zh-CN": "已验证公司通常不得修改：", "th": "บริษัทที่ได้รับการตรวจสอบแล้วโดยทั่วไปไม่สามารถแก้ไข:"}, "Verified companies may request updates to:": {"zh-CN": "已验证公司可请求更新：", "th": "บริษัทที่ได้รับการตรวจสอบแล้วสามารถขออัปเดต:"}, "Verified factual errors will be corrected after review.": {"zh-CN": "经核实的事实错误将在审核后更正。", "th": "ข้อผิดพลาดตามข้อเท็จจริงที่ได้รับการยืนยันจะได้รับการแก้ไขหลังจากการตรวจสอบ"}, "Verified factual errors.": {"zh-CN": "已验证的事实错误。", "th": "ข้อผิดพลาดตามข้อเท็จจริงที่ได้รับการยืนยัน"}, "Verify applicant identity": {"zh-CN": "验证申请人身份", "th": "ยืนยันตัวตนผู้สมัคร"}, "Verify company information": {"zh-CN": "验证公司信息", "th": "ยืนยันข้อมูลบริษัท"}, "Verify the submitted information;": {"zh-CN": "验证提交的信息；", "th": "ยืนยันข้อมูลที่ส่งมา;"}, "Verifying your email…": {"zh-CN": "正在验证您的邮箱…", "th": "กำลังยืนยันอีเมลของคุณ..."}, "Violation of these Terms may result in suspension or permanent restriction of access.": {"zh-CN": "违反这些条款可能导致访问被暂停或永久限制。", "th": "การละเมิดข้อกำหนดเหล่านี้อาจส่งผลให้ถูกระงับหรือจำกัดการเข้าถึงอย่างถาวร"}, "Water Supply & Waste Management": {"zh-CN": "供水与废物管理", "th": "การประปาและการจัดการขยะ"}, "We are not affiliated with or operated by any government authority unless expressly stated.": {"zh-CN": "除非明确说明，我们与任何政府机构无关联或由其运营。", "th": "เราไม่ได้เป็นพันธมิตรหรือดำเนินการโดยหน่วยงานรัฐบาลใดๆ เว้นแต่จะระบุไว้อย่างชัดเจน"}, "We continuously review and update information whenever reasonably possible.": {"zh-CN": "我们持续审查并在合理可能的情况下更新信息。", "th": "เราทบทวนและอัปเดตข้อมูลอย่างต่อเนื่องเมื่อเป็นไปได้อย่างสมเหตุสมผล"}, "We do not knowingly collect personal information from children.": {"zh-CN": "我们不会故意收集儿童的个人信息。", "th": "เราไม่เก็บรวบรวมข้อมูลส่วนบุคคลจากเด็กโดยรู้เท่าทัน"}, "We may use information to:": {"zh-CN": "我们可能使用信息来：", "th": "เราอาจใช้ข้อมูลเพื่อ:"}, "We want everyone to be able to find and understand Thai company information, regardless of ability.": {"zh-CN": "我们希望每个人都能找到并理解泰国公司信息，无论其能力如何。", "th": "เราต้องการให้ทุกคนสามารถค้นหาและเข้าใจข้อมูลบริษัทไทยได้ โดยไม่คำนึงถึงความสามารถ"}, "Website": {"zh-CN": "网站", "th": "เว็บไซต์"}, "Welcome to BizThai. By accessing or using the BizThai website, services, APIs or any related products, you acknowledge that you have read, understood and agreed to be bound by these Terms of Use.": {"zh-CN": "欢迎使用BizThai。通过访问或使用BizThai网站、服务、API或任何相关产品，您确认已阅读、理解并同意受这些使用条款的约束。", "th": "ยินดีต้อนรับสู่ BizThai การเข้าถึงหรือใช้เว็บไซต์ บริการ API หรือผลิตภัณฑ์ที่เกี่ยวข้องใดๆ ของ BizThai แสดงว่าคุณรับทราบว่าได้อ่าน ทำความเข้าใจ และตกลงที่จะผูกพันตามข้อกำหนดการใช้งานเหล่านี้"}, "What BizThai is": {"zh-CN": "BizThai是什么", "th": "BizThai คืออะไร"}, "What we do": {"zh-CN": "我们做什么", "th": "สิ่งที่เราทำ"}, "What you can do here": {"zh-CN": "您可以在这里做什么", "th": "สิ่งที่คุณสามารถทำได้ที่นี่"}, "Where Does Our Data Come From?": {"zh-CN": "我们的数据来自哪里？", "th": "ข้อมูลของเรามาจากไหน?"}, "Where commercial products or services are offered, they are provided under separate licensing terms.": {"zh-CN": "在提供商业产品或服务的地方，它们将根据单独的许可条款提供。", "th": "ในกรณีที่มีการเสนอผลิตภัณฑ์หรือบริการเชิงพาณิชย์ จะมีการให้บริการภายใต้ข้อกำหนดการอนุญาตสิทธิ์แยกต่างหาก"}, "Where errors are identified, BizThai will review and correct information in accordance with the Data Correction Policy.": {"zh-CN": "如果发现错误，BizThai将根据数据更正政策审查和更正信息。", "th": "เมื่อพบข้อผิดพลาด BizThai จะตรวจสอบและแก้ไขข้อมูลตามนโยบายการแก้ไขข้อมูล"}, "Where inconsistencies exist, official government records shall prevail.": {"zh-CN": "如果存在不一致，以官方政府记录为准。", "th": "ในกรณีที่มีความไม่สอดคล้องกัน ให้ยึดถือบันทึกของทางราชการเป็นหลัก"}, "Where information differs from official government records, the government records shall prevail.": {"zh-CN": "如果信息与官方政府记录不同，以政府记录为准。", "th": "หากข้อมูลแตกต่างจากบันทึกของทางราชการ ให้ยึดถือบันทึกของทางราชการเป็นหลัก"}, "Where information has been lawfully published by a competent government authority, BizThai may collect, organize, index, categorize and display such information to improve public accessibility and business transparency.": {"zh-CN": "如果信息已由主管政府机构合法发布，BizThai可以收集、整理、索引、分类和显示此类信息，以提高公众可访问性和商业透明度。", "th": "ในกรณีที่ข้อมูลได้รับการเผยแพร่โดยชอบด้วยกฎหมายจากหน่วยงานรัฐที่มีอำนาจ BizThai อาจรวบรวม จัดระเบียบ ทำดัชนี จัดหมวดหมู่ และแสดงข้อมูลดังกล่าวเพื่อเพิ่มการเข้าถึงของสาธารณะและความโปร่งใสทางธุรกิจ"}, "Where our data comes from": {"zh-CN": "我们的数据来源", "th": "ที่มาของข้อมูลของเรา"}, "Where personal information appears within public business records, BizThai processes such information only for lawful purposes consistent with applicable laws.": {"zh-CN": "如果个人信息出现在公共商业记录中，BizThai仅出于符合适用法律的合法目的处理此类信息。", "th": "ในกรณีที่ข้อมูลส่วนบุคคลปรากฏอยู่ในบันทึกธุรกิจสาธารณะ BizThai จะประมวลผลข้อมูลดังกล่าวเพื่อวัตถุประสงค์ที่ชอบด้วยกฎหมายตามกฎหมายที่เกี่ยวข้องเท่านั้น"}, "Where sufficient evidence is provided, BizThai may:": {"zh-CN": "如果提供充分证据，BizThai可以：", "th": "เมื่อมีหลักฐานเพียงพอ BizThai อาจ:"}, "Where the business information on BizThai comes from, how it is processed, and the principles governing its publication.": {"zh-CN": "BizThai上的商业信息来自何处、如何处理以及管理其发布的原则。", "th": "ข้อมูลธุรกิจบน BizThai มาจากไหน ถูกประมวลผลอย่างไร และหลักการที่ควบคุมการเผยแพร่"}, "Whether you are screening a potential supplier, researching a market, or looking for partners in a specific province or industry, BizThai gives you a single place to search and compare verified company information.": {"zh-CN": "无论您是在筛选潜在供应商、研究市场，还是在特定省份或行业寻找合作伙伴，BizThai为您提供了一个搜索和比较经过验证的公司信息的单一平台。", "th": "ไม่ว่าคุณจะกำลังตรวจสอบซัพพลายเออร์ที่มีศักยภาพ วิจัยตลาด หรือมองหาพันธมิตรในจังหวัดหรืออุตสาหกรรมเฉพาะ BizThai มอบสถานที่เดียวให้คุณค้นหาและเปรียบเทียบข้อมูลบริษัทที่ได้รับการยืนยัน"}, "Which countries are most often linked to Thai company ownership, by number of companies.": {"zh-CN": "哪些国家最常与泰国公司所有权相关联（按公司数量）。", "th": "ประเทศใดที่เชื่อมโยงกับการเป็นเจ้าของบริษัทไทยมากที่สุด โดยจำนวนบริษัท"}, "While BizThai makes reasonable efforts to provide accurate and up-to-date information, BizThai does not warrant or guarantee that any information available on the platform is:": {"zh-CN": "尽管BizThai做出合理努力提供准确和最新的信息，但BizThai不保证或担保平台上的任何信息是：", "th": "แม้ว่า BizThai จะพยายามอย่างสมเหตุสมผลเพื่อให้ข้อมูลที่ถูกต้องและเป็นปัจจุบัน แต่ BizThai ไม่รับประกันหรือรับรองว่าข้อมูลใดๆ ที่มีอยู่ในแพลตฟอร์มนั้น:"}, "Who May Submit a Request": {"zh-CN": "谁可以提交请求", "th": "ใครสามารถยื่นคำขอได้"}, "Who owns Thailand's companies": {"zh-CN": "谁拥有泰国的公司", "th": "ใครเป็นเจ้าของบริษัทในประเทศไทย"}, "Wholesale & Retail Trade": {"zh-CN": "批发和零售贸易", "th": "การค้าส่งและค้าปลีก"}, "Wholesale and retail trade": {"zh-CN": "批发和零售贸易", "th": "การค้าส่งและค้าปลีก"}, "Why Is My Company Listed?": {"zh-CN": "为什么我的公司被列出？", "th": "ทำไมบริษัทของฉันจึงถูกแสดง?"}, "Withdrawal of consent (where consent is the legal basis)": {"zh-CN": "撤回同意（如果同意是法律依据）", "th": "การถอนความยินยอม (ในกรณีที่ความยินยอมเป็นฐานทางกฎหมาย)"}, "Without prior written permission from BizThai, users must not:": {"zh-CN": "未经BizThai事先书面许可，用户不得：", "th": "โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษรจาก BizThai ก่อน ผู้ใช้ต้องไม่:"}, "Yearly new-company registrations across Thailand. Switch the time range or measure below to compare each year.": {"zh-CN": "泰国每年新公司注册数量。切换下方的时间范围或度量标准以比较各年份。", "th": "การจดทะเบียนบริษัทใหม่รายปีทั่วประเทศไทย สลับช่วงเวลาหรือหน่วยวัดด้านล่างเพื่อเปรียบเทียบแต่ละปี"}, "Yes. Authorized company representatives may request updates or corrections by providing supporting documentation.": {"zh-CN": "是的。授权公司代表可通过提供支持文件请求更新或更正。", "th": "ใช่ ตัวแทนบริษัทที่ได้รับอนุญาตสามารถขออัปเดตหรือแก้ไขโดยจัดเตรียมเอกสารประกอบ"}, "You don't need to email us to find a business. Search the full directory, or describe what you need to our AI assistant and it will surface the best-matched Thai companies in seconds.": {"zh-CN": "您无需发邮件给我们即可查找企业。搜索完整目录，或向我们的AI助手描述您的需求，它将在几秒内为您呈现最匹配的泰国公司。", "th": "คุณไม่จำเป็นต้องส่งอีเมลถึงเราเพื่อค้นหาธุรกิจ ค้นหาในไดเรกทอรีทั้งหมด หรืออธิบายสิ่งที่คุณต้องการให้ผู้ช่วย AI ของเรา แล้วมันจะแสดงบริษัทไทยที่ตรงที่สุดในไม่กี่วินาที"}, "You haven't claimed any companies yet.": {"zh-CN": "您尚未认领任何公司。", "th": "คุณยังไม่ได้อ้างสิทธิ์บริษัทใดๆ"}, "You haven't saved any companies yet.": {"zh-CN": "您尚未保存任何公司。", "th": "คุณยังไม่ได้บันทึกบริษัทใดๆ"}, "Your Rights": {"zh-CN": "您的权利", "th": "สิทธิของคุณ"}, "Your account": {"zh-CN": "您的账户", "th": "บัญชีของคุณ"}, "Your complaint should include:": {"zh-CN": "您的投诉应包含：", "th": "ข้อร้องเรียนของคุณควรประกอบด้วย:"}, "Your email address": {"zh-CN": "您的电子邮件地址", "th": "ที่อยู่อีเมลของคุณ"}, "Your full name": {"zh-CN": "您的全名", "th": "ชื่อเต็มของคุณ"}, "Your request should include:": {"zh-CN": "您的请求应包含：", "th": "คำขอของคุณควรประกอบด้วย:"}, "e.g. foreign-owned logistics companies in Chonburi": {"zh-CN": "例如：春武里府的外资物流公司", "th": "เช่น บริษัทโลจิสติกส์ที่ถือครองโดยต่างชาติในชลบุรี"}, "registered companies": {"zh-CN": "注册公司", "th": "บริษัทที่จดทะเบียน"}, "sub-industries": {"zh-CN": "子行业", "th": "อุตสาหกรรมย่อย"}, "you@example.com": {"zh-CN": "you@example.com", "th": "you@example.com"}, "Sitemap": {"zh-CN": "网站地图", "th": "แผนผังเว็บไซต์"}, "XML Sitemap": {"zh-CN": "XML 网站地图", "th": "แผนผังเว็บไซต์ XML"}, "Every page, business report, province, industry and company category on BizThai": {"zh-CN": "BizThai 上的每个页面、商业报告、省份、行业和公司类别", "th": "ทุกหน้า รายงานธุรกิจ จังหวัด อุตสาหกรรม และหมวดหมู่บริษัทบน BizThai"}, "Thailand's Business Intelligence Platform": {"zh-CN": "泰国商业信息平台", "th": "แพลตฟอร์มข้อมูลธุรกิจของประเทศไทย"}, "BizThai is a business intelligence platform focused on Thailand.": {"zh-CN": "BizThai 是一个专注于泰国商业信息、企业数据和市场情报的平台。", "th": "BizThai เป็นแพลตฟอร์มข้อมูลธุรกิจที่มุ่งเน้นประเทศไทย"}, "We bring together company information, business data, industry insights, and market intelligence to help businesses access reliable information, identify opportunities, and make informed decisions.": {"zh-CN": "我们整合企业资料、行业数据、市场资讯和商业资源，为企业、投资者、采购商、金融机构、专业服务机构以及研究人员提供可靠、准确、易于获取的商业信息。", "th": "โดยรวบรวมข้อมูลบริษัท ข้อมูลทางธุรกิจ ข้อมูลอุตสาหกรรม และข้อมูลตลาด เพื่อช่วยให้ผู้ใช้งานเข้าถึงข้อมูลที่เชื่อถือได้ ค้นหาโอกาสทางธุรกิจ และตัดสินใจได้อย่างมีประสิทธิภาพ"}, "Whether you are researching a company, evaluating a supplier, exploring an industry, or entering the Thai market, BizThai provides the information you need to move forward with confidence.": {"zh-CN": "无论是了解一家企业、寻找合作伙伴、研究行业趋势，还是进入泰国市场，BizThai 都致力于帮助用户获得更全面的商业洞察，并支持更加高效的商业决策。", "th": "ไม่ว่าคุณจะต้องการศึกษาข้อมูลบริษัท ค้นหาซัพพลายเออร์ วิเคราะห์อุตสาหกรรม หรือขยายธุรกิจเข้าสู่ประเทศไทย BizThai พร้อมสนับสนุนด้วยข้อมูลที่ครบถ้วนและใช้งานได้จริง"}, "What We Offer": {"zh-CN": "我们提供", "th": "สิ่งที่เราให้บริการ"}, "BizThai provides a growing range of business information and digital services, including:": {"zh-CN": "BizThai 持续建设和完善商业数据平台，提供包括：", "th": "BizThai ให้บริการข้อมูลและบริการด้านธุรกิจอย่างต่อเนื่อง ได้แก่"}, "Company profiles and registration records": {"zh-CN": "企业信息与注册资料", "th": "ข้อมูลบริษัทและข้อมูลการจดทะเบียน"}, "Directors and management information": {"zh-CN": "公司管理层及董事信息", "th": "ข้อมูลกรรมการและผู้บริหาร"}, "Company status": {"zh-CN": "企业经营状态", "th": "สถานะของบริษัท"}, "Industry classifications and business directories": {"zh-CN": "行业分类与企业目录", "th": "การจัดหมวดหมู่อุตสาหกรรมและสารบบธุรกิจ"}, "Business news and market updates": {"zh-CN": "商业新闻与市场动态", "th": "ข่าวธุรกิจและข้อมูลตลาด"}, "Supplier and buyer directories": {"zh-CN": "供应商与采购商目录", "th": "ฐานข้อมูลผู้ซื้อและผู้ขาย"}, "Business intelligence and credit references": {"zh-CN": "企业信用参考信息", "th": "ข้อมูลอ้างอิงด้านเครดิตและข้อมูลเชิงธุรกิจ"}, "Industry research and market insights": {"zh-CN": "行业研究与市场分析", "th": "งานวิจัยอุตสาหกรรมและข้อมูลเชิงลึกของตลาด"}, "APIs and enterprise data solutions": {"zh-CN": "企业数据接口（API）及数据解决方案", "th": "API และโซลูชันข้อมูลสำหรับองค์กร"}, "Who We Serve": {"zh-CN": "服务对象", "th": "ผู้ใช้งานของเรา"}, "BizThai serves businesses, investors, procurement teams, financial institutions, legal and accounting professionals, researchers, entrepreneurs, government organizations, and companies doing business in Thailand.": {"zh-CN": "BizThai 服务于泰国本地企业、国际采购商、投资机构、金融机构、法律及会计专业人士、研究机构、创业者，以及计划进入泰国市场的全球企业。", "th": "BizThai ให้บริการแก่ภาคธุรกิจ นักลงทุน ผู้จัดซื้อ สถาบันการเงิน บริษัทกฎหมายและบัญชี นักวิจัย ผู้ประกอบการ หน่วยงานภาครัฐ และบริษัทต่างประเทศที่ดำเนินธุรกิจในประเทศไทย"}, "Our Data": {"zh-CN": "数据来源", "th": "แหล่งข้อมูล"}, "Our platform organizes information collected from publicly available government records, company disclosures, and other legally accessible sources.": {"zh-CN": "平台数据主要来源于政府公开信息、企业依法披露的信息以及其他合法公开的数据来源，并持续进行整理、更新与结构化处理。", "th": "BizThai รวบรวมและจัดโครงสร้างข้อมูลจากข้อมูลภาครัฐที่เปิดเผยต่อสาธารณะ ข้อมูลที่บริษัทเปิดเผยตามกฎหมาย และแหล่งข้อมูลที่สามารถเข้าถึงได้อย่างถูกต้องตามกฎหมาย"}, "We continuously improve the quality, coverage, and accessibility of our data to provide reliable business information for our users.": {"zh-CN": "我们不断提升数据质量、覆盖范围和更新效率，为用户提供更加可靠的商业信息服务。", "th": "เราปรับปรุงคุณภาพ ความครอบคลุม และความถูกต้องของข้อมูลอย่างต่อเนื่อง เพื่อให้ผู้ใช้งานได้รับข้อมูลธุรกิจที่เชื่อถือได้และใช้งานได้ง่าย"}, "Looking Ahead": {"zh-CN": "展望未来", "th": "ก้าวต่อไป"}, "BizThai is more than a company information platform.": {"zh-CN": "BizThai 不仅是一家企业信息平台。", "th": "BizThai ไม่ได้เป็นเพียงแพลตฟอร์มค้นหาข้อมูลบริษัทเท่านั้น"}, "We are building a comprehensive business ecosystem that connects company data, market intelligence, supplier discovery, industry information, and digital business services, helping organizations connect, grow, and succeed in Thailand.": {"zh-CN": "我们正在打造覆盖企业数据、商业情报、行业资讯、供应链资源、市场信息及数字化商业服务的综合商业平台，帮助企业建立连接、发现机会，并推动更加开放、透明和高效的商业生态。", "th": "เรากำลังพัฒนาแพลตฟอร์มข้อมูลธุรกิจแบบครบวงจร ที่เชื่อมโยงข้อมูลบริษัท ข้อมูลตลาด เครือข่ายซัพพลายเออร์ ข้อมูลอุตสาหกรรม และบริการดิจิทัล เพื่อช่วยให้องค์กรเติบโต สร้างความร่วมมือ และดำเนินธุรกิจในประเทศไทยได้อย่างมีประสิทธิภาพ"}};

/* ===== 界面文案三语化(UI chrome i18n,源文本精确匹配) ===== */
(function () {
  var DICT = (typeof STARTER_UI_I18N !== 'undefined' && STARTER_UI_I18N) || {};

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function normalizeLocale(value) {
    value = (value == null ? '' : String(value)).trim().toLowerCase();
    if (value === 'zh' || value.indexOf('zh') === 0) return 'zh-CN';
    if (value.indexOf('th') === 0) return 'th';
    if (value.indexOf('en') === 0) return 'en';
    return '';
  }
  function cookieLocale() {
    var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
    return m ? normalizeLocale(decodeURIComponent(m[1])) : '';
  }

  function activeLocale() {
    return window.location.hostname === 'en.bizthai.com' ? 'en' : 'th';
  }

  function collapse(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  // 这些子树跳过:公司/分类数据节点、语言切换器、脚本样式、显式标 data-no-i18n
  var SKIP = '.starter-cloud__item,[data-language-switch],[data-no-i18n],script,style';

  function inSkipped(node) {
    var el = node.nodeType === 3 ? node.parentNode : node;
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(SKIP)) return true;
      el = el.parentNode;
    }
    return false;
  }

  function translateText(locale, root) {
    if (locale === 'en' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var key = collapse(node.nodeValue);
      if (!key) return;
      var entry = DICT[key];
      if (!entry || !entry[locale]) return;
      if (inSkipped(node)) return;
      // 保留首尾空白,仅替换中间正文
      var m = node.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
      node.nodeValue = (m ? m[1] : '') + entry[locale] + (m ? m[2] : '');
    });
  }

  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  function translateAttrs(locale, root) {
    if (locale === 'en' || !root) return;
    var els = root.querySelectorAll('[placeholder],[aria-label],[title],[alt]');
    Array.prototype.forEach.call(els, function (el) {
      if (inSkipped(el)) return;
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var entry = DICT[collapse(el.getAttribute(a))];
        if (entry && entry[locale]) el.setAttribute(a, entry[locale]);
      });
    });
  }

  // 全局 data-en/data-th/data-zh 翻译器:静态模板里用这套属性的元素(首页公司名 bz-co__nm、
  // promo 卡、tab 按钮、行业/府浏览行等 73+ 元素)原本只有 3 个动态卡片函数内部处理,静态元素
  // 无人翻译 → 永远停在英文。这里在每次 apply 时全局补上,缺该语种回退英文。
  function translateDataAttrs(locale, root) {
    var suffix = /^zh/.test(locale) ? 'zh' : (/^th/.test(locale) ? 'th' : 'en');
    var els = (root || document).querySelectorAll('[data-en],[data-th],[data-zh]');
    Array.prototype.forEach.call(els, function (el) {
      if (el.children && el.children.length) return;            // 仅叶子文本节点,避免破坏嵌套结构
      if (el.matches && el.matches('[data-language-switch],[data-no-i18n]')) return;
      var val = el.getAttribute('data-' + suffix);
      if (val == null || val === '') val = el.getAttribute('data-en');   // 缺该语种回退英文
      if (val == null || val === '') return;
      if (el.textContent !== val) el.textContent = val;
    });
  }

  // 内部页面链接补语言前缀:全站生成公司/分类链接的模板 + JS helper 有几百处,不逐个改;
  // 非英文时统一在这里给同源内容链接补 /zh、/th(资源/接口/已带前缀的跳过,见 nginx 的
  // /zh、/th 前缀转发规则)。
  // sitemap.xml 需要带语言前缀(/th/sitemap.xml、/zh/sitemap.xml);其它 sitemap-*.xml / xsl 仍跳过
  var LINK_SKIP_RE = /^\/(zh|th|en)(\/|$)|^\/(assets|api|uploads|admin)(\/|$)|^\/(robots\.txt|sitemap\.xsl|BingSiteAuth\.xml)$|^\/sitemap-/;
  function localizeLinks(locale, root) {
    if (locale === 'en' || !root) return;
    var seg = locale === 'th' ? 'th' : (/^zh/.test(locale) ? 'zh' : '');
    if (!seg) return;
    var links = root.querySelectorAll('a[href]');
    Array.prototype.forEach.call(links, function (el) {
      if (inSkipped(el)) return;
      var href = el.getAttribute('href');
      if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
      if (href === '/sitemap.xml') { el.setAttribute('href', '/' + seg + '/sitemap.xml'); return; }
      if (LINK_SKIP_RE.test(href)) return;
      el.setAttribute('href', '/' + seg + href);
    });
  }

  function apply(root) {
    var locale = activeLocale();
    var scope = root || document.body;
    translateText(locale, scope);
    translateAttrs(locale, scope);
    translateDataAttrs(locale, scope);
    localizeLinks(locale, scope);
  }

  // 通用 i18n hook,供动态渲染后的内容复用(翻译 JS 生成的文本节点)
  window.__starterApplyI18n = apply;

  // 首页"行业构成"卡片、/companies 公司列表这类板块是页面加载后异步 fetch 拼 HTML 插入的,
  // 不在下面这一次性 apply() 的覆盖范围内——那次只跑一遍,跑完之后才插入的内容永远补不到
  // 翻译/链接前缀。用 MutationObserver 监听后续新增节点,自动补跑同一套 i18n。translateDataAttrs
  // 的 el.textContent 赋值会触发一次自身的 childList 变化,但它有"值相同就不再写"的判断,
  // 不会死循环,只多跑一轮就自然收敛。
  var reapplyScheduled = false;
  function scheduleReapply() {
    if (reapplyScheduled) return;
    reapplyScheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      reapplyScheduled = false;
      apply(document.body);
    });
  }

  ready(function () {
    apply(document.body);
    if (window.MutationObserver) {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i += 1) {
          if (mutations[i].addedNodes && mutations[i].addedNodes.length) { scheduleReapply(); return; }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
  });
})();


(function () {
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    var header = document.querySelector('[data-random-glow]');
    if (!header) return;
    if (!header.closest('.starter-front')) return;

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var bounds = {
      minX: 8,
      maxX: 92,
      minY: 4,
      maxY: 78
    };
    var state = {
      x: Math.random() * (bounds.maxX - bounds.minX) + bounds.minX,
      y: Math.random() * (bounds.maxY - bounds.minY) + bounds.minY,
      vx: (Math.random() > 0.5 ? 1 : -1) * (18 + Math.random() * 9),
      vy: (Math.random() > 0.5 ? 1 : -1) * (13 + Math.random() * 8),
      drift: 0
    };
    var lastTime = 0;

    function setGlowPosition() {
      header.style.setProperty('--glow-x', state.x.toFixed(2) + '%');
      header.style.setProperty('--glow-y', state.y.toFixed(2) + '%');
    }

    function bounce(axis, velocityAxis, min, max) {
      if (state[axis] < min) {
        state[axis] = min + (min - state[axis]);
        state[velocityAxis] = Math.abs(state[velocityAxis]);
      } else if (state[axis] > max) {
        state[axis] = max - (state[axis] - max);
        state[velocityAxis] = -Math.abs(state[velocityAxis]);
      }
    }

    function nudgeVelocity(deltaSeconds) {
      state.drift -= deltaSeconds;
      if (state.drift > 0) return;

      state.vx += (Math.random() - 0.5) * 6;
      state.vy += (Math.random() - 0.5) * 5;
      state.vx = Math.max(-34, Math.min(34, state.vx));
      state.vy = Math.max(-27, Math.min(27, state.vy));
      if (Math.abs(state.vx) < 14) state.vx += state.vx < 0 ? -7 : 7;
      if (Math.abs(state.vy) < 10) state.vy += state.vy < 0 ? -5 : 5;
      state.drift = 0.55 + Math.random() * 1.1;
    }

    function animateGlow(time) {
      if (!lastTime) lastTime = time;
      var deltaSeconds = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      state.x += state.vx * deltaSeconds;
      state.y += state.vy * deltaSeconds;
      bounce('x', 'vx', bounds.minX, bounds.maxX);
      bounce('y', 'vy', bounds.minY, bounds.maxY);
      nudgeVelocity(deltaSeconds);
      setGlowPosition();

      window.requestAnimationFrame(animateGlow);
    }

    setGlowPosition();

    if (!reduceMotion && window.requestAnimationFrame) {
      window.requestAnimationFrame(animateGlow);
    }
  });
})();


/* ===== 公司详情页客户端渲染(参照旧 SPA CompanyPage:Hero + 三 Tab)===== */
(function () {
  var root = document.querySelector('[data-company-detail]');
  if (!root || !window.fetch) return;

  /* ---- 通用辅助 ---- */
  function text(v) { return v == null ? '' : String(v); }
  function metaValue(meta, lower, camel) {
    var v = meta && meta[lower];
    if (v !== undefined && v !== null && v !== '') return v;
    return camel && meta ? meta[camel] : undefined;
  }
  function firstValue(meta, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var v = meta && meta[keys[i]];
      if (v !== undefined && v !== null && v !== '') return text(v);
    }
    return '';
  }
  function langText(th, en, zh) {
    var fb = text(en) || text(th) || text(zh);
    return { th: text(th) || fb, en: text(en) || fb, zh: text(zh) || fb };
  }
  function i18nText(meta, key) {
    var b = meta && meta.i18n;
    if (!b || typeof b !== 'object') return null;
    var th = b.th && b.th[key], en = b.en && b.en[key], zh = b.zh && b.zh[key];
    if (!th && !en && !zh) return null;
    return langText(th, en, zh);
  }
  function normalizeLocale(v) {
    v = text(v).trim().toLowerCase();
    if (v === 'zh' || v.indexOf('zh') === 0) return 'zh-CN';
    if (v.indexOf('th') === 0) return 'th';
    if (v.indexOf('en') === 0) return 'en';
    return '';
  }
  function cookieLocale() {
    var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
    return m ? normalizeLocale(decodeURIComponent(m[1])) : '';
  }
  function activeLocale() {
    var first = window.location.pathname.split('/').filter(Boolean)[0] || '';
    var fp = normalizeLocale(first);
    if (fp) return fp;
    var __hl = normalizeLocale(document.documentElement.lang); if (__hl) return __hl;
    return 'en';
  }
  function pickLang(val, locale) {
    if (!val) return '';
    if (locale === 'zh-CN') return text(val.zh || val.en || val.th);
    if (locale === 'th') return text(val.th || val.en || val.zh);
    return text(val.en || val.th || val.zh);
  }
  function escapeHtml(v) {
    return text(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(v, dec) {
    if (v === null || v === undefined || v === '') return '-';
    var n = Number(v);
    if (!isFinite(n)) return '-';
    var s = (dec != null) ? n.toFixed(dec) : String(n);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  var BE = 543;
  function ceFromYear(y) { y = parseInt(y, 10); if (isNaN(y)) return null; return y >= 2400 ? y - BE : y; }
  function dualYear(yearRaw) {
    var ce = ceFromYear(yearRaw);
    if (ce === null) return '';
    return LANG === 'th' ? (ce + BE) + ' (' + ce + ')' : ce + ' (' + (ce + BE) + ')';
  }
  function dualDate(raw) {
    raw = text(raw);
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return raw;
    var ce = ceFromYear(m[1]);
    if (ce === null) return raw;
    var be = ce + BE, rest = '-' + m[2] + '-' + m[3];
    return LANG === 'th' ? (be + rest + ' (' + ce + ')') : (ce + rest + ' (' + be + ')');
  }

  var locale = activeLocale();
  var LANG = locale === 'zh-CN' ? 'zh' : (locale === 'th' ? 'th' : 'en');
  function pick(v) { return pickLang(v, locale); }

  var LABELS = {
    kicker: { en: 'Thai Company Profile', th: 'โปรไฟล์บริษัทไทย', zh: '泰国公司档案' },
    dataSource: { en: 'DBD DataWarehouse+', th: 'DBD DataWarehouse+', zh: 'DBD DataWarehouse+' },
    copyLink: { en: 'Copy link', th: 'คัดลอกลิงก์', zh: '复制链接' },
    copied: { en: 'Copied', th: 'คัดลอกแล้ว', zh: '已复制' },
    print: { en: 'Print', th: 'พิมพ์', zh: '打印' },
    registryProfile: { en: 'Registry Profile', th: 'ข้อมูลทะเบียน', zh: '登记档案' },
    financialRecords: { en: 'Financial Records', th: 'ข้อมูลการเงิน', zh: '财务数据' },
    dataSource: { en: 'Data source: DBD DataWarehouse+', th: 'แหล่งข้อมูล: DBD DataWarehouse+', zh: '数据来源:DBD DataWarehouse+' },
    viewsCount: { en: '{n} views', th: 'เข้าชม {n} ครั้ง', zh: '{n} 人看过' },
    directorsRecords: { en: 'Directors & Nationality', th: 'กรรมการและสัญชาติ', zh: '董事与国籍信息' },
    signAuthorityBadge: { en: 'Signing authority', th: 'มีอำนาจลงนาม', zh: '有签字权限' },
    natBreakdownTitle: { en: 'Nationality Breakdown', th: 'สัดส่วนสัญชาติกรรมการ', zh: '董事国籍分布' },
    natBreakdownNote: { en: 'By director headcount, not by investment value.', th: 'นับตามจำนวนกรรมการ ไม่ใช่มูลค่าการลงทุน', zh: '按董事人数占比,非出资金额占比。' },
    natTableNat: { en: 'Nationality', th: 'สัญชาติ', zh: '国籍' },
    natTableCount: { en: 'Directors', th: 'จำนวน', zh: '人数' },
    natTablePct: { en: 'Share', th: 'สัดส่วน', zh: '占比' },
    capBreakdownTitle: { en: 'Shareholding by Nationality', th: 'สัดส่วนผู้ถือหุ้นตามสัญชาติ', zh: '股权国籍构成' },
    capBreakdownNote: { en: 'By registered capital (share value).', th: 'ตามสัดส่วนทุนจดทะเบียน (มูลค่าหุ้น)', zh: '按注册资本(股份价值)占比。' },
    shareTrendTitle: { en: 'Shareholding Trend by Nationality', th: 'แนวโน้มสัดส่วนผู้ถือหุ้นตามสัญชาติ (รายปี)', zh: '历年股权国籍占比趋势' },
    shareTrendNote: { en: 'Thai vs. foreign shareholding by year (% of registered capital).', th: 'สัดส่วนผู้ถือหุ้นไทยเทียบกับต่างชาติรายปี (% ของทุนจดทะเบียน)', zh: '按年度对比泰籍与外籍持股占比(占注册资本比例)。' },
    metricShareHistTH: { en: 'Thai shareholding', th: 'สัดส่วนผู้ถือหุ้นไทย', zh: '泰籍持股比例' },
    metricShareHistOT: { en: 'Foreign shareholding', th: 'สัดส่วนผู้ถือหุ้นต่างชาติ', zh: '外籍持股比例' },
    capTableShares: { en: 'Shares', th: 'จำนวนหุ้น', zh: '股份数量' },
    capTableValue: { en: 'Investment Value (THB)', th: 'มูลค่าการลงทุน (บาท)', zh: '投资价值(泰铢)' },
    changeRecordsTab: { en: 'Change Records', th: 'ประวัติการเปลี่ยนแปลง', zh: '变更记录' },
    financialDataTab: { en: 'Financial Data', th: 'ข้อมูลทางการเงิน', zh: '财务数据' },
    metric: { en: 'Item', th: 'รายการ', zh: '项目' },
    companyType: { en: 'Company type', th: 'ประเภทนิติบุคคล', zh: '企业类型' },
    status: { en: 'Status', th: 'สถานะ', zh: '经营状态' },
    regDate: { en: 'Registration date', th: 'วันที่จดทะเบียน', zh: '注册日期' },
    registeredCapital: { en: 'Registered capital', th: 'ทุนจดทะเบียน', zh: '注册资本' },
    paidCapital: { en: 'Paid-up capital', th: 'ทุนชำระแล้ว', zh: '实缴资本' },
    businessCategory: { en: 'Business category', th: 'ประเภทธุรกิจ', zh: '经营类型' },
    industry: { en: 'Industry', th: 'กลุ่มอุตสาหกรรม', zh: '行业大类' },
    provinceDistrict: { en: 'Province / district', th: 'จังหวัด / อำเภอ', zh: '省份/县区' },
    financialYear: { en: 'Financial year', th: 'ปีงบการเงิน', zh: '财务年份' },
    lastUpdated: { en: 'Last updated', th: 'ปรับปรุงล่าสุด', zh: '数据更新' },
    overview: { en: 'Company overview', th: 'ข้อมูลทั่วไป', zh: '公司概览' },
    capitalDates: { en: 'Capital & dates', th: 'ทุนและวันที่', zh: '资本与日期' },
    registrationNo: { en: 'Registration number', th: 'เลขทะเบียน', zh: '注册号' },
    nameTh: { en: 'Name (Thai)', th: 'ชื่อ (ไทย)', zh: '名称(泰文)' },
    nameEn: { en: 'Name (English)', th: 'ชื่อ (อังกฤษ)', zh: '名称(英文)' },
    nameZh: { en: 'Name (Chinese)', th: 'ชื่อ (จีน)', zh: '名称(中文)' },
    shares: { en: 'Shares', th: 'จำนวนหุ้น', zh: '股本数量' },
    registeredAddress: { en: 'Registered address', th: 'ที่อยู่จดทะเบียน', zh: '注册地址' },
    address: { en: 'Address', th: 'ที่อยู่', zh: '地址' },
    region: { en: 'District / province', th: 'พื้นที่', zh: '区域' },
    zipcode: { en: 'Postal code', th: 'รหัสไปรษณีย์', zh: '邮编' },
    businessObjective: { en: 'Business objective', th: 'วัตถุประสงค์ทางธุรกิจ', zh: '经营范围' },
    contact: { en: 'Contact', th: 'ข้อมูลติดต่อ', zh: '联系方式' },
    phone: { en: 'Phone', th: 'โทรศัพท์', zh: '电话' },
    email: { en: 'Email', th: 'อีเมล', zh: '邮箱' },
    website: { en: 'Website', th: 'เว็บไซต์', zh: '网站' },
    fax: { en: 'Fax', th: 'โทรสาร', zh: '传真' },
    balanceSheet: { en: 'Balance sheet', th: 'งบแสดงฐานะการเงิน', zh: '资产负债表' },
    incomeStatement: { en: 'Income statement', th: 'งบกำไรขาดทุน', zh: '损益表' },
    financialRatios: { en: 'Financial ratios', th: 'อัตราส่วนทางการเงิน', zh: '财务比率' },
    noFinancial: { en: 'No financial statements are available for this company.', th: 'ไม่มีข้อมูลงบการเงินสำหรับบริษัทนี้', zh: '该公司暂无财务报表数据。' },
    revenue: { en: 'Revenue', th: 'รายได้', zh: '营业收入' },
    netProfit: { en: 'Net profit', th: 'กำไรสุทธิ', zh: '净利润' },
    totalAssets: { en: 'Total assets', th: 'สินทรัพย์รวม', zh: '总资产' },
    equity: { en: 'Equity', th: 'ส่วนของผู้ถือหุ้น', zh: '股东权益' },
    finYearNote: { en: 'Latest figures · FY {y}', th: 'ข้อมูลล่าสุด · ปีงบ {y}', zh: '最新数据 · 财年 {y}' },
    netProfitLoss: { en: 'Profit (Loss)', th: 'กำไร(ขาดทุน)', zh: '利润(亏损)' },
    yoy: { en: 'YoY', th: 'YoY', zh: '同比' },
    finCardHead: { en: '{label} Year {y} ({unit})', th: '{label} ปี {y} ({unit})', zh: '{label} {y}年 ({unit})' },
    finTrendCaption: { en: '{label} {n}-Year ({unit})', th: '{label} {n} ปี ({unit})', zh: '{label} {n}年趋势 ({unit})' },
    finNoData: { en: 'No financial data available', th: 'ไม่มีข้อมูลทางการเงิน', zh: '暂无财务数据' },
    // ── 深度财务分析(利润流向/成长/盈利/风险/排名,并入登记档案里原有的三个财务区块,不再是独立页/独立 tab) ──
    secFlowNote: { en: 'How revenue turns into profit, step by step — FY {y}.', th: 'รายได้กลายเป็นกำไรอย่างไร ทีละขั้น — ปีงบ {y}', zh: '收入如何一步步变成利润(财年 {y})。' },
    finYearPicker: { en: 'Fiscal year:', th: 'ปีงบที่ยื่น:', zh: '提交年度:' },
    secRank: { en: 'Market Position', th: 'อันดับในตลาด', zh: '市场地位' },
    secMap: { en: 'Location on Map', th: 'ตำแหน่งบนแผนที่', zh: '地图位置' },
    cogs: { en: 'Cost of sales', th: 'ต้นทุนขาย', zh: '销售成本' },
    taxExpense: { en: 'Tax expense', th: 'ค่าใช้จ่ายภาษี', zh: '税项支出' },
    secGrowth: { en: 'Growth Trend', th: 'แนวโน้มการเติบโต', zh: '增长趋势' },
    grossMargin: { en: 'Gross margin', th: 'อัตรากำไรขั้นต้น', zh: '毛利率' },
    netMargin: { en: 'Net margin', th: 'อัตรากำไรสุทธิ', zh: '净利率' },
    opMargin: { en: 'Operating margin', th: 'อัตรากำไรจากการดำเนินงาน', zh: '营业利润率' },
    roa: { en: 'Return on assets (ROA)', th: 'ผลตอบแทนต่อสินทรัพย์ (ROA)', zh: '资产回报率 (ROA)' },
    roe: { en: 'Return on equity (ROE)', th: 'ผลตอบแทนต่อผู้ถือหุ้น (ROE)', zh: '净资产回报率 (ROE)' },
    riskLiquidity: { en: 'Liquidity (current ratio)', th: 'สภาพคล่อง (Current ratio)', zh: '流动性(流动比率)' },
    riskLeverage: { en: 'Leverage (debt / assets)', th: 'ภาระหนี้ (หนี้สิน/สินทรัพย์)', zh: '杠杆(资产负债率)' },
    riskDE: { en: 'Debt to equity', th: 'หนี้สินต่อทุน', zh: '产权比率(负债/权益)' },
    riskInterest: { en: 'Interest coverage', th: 'ความสามารถชำระดอกเบี้ย', zh: '利息保障倍数' },
    riskGood: { en: 'Healthy', th: 'แข็งแรง', zh: '稳健' },
    riskWatch: { en: 'Watch', th: 'ควรติดตาม', zh: '关注' },
    riskAlert: { en: 'Risk', th: 'ความเสี่ยง', zh: '风险' },
    riskNa: { en: 'No data', th: 'ไม่มีข้อมูล', zh: '数据不足' },
    liqGood: { en: 'Current ratio {v} — short-term obligations are well covered.', th: 'อัตราส่วนสภาพคล่อง {v} — ครอบคลุมภาระระยะสั้นได้ดี', zh: '流动比率 {v},短期偿债能力充足。' },
    liqWatch: { en: 'Current ratio {v} — coverage is adequate but thin.', th: 'อัตราส่วนสภาพคล่อง {v} — พอครอบคลุมแต่ไม่มาก', zh: '流动比率 {v},短期偿债能力基本平衡,余量不大。' },
    liqAlert: { en: 'Current ratio {v} — current liabilities exceed current assets; monitor liquidity.', th: 'อัตราส่วนสภาพคล่อง {v} — หนี้สินหมุนเวียนสูงกว่าสินทรัพย์หมุนเวียน ควรติดตามสภาพคล่อง', zh: '流动比率 {v},流动负债高于流动资产,需关注短期流动性压力。' },
    levGood: { en: 'Debt is {v} of assets — conservative leverage.', th: 'หนี้สินคิดเป็น {v} ของสินทรัพย์ — ภาระหนี้อยู่ในระดับต่ำ', zh: '负债占总资产 {v},杠杆水平稳健。' },
    levWatch: { en: 'Debt is {v} of assets — moderate leverage.', th: 'หนี้สินคิดเป็น {v} ของสินทรัพย์ — ภาระหนี้ปานกลาง', zh: '负债占总资产 {v},杠杆中等。' },
    levAlert: { en: 'Debt is {v} of assets — leverage is elevated.', th: 'หนี้สินคิดเป็น {v} ของสินทรัพย์ — ภาระหนี้ค่อนข้างสูง', zh: '负债占总资产 {v},杠杆偏高。' },
    deGood: { en: 'Debt/equity {v} — equity comfortably funds the balance sheet.', th: 'หนี้สินต่อทุน {v} — ฐานทุนแข็งแรง', zh: '产权比率 {v},权益资本对负债覆盖充分。' },
    deWatch: { en: 'Debt/equity {v} — moderate reliance on debt.', th: 'หนี้สินต่อทุน {v} — พึ่งพาหนี้ปานกลาง', zh: '产权比率 {v},对债务融资有一定依赖。' },
    deAlert: { en: 'Debt/equity {v} — heavy reliance on debt funding.', th: 'หนี้สินต่อทุน {v} — พึ่งพาหนี้ในระดับสูง', zh: '产权比率 {v},高度依赖债务融资。' },
    intGood: { en: 'EBIT covers interest {v}× — comfortable headroom.', th: 'EBIT ครอบคลุมดอกเบี้ย {v} เท่า — เพียงพอ', zh: '息税前利润为利息支出的 {v} 倍,偿息压力小。' },
    intWatch: { en: 'EBIT covers interest {v}× — headroom is limited.', th: 'EBIT ครอบคลุมดอกเบี้ย {v} เท่า — ค่อนข้างจำกัด', zh: '息税前利润为利息支出的 {v} 倍,偿息余量有限。' },
    intAlert: { en: 'EBIT covers interest only {v}× — earnings do not comfortably cover interest.', th: 'EBIT ครอบคลุมดอกเบี้ยเพียง {v} เท่า — กำไรไม่พอครอบคลุมดอกเบี้ย', zh: '息税前利润仅为利息支出的 {v} 倍,盈利难以覆盖利息。' },
    intNone: { en: 'No material interest expense — minimal debt-service burden.', th: 'แทบไม่มีภาระดอกเบี้ย', zh: '几乎没有利息负担,债务偿付压力极小。' },
    overallGood: { en: 'Overall: financial position looks solid across the indicators above.', th: 'ภาพรวม: สถานะการเงินอยู่ในเกณฑ์ดีตามตัวชี้วัดข้างต้น', zh: '整体来看:上述各项指标显示财务状况较为稳健。' },
    overallWatch: { en: 'Overall: fundamentals are acceptable, but the flagged items above deserve monitoring.', th: 'ภาพรวม: พื้นฐานพอใช้ แต่ควรติดตามรายการที่ถูกทำเครื่องหมายไว้', zh: '整体来看:基本面尚可,但上述标黄/标红项值得持续关注。' },
    overallAlert: { en: 'Overall: several indicators point to elevated financial risk; review with care.', th: 'ภาพรวม: หลายตัวชี้วัดสะท้อนความเสี่ยงการเงินสูง ควรพิจารณาอย่างรอบคอบ', zh: '整体来看:多项指标提示财务风险偏高,请审慎评估。' },
    rankCaption: { en: 'Ranking is relative to similar companies that filed FY {y} statements with DBD — not all companies in Thailand.', th: 'อันดับเทียบกับบริษัทประเภทเดียวกันที่ยื่นงบต่อ DBD ในปีงบ {y} เท่านั้น ไม่ใช่ทุกบริษัทที่จดทะเบียนในประเทศไทย', zh: '排名仅参照同类型、于财年 {y} 向 DBD 提交财报的企业,并非泰国全部注册企业。' },
    rankInactive: { en: 'This company has been deregistered (or is in another non-operating status); ranking is unavailable.', th: 'บริษัทนี้เลิกกิจการแล้ว (หรือมีสถานะผิดปกติอื่น) จึงยังไม่มีอันดับ', zh: '该企业已注销（或其他异常状态），暂无排名' },
    rankNoFiling: { en: 'This company did not file a FY {y} annual report and is not included in the ranking.', th: 'บริษัทนี้ไม่ได้ยื่นงบการเงินปี {y} จึงไม่เข้าร่วมการจัดอันดับ', zh: '该企业{y}年未提供年报，不参与排名' },
    rankNegative: { en: 'This company’s FY {y} revenue is negative (likely a data error) and is not included in the ranking.', th: 'รายได้ปีงบ {y} ของบริษัทติดลบ (อาจเป็นข้อมูลผิดพลาด) จึงไม่เข้าร่วมการจัดอันดับ', zh: '该企业{y}年营收为负（数据异常），不参与排名' },
    rankLastFiling: { en: 'Latest annual report: FY {y}.', th: 'งบการเงินล่าสุด: ปี {y}', zh: '最近年报：{y}' },
    rankLastFilingNone: { en: 'No annual report on file.', th: 'ไม่พบบันทึกงบการเงิน', zh: '暂无年报记录' },
    rankRevAll: { en: 'Revenue ranking{ind}', th: 'อันดับรายได้{ind}', zh: '营收排名{ind}' },
    rankProfitAll: { en: 'Profit ranking{ind}', th: 'อันดับกำไร{ind}', zh: '利润排名{ind}' },
    rankRevSize: { en: 'Revenue · same size class{s}', th: 'รายได้ · ขนาดเดียวกัน{s}', zh: '营收 · 同规模企业{s}' },
    rankProfitSize: { en: 'Profit · same size class{s}', th: 'กำไร · ขนาดเดียวกัน{s}', zh: '利润 · 同规模企业{s}' },
    st1Title: { en: 'Step 1 · Total revenue', th: 'ขั้นที่ 1 · รายได้รวม', zh: 'Step 1 · 总收入' },
    st1A: { en: 'In FY {y} the company recorded total revenue of {total} THB', th: 'ปีงบ {y} บริษัทมีรายได้รวม {total} บาท', zh: '财年 {y} 公司实现总收入 {total} 泰铢' },
    st1B: { en: 'sales/service revenue {sales} ({p}%)', th: 'รายได้จากการขาย/บริการ {sales} ({p}%)', zh: '其中主营业务收入 {sales}(占 {p}%)' },
    st1C: { en: 'other income {oth} ({p}%)', th: 'รายได้อื่น {oth} ({p}%)', zh: '其他收入 {oth}(占 {p}%)' },
    st2Title: { en: 'Step 2 · Cost & gross profit', th: 'ขั้นที่ 2 · ต้นทุนและกำไรขั้นต้น', zh: 'Step 2 · 成本与毛利' },
    st2A: { en: 'Cost of sales/services was {cogs} THB ({p}% of revenue)', th: 'ต้นทุนขาย/บริการ {cogs} บาท ({p}% ของรายได้)', zh: '销售/服务成本 {cogs} 泰铢(占总收入 {p}%)' },
    st2B: { en: 'gross profit {gp} THB, gross margin {gm}%', th: 'กำไรขั้นต้น {gp} บาท อัตรากำไรขั้นต้น {gm}%', zh: '毛利 {gp} 泰铢,毛利率 {gm}%' },
    st3Title: { en: 'Step 3 · Operating expenses', th: 'ขั้นที่ 3 · ค่าใช้จ่ายดำเนินงาน', zh: 'Step 3 · 期间费用' },
    st3A: { en: 'Total expenses were {exp} THB', th: 'ค่าใช้จ่ายรวม {exp} บาท', zh: '费用合计 {exp} 泰铢' },
    st3B: { en: 'selling & service expense {sell}', th: 'ค่าใช้จ่ายขายและบริการ {sell}', zh: '其中销售与服务费用 {sell}' },
    st3C: { en: 'administrative expense {adm}', th: 'ค่าใช้จ่ายบริหาร {adm}', zh: '管理费用 {adm}' },
    st3D: { en: 'earnings before interest & tax (EBIT) {ebit} THB', th: 'กำไรก่อนดอกเบี้ยและภาษี (EBIT) {ebit} บาท', zh: '息税前利润(EBIT){ebit} 泰铢' },
    st4Title: { en: 'Step 4 · Interest & tax', th: 'ขั้นที่ 4 · ดอกเบี้ยและภาษี', zh: 'Step 4 · 利息与税' },
    st4A: { en: 'Interest expense {int} THB (coverage {cov}×)', th: 'ดอกเบี้ยจ่าย {int} บาท (ครอบคลุม {cov} เท่า)', zh: '利息支出 {int} 泰铢(利息保障倍数 {cov})' },
    st4B: { en: 'income tax {tax} THB', th: 'ภาษีเงินได้ {tax} บาท', zh: '所得税费用 {tax} 泰铢' },
    st5Title: { en: 'Step 5 · Net result', th: 'ขั้นที่ 5 · ผลกำไรสุทธิ', zh: 'Step 5 · 净利润' },
    st5Profit: { en: 'Net profit came to {np} THB, a net margin of {nm}%', th: 'กำไรสุทธิ {np} บาท อัตรากำไรสุทธิ {nm}%', zh: '最终净利润 {np} 泰铢,净利率 {nm}%' },
    st5Loss: { en: 'The year closed at a net loss of {np} THB', th: 'ปีนี้ขาดทุนสุทธิ {np} บาท', zh: '本年度净亏损 {np} 泰铢' },
    stYoY: { en: 'YoY {sign}{pc}%', th: 'เทียบปีก่อน {sign}{pc}%', zh: '同比 {sign}{pc}%' },
    ndRev: { en: 'Sales revenue', th: 'รายได้ขาย/บริการ', zh: '主营收入' },
    ndOth: { en: 'Other income', th: 'รายได้อื่น', zh: '其他收入' },
    ndTotal: { en: 'Total revenue', th: 'รายได้รวม', zh: '总收入' },
    ndCogs: { en: 'Cost of sales', th: 'ต้นทุนขาย', zh: '销售成本' },
    ndGp: { en: 'Gross profit', th: 'กำไรขั้นต้น', zh: '毛利' },
    ndOpex: { en: 'Operating expense', th: 'ค่าใช้จ่ายดำเนินงาน', zh: '期间费用' },
    ndEbit: { en: 'EBIT', th: 'EBIT', zh: '息税前利润' },
    ndInt: { en: 'Interest expense', th: 'ดอกเบี้ยจ่าย', zh: '利息支出' },
    ndTax: { en: 'Income tax', th: 'ภาษีเงินได้', zh: '所得税' },
    ndNp: { en: 'Net profit', th: 'กำไรสุทธิ', zh: '净利润' },
    registeredDirectors: { en: 'Registered directors', th: 'กรรมการที่จดทะเบียน', zh: '登记董事' },
    nationality: { en: 'Nationality', th: 'สัญชาติ', zh: '国籍' },
    updated: { en: 'Updated', th: 'ปรับปรุง', zh: '更新' },
    signingAuthority: { en: 'Signing authority', th: 'อำนาจลงนาม', zh: '签字权限' },
    totalDirectors: { en: 'Total directors', th: 'จำนวนกรรมการ', zh: '董事总数' },
    signingRules: { en: 'Signing rules', th: 'เงื่อนไขลงนาม', zh: '签字条款' },
    noDirectors: { en: 'No director records are available.', th: 'ไม่มีข้อมูลกรรมการ', zh: '暂无董事数据。' },
    relatedCompanies: { en: 'Related companies (shared directors)', th: 'บริษัทที่เกี่ยวข้อง (กรรมการร่วม)', zh: '关联企业(共享董事)' },
    relatedNote: { en: 'Linked only by shared directors — not ownership or control.', th: 'เชื่อมโยงผ่านกรรมการร่วมเท่านั้น ไม่ใช่การถือหุ้นหรือการควบคุม', zh: '仅基于共享董事关联,不代表股权或控制关系。' },
    sharedDirectors: { en: 'shared', th: 'กรรมการร่วม', zh: '共享董事' },
    home: { en: 'Home', th: 'หน้าแรก', zh: '首页' },
    directory: { en: 'Company Directory', th: 'ทำเนียบบริษัท', zh: '公司名录' },
    moreTitle: { en: 'More Thai Company Records', th: 'ข้อมูลบริษัทไทยเพิ่มเติม', zh: '更多泰国公司记录' },
    moreSub: { en: 'Recent records from the same backend company model.', th: 'ข้อมูลล่าสุดจากโมเดลบริษัทเดียวกัน', zh: '来自同一后端公司模型的最新记录。' },
    currencyUnit: { en: 'THB', th: 'บาท', zh: '泰铢' },
    loading: { en: 'Loading company record…', th: 'กำลังโหลดข้อมูลบริษัท…', zh: '正在加载公司数据…' },
    loadError: { en: 'Unable to load this company record right now.', th: 'ไม่สามารถโหลดข้อมูลบริษัทได้ในขณะนี้', zh: '暂时无法加载该公司数据。' },
    keyFigures: { en: 'Key figures', th: 'ตัวเลขสำคัญ', zh: '关键数据' },
    established: { en: 'Established', th: 'ก่อตั้งเมื่อ', zh: '成立于' },
    years: { en: 'yrs', th: 'ปี', zh: '年' },
    sizeSmall: { en: 'Small enterprise', th: 'ธุรกิจขนาดเล็ก', zh: '小型企业' },
    sizeMedium: { en: 'Medium enterprise', th: 'ธุรกิจขนาดกลาง', zh: '中型企业' },
    sizeLarge: { en: 'Large enterprise', th: 'ธุรกิจขนาดใหญ่', zh: '大型企业' },
    latestFinancials: { en: 'Latest financials', th: 'ผลการเงินล่าสุด', zh: '最新财务表现' },
    businessActivity: { en: 'Business activity', th: 'กิจกรรมทางธุรกิจ', zh: '经营业务' },
    registrationDetails: { en: 'Registration details', th: 'รายละเอียดการจดทะเบียน', zh: '登记明细' },
    companySize: { en: 'Company size', th: 'ขนาดธุรกิจ', zh: '企业规模' },
    provenanceNote: { en: 'Source: DBD DataWarehouse+ · updated {d}', th: 'แหล่งข้อมูล: DBD DataWarehouse+ · ปรับปรุง {d}', zh: '数据来源:DBD DataWarehouse+ · 更新于 {d}' },
    saveCompany: { en: 'Save this company', th: 'บันทึกบริษัทนี้', zh: '收藏该公司' },
    claimCompany: { en: 'Claim this company', th: 'อ้างสิทธิ์บริษัทนี้', zh: '认领该公司' },
    downloadProfile: { en: 'Download PDF', th: 'ดาวน์โหลด PDF', zh: '下载PDF' },
    downloadGenerating: { en: 'Generating AI report…', th: 'กำลังสร้างรายงาน AI…', zh: 'AI 生成报告中…' },
    downloadFailed: { en: 'Generation failed, please retry', th: 'สร้างไม่สำเร็จ โปรดลองใหม่', zh: '生成失败,请重试' },
    saved: { en: 'Saved', th: 'บันทึกแล้ว', zh: '已收藏' },
    claimSubmitted: { en: 'Claim submitted (pending review)', th: 'ส่งคำขอแล้ว (รอตรวจสอบ)', zh: '认领申请已提交(待审核)' },
    claimPending: { en: 'Claim pending review', th: 'คำขออยู่ระหว่างตรวจสอบ', zh: '认领待审核' },
    claimOwned: { en: 'You own this company', th: 'คุณเป็นเจ้าของบริษัทนี้', zh: '你已拥有该公司' },
    claimFailed: { en: 'Could not submit claim. Please try again.', th: 'ส่งคำขอไม่สำเร็จ โปรดลองใหม่', zh: '认领提交失败,请重试。' },
    businessEmpty: { en: 'No business activity details available.', th: 'ไม่มีรายละเอียดกิจกรรมทางธุรกิจ', zh: '暂无经营业务信息。' },
    contactEmpty: { en: 'No contact information available.', th: 'ไม่มีข้อมูลติดต่อ', zh: '暂无联系方式。' },
    contactSearchHint: { en: 'You can search Google for publicly available contact information about this company.', th: 'คุณสามารถค้นหาข้อมูลติดต่อสาธารณะของบริษัทนี้ผ่าน Google', zh: '你可以前往 Google 搜索该公司的公开联系方式。' },
    contactSearchButton: { en: 'Find contact details', th: 'ค้นหาข้อมูลติดต่อ', zh: '查找联系方式' },
    // 认领会员编辑记录提示(2026-07-05):{date} 是月日时分的轻量格式,不用登记信息那套泰历双历格式
    ownerEditNote: { en: 'Updated by verified owner on {date}', th: 'อัปเดตโดยเจ้าของที่ยืนยันแล้วเมื่อ {date}', zh: '认领后 {date} 修改' },
    peerTag: { en: 'Similar companies', th: 'บริษัทคล้ายกัน', zh: '同类企业' },
    areaPeerTag: { en: 'Companies in this district', th: 'บริษัทในพื้นที่เดียวกัน', zh: '同区企业' },
    networkSub: { en: '3-degree network (shared directors)', th: 'เครือข่าย 3 ระดับ (กรรมการร่วม)', zh: '三度关联网络(共享董事)' },
    networkBuilding: { en: 'Building the network…', th: 'กำลังสร้างเครือข่าย…', zh: '正在构建关联网络…' },
    networkEmpty: { en: 'No companies sharing directors were found.', th: 'ไม่พบบริษัทที่มีกรรมการร่วม', zh: '暂未发现与本公司共享董事的关联企业。' },
    netSubject: { en: 'Subject', th: 'บริษัทนี้', zh: '本公司' },
    networkShowList: { en: 'Show direct relations ({n})', th: 'ดูรายการ ({n})', zh: '展开直接关联列表({n} 家)' },
    networkCollapse: { en: 'Collapse list', th: 'ย่อรายการ', zh: '收起关联列表' },
    networkShowingOf: { en: 'Showing {a} of {b}.', th: 'แสดง {a} จาก {b}', zh: '仅显示前 {a} 家,共 {b} 家。' },
    networkHint: { en: 'Scroll to zoom · drag to pan · hover for shared directors · click to open', th: 'เลื่อนซูม · ลากเลื่อน · วางเมาส์ · คลิกเปิด', zh: '滚轮缩放 · 拖动平移 · 悬浮看共同董事 · 点击进入公司' },
    sharedDirectorsLabel: { en: 'Shared directors', th: 'กรรมการร่วม', zh: '共同董事' },
    relCompany: { en: 'Company', th: 'บริษัท', zh: '关联企业' },
    relCommon: { en: 'Common directors', th: 'กรรมการที่ร่วมกัน', zh: '共同董事' },
    provinceShort: { en: 'Province', th: 'จังหวัด', zh: '府' },
    networkTab: { en: 'Related Companies', th: 'บริษัทที่เกี่ยวข้อง', zh: '关联企业' },
    totalLiabilities: { en: 'Total liabilities', th: 'รวมหนี้สิน', zh: '总负债' },
    claimModalTitle: { en: 'Claim this company', th: 'อ้างสิทธิ์บริษัทนี้', zh: '认领该公司' },
    claimModalSub: { en: 'Fill in your details to claim {name}. Our team will review your request.', th: 'กรอกข้อมูลเพื่ออ้างสิทธิ์ {name} ทีมงานจะตรวจสอบคำขอของคุณ', zh: '填写资料以认领 {name},提交后由管理员审核。' },
    claimFieldContact: { en: 'Contact name', th: 'ชื่อผู้ติดต่อ', zh: '联系人姓名' },
    claimFieldRole: { en: 'Role / relationship to company', th: 'ตำแหน่ง / ความเกี่ยวข้องกับบริษัท', zh: '职位 / 与公司关系' },
    claimFieldPhone: { en: 'Phone', th: 'โทรศัพท์', zh: '联系电话' },
    claimFieldEmail: { en: 'Email', th: 'อีเมล', zh: '联系邮箱' },
    claimFieldReason: { en: 'Reason for claim', th: 'เหตุผลในการอ้างสิทธิ์', zh: '认领理由' },
    claimReasonHint: { en: 'Explain your relationship to this company and the basis for your claim.', th: 'อธิบายความเกี่ยวข้องของคุณกับบริษัทนี้และเหตุผลในการอ้างสิทธิ์', zh: '说明你与该公司的关系及认领依据。' },
    claimReasonRequired: { en: 'Please enter a reason for your claim.', th: 'โปรดระบุเหตุผลในการอ้างสิทธิ์', zh: '请填写认领理由。' },
    claimCancel: { en: 'Cancel', th: 'ยกเลิก', zh: '取消' },
    claimSubmit: { en: 'Submit claim', th: 'ส่งคำขอ', zh: '提交认领' },
    claimSubmitting: { en: 'Submitting…', th: 'กำลังส่ง…', zh: '提交中…' },
    verifiedBadge: { en: 'Verified', th: 'ยืนยันแล้ว', zh: '已认证' },
    signIn: { en: 'Sign in', th: 'เข้าสู่ระบบ', zh: '登录' },
    contactGate: { en: 'Sign in to view full contact details', th: 'เข้าสู่ระบบเพื่อดูข้อมูลติดต่อ', zh: '登录后查看完整联系方式' },
    financialGate: { en: 'Sign in to view full financial data', th: 'เข้าสู่ระบบเพื่อดูข้อมูลทางการเงิน', zh: '登录后查看完整财务数据' },
    networkGate: { en: 'Sign in to explore the corporate network', th: 'เข้าสู่ระบบเพื่อดูเครือข่ายบริษัท', zh: '登录后探索企业关联网络' },
    directorsGate: { en: 'Sign in to view registered director details', th: 'เข้าสู่ระบบเพื่อดูรายละเอียดกรรมการที่จดทะเบียน', zh: '登录后查看登记董事详情' },
    ownerHiddenNotice: { en: 'The business owner has claimed this listing and chosen to mask shareholder/director names.', th: 'เจ้าของธุรกิจได้ยืนยันการเป็นเจ้าของรายชื่อนี้และเลือกปิดบังชื่อผู้ถือหุ้น/กรรมการบางส่วน', zh: '企业主已认领公司并将股东/董事姓名做打码处理。' },
    ownerPublicNotice: { en: 'The business owner has claimed this listing and chosen to display this information publicly.', th: 'เจ้าของธุรกิจได้ยืนยันการเป็นเจ้าของรายชื่อนี้และเลือกแสดงข้อมูลนี้ต่อสาธารณะ', zh: '企业主已认领公司并选择对外公开展示。' },
    // ── 财务数据 tab 重排(2026-07-05):资产负债表/损益表/财务比率从原始表格改成结构图+卡片 ──
    financeAssetSide: { en: 'Assets', th: 'สินทรัพย์', zh: '资产去向' },
    financeFundingSide: { en: 'Financing', th: 'แหล่งเงินทุน', zh: '资金来源' },
    financeOtherCurrent: { en: 'Other current assets', th: 'สินทรัพย์หมุนเวียนอื่น', zh: '其他流动资产' },
    financeOtherNonCurrent: { en: 'Other non-current assets', th: 'สินทรัพย์ไม่หมุนเวียนอื่น', zh: '其他非流动资产' },
    financeAssetDetail: { en: 'Asset detail', th: 'รายละเอียดสินทรัพย์', zh: '资产明细' },
    financeLiabEquityDetail: { en: 'Liabilities & equity detail', th: 'รายละเอียดหนี้สินและส่วนของผู้ถือหุ้น', zh: '负债与权益明细' },
    financeIncomeDetail: { en: 'Revenue & expense detail', th: 'รายละเอียดรายได้และค่าใช้จ่าย', zh: '收入与费用明细' },
    financeExpenseMix: { en: 'Cost structure', th: 'โครงสร้างต้นทุน', zh: '成本构成' },
    financeExpOther: { en: 'Tax & other', th: 'ภาษีและอื่นๆ', zh: '税项+其他' },
    financeProfitability: { en: 'Profitability', th: 'ความสามารถในการทำกำไร', zh: '盈利能力' },
    financeEfficiency: { en: 'Operating efficiency', th: 'ประสิทธิภาพการดำเนินงาน', zh: '运营效率' },
    financeEpsUnit: { en: 'THB / share', th: 'บาท/หุ้น', zh: '泰铢/股' },
    financeXrefNote: { en: 'Current ratio, debt/asset and debt/equity are shown above under Balance Sheet health.', th: 'อัตราส่วนสภาพคล่อง หนี้สินต่อสินทรัพย์ และหนี้สินต่อทุน แสดงไว้ด้านบนในส่วนสุขภาพงบดุลแล้ว', zh: '流动比率/资产负债比/产权比率见上方「资产负债表」健康度体检' },
    financeInvTurnoverCap: { en: '~{d} days per cycle', th: 'ประมาณ {d} วัน/รอบ', zh: '约 {d} 天/轮' },
    financeRecvTurnoverCap: { en: '~{d} days to collect', th: 'เก็บหนี้เฉลี่ย {d} วัน', zh: '约 {d} 天回款' },
    financeAssetTurnoverCap: { en: '฿{v} revenue per ฿1 of assets', th: 'รายได้ {v} บาทต่อสินทรัพย์ 1 บาท', zh: '每 ฿1 资产带来 ฿{v} 营收' },
    financeTimesPerYear: { en: 'x/yr', th: 'ครั้ง/ปี', zh: '次/年' }
  };
  function t(key) { var e = LABELS[key]; return e ? (e[LANG] || e.en) : key; }
  function tt(key, vars) {
    var s = t(key);
    for (var k in vars) { if (vars.hasOwnProperty(k)) s = s.split('{' + k + '}').join(vars[k]); }
    return s;
  }
  // 认领会员编辑提示的轻量"月日 时:分"格式,和 resolver ssrEditNoteDate 同一套逻辑(镜像实现,
  // 不是同一份代码——项目里 SSR/客户端历来独立各写一份)。直接从原始时间戳字符串正则取数字,
  // 不用 Date 对象,避免浏览器本地时区和数据库 +07 时区不一致时被悄悄转换。
  var EDIT_NOTE_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function editNoteDate(raw) {
    var m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return '';
    var month = parseInt(m[2], 10), day = parseInt(m[3], 10), hh = m[4], mm = m[5];
    var monEn = EDIT_NOTE_MONTHS_EN[month - 1] || '';
    if (LANG === 'zh') return month + '月' + day + '日 ' + hh + ':' + mm;
    if (LANG === 'th') return day + ' ' + monEn + ' ' + hh + ':' + mm;
    return monEn + ' ' + day + ', ' + hh + ':' + mm;
  }
  function ownerEditNoteHtml(rawEditedAt) {
    if (!rawEditedAt) return '';
    var d = editNoteDate(rawEditedAt);
    return d ? '<p class="biz-detail-editnote">' + escapeHtml(tt('ownerEditNote', { date: d })) + '</p>' : '';
  }

  /* ---- DOM 辅助 ---- */
  function q(sel) { return root.querySelector(sel); }
  function setText(sel, val) { var el = root.querySelector(sel); if (el) el.textContent = val; }
  function panel(name) { return root.querySelector('[data-panel="' + name + '"]'); }

  /* ---- 财务表行定义 ---- */
  var BALANCE_ROWS = [
    { f: 'traderreceivables', l: { th: 'ลูกหนี้การค้าสุทธิ', en: 'Trade receivables', zh: '应收账款净额' } },
    { f: 'inventories', l: { th: 'สินค้าคงเหลือ', en: 'Inventories', zh: '存货' } },
    { f: 'cashandcashequivalents', l: { th: 'เงินสดและรายการเทียบเท่า', en: 'Cash & equivalents', zh: '现金及等价物' } },
    { f: 'currentassets', l: { th: 'สินทรัพย์หมุนเวียน', en: 'Current assets', zh: '流动资产' } },
    { f: 'propertyplantandequipment', l: { th: 'ที่ดิน อาคารและอุปกรณ์', en: 'Property, plant & equipment', zh: '固定资产' } },
    { f: 'noncurrentassets', l: { th: 'สินทรัพย์ไม่หมุนเวียน', en: 'Non-current assets', zh: '非流动资产' } },
    { f: 'assets', l: { th: 'รวมสินทรัพย์', en: 'Total assets', zh: '总资产' }, strong: true },
    { f: 'currentliabilities', l: { th: 'หนี้สินหมุนเวียน', en: 'Current liabilities', zh: '流动负债' } },
    { f: 'noncurrentliabilities', l: { th: 'หนี้สินไม่หมุนเวียน', en: 'Non-current liabilities', zh: '非流动负债' } },
    { f: 'liabilities', l: { th: 'รวมหนี้สิน', en: 'Total liabilities', zh: '总负债' }, strong: true },
    { f: 'equity', l: { th: 'ส่วนของผู้ถือหุ้น', en: 'Total equity', zh: '股东权益' }, strong: true },
    { f: 'liabilitiesandequity', l: { th: 'รวมหนี้สินและส่วนของผู้ถือหุ้น', en: 'Total liabilities & equity', zh: '负债及权益合计' }, strong: true }
  ];
  var INCOME_ROWS = [
    { f: 'revenue', l: { th: 'รายได้รวม', en: 'Total revenue', zh: '总收入' }, strong: true },
    { f: 'revfromsaleorrevfromservice', l: { th: 'รายได้จากการขายหรือบริการ', en: 'Revenue from sales/services', zh: '销售/服务收入' } },
    { f: 'costsofsaleofgoodorservice', l: { th: 'ต้นทุนขายหรือบริการ', en: 'Cost of sales/services', zh: '销售/服务成本' } },
    { f: 'grossprofit', l: { th: 'กำไรขั้นต้น', en: 'Gross profit', zh: '毛利润' } },
    { f: 'sellingandserviceexpense', l: { th: 'ค่าใช้จ่ายในการขายและบริการ', en: 'Selling & service expense', zh: '销售费用' } },
    { f: 'administrativeexpense', l: { th: 'ค่าใช้จ่ายในการบริหาร', en: 'Administrative expense', zh: '管理费用' } },
    { f: 'expenses', l: { th: 'ค่าใช้จ่ายรวม', en: 'Total expenses', zh: '总费用' } },
    { f: 'otherincomes', l: { th: 'รายได้อื่น', en: 'Other income', zh: '其他收入' } },
    { f: 'interestexpense', l: { th: 'ดอกเบี้ยจ่าย', en: 'Interest expense', zh: '利息支出' } },
    { f: 'plbeforeincometaxexpense', l: { th: 'กำไรก่อนภาษี', en: 'Profit before tax', zh: '税前利润' } },
    { f: 'taxexpenseincome', l: { th: 'ค่าใช้จ่ายภาษีเงินได้', en: 'Income tax expense', zh: '所得税费用' } },
    { f: 'profitloss', l: { th: 'กำไร(ขาดทุน)สุทธิ', en: 'Net profit (loss)', zh: '净利润(亏损)' }, strong: true }
  ];
  var RATIO_ROWS = [
    { f: 'currentRatio', l: { th: 'อัตราส่วนสภาพคล่อง', en: 'Current ratio', zh: '流动比率' } },
    { f: 'debtToAsset', l: { th: 'หนี้สินต่อสินทรัพย์', en: 'Debt to asset', zh: '资产负债比' } },
    { f: 'debtToEquity', l: { th: 'หนี้สินต่อทุน', en: 'Debt to equity', zh: '产权比率' } },
    { f: 'grossProfitMargin', l: { th: 'อัตรากำไรขั้นต้น %', en: 'Gross profit margin %', zh: '毛利率 %' }, pct: true },
    { f: 'netProfitMargin', l: { th: 'อัตรากำไรสุทธิ %', en: 'Net profit margin %', zh: '净利率 %' }, pct: true },
    { f: 'operatingProfitMargin', l: { th: 'อัตรากำไรจากการดำเนินงาน %', en: 'Operating margin %', zh: '营业利润率 %' }, pct: true },
    { f: 'returnOnAsset', l: { th: 'ผลตอบแทนต่อสินทรัพย์ %', en: 'Return on assets %', zh: '资产回报率 %' }, pct: true },
    { f: 'returnOnEquity', l: { th: 'ผลตอบแทนต่อส่วนผู้ถือหุ้น %', en: 'Return on equity %', zh: '净资产回报率 %' }, pct: true },
    { f: 'inventoryTurnover', l: { th: 'อัตราหมุนเวียนสินค้า', en: 'Inventory turnover', zh: '存货周转率' } },
    { f: 'accountReceivableTurnover', l: { th: 'อัตราหมุนเวียนลูกหนี้', en: 'Receivable turnover', zh: '应收周转率' } },
    { f: 'totalAssetTurnover', l: { th: 'อัตราหมุนเวียนสินทรัพย์', en: 'Asset turnover', zh: '资产周转率' } },
    { f: 'earningPerShare', l: { th: 'กำไรต่อหุ้น', en: 'Earnings per share', zh: '每股收益' } }
  ];

  /* ---- 当前公司字段(三语,优先 i18n 块,兜底扁平字段)---- */
  var meta = {}, raw = {};
  var entryId = '', entrySlug = '';   // 认领用:数字 entry id + slug(=jpNo)
  var entryUpdatedAt = '';   // cms_content_entries.updated_at:真实同步时间,「数据更新」徽标专用,不用 meta.updatedate(DBD 自己的登记日期)
  function fName() { return i18nText(meta, 'name') || langText(metaValue(meta, 'jpname', 'jpName'), metaValue(meta, 'jpnamee', 'jpNameE'), meta.jpnamezh); }
  // DBD 法人经营状态是有限枚举(jpstatcode 决定)。数据里 i18n.zh.status/statuszh 被三语翻译管线
  // 跳过、系统性填成了泰文原文(全库采样约 58% 的 zh.status==th.status),不可信任。故经营状态一律
  // 用 jpstatcode → 固定三语映射,不再走每条数据的 i18n/statuszh 字段。code 用大写(含 A/B/D 字母码)。
  var STATUS_BY_CODE = {
    '1': { en: 'Operating',                th: 'ยังดำเนินกิจการอยู่',   zh: '正常经营' },
    '2': { en: 'Absolute Receivership',    th: 'พิทักษ์ทรัพย์เด็ดขาด',  zh: '绝对财产接管' },
    '3': { en: 'Transformation',           th: 'แปรสภาพ',              zh: '已改制' },
    '4': { en: 'Dissolution',              th: 'เลิก',                 zh: '已解散' },
    '5': { en: 'Liquidation Completion',   th: 'เสร็จการชำระบัญชี',     zh: '清算完结' },
    '6': { en: 'Amalgamation',             th: 'ควบ',                  zh: '已合并' },
    '8': { en: 'Defunct',                  th: 'ร้าง',                 zh: '已除名' },
    '9': { en: 'Bankrupt',                 th: 'ล้มละลาย',             zh: '破产' },
    'A': { en: 'Rehabilitation',           th: 'ฟื้นฟู',                zh: '企业重整' },
    'B': { en: 'Restored to the Register', th: 'คืนสู่ทะเบียน',         zh: '恢复登记' },
    'D': { en: 'Cease to exist',           th: 'สิ้นสภาพ',              zh: '终止存续' }
  };
  function fStatus() {
    var code = text(metaValue(meta, 'jpstatcode', 'jpStatCode')).trim().toUpperCase();
    if (STATUS_BY_CODE[code]) return STATUS_BY_CODE[code];
    // 无法识别的状态码:退回原有逻辑(英文优先,避免中文位显示泰文)。
    return i18nText(meta, 'status') || langText(meta.status || meta.jpstatdesc, metaValue(meta, 'jpstatdesce', 'jpStatDescE'), meta.statuszh); }
  function fProvince() { return i18nText(meta, 'province') || langText(meta.province, metaValue(meta, 'provincee', 'provinceE'), meta.provincezh); }
  function fDistrict() { return i18nText(meta, 'district') || langText(meta.ampurdesc, meta.ampurdesce, meta.ampurdesczh); }
  function fSubdistrict() { return i18nText(meta, 'subdistrict') || langText(meta.tumbondesc, meta.tumbondesce, meta.tumbondesczh); }
  function fAddress() { return i18nText(meta, 'address') || langText(meta.address, meta.addresse || meta.address, meta.addresszh); }
  function fCompanyType() { return i18nText(meta, 'companyType') || langText(meta.jptypedesc, meta.companytypee || meta.jptypedesce, meta.companytypezh); }
  function fIndustry() { return i18nText(meta, 'industryGroup') || langText(meta.setupobjgrpdesc, meta.setupobjgrpdesce, meta.setupobjgrpdesczh); }
  function fBizCategory() { return langText(meta.businesstypedesc, meta.businesstypedesce, meta.businesstypedesczh); }
  function fObjective() {
    var oth = text(meta.objective_th), oen = text(meta.objective_en), ozh = text(meta.objective_zh);
    if (oth || oen || ozh) return langText(oth, oen, ozh);
    return i18nText(meta, 'objective') || langText(firstValue(meta, ['setupobjdesc', 'submitobjdesc', 'setupobjnamekeyin']), firstValue(meta, ['setupobjdesce', 'submitobjdesce']), firstValue(meta, ['setupobjdesczh', 'submitobjdesczh']));
  }
  function fObjectiveDetail() { return langText(firstValue(meta, ['setupobjnamekeyin', 'submitobjnamekeyin']), firstValue(meta, ['setupobjnamekeyine', 'submitobjnamekeyine']), firstValue(meta, ['setupobjnamekeyinzh', 'submitobjnamekeyinzh'])); }
  function capWithUnit(v) { if (v === null || v === undefined || v === '') return ''; var n = Number(v); if (!isFinite(n)) return ''; return fmtNum(n, 0) + ' ' + t('currencyUnit'); }

  /* ---- 强化字段:企业规模 / 成立年限 / 名称首字母 / 紧凑金额 ---- */
  var SIZE_LABELS = { S: 'sizeSmall', M: 'sizeMedium', L: 'sizeLarge' };
  function fSizeKey() { var c = text(metaValue(meta, 'businesssizecode', 'businessSizeCode')).trim().toUpperCase(); return SIZE_LABELS[c] || ''; }
  function ageYears() { var a = parseInt(text(metaValue(meta, 'jpage', 'jpAge')), 10); return (!isNaN(a) && a > 0) ? a : 0; }
  function establishedYear() { var m = text(meta.regdate).match(/^(\d{4})/); return m ? ceFromYear(m[1]) : null; }
  function monogramChar() {
    var nm = fName(), str = text(nm.en || nm.th).trim();
    var m = str.match(/[A-Za-z0-9\u0E00-\u0E7F\u4E00-\u9FFF]/);
    return m ? m[0].toUpperCase() : '·';
  }
  function moneyShort(v) {
    var n = Number(v);
    if (!isFinite(n)) return '-';
    var abs = Math.abs(n), sign = n < 0 ? '-' : '';
    var units = LANG === 'zh' ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
      : LANG === 'th' ? [[1e12, 'ล้านล้าน'], [1e9, 'พันล้าน'], [1e6, 'ล้าน']]
      : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i += 1) { if (abs >= units[i][0]) return sign + '฿' + fmtNum(abs / units[i][0], 2) + units[i][1]; }
    return sign + '฿' + fmtNum(abs, 0);
  }

  /* ---- CTA 行为:收藏 / 认领 / 下载 PDF —— 三者均需登录(收藏按用户 id 隔离)---- */
  function AUTH() { return window.__starterAuth; }
  function here() { return window.location.pathname + window.location.search; }
  var favSaved = false;
  function updateSaveBtn(btn) {
    if (!btn) return;
    btn.textContent = favSaved ? t('saved') : t('saveCompany');
    btn.classList.toggle('is-active', favSaved);
  }
  function hydrateSaved(btn) {
    var a = AUTH(); if (!a || !entryId) return;
    a.me().then(function (u) {
      if (!u) return;
      a.favCheck(entryId).then(function (res) { favSaved = !!(res.data && res.data.favorited); updateSaveBtn(btn); });
    });
  }
  function toggleSave(btn) {
    var a = AUTH(); if (!a) return;
    a.me().then(function (u) {
      if (!u) { a.requireLogin(here()); return; }
      if (!entryId) return;
      btn.disabled = true;
      (favSaved ? a.favRemove(entryId) : a.favAdd(entryId)).then(function (res) {
        btn.disabled = false;
        if (res.ok) { favSaved = !favSaved; updateSaveBtn(btn); }
      }).catch(function () { btn.disabled = false; });
    });
  }
  function doDownload(btn) {
    var a = AUTH(); if (!a) { window.print(); return; }
    a.me().then(function (u) {
      if (!u) { a.requireLogin(here()); return; }
      if (!btn || btn.disabled) return;
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = t('downloadGenerating');
      fetch('/api/site/v1/ai/company-report', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jpno: fetchKey, locale: LANG, url: window.location.origin + here() })
      })
        .then(function (r) { if (!r.ok) throw new Error('report_failed'); return r.blob(); })
        .then(function (bl) {
          var fname = text(metaValue(meta, 'jpnamee', 'jpNameE') || jpno || 'bizthai-report')
            .replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'bizthai-report';
          var objUrl = URL.createObjectURL(bl);
          var link = document.createElement('a');
          link.href = objUrl; link.download = fname + '.pdf';
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(function () { URL.revokeObjectURL(objUrl); }, 30000);
          btn.disabled = false; btn.textContent = original;
        })
        .catch(function () {
          btn.textContent = t('downloadFailed');
          setTimeout(function () { btn.disabled = false; btn.textContent = original; }, 2600);
        });
    });
  }
  function doClaim(btn) {
    var a = AUTH(); if (!a) return;
    a.me().then(function (u) {
      if (!u) { a.requireLogin(here() + (here().indexOf('?') >= 0 ? '&' : '?') + 'claim=' + encodeURIComponent(jpno)); return; }
      openClaimModal();
    });
  }

  /* ---- 认领申请表单(modal):收集资料 + 必填理由 → 组装进单一 note 提交 ---- */
  var claimModalEl = null;
  function companyDisplayName() { var h = q('[data-detail-name-en]'); var n = h ? text(h.textContent).trim() : ''; return n || text(jpno); }
  function claimField(name, label, type, max) {
    return '<label class="auth-field"><span class="auth-field__label">' + escapeHtml(label) + '</span>' +
      '<input type="' + type + '" name="' + name + '" maxlength="' + max + '" autocomplete="off"></label>';
  }
  function buildClaimModal() {
    if (claimModalEl) return claimModalEl;
    var el = document.createElement('div');
    el.className = 'claim-modal'; el.setAttribute('data-claim-modal', ''); el.hidden = true;
    var subHtml = escapeHtml(t('claimModalSub')).replace('{name}', '<strong>' + escapeHtml(companyDisplayName()) + '</strong>');
    el.innerHTML =
      '<div class="claim-modal__backdrop" data-claim-close></div>' +
      '<div class="claim-modal__card" role="dialog" aria-modal="true" aria-label="' + escapeHtml(t('claimModalTitle')) + '">' +
        '<button type="button" class="claim-modal__x" data-claim-close aria-label="' + escapeHtml(t('claimCancel')) + '">×</button>' +
        '<h2 class="claim-modal__title">' + escapeHtml(t('claimModalTitle')) + '</h2>' +
        '<p class="claim-modal__sub">' + subHtml + '</p>' +
        '<div class="auth-alert" data-claim-alert hidden></div>' +
        '<form class="auth-form claim-form" data-claim-form novalidate>' +
          claimField('contact', t('claimFieldContact'), 'text', 80) +
          claimField('role', t('claimFieldRole'), 'text', 80) +
          '<div class="claim-form__grid">' + claimField('phone', t('claimFieldPhone'), 'tel', 40) + claimField('email', t('claimFieldEmail'), 'email', 120) + '</div>' +
          '<label class="auth-field"><span class="auth-field__label">' + escapeHtml(t('claimFieldReason')) + ' <span class="claim-req">*</span></span>' +
            '<textarea name="reason" rows="4" maxlength="1000" required></textarea>' +
            '<span class="auth-field__hint">' + escapeHtml(t('claimReasonHint')) + '</span></label>' +
          '<div class="claim-form__actions">' +
            '<button type="button" class="claim-form__cancel" data-claim-close>' + escapeHtml(t('claimCancel')) + '</button>' +
            '<button type="submit" class="auth-submit" data-claim-submit>' + escapeHtml(t('claimSubmit')) + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-claim-close]')) closeClaimModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && claimModalEl && !claimModalEl.hidden) closeClaimModal(); });
    el.querySelector('[data-claim-form]').addEventListener('submit', function (e) { e.preventDefault(); submitClaimForm(this); });
    claimModalEl = el; return el;
  }
  function openClaimModal() {
    var el = buildClaimModal();
    var box = el.querySelector('[data-claim-alert]'); if (box) box.hidden = true;
    el.hidden = false; document.body.classList.add('claim-open');
    var ta = el.querySelector('textarea[name="reason"]'); if (ta) setTimeout(function () { ta.focus(); }, 30);
  }
  function closeClaimModal() { if (!claimModalEl) return; claimModalEl.hidden = true; document.body.classList.remove('claim-open'); }
  function claimAlert(type, msg) { var box = claimModalEl && claimModalEl.querySelector('[data-claim-alert]'); if (!box) return; box.className = 'auth-alert is-' + type; box.textContent = msg; box.hidden = false; }
  function submitClaimForm(form) {
    var a = AUTH(); if (!a) return;
    var reason = text(form.reason.value).trim();
    if (!reason) { claimAlert('error', t('claimReasonRequired')); form.reason.focus(); return; }
    var contact = text(form.contact.value).trim(), role = text(form.role.value).trim(), phone = text(form.phone.value).trim(), email = text(form.email.value).trim();
    var lines = ['Reason: ' + reason];
    if (contact) lines.push('Contact: ' + contact);
    if (role) lines.push('Relationship: ' + role);
    if (phone) lines.push('Phone: ' + phone);
    if (email) lines.push('Email: ' + email);
    var note = lines.join('\n');
    var btn = form.querySelector('[data-claim-submit]');
    if (btn) { btn.disabled = true; btn.dataset.orig = btn.textContent; btn.textContent = t('claimSubmitting'); }
    a.post('/claims', { model: 'thaicompany', slug: entrySlug || jpno, entry_id: entryId || undefined, note: note, evidence_json: { reason: reason, contact: contact, relationship: role, phone: phone, email: email } }).then(function (res) {
      if (res.ok) {
        closeClaimModal();
        var cb = q('[data-cta="claim"]');
        if (cb) { cb.textContent = t('claimSubmitted'); cb.classList.add('is-done'); cb.disabled = true; }
      } else {
        if (btn) { btn.disabled = false; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; }
        claimAlert('error', t('claimFailed'));
      }
    }).catch(function () {
      if (btn) { btn.disabled = false; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; }
      claimAlert('error', t('claimFailed'));
    });
  }
  function reflectClaim(btn) {
    if (!btn) return;
    var a = AUTH(); if (!a) return;
    a.me().then(function (u) {
      if (!u) return;
      a.getJSON('/claims/mine').then(function (res) {
        var items = (res.data && res.data.items) || [];
        for (var i = 0; i < items.length; i += 1) {
          if (String(items[i].entry_slug) === String(jpno) || (entryId && String(items[i].entry_id) === String(entryId))) {
            btn.textContent = items[i].status === 'approved' ? t('claimOwned') : t('claimPending');
            btn.classList.add('is-done'); btn.disabled = true; return;
          }
        }
      });
    });
  }

  /* ---- fetchKey 来源:/company/<slug> → /<jpNo>.html → 纯数字段 → canonical → /<英文名slug>.html ----
     扁平路由迁移后(ops/migrate_flat_company_routes.sql)resolver 已退役,不再有 data-detail-jpno/slug 的 SSR 注入;
     WooCMS entries API 原生认 cms_permalink_routes 里的英文名 slug,无数字也能直接按 slug 取数据,不必先反解出 jpNo。 */
  function jpNoFromLocation() {
    var rj = root && root.getAttribute('data-detail-jpno');   // 旧 resolver SSR 注入,现无来源,保留兼容
    if (rj && /^\d{6,}$/.test(rj)) return rj;
    var segs = window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    var idx = segs.lastIndexOf('company');
    if (idx >= 0 && segs[idx + 1]) return segs[idx + 1];
    for (var i = segs.length - 1; i >= 0; i -= 1) {
      if (/^\d{6,}$/.test(segs[i])) return segs[i];
      var hm = segs[i].match(/(\d{6,})\.html$/);   // /<...>-<jpNo>.html 或 /<jpNo>.html
      if (hm) return hm[1];
    }
    var c = document.querySelector('link[rel="canonical"]');
    if (c) { var mm = (c.getAttribute('href') || '').match(/\d{6,}/g); if (mm) return mm[mm.length - 1]; }
    for (var j = segs.length - 1; j >= 0; j -= 1) {   // 兜底:无数字的扁平英文名 slug(/{英文名slug}.html),文件名去掉 .html 就是 key
      var sm = segs[j].match(/^([a-z0-9-]+)\.html$/i);
      if (sm) return sm[1];
    }
    return '';
  }
  var jpno = jpNoFromLocation();
  var wantClaimOpen = /[?&]claimopen=1\b/.test(window.location.search);   // 注册认领流程跳回后自动弹表单

  /* ---- 渲染 ---- */
  /* ---- 行业大类→TSIC段归档 / 经营类型→TSIC细类归档(复用 /t/industry 列表);「同类企业」标签链接 ---- */
  function slugifyIndustry(v) { return text(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function tsicSection(code) {
    var d = parseInt(text(code).slice(0, 2), 10);
    if (!d) return '';
    var mp = [[1,3,'a'],[5,9,'b'],[10,33,'c'],[35,35,'d'],[36,39,'e'],[41,43,'f'],[45,47,'g'],[49,53,'h'],[55,56,'i'],[58,63,'j'],[64,66,'k'],[68,68,'l'],[69,75,'m'],[77,82,'n'],[85,85,'p'],[86,88,'q'],[90,93,'r'],[94,96,'s'],[97,99,'t']];
    for (var i = 0; i < mp.length; i += 1) { if (d >= mp[i][0] && d <= mp[i][1]) return mp[i][2]; }
    return '';   // 84→section O 无归档页
  }
  var TSIC_SECTION_LABELS = {
    a:['Agriculture, Forestry & Fishing','เกษตรกรรม การป่าไม้ และการประมง','农林牧渔'], b:['Mining & Quarrying','การทำเหมืองแร่และเหมืองหิน','采矿业'],
    c:['Manufacturing','การผลิต','制造业'], d:['Electricity & Gas Supply','ไฟฟ้า ก๊าซ ไอน้ำ และระบบปรับอากาศ','电力燃气供应'],
    e:['Water Supply & Waste Management','การจัดหาน้ำ การจัดการน้ำเสียและของเสีย','供水及废弃物管理'], f:['Construction','การก่อสร้าง','建筑业'],
    g:['Wholesale & Retail Trade','การขายส่งและการขายปลีก การซ่อมยานยนต์และจักรยานยนต์','批发与零售'], h:['Transportation & Storage','การขนส่งและสถานที่เก็บสินค้า','运输仓储'],
    i:['Accommodation & Food Service','ที่พักแรมและบริการด้านอาหาร','住宿与餐饮'], j:['Information & Communication','ข้อมูลข่าวสารและการสื่อสาร','信息与通信'],
    k:['Finance & Insurance','กิจกรรมทางการเงินและการประกันภัย','金融与保险'], l:['Real Estate','กิจกรรมด้านอสังหาริมทรัพย์','房地产'],
    m:['Professional, Scientific & Technical','กิจกรรมวิชาชีพ วิทยาศาสตร์ และกิจกรรมทางวิชาการ','专业科技服务'], n:['Administrative & Support Service','กิจกรรมการบริหารและบริการสนับสนุน','行政与支持服务'],
    p:['Education','การศึกษา','教育'], q:['Health & Social Work','กิจกรรมด้านสุขภาพและงานสังคมสงเคราะห์','卫生与社会工作'],
    r:['Arts, Entertainment & Recreation','ศิลปะ ความบันเทิงและนันทนาการ','文化娱乐'], s:['Other Service Activities','กิจกรรมการบริการด้านอื่น ๆ','其他服务业'],
    t:['Household Employment Activities','กิจกรรมการจ้างงานในครัวเรือน','家庭雇佣活动']
  };
  function tsicSectionLabel(sec) {
    var row = TSIC_SECTION_LABELS[sec];
    return row ? row[LANG === 'th' ? 1 : (LANG === 'zh' ? 2 : 0)] : '';
  }
  var TSIC_SECTION_ENGSLUG = {
    a: 'agriculture-forestry-fishing', b: 'mining-quarrying', c: 'manufacturing',
    d: 'electricity-gas-supply', e: 'water-supply-waste-management', f: 'construction',
    g: 'wholesale-retail-trade', h: 'transportation-storage', i: 'accommodation-food-service',
    j: 'information-communication', k: 'finance-insurance', l: 'real-estate',
    m: 'professional-scientific-technical', n: 'administrative-support-service', p: 'education',
    q: 'health-social-work', r: 'arts-entertainment-recreation', s: 'other-service-activities',
    t: 'household-employment-activities'
  };
  function industryUrl() {
    var sec = tsicSection(meta.setupobjcode || meta.submitobjcode);
    return sec ? '/industry-' + (TSIC_SECTION_ENGSLUG[sec] || ('tsic-' + sec)) + '.html' : '';
  }
  // 行业大类编号是本地从 setupobjcode 推算的 TSIC 分段字母,与 resolver SSR(server.js)同源同算法
  function industryWithCode() {
    var sec = tsicSection(meta.setupobjcode || meta.submitobjcode);
    // 代码区间是行业大类的权威来源；历史 industryGroup term 尚未刷新时可能是陈旧值。
    var name = tsicSectionLabel(sec) || pick(fIndustry());
    if (!name) return '';
    return sec ? (name + ' (TSIC-' + sec.toUpperCase() + ')') : name;
  }
  function subclassUrl() {
    var code = text(meta.setupobjcode || meta.submitobjcode), name = text(meta.setupobjdesce || meta.submitobjdesce);
    if (!/^\d{4,}$/.test(code) || !name) return '';
    return '/industry-' + slugifyIndustry(name) + '-' + code + '.html';
  }
  function subclassName() {
    return pick(langText(
      firstValue(meta, ['setupobjdesc', 'submitobjdesc']),
      firstValue(meta, ['setupobjdesce', 'submitobjdesce']),
      firstValue(meta, ['setupobjdesczh', 'submitobjdesczh'])
    ));
  }
  // 主营/简介用 TSIC 细类(大类下的行业类目),不是 section 大类
  function subclassWithCode() {
    var name = subclassName().replace(/[\s.,，。;；]+$/, '');
    var code = text(meta.setupobjcode || meta.submitobjcode);
    if (!name) return '';
    return /^\d{4,}$/.test(code) ? (name + ' (TSIC-' + code + ')') : name;
  }
  function provinceFlatUrl() {
    var pe = provinceEngSlug();
    return pe ? '/' + pe + '.html' : '';
  }
  function localePathPrefix() {
    return locale === 'zh-CN' ? '/zh' : (locale === 'th' ? '/th' : '');
  }
  function withLocalePath(path) {
    if (!path) return path;
    var p = localePathPrefix();
    if (!p) return path;
    if (path === '/') return p + '/';
    return p + path;
  }
  function setCrumbLink(key, label, href) {
    var el = q('[data-crumb="' + key + '"]');
    var sep = q('[data-crumb-sep="' + key + '"]');
    if (!el) return;
    if (!label) {
      el.hidden = true;
      if (sep) sep.hidden = true;
      return;
    }
    el.hidden = false;
    if (sep) sep.hidden = false;
    el.textContent = label;
    if (href) el.setAttribute('href', withLocalePath(href));
  }
  // 同区企业:链到区域排名页的「该区企业报告」 /business-regional-rankings-summary?province=<engslug>&district=<区slug>
  //  - province 用可读 engslug = slugify(英文府名)(与 analytics /regions engslug、resolver 区报告链接一致)
  //  - district 用区 term slug(<罗马音>-<ampurcode>);文字部分无法从 meta 重建,改用内嵌 STARTER_DISTRICTS 按 ampurcode 反查
  //  - 缺区数据时降级到府级(只带 province),仍是同一模板的府→区下钻页
  function provinceEngSlug() { return slugifyIndustry(text(metaValue(meta, 'provincee', 'provinceE'))); }
  function districtSlug() {
    if (typeof STARTER_DISTRICTS === 'undefined') return '';
    var code = text(meta.ampurcode).trim();
    return (code && STARTER_DISTRICTS[code]) || '';
  }
  function provincePeerUrl() {
    var pe = provinceEngSlug();
    if (!pe) return '';
    var ds = districtSlug();
    var url = '/business-regional-rankings-summary?province=' + encodeURIComponent(pe);
    if (ds) url += '&district=' + encodeURIComponent(ds);
    return url;
  }
  function peerChip(url, labelKey) { return url ? ' <a class="biz-detail-peertag" href="' + escapeHtml(url) + '">' + escapeHtml(t(labelKey || 'peerTag')) + '</a>' : ''; }
  function dlRowLink(label, value, url, chipKey) {
    value = text(value);
    if (!value || value === '-') return '';
    return '<div class="biz-detail-dl__row"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + peerChip(url, chipKey) + '</dd></div>';
  }

  // Hero 简介由登记资料与最新申报财务动态生成；字段缺失时自动省略对应分句。
  function naturalDate(rawDate) {
    var m = text(rawDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return text(rawDate);
    var ce = ceFromYear(m[1]);
    if (ce === null) return text(rawDate);
    var month = parseInt(m[2], 10), day = parseInt(m[3], 10);
    var monthsEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var monthsTh = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    if (LANG === 'zh') return ce + '年' + month + '月' + day + '日';
    if (LANG === 'th') return day + ' ' + monthsTh[month - 1] + ' ' + (ce + BE);
    return monthsEn[month - 1] + ' ' + day + ', ' + ce;
  }
  function latestFiledRevenue() {
    var fs = raw.financialStatements || {};
    var annual = fs.annualData || {};
    var years = (fs.years || Object.keys(annual)).slice().map(String).sort(function (a, b) {
      return (ceFromYear(b) || 0) - (ceFromYear(a) || 0);
    });
    for (var i = 0; i < years.length; i += 1) {
      var revenue = numOf(annual[years[i]], 'revenue');
      if (revenue !== null) return revenue;
    }
    var fallback = metaValue(meta, 'totalincome', 'totalIncome');
    return fallback !== undefined && fallback !== null && fallback !== '' && isFinite(Number(fallback)) ? Number(fallback) : null;
  }
  function companySummary() {
    var nm = fName();
    var name = text(nm.en || nm.th);
    var province = pick(fProvince());
    var companyType = pick(fCompanyType());
    var status = pick(fStatus());
    var regNo = text(meta.jpno);
    var regDate = naturalDate(meta.regdate);
    // 「主营」用细类(面包屑同级),缺细类时再退回大类
    var industry = (subclassWithCode() || industryWithCode()).replace(/[\s.,，。;；]+$/, '');
    var revenue = latestFiledRevenue();
    var revenueText = revenue === null ? '' : fmtNum(revenue, Number(revenue) % 1 === 0 ? 0 : 2);

    if (LANG === 'zh') {
      var identityZh = name + ' 是一家' + (province ? '在泰国' + province : '在泰国') + '登记' +
        (status ? '并' + status : '') + '的' + (companyType || '企业');
      if (regNo) identityZh += '，注册号为' + regNo;
      if (regDate) identityZh += '，成立于' + regDate;
      var summaryZh = identityZh + '。';
      if (industry || revenueText) {
        summaryZh += '该公司' + (industry ? '主营' + industry : '') +
          (industry && revenueText ? '，' : '') + (revenueText ? '最新申报年度营收为' + revenueText + '泰铢' : '') + '。';
      }
      return summaryZh;
    }
    if (LANG === 'th') {
      var identityTh = name + ' เป็น' + (companyType || 'นิติบุคคล') +
        (province ? 'ที่จดทะเบียนในจังหวัด' + province + ' ประเทศไทย' : 'ที่จดทะเบียนในประเทศไทย');
      if (status) identityTh += ' และมีสถานะ' + status;
      if (regNo) identityTh += ' เลขทะเบียน ' + regNo;
      if (regDate) identityTh += ' ก่อตั้งเมื่อวันที่ ' + regDate;
      var summaryTh = identityTh + ' ';
      if (industry) summaryTh += 'บริษัทประกอบธุรกิจหลักด้าน' + industry;
      if (revenueText) summaryTh += (industry ? ' โดย' : 'บริษัท') + 'มีรายได้ประจำปีที่ยื่นล่าสุด ' + revenueText + ' บาท';
      return summaryTh.trim() + '.';
    }
    var identityEn = name + ' is a ' + (companyType || 'business entity') +
      (province ? ' registered in ' + province + ', Thailand' : ' registered in Thailand');
    if (status) identityEn += ' and is currently ' + status.toLowerCase();
    if (regNo) identityEn += ', under registration number ' + regNo;
    if (regDate) identityEn += ', established on ' + regDate;
    var summaryEn = identityEn + '.';
    if (industry || revenueText) {
      summaryEn += ' The company' + (industry ? ' primarily engages in ' + industry : '') +
        (industry && revenueText ? ',' : '') + (revenueText ? ' with latest filed annual revenue of ' + revenueText + ' THB' : '') + '.';
    }
    return summaryEn;
  }

  function renderHero() {
    var nm = fName();
    // DBD 仅有泰/英两种公司名(无中文名):英文名为主标题、泰文名为副标题(不随界面语言变)
    var mainName = nm.en || nm.th;
    var alt = (nm.th && nm.th !== mainName) ? nm.th : '';
    setText('[data-detail-name-en]', mainName);
    var altEl = q('[data-detail-name-alt]');
    if (altEl) { if (alt) { altEl.textContent = alt; altEl.hidden = false; } else { altEl.hidden = true; } }
    var lead = companySummary() || pick(fObjective());
    if (lead) setText('[data-detail-lead]', lead);

    // 经营状态徽章:紧跟公司名后面
    var badges = '<span class="biz-detail-badge biz-company-status" data-company-status data-status-code="' + escapeHtml(text(meta.jpstatcode)) + '">' +
      '<i class="biz-detail-dot" aria-hidden="true"></i>' + escapeHtml(pick(fStatus()) || '-') + '</span>';
    q('[data-detail-badges]').innerHTML = badges;
    if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(q('[data-detail-badges]'));

    // 标题行最右:数据来源(上)+数据更新(下)
    var srcEl = q('[data-detail-source]');
    if (srcEl) srcEl.textContent = t('dataSource');
    var updEl = q('[data-detail-updated]');
    if (updEl) {
      var upd = dualDate(entryUpdatedAt || meta.updatedate);
      if (upd) {
        updEl.innerHTML = '<span class="biz-detail-updated__label">' + escapeHtml(t('lastUpdated')) + '</span>' +
          '<time class="biz-detail-updated__date">' + escapeHtml(upd) + '</time>';
        updEl.hidden = false;
      } else {
        updEl.hidden = true;
      }
    }

    // 关键事实(快速扫读身份信息)+ 公司地址(全宽,放在上面)
    // 地址整条保持原始语言,不混中文翻译:街道只有英文/泰文转写(DBD 无中文),若府县用中文译名会
    // 拼成"英文街道+中文府县"的混搭。故中文页地址取英文、泰文页取泰文,保证整条地址语言统一。
    function addrText(v) {
      if (!v) return '';
      if (locale === 'th') return text(v.th || v.en || v.zh);
      return text(v.en || v.th || v.zh);  // 英文页 & 中文页(按需求地址不翻中文)一律用英文原始地址
    }
    var region = [addrText(fSubdistrict()), addrText(fDistrict()), addrText(fProvince())].filter(Boolean).join(' · ');
    var fullAddr = [addrText(fAddress()), region, text(meta.zipcode)].filter(Boolean).join(', ');
    var facts = [
      [t('registrationNo'), text(meta.jpno)],
      [t('companyType'), pick(fCompanyType())],
      [t('industry'), industryWithCode(), false, industryUrl()],
      [t('address'), fullAddr, true]
    ];
    q('[data-detail-facts]').innerHTML = facts.map(function (f) {
      if (!text(f[1])) return '';
      return '<li' + (f[2] ? ' class="is-wide"' : '') + '><span>' + escapeHtml(f[0]) +
        '</span><strong>' + escapeHtml(f[1]) + peerChip(f[3]) + '</strong></li>';
    }).join('');

    // facts 右侧操作按钮组(三色,横向一行;功能已接)
    var ctaEl = q('[data-detail-cta]');
    if (ctaEl) {
      ctaEl.innerHTML =
        '<button type="button" class="biz-detail-cta__btn biz-detail-cta__btn--save" data-cta="save">' + escapeHtml(t('saveCompany')) + '</button>' +
        '<button type="button" class="biz-detail-cta__btn biz-detail-cta__btn--claim" data-cta="claim">' + escapeHtml(t('claimCompany')) + '</button>' +
        '<button type="button" class="biz-detail-cta__btn biz-detail-cta__btn--download" data-cta="download">' + escapeHtml(t('downloadProfile')) + '</button>';
      var saveBtn = ctaEl.querySelector('[data-cta="save"]');
      updateSaveBtn(saveBtn);
      hydrateSaved(saveBtn);
      reflectClaim(ctaEl.querySelector('[data-cta="claim"]'));
      ctaEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-cta]');
        if (!b) return;
        var act = b.getAttribute('data-cta');
        if (act === 'save') { toggleSave(saveBtn); }
        else if (act === 'download') { doDownload(b); }
        else if (act === 'claim') { doClaim(b); }
      });
      if (wantClaimOpen) { wantClaimOpen = false; var cb0 = ctaEl.querySelector('[data-cta="claim"]'); if (cb0 && !cb0.disabled) doClaim(cb0); }
    }

    setText('[data-crumb="home"]', t('home'));
    setText('[data-crumb="directory"]', t('directory'));
    var homeCrumb = q('[data-crumb="home"]');
    var dirCrumb = q('[data-crumb="directory"]');
    if (homeCrumb) homeCrumb.setAttribute('href', withLocalePath('/'));
    if (dirCrumb) dirCrumb.setAttribute('href', withLocalePath('/companies'));
    // 面包屑补行业类目(优先细类)与所属府(泰国行政单位是「府」,不是中国的「省」)
    var crumbIndName = subclassName() || tsicSectionLabel(tsicSection(meta.setupobjcode || meta.submitobjcode)) || pick(fIndustry());
    var crumbIndHref = subclassUrl() || industryUrl();
    setCrumbLink('industry', crumbIndName, crumbIndHref);
    setCrumbLink('province', pick(fProvince()), provinceFlatUrl());
    setText('[data-crumb="current"]', mainName);
    setText('[data-detail-more-title]', t('moreTitle'));
    setText('[data-detail-more-sub]', t('moreSub'));
    // SEO: 不覆盖 SSR 的 <title> / canonical。Google 明确要求 JS 不得把 canonical
    // 改成与原始 HTML 不同的 URL;此前这里会把 /zh|/th 页改成英文无前缀 URL 并缩短 title。
    // 仅在旧丑陋路径上做地址栏收敛,且保留语言前缀;只有这类收敛才同步 canonical。
    var urlEnName = text(metaValue(meta, 'jpnamee', 'jpNameE'));
    var pretty = window.__starterCompanyHref ? window.__starterCompanyHref(text(meta.jpno), urlEnName) : '';
    if (pretty) {
      var prettyLocalized = withLocalePath(pretty);
      var curPath = window.location.pathname.replace(/\/+$/, '');
      var prettyPath = prettyLocalized.split('?')[0];
      if (curPath !== prettyPath &&
          /(?:\/(?:zh|th))?\/(?:company\/\d{6,}|c\/thaicompany\/\d{6,}|\d{6,}\.html)$/.test(curPath)) {
        try { window.history.replaceState(null, '', prettyLocalized + window.location.search + window.location.hash); } catch (_) {}
        var canon = document.querySelector('link[rel="canonical"]');
        if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel', 'canonical'); document.head.appendChild(canon); }
        canon.setAttribute('href', window.location.origin + prettyLocalized);
      }
    }
  }

  function renderVerifiedBadge() {
    if (!jpno) return;
    fetch('/api/site/v1/companies/' + encodeURIComponent(jpno) + '/claim-status', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.claimed) return;
        var badgesEl = q('[data-detail-badges]');
        if (badgesEl) {
          var medal = document.createElement('span');
          medal.className = 'biz-verified-medal';
          medal.title = t('verifiedBadge');
          medal.setAttribute('aria-label', t('verifiedBadge'));
          medal.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30" fill="none" aria-hidden="true">' +
            '<path d="M8 0h8v12l-4 3-4-3V0z" fill="#B45309"/>' +
            '<path d="M8 0h4v12l-4-3V0z" fill="#92400E" opacity="0.5"/>' +
            '<rect x="8" y="0" width="8" height="2.5" rx="0.5" fill="#D97706"/>' +
            '<circle cx="12" cy="22" r="8" fill="#F59E0B"/>' +
            '<circle cx="12" cy="22" r="6.5" fill="#FDE68A"/>' +
            '<circle cx="12" cy="22" r="8" fill="none" stroke="#B45309" stroke-width="1.2"/>' +
            '<path d="M12 16.5l1.4 4.2h4.4l-3.5 2.6 1.3 4.2-3.6-2.6-3.6 2.6 1.3-4.2-3.5-2.6h4.4z" fill="#B45309"/>' +
            '</svg>';
          badgesEl.insertBefore(medal, badgesEl.firstChild);
        }
        var claimBtn = q('[data-cta="claim"]');
        if (claimBtn && !claimBtn.classList.contains('is-done')) {
          claimBtn.textContent = t('verifiedBadge');
          claimBtn.classList.add('is-verified');
          claimBtn.disabled = true;
        }
      })
      .catch(function () {});
  }

  function renderFinbar() {
    var el = q('[data-detail-finbar]');
    if (!el) return;
    // 对投资/尽调客户最有用的财务头条:营收 / 净利 / 总资产 / 权益(取 profile 内嵌财务摘要)
    var items = [
      { l: t('revenue'), v: metaValue(meta, 'totalincome', 'totalIncome') },
      { l: t('netProfit'), v: metaValue(meta, 'netprofit', 'netProfit'), profit: true },
      { l: t('totalAssets'), v: metaValue(meta, 'totalasset', 'totalAsset') },
      { l: t('equity'), v: metaValue(meta, 'totalequity', 'totalEquity') }
    ];
    var present = items.some(function (it) { var n = Number(it.v); return it.v != null && it.v !== '' && isFinite(n); });
    if (!present) { el.hidden = true; return; }
    var fy = dualYear(meta.finyear);
    var head = '<div class="biz-detail-finbar__head">' +
      '<span class="biz-detail-finbar__kicker">' + escapeHtml(t('latestFinancials')) + '</span>' +
      (fy ? '<span class="biz-detail-finbar__year">' + escapeHtml(t('finYearNote').replace('{y}', fy)) + '</span>' : '') + '</div>';
    var cards = items.map(function (it) {
      var n = Number(it.v), has = it.v != null && it.v !== '' && isFinite(n);
      var tone = (it.profit && has) ? (n >= 0 ? ' is-pos' : ' is-neg') : '';
      return '<div class="biz-detail-kpi' + tone + '">' +
        '<span class="biz-detail-kpi__label">' + escapeHtml(it.l) + '</span>' +
        '<strong>' + (has ? escapeHtml(moneyShort(n)) : '-') + '</strong></div>';
    }).join('');
    el.innerHTML = head + '<div class="biz-detail-finbar__grid">' + cards + '</div>';
    el.hidden = false;
  }

  // 「登记档案」与「财务报表」已合并为一个 tab(profile):基础信息在上,财务报表(3 卡趋势图)+
  // 市场地位排名在下(市场地位是本文件 renderFinancial() 客户端渲染的,不在 resolver SSR 里)。
  // 财务比率分析(8 组指标)2026-07-04 当天先合并进 profile,当天晚些时候又改回独立的「财务数据」tab
  // (finance)——3 卡趋势图/市场地位继续留在 profile,只有更深的比率分析单独成 tab。
  // changes(变更记录)tab 内容完全由 resolver SSR 注入 data-panel 空 div,本文件不重新渲染其内容
  // (不像 profile/business/directors/contact 那样有对应的 renderXxx() 覆盖逻辑),这里只负责生成
  // 对应的 tab 按钮,面板本身的 HTML 全程原样保留服务端拼好的内容。
  // finance(财务数据)tab 曾经也是这个模式,但 2026-07-05 重排后改成了 100% 客户端渲染——
  // 面板对应的 data-panel="finance" 空 div 由本文件的 renderFinancial() 客户端拼装内容,没有 SSR 参与。
  var TABS = [['profile', 'registryProfile'], ['finance', 'financialDataTab'], ['directors', 'directorsRecords'], ['changes', 'changeRecordsTab'], ['network', 'networkTab'], ['business', 'businessActivity'], ['contact', 'contact']];
  // 联系方式已公开(无需登录,绝不挂锁);董事/股东、关联网络仍需登录
  var GATED_TABS = { directors: 1, network: 1 };
  var LOCK_SVG = '<svg class="biz-detail-tab__lock" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 10h-1V7a5 5 0 0 0-10 0v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM9 7a3 3 0 0 1 6 0v3H9V7zm3 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>';
  function renderTabs() {
    var el = q('[data-detail-tabs]');
    el.innerHTML = TABS.map(function (tb) {
      var lock = (tb[0] !== 'contact' && GATED_TABS[tb[0]]) ? LOCK_SVG : '';
      return '<button type="button" class="biz-detail-tab" role="tab" data-tab="' + tb[0] + '">' + escapeHtml(t(tb[1])) + lock + '</button>';
    }).join('');
    var tabbar = q('[data-detail-tabbar]');
    if (tabbar) tabbar.hidden = false;
    var srcEl = q('[data-detail-source]');
    if (srcEl) srcEl.textContent = t('dataSource');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) showPanel(b.getAttribute('data-tab'));
    });
  }
  function clearTabLocks() {
    Array.prototype.forEach.call(root.querySelectorAll('.biz-detail-tab__lock'), function (icon) {
      icon.parentNode.removeChild(icon);
    });
  }
  function showPanel(name) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-panel]'), function (p) {
      p.hidden = p.getAttribute('data-panel') !== name;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name === 'finance' && finDraw) { var fd = finDraw; finDraw = null; fd(); }
    if (name === 'profile' && finSummaryDraw) { var fsd = finSummaryDraw; finSummaryDraw = null; fsd(); }
    if (name === 'directors' && dirDraw) { var dd = dirDraw; dirDraw = null; dd(); }
    if (name === 'network' && netFit) { var nf = netFit; netFit = null; setTimeout(nf, 0); }
  }
  var finDraw = null;
  var finSummaryDraw = null;
  var dirDraw = null;
  var netFit = null;

  function dlRow(label, value) {
    value = text(value);
    if (!value || value === '-') return '';
    return '<div class="biz-detail-dl__row"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
  }
  function card(title, inner, cls) {
    if (!inner || !inner.trim()) return '';
    return '<div class="biz-detail-card' + (cls ? ' ' + cls : '') + '"><h3>' + escapeHtml(title) + '</h3><dl class="biz-detail-dl">' + inner + '</dl></div>';
  }

  function renderBusiness() {
    var obj = pick(fObjective()), objDetail = pick(fObjectiveDetail());
    var html;
    if (obj || objDetail) {
      // 认领会员编辑提示:只有当前显示的这段文本确实来自 objective_zh/en/th 三者之一
      // (不是 setupobjdesc 等 DBD 原生兜底字段)才可能是会员改过的,面板自己的
      // data-business-edited-at 属性(resolver SSR 注入,已经核对过"改过且改的值还生效")才可信
      var objFromOwnerField = obj && (meta.objective_zh === obj || meta.objective_en === obj || meta.objective_th === obj);
      var editNote = objFromOwnerField ? ownerEditNoteHtml(panel('business').getAttribute('data-business-edited-at')) : '';
      // 编号取 setupobjcode 本身(经营业务的真实5位数字TSIC编号,与 resolver SSR 同源),
      // 只拼进渲染文本,不改 obj 本身,避免影响上面的认领会员编辑比对
      var objRawCode = text(meta.setupobjcode || meta.submitobjcode);
      var objCode = /^\d{4,}$/.test(objRawCode) ? objRawCode : '';
      html = '<div class="biz-detail-block biz-detail-block--lead"><h3>' + escapeHtml(t('businessActivity')) + '</h3>' +
        (obj ? '<p class="biz-detail-block__lead">' + escapeHtml(obj + (objCode ? ' (TSIC-' + objCode + ')' : '')) + '</p>' : '') +
        (objDetail && objDetail !== obj ? '<p>' + escapeHtml(objDetail) + '</p>' : '') + editNote + '</div>';
    } else {
      html = '<div class="biz-detail-empty">' + escapeHtml(t('businessEmpty')) + '</div>';
    }
    panel('business').innerHTML = html;
  }

  function renderContact() {
    // 2026-07-27:联系方式登录锁已打开——电话/邮箱/传真对访客公开。
    // 优先用 resolver 注入的 data-contact-* (含认领核验值),否则回退 DBD meta。
    var panelEl = panel('contact');
    var vPhone = panelEl.getAttribute('data-contact-phone') || text(meta.phoneno) || '';
    var vEmail = panelEl.getAttribute('data-contact-email') || text(meta.email) || '';
    var vFax = panelEl.getAttribute('data-contact-fax') || text(meta.faxno) || '';
    var contact = '';
    if (vPhone) contact += '<div class="biz-detail-dl__row"><dt>' + escapeHtml(t('phone')) + '</dt><dd>' + escapeHtml(vPhone) + '</dd></div>';
    if (vEmail) contact += '<div class="biz-detail-dl__row"><dt>' + escapeHtml(t('email')) + '</dt><dd><a href="mailto:' + escapeHtml(vEmail) + '">' + escapeHtml(vEmail) + '</a></dd></div>';
    ['website1', 'website2', 'website3', 'website4'].forEach(function (w) {
      var u = meta[w];
      if (u) {
        var href = /^https?:/i.test(u) ? u : ('http://' + u);
        contact += '<div class="biz-detail-dl__row"><dt>' + escapeHtml(t('website')) + '</dt><dd><a href="' + escapeHtml(href) + '" target="_blank" rel="noopener nofollow">' + escapeHtml(u) + '</a></dd></div>';
      }
    });
    if (vFax) contact += dlRow(t('fax'), vFax);
    var html = card(t('contact'), contact);
    if (html) html += ownerEditNoteHtml(panelEl.getAttribute('data-contact-edited-at'));
    if (!html) {
      var searchName = pick(fName()) || text(meta.jpno);
      var searchQuery = LANG === 'zh' ? searchName + '公司联系方式'
        : (LANG === 'th' ? searchName + ' ข้อมูลติดต่อบริษัท' : searchName + ' company contact information');
      var googleLang = LANG === 'zh' ? 'zh-CN' : LANG;
      var googleUrl = 'https://www.google.com/search?hl=' + encodeURIComponent(googleLang) + '&q=' + encodeURIComponent(searchQuery);
      html = '<div class="biz-detail-empty biz-contact-search">' +
        '<p class="biz-contact-search__empty">' + escapeHtml(t('contactEmpty')) + '</p>' +
        '<p class="biz-contact-search__hint">' + escapeHtml(t('contactSearchHint')) + '</p>' +
        '<a class="biz-contact-search__button" href="' + escapeHtml(googleUrl) + '" target="_blank" rel="noopener nofollow">' +
          escapeHtml(t('contactSearchButton')) +
        '</a></div>';
    }
    panelEl.innerHTML = html;
  }

  function renderProfile() {
    var nm = fName();
    // DBD 无中文公司名:zh 多为泰文回退,仅在确为独立中文名时才显示该行
    var zhName = (nm.zh && nm.zh !== nm.th && nm.zh !== nm.en) ? nm.zh : '';

    var html = '<div class="biz-detail-grid">';
    html += card(t('overview'),
      dlRow(t('nameTh'), nm.th) + dlRow(t('nameEn'), nm.en) + dlRow(t('nameZh'), zhName) +
      dlRow(t('status'), pick(fStatus())) +
      dlRow(t('companySize'), fSizeKey() ? t(fSizeKey()) : '') +
      dlRowLink(t('industry'), industryWithCode(), industryUrl()));
    // 登记明细(资本/股本/年份等技术性低频字段):保留但弱化展示
    // 注:"数据更新"已移到标题行最右展示,此处不再重复
    html += card(t('registrationDetails'),
      dlRow(t('registeredCapital'), capWithUnit(meta.capamt)) +
      dlRow(t('paidCapital'), capWithUnit(Number(meta.paidamt) < 0 ? meta.capamt : meta.paidamt)) +
      dlRow(t('shares'), meta.shareqty ? fmtNum(meta.shareqty) : '') +
      dlRow(t('regDate'), dualDate(meta.regdate)) +
      dlRow(t('financialYear'), dualYear(meta.finyear)), 'biz-detail-card--muted');
    var region = [pick(fSubdistrict()), pick(fDistrict()), pick(fProvince())].filter(Boolean).join(' · ');
    html += card(t('registeredAddress'),
      dlRow(t('address'), pick(fAddress())) + dlRowLink(t('region'), region, provincePeerUrl(), 'areaPeerTag') + dlRow(t('zipcode'), meta.zipcode));
    html += '</div>';
    // 营收/利润/资产趋势卡 + 市场地位排名:常驻登记档案 tab(不随「资产负债表/损益表/财务比率」搬去财务数据 tab)
    html += '<div class="biz-fin-summary" data-fin-summary></div>';
    panel('profile').innerHTML = html;
  }

  function numOf(rec, f) {
    var v = rec ? rec[f] : undefined;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v != null && v !== '' && isFinite(Number(v))) return Number(v);
    return null;
  }
  // DBD 数据每年都预置 143 个字段(占位年份也会有,靠 nullFlag 区分),不能用「有没有 key」判断这年
  // 是否真的有数据——必须检查具体字段是否为真实数字。跨三张表(资产负债/利润/比率)任一字段有值即算「这年有数据」。
  function yearHasData(y, annual) {
    var rec = annual[y];
    if (!rec) return false;
    return BALANCE_ROWS.some(function (r) { return numOf(rec, r.f) !== null; }) ||
      INCOME_ROWS.some(function (r) { return numOf(rec, r.f) !== null; }) ||
      RATIO_ROWS.some(function (r) { return numOf(rec, r.f) !== null; });
  }
  function yearsWithData(years, rows, annual) {
    return years.filter(function (y) {
      var rec = annual[y] || {};
      return rows.some(function (r) { return numOf(rec, r.f) !== null; });
    });
  }
  function buildFinTable(rows, years, annual, withPc) {
    var head = '<thead><tr><th>' + escapeHtml(t('metric')) + '</th>' +
      years.map(function (y) { return '<th>' + escapeHtml(dualYear(y)) + '</th>'; }).join('') + '</tr></thead>';
    var body = rows.map(function (row) {
      var cells = years.map(function (y) {
        var rec = annual[y] || {};
        var v = numOf(rec, row.f);
        if (v === null) return '<td><span class="biz-fin-na">-</span></td>';
        var val = fmtNum(v, 2);
        var pcHtml = '';
        if (withPc && !row.pct) {
          var pc = numOf(rec, row.f + 'Pc');
          if (pc !== null && pc !== 0) {
            var cls = pc > 0 ? 'is-up' : 'is-down';
            pcHtml = '<small class="biz-fin-pc ' + cls + '">' + (pc > 0 ? '+' : '') + fmtNum(pc, 2) + '%</small>';
          }
        }
        return '<td>' + escapeHtml(val) + pcHtml + '</td>';
      }).join('');
      return '<tr' + (row.strong ? ' class="is-strong"' : '') + '><th scope="row">' + escapeHtml(pick(row.l)) + '</th>' + cells + '</tr>';
    }).join('');
    return '<div class="biz-report-table-wrap"><table class="biz-report-table biz-fin-table">' + head + '<tbody>' + body + '</tbody></table></div>';
  }
  function finSection(title, rows, years, annual, withPc) {
    var ys = yearsWithData(years, rows, annual);
    if (!ys.length) return '';
    return '<div class="biz-detail-block"><h3>' + escapeHtml(title) + '</h3>' + buildFinTable(rows, ys, annual, withPc) + '</div>';
  }
  /* ===== 财务图表(Chart.js v4,按需懒加载;图表+表格并存)===== */
  function loadChart(cb) {
    if (window.Chart) { cb(); return; }
    if (window.__finChartCbs) { window.__finChartCbs.push(cb); return; }
    window.__finChartCbs = [cb];
    var sc = document.createElement('script');
    sc.src = '/theme-assets/starter/chart.umd.min.js';
    sc.onload = function () { var q = window.__finChartCbs || []; window.__finChartCbs = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
    sc.onerror = function () { window.__finChartCbs = null; };
    document.head.appendChild(sc);
  }
  function finVals(field, years, annual) { return years.map(function (y) { return numOf(annual[y] || {}, field); }); }
  function finLabels(years) { return years.map(function (y) { var ce = ceFromYear(y); return ce == null ? String(y) : String(LANG === 'th' ? ce + 543 : ce); }); }
  function finOpts(money) {
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14, color: '#6b6b76', font: { size: 12 } } },
        tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, displayColors: true, usePointStyle: true, callbacks: { label: function (c) { var v = c.parsed.y; return ' ' + c.dataset.label + ': ' + (v == null ? '-' : (money ? moneyShort(v) : fmtNum(v, 2))); } } }
      },
      scales: {
        x: { grid: { display: false }, border: { color: 'rgba(20,20,30,0.1)' }, ticks: { color: '#8a8594', font: { size: 11 } } },
        y: { grid: { color: 'rgba(20,20,30,0.06)' }, border: { display: false }, ticks: { color: '#8a8594', font: { size: 11 }, maxTicksLimit: 5, callback: function (v) { return money ? moneyShort(v) : v; } } }
      }
    };
  }
  function finBar(cv, labels, series, years, annual) {
    return new window.Chart(cv, { type: 'bar', data: { labels: labels, datasets: series.map(function (s) { return { label: s.label, data: finVals(s.field, years, annual), backgroundColor: s.color, maxBarThickness: 30 }; }) }, options: finOpts(true) });
  }
  function finLine(cv, labels, series, years, annual) {
    return new window.Chart(cv, { type: 'line', data: { labels: labels, datasets: series.map(function (s) { return { label: s.label, data: finVals(s.field, years, annual), borderColor: s.color, backgroundColor: s.color, borderWidth: 2, tension: 0.34, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: s.color, pointBorderWidth: 2, spanGaps: true }; }) }, options: finOpts(false) });
  }
  // 损益表 tab 的"增长趋势"折线图:总收入/销售成本/税项支出,多年对比(桑基图是单年切面,这个是趋势补充)
  function drawGrowthChart(cv, years, annual) {
    return new window.Chart(cv, {
      type: 'line',
      data: {
        labels: finLabels(years),
        datasets: [
          { label: t('revenue'), field: 'revenue', color: '#7901b2' },
          { label: t('cogs'), field: 'costsofsaleofgoodorservice', color: '#57535e' },
          { label: t('taxExpense'), field: 'taxexpenseincome', color: '#d97706' }
        ].map(function (s) { return { label: s.label, data: finVals(s.field, years, annual), borderColor: s.color, backgroundColor: s.color, borderWidth: 2, tension: 0.34, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: s.color, pointBorderWidth: 2, spanGaps: true }; })
      },
      options: finOpts(true)
    });
  }
  function drawOneChart(cv, key, years, annual) {
    var labels = finLabels(years);
    if (key === 'balance') finBar(cv, labels, [
      { label: t('totalAssets'), field: 'assets', color: '#7901b2' },
      { label: t('totalLiabilities'), field: 'liabilities', color: '#57535e' },
      { label: t('equity'), field: 'equity', color: '#11803f' }
    ], years, annual);
    else if (key === 'income') finBar(cv, labels, [
      { label: t('revenue'), field: 'revenue', color: '#7901b2' },
      { label: t('netProfit'), field: 'profitloss', color: '#11803f' }
    ], years, annual);
    else if (key === 'ratios') {
      var rowOf = function (f) { for (var i = 0; i < RATIO_ROWS.length; i += 1) if (RATIO_ROWS[i].f === f) return RATIO_ROWS[i]; return null; };
      var rs = [['grossProfitMargin', '#7901b2'], ['netProfitMargin', '#11803f'], ['operatingProfitMargin', '#57535e'], ['returnOnAsset', '#d97706'], ['returnOnEquity', '#0f6cbd']].map(function (x) { var row = rowOf(x[0]); return { label: row ? pick(row.l) : x[0], field: x[0], color: x[1] }; });
      finLine(cv, labels, rs, years, annual);
    }
  }
  function finSecChart(key, title, rows, years, annual, withPc) {
    var ys = yearsWithData(years, rows, annual);
    if (!ys.length) return '';
    return '<div class="biz-detail-block"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="biz-fin-chart"><canvas data-fin-chart="' + key + '"></canvas></div>' +
      buildFinTable(rows, ys, annual, withPc) + '</div>';
  }

  /* ===== 财务趋势卡(营收/利润(亏损)/资产,latest 年 + YoY + 多年趋势图)===== */
  function hexA(hex, a) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function finTrendChart(cv, field, label, years, annual, color) {
    var opts = finOpts(true);
    opts.plugins.legend.display = false;
    return new window.Chart(cv, {
      type: 'line',
      data: { labels: finLabels(years), datasets: [{ label: label, data: finVals(field, years, annual), borderColor: color, backgroundColor: hexA(color, 0.14), borderWidth: 2, tension: 0.34, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderColor: color, pointBorderWidth: 2, spanGaps: true, fill: true }] },
      options: opts
    });
  }
  var TREND_CARDS = [
    { field: 'revenue', labelKey: 'revenue' },
    { field: 'profitloss', labelKey: 'netProfitLoss' },
    { field: 'assets', labelKey: 'totalAssets' }
  ];
  function drawTrendCharts(container, years, annual) {
    loadChart(function () {
      if (!window.Chart) return;
      var vals = finVals('profitloss', years, annual), lastVal = null;
      for (var i = vals.length - 1; i >= 0; i -= 1) { if (vals[i] != null) { lastVal = vals[i]; break; } }
      var profitColor = (lastVal != null && lastVal < 0) ? '#c02638' : '#11803f';
      var colorOf = { revenue: '#7901b2', profitloss: profitColor, assets: '#7901b2' };
      TREND_CARDS.forEach(function (c) {
        var cv = container.querySelector('[data-fin-trend="' + c.field + '"]');
        if (!cv || cv.__drawn) return;
        cv.__drawn = true;
        finTrendChart(cv, c.field, t(c.labelKey), years, annual, colorOf[c.field]);
      });
    });
  }
  function renderTrendGrid(user, latest, chartYears, annual) {
    if (!latest) {
      return '<div class="biz-fin-trend-grid">' + TREND_CARDS.map(function (c) {
        return '<div class="biz-fin-trendcard is-empty"><div class="biz-fin-trendcard__head">' + escapeHtml(t(c.labelKey)) + '</div>' +
          '<p class="biz-fin-trendcard__empty">' + escapeHtml(t('finNoData')) + '</p></div>';
      }).join('') + '</div>';
    }
    var rec = annual[latest] || {};
    var ce = ceFromYear(latest);
    var yearLabel = ce == null ? String(latest) : String(LANG === 'th' ? ce + BE : ce);
    var nYears = chartYears.length;
    function headOf(c) { return escapeHtml(t('finCardHead').replace('{label}', t(c.labelKey)).replace('{y}', yearLabel).replace('{unit}', t('currencyUnit'))); }
    function cardHtml(c) {
      var v = numOf(rec, c.field);
      var pc = numOf(rec, c.field + 'Pc');
      var tone = (c.field === 'profitloss' && v !== null) ? (v >= 0 ? ' is-pos' : ' is-neg') : '';
      var yoyHtml = '';
      if (pc !== null && pc !== 0) {
        var ycls = pc > 0 ? 'is-up' : 'is-down';
        yoyHtml = '<div class="biz-fin-trendcard__yoy ' + ycls + '"><span class="biz-fin-trendcard__arrow">' + (pc > 0 ? '▲' : '▼') + '</span> ' + escapeHtml(t('yoy')) + ' ' + escapeHtml(fmtNum(Math.abs(pc), 2)) + '%</div>';
      }
      var chartHtml = nYears > 1 ? ('<p class="biz-fin-trendcard__chartcap">' + escapeHtml(t('finTrendCaption').replace('{label}', t(c.labelKey)).replace('{n}', String(nYears)).replace('{unit}', t('currencyUnit'))) + '</p>' +
        '<div class="biz-fin-chart biz-fin-chart--trend"><canvas data-fin-trend="' + c.field + '"></canvas></div>') : '';
      return '<div class="biz-fin-trendcard">' +
        '<div class="biz-fin-trendcard__head">' + headOf(c) + '</div>' +
        '<strong class="biz-fin-trendcard__value' + tone + '">' + (v === null ? '-' : escapeHtml(fmtNum(v, 0))) + '</strong>' +
        yoyHtml + chartHtml + '</div>';
    }
    // 财务数据全部公开,不再需要登录门禁(此前 finVeil 磨砂玻璃遮罩机制已移除)。
    var gridHtml = TREND_CARDS.map(function (c) { return cardHtml(c); }).join('');
    return '<div class="biz-fin-trend-grid">' + gridHtml + '</div>';
  }

  /* ===== 深度财务分析(利润流向桑基图+分步解读 / 风险红绿灯 / 市场排名):并入登记档案 tab,替换原三个 sub-tab 的简单图表 ===== */
  function pctOf(part, total) { if (part == null || total == null || total <= 0) return null; return (part / total * 100).toFixed(1); }
  function loadSankey(cb) {
    if (window.__sankeyReady) { cb(); return; }
    if (window.__sankeyCbs) { window.__sankeyCbs.push(cb); return; }
    window.__sankeyCbs = [cb];
    var sc = document.createElement('script');
    sc.src = '/theme-assets/starter/chartjs-chart-sankey.min.js';
    sc.onload = function () { window.__sankeyReady = true; var q = window.__sankeyCbs || []; window.__sankeyCbs = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
    sc.onerror = function () { window.__sankeyCbs = null; };
    document.head.appendChild(sc);
  }
  // 利润流向:9 节点桑基数据(主营/其他收入→总收入→销售成本/毛利→期间费用/EBIT→利息/所得税/净利润)
  function finFlowData(rec) {
    var sales = numOf(rec, 'revfromsaleorrevfromservice'), oth = numOf(rec, 'otherincomes'), total = numOf(rec, 'revenue');
    var cogs = numOf(rec, 'costsofsaleofgoodorservice'), gp = numOf(rec, 'grossprofit');
    var sell = numOf(rec, 'sellingandserviceexpense'), adm = numOf(rec, 'administrativeexpense'), exp = numOf(rec, 'expenses');
    var intr = numOf(rec, 'interestexpense'), pbt = numOf(rec, 'plbeforeincometaxexpense'), tax = numOf(rec, 'taxexpenseincome'), np = numOf(rec, 'profitloss');
    var ebit = (pbt != null) ? pbt + (intr || 0) : null;
    var opex = (sell != null || adm != null) ? (sell || 0) + (adm || 0) : ((exp != null && cogs != null && exp > cogs) ? exp - cogs : null);
    var flows = [];
    function pushFlow(from, to, v) { if (v != null && v > 0) flows.push({ from: from, to: to, flow: v }); }
    pushFlow('rev', 'total', sales);
    pushFlow('oth', 'total', oth);
    pushFlow('total', 'cogs', cogs);
    pushFlow('total', 'gp', gp != null ? gp : (total != null && cogs != null ? total - cogs : null));
    pushFlow('gp', 'opex', opex);
    pushFlow('gp', 'ebit', ebit);
    pushFlow('ebit', 'int', intr);
    pushFlow('ebit', 'tax', tax);
    pushFlow('ebit', 'np', np);
    var ndColors = { rev: '#9333ea', oth: '#b57edc', total: '#7901b2', cogs: '#d16666', gp: '#2f9e63', opex: '#d16666', ebit: '#11803f', int: '#c02638', tax: '#d97706', np: '#0a6b34' };
    var ndAmounts = { rev: sales, oth: oth, total: total, cogs: cogs, gp: gp, opex: opex, ebit: ebit, int: intr, tax: tax, np: np };
    var ndLabelKeys = { rev: 'ndRev', oth: 'ndOth', total: 'ndTotal', cogs: 'ndCogs', gp: 'ndGp', opex: 'ndOpex', ebit: 'ndEbit', int: 'ndInt', tax: 'ndTax', np: 'ndNp' };
    var ndLabels = {};
    Object.keys(ndColors).forEach(function (id) {
      var amt = ndAmounts[id];
      if (amt == null) return;
      var share = pctOf(Math.abs(amt), total);
      ndLabels[id] = t(ndLabelKeys[id]) + ' ' + moneyShort(amt) + (share != null ? ' · ' + share + '%' : '');
    });
    return { sales: sales, oth: oth, total: total, cogs: cogs, gp: gp, sell: sell, adm: adm, exp: exp, intr: intr, pbt: pbt, tax: tax, np: np, ebit: ebit, flows: flows, ndColors: ndColors, ndLabels: ndLabels };
  }
  // colorMode:'to' → 每条流按目的地节点着色(纯色,非渐变混色):成本/费用/利息类目的地是红色调,
  // 延续利润的目的地是绿色调,读起来像"红=支出、绿=留存利润",比渐变混色清晰很多
  function drawSankey(cv, fd) {
    loadSankey(function () {
      if (!window.Chart) return;
      if (cv.__chart) { try { cv.__chart.destroy(); } catch (e) {} cv.__chart = null; }
      try {
        cv.__chart = new window.Chart(cv, {
          type: 'sankey',
          data: { datasets: [{
            data: fd.flows, labels: fd.ndLabels,
            colorFrom: function (c) { return fd.ndColors[fd.flows[c.dataIndex].from] || '#7901b2'; },
            colorTo: function (c) { return fd.ndColors[fd.flows[c.dataIndex].to] || '#7901b2'; },
            colorMode: 'to', nodeWidth: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', color: '#18181b', font: { size: 12, weight: 700 }
          }] },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, displayColors: false, callbacks: { label: function (c) { var d = fd.flows[c.dataIndex]; return ' ' + (fd.ndLabels[d.from] || d.from) + ' → ' + (fd.ndLabels[d.to] || d.to); } } }
            }
          }
        });
      } catch (e) { if (cv.parentNode) cv.parentNode.style.display = 'none'; }
    });
  }
  // 分步解读:Step1~5 规则模板三语文案(金额包 .frp-v,登录门禁沿用整个 subpanel 的 is-gated)
  function finFlowSteps(fd, rec, yLbl) {
    function money(v) { return '<span class="frp-v">' + escapeHtml(fmtNum(v, 0)) + '</span>'; }
    function yoyBit(pc) { return (pc != null && pc !== 0) ? tt('stYoY', { sign: pc > 0 ? '+' : '-', pc: fmtNum(Math.abs(pc), 2) }) : null; }
    function joinBits(bits) {
      var kept = [];
      bits.forEach(function (b) { if (b) kept.push(b); });
      var sep = LANG === 'zh' ? ',' : LANG === 'th' ? ' · ' : '; ';
      var end = LANG === 'zh' ? '。' : '.';
      return kept.join(sep) + end;
    }
    var steps = [];
    if (fd.total != null) {
      steps.push([t('st1Title'), joinBits([
        tt('st1A', { y: yLbl, total: money(fd.total) }),
        fd.sales != null ? tt('st1B', { sales: money(fd.sales), p: pctOf(fd.sales, fd.total) || '-' }) : null,
        (fd.oth != null && fd.oth > 0) ? tt('st1C', { oth: money(fd.oth), p: pctOf(fd.oth, fd.total) || '-' }) : null,
        yoyBit(numOf(rec, 'revenuePc'))
      ])]);
    }
    if (fd.cogs != null || fd.gp != null) {
      steps.push([t('st2Title'), joinBits([
        fd.cogs != null ? tt('st2A', { cogs: money(fd.cogs), p: pctOf(fd.cogs, fd.total) || '-' }) : null,
        fd.gp != null ? tt('st2B', { gp: money(fd.gp), gm: numOf(rec, 'grossProfitMargin') != null ? fmtNum(rec.grossProfitMargin, 2) : (pctOf(fd.gp, fd.total) || '-') }) : null
      ])]);
    }
    if (fd.exp != null || fd.ebit != null) {
      steps.push([t('st3Title'), joinBits([
        fd.exp != null ? tt('st3A', { exp: money(fd.exp) }) : null,
        (fd.sell != null && fd.sell > 0) ? tt('st3B', { sell: money(fd.sell) }) : null,
        (fd.adm != null && fd.adm > 0) ? tt('st3C', { adm: money(fd.adm) }) : null,
        fd.ebit != null ? tt('st3D', { ebit: money(fd.ebit) }) : null
      ])]);
    }
    var cov = (fd.intr != null && fd.intr > 0 && fd.ebit != null) ? fd.ebit / fd.intr : null;
    if ((fd.intr != null && fd.intr > 0) || (fd.tax != null && fd.tax > 0)) {
      steps.push([t('st4Title'), joinBits([
        (fd.intr != null && fd.intr > 0) ? tt('st4A', { int: money(fd.intr), cov: cov != null ? fmtNum(cov, 2) : '-' }) : null,
        (fd.tax != null && fd.tax > 0) ? tt('st4B', { tax: money(fd.tax) }) : null
      ])]);
    }
    if (fd.np != null) {
      steps.push([t('st5Title'), joinBits([
        fd.np >= 0 ? tt('st5Profit', { np: money(fd.np), nm: numOf(rec, 'netProfitMargin') != null ? fmtNum(rec.netProfitMargin, 2) : (pctOf(fd.np, fd.total) || '-') })
          : tt('st5Loss', { np: money(Math.abs(fd.np)) }),
        yoyBit(numOf(rec, 'profitlossPc'))
      ])]);
    }
    return '<ol class="biz-frp__steps">' + steps.map(function (s) { return '<li><strong>' + escapeHtml(s[0]) + '</strong><p>' + s[1] + '</p></li>'; }).join('') + '</ol>';
  }
  // 风险评估红绿灯:流动比率/资产负债率/产权比率/利息保障倍数,阈值判定 + 整体结论
  function finRiskCards(rec) {
    var cr = numOf(rec, 'currentRatio'), dta = numOf(rec, 'debtToAsset'), dte = numOf(rec, 'debtToEquity');
    var intr = numOf(rec, 'interestexpense'), pbt = numOf(rec, 'plbeforeincometaxexpense');
    var ebit = (pbt != null) ? pbt + (intr || 0) : null;
    var cov = (intr != null && intr > 0 && ebit != null) ? ebit / intr : null;
    function level3(v, goodMax, watchMax, invert) {
      if (v == null) return 'na';
      if (!invert) return v < goodMax ? 'good' : (v <= watchMax ? 'watch' : 'alert');
      return v >= goodMax ? 'good' : (v >= watchMax ? 'watch' : 'alert');
    }
    var risks = [
      { key: 'riskLiquidity', txt: cr != null ? fmtNum(cr, 2) : null, lv: level3(cr, 1.5, 1.0, true), msgs: ['liqGood', 'liqWatch', 'liqAlert'] },
      { key: 'riskLeverage', txt: dta != null ? fmtNum(dta * 100, 2) + '%' : null, lv: level3(dta, 0.5, 0.7, false), msgs: ['levGood', 'levWatch', 'levAlert'] },
      { key: 'riskDE', txt: dte != null ? fmtNum(dte, 2) : null, lv: level3(dte, 1, 2, false), msgs: ['deGood', 'deWatch', 'deAlert'] }
    ];
    if (intr == null || intr <= 0) {
      risks.push({ key: 'riskInterest', txt: '—', lv: 'good', fixedMsg: t('intNone') });
    } else {
      risks.push({ key: 'riskInterest', txt: cov != null ? fmtNum(cov, 2) + '×' : null, lv: level3(cov, 3, 1, true), msgs: ['intGood', 'intWatch', 'intAlert'] });
    }
    var lvLabelKey = { good: 'riskGood', watch: 'riskWatch', alert: 'riskAlert', na: 'riskNa' };
    var nAlert = 0, nWatch = 0;
    var cards = risks.map(function (r) {
      if (r.lv === 'alert') nAlert += 1; else if (r.lv === 'watch') nWatch += 1;
      var msg = r.fixedMsg || (r.lv === 'na' ? '' : tt(r.msgs[r.lv === 'good' ? 0 : r.lv === 'watch' ? 1 : 2], { v: r.txt }));
      return '<div class="biz-frp__risk is-' + r.lv + '"><div class="biz-frp__risk-top"><span class="biz-frp__risk-name">' + escapeHtml(t(r.key)) + '</span>' +
        '<span class="biz-frp__risk-badge">' + escapeHtml(t(lvLabelKey[r.lv])) + '</span></div>' +
        '<strong class="biz-frp__risk-val">' + escapeHtml(r.txt == null ? '-' : r.txt) + '</strong>' +
        (msg ? '<p class="biz-frp__risk-msg">' + escapeHtml(msg) + '</p>' : '') + '</div>';
    }).join('');
    var overallKey = nAlert >= 2 ? 'overallAlert' : (nAlert + nWatch >= 1 ? 'overallWatch' : 'overallGood');
    var overallCls = overallKey === 'overallGood' ? 'good' : overallKey === 'overallWatch' ? 'watch' : 'alert';
    return '<div class="biz-frp__risk-grid">' + cards + '</div><p class="biz-frp__overall is-' + overallCls + '">' + escapeHtml(t(overallKey)) + '</p>';
  }
  // 经营状态是否「运营中」——与 analytics operatingCondExpr / 状态徽章 statusKind 同口径。
  // 注销、解散、破产等异常状态不参与排行统计,详情页也不展示 DBD 透传的排名数字。
  function isCompanyOperating() {
    var code = text(metaValue(meta, 'jpstatcode', 'jpStatCode')).trim();
    var statusVal = pick(fStatus()) || text(meta.statuszh) || text(metaValue(meta, 'jpstatdesce', 'jpStatDescE')) || text(meta.jpstatdesc);
    if (typeof window.__bizthaiStatusKind === 'function') return window.__bizthaiStatusKind(statusVal, code) === 'operating';
    return String(code) === '1';
  }
  // 站点当前排行财年(佛历 BE):与 /business-leaderboards 同源(ranking_config.financial_ranking_year)。
  // 缺省回退「公历去年」→ BE(2026 年页面上即 2025/2568),避免接口失败时误用更旧年的 DBD 排名。
  var rankingYearBePromise = null;
  function fallbackRankingYearBe() { return (new Date().getFullYear() - 1) + BE; }
  function getRankingYearBe() {
    if (!rankingYearBePromise) {
      rankingYearBePromise = fetch('/api/site/v1/analytics/rankings?limit=1', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var y = j && (j.defaultFiscalYearBe || j.fiscalYearBe);
          y = parseInt(y, 10);
          return (Number.isFinite(y) && y > 0) ? y : fallbackRankingYearBe();
        })
        .catch(function () { return fallbackRankingYearBe(); });
    }
    return rankingYearBePromise;
  }
  function rankYearLabel(rankBe) {
    var ce = ceFromYear(rankBe);
    if (ce == null) return String(rankBe || '');
    return String(LANG === 'th' ? ce + BE : ce);
  }
  // 库内有真实数字的最近财年(按公历 CE 取最大),供「不参与排名」提示附注最近年报时间
  function lastFilingYearLabel(annual) {
    if (!annual) return '';
    var keys = Object.keys(annual);
    var best = null, bestCe = -1;
    for (var i = 0; i < keys.length; i += 1) {
      if (!yearHasData(keys[i], annual)) continue;
      var ce = ceFromYear(keys[i]);
      if (ce != null && ce > bestCe) { bestCe = ce; best = keys[i]; }
    }
    return best != null ? rankYearLabel(best) : '';
  }
  function finRankSection(bodyHtml) {
    return '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escapeHtml(t('secRank')) + '</h2></div>' + bodyHtml + '</div>';
  }
  function finRankInactiveNote(mainMsg, annual) {
    var last = lastFilingYearLabel(annual);
    var lastBit = last ? tt('rankLastFiling', { y: last }) : t('rankLastFilingNone');
    return finRankSection('<p class="biz-frp__note biz-frp__note--inactive">' + escapeHtml(mainMsg) +
      ' <span class="biz-frp__note-last">' + escapeHtml(lastBit) + '</span></p>');
  }
  // 市场地位:仅展示「当前排行财年」年报上的排名。缺该年年报 / 负营收 / 非运营 → 提示不参与排名。
  // 不用「最新有数据的一年」凑排名(否则 2024 及更早数据会冒充进 2025 榜口径)。
  function finRankBlock(annual, rankBe) {
    if (!isCompanyOperating()) {
      return finRankInactiveNote(t('rankInactive'), annual);
    }
    var yKey = null;
    if (rankBe != null && annual) {
      if (annual[rankBe] != null) yKey = rankBe;
      else if (annual[String(rankBe)] != null) yKey = String(rankBe);
    }
    var yLbl = rankYearLabel(rankBe);
    if (!yKey || !yearHasData(yKey, annual)) {
      return finRankInactiveNote(tt('rankNoFiling', { y: yLbl }), annual);
    }
    var rec = annual[yKey] || {};
    var rev = numOf(rec, 'revenue');
    // 与榜单 SQL 一致:负营收不参与(申报符号/单位错误),不展示 DBD 透传排名数字
    if (rev != null && rev < 0) {
      return finRankInactiveNote(tt('rankNegative', { y: yLbl }), annual);
    }
    var sizeDesc = LANG === 'th' ? (rec.businessSizeDesc || rec.businessSizeDescE) : (rec.businessSizeDescE || rec.businessSizeDesc);
    var indDesc = pick(fIndustry());
    // 排名卡片括注:同规模卡片=规模+行业一起括注;全国卡片只括注行业(口径均为 DBD 原生字段,「行业」用页面上展示的同一个大类,不代表 DBD 内部实际分组比这更细)
    function bracket(parts) {
      var kept = parts.filter(Boolean);
      if (!kept.length) return '';
      var inner = kept.join(' · ');
      return LANG === 'zh' ? '(' + inner + ')' : ' (' + inner + ')';
    }
    var indBit = bracket([indDesc]);
    var sizeIndBit = bracket([sizeDesc, indDesc]);
    var canRev = rev != null && rev >= 0;
    var defs = [
      canRev ? ['rankRevAll', numOf(rec, 'rankRevenueAll'), { ind: indBit }] : null,
      ['rankProfitAll', numOf(rec, 'rankProfitlossAll'), { ind: indBit }],
      canRev ? ['rankRevSize', numOf(rec, 'rankRevenueSameSize'), { s: sizeIndBit }] : null,
      ['rankProfitSize', numOf(rec, 'rankProfitlossSameSize'), { s: sizeIndBit }]
    ].filter(function (d) { return d && d[1] != null && d[1] > 0; });
    if (!defs.length) {
      return finRankInactiveNote(tt('rankNoFiling', { y: yLbl }), annual);
    }
    var cards = defs.map(function (d) {
      return '<a class="biz-frp__rank" href="/business-leaderboards"><strong>#' + escapeHtml(fmtNum(d[1], 0)) + '</strong><span>' + escapeHtml(tt(d[0], d[2])) + '</span><i class="biz-frp__rank-arrow" aria-hidden="true">→</i></a>';
    }).join('');
    return finRankSection(
      '<div class="biz-frp__rank-grid">' + cards + '</div>' +
      '<p class="biz-frp__note">' + escapeHtml(tt('rankCaption', { y: yLbl })) + '</p>'
    );
  }
  // 地图定位(2026-07-06,v1 无 key 版):库里没有经纬度,不做地理编码/不存坐标 —— 直接把泰文原始地址
  // (省/县/区/邮编用泰文字段,不用 pick() 的界面语言版本,泰文原文让 Google 现查更准)拼给 Google
  // 地图旧版 output=embed 免 key 接口现查现转,纯客户端 iframe,不经过我们服务器
  function finMapBlock() {
    var parts = [text(meta.address), text(meta.tumbondesc), text(meta.ampurdesc), text(meta.province), text(meta.zipcode)].filter(Boolean);
    if (!parts.length) return '';
    var src = 'https://www.google.com/maps?q=' + encodeURIComponent(parts.join(' ') + ', Thailand') + '&output=embed';
    return '<div class="biz-detail-section"><div class="biz-detail-section__head"><h2 class="biz-detail-section__title">' + escapeHtml(t('secMap')) + '</h2></div>' +
      '<div class="biz-detail-map"><iframe src="' + escapeHtml(src) + '" loading="lazy" title="' + escapeHtml(t('secMap')) + '"></iframe></div></div>';
  }

  // ===== 财务数据 tab 重排(2026-07-05):资产负债表/损益表/财务比率从原始表格改成结构图+卡片,数据不减 =====
  function rowLabel(rows, f) {
    for (var i = 0; i < rows.length; i += 1) { if (rows[i].f === f) return pick(rows[i].l); }
    return f;
  }
  function miniSpark(vals, big) {
    var known = [];
    vals.forEach(function (v) { if (v != null) known.push(v); });
    if (known.length < 2) return '';
    var lo = Math.min.apply(null, known), hi = Math.max.apply(null, known);
    var span = (hi - lo) || Math.abs(hi) || 1;
    var minH = big ? 6 : 3, maxH = big ? 34 : 17;
    var bars = vals.map(function (v) {
      var h = v == null ? minH : Math.max(minH, Math.round(minH + (v - lo) / span * (maxH - minH)));
      return '<b style="height:' + h + 'px;"></b>';
    }).join('');
    return '<div class="biz-fin-spark' + (big ? ' is-lg' : '') + '">' + bars + '</div>';
  }
  // 资产负债表:资产/资金来源结构横条(latest 年,门禁只锁绝对金额,不锁颜色占比本身)
  function finCompositionBars(rec) {
    var totalA = numOf(rec, 'assets');
    if (totalA == null || totalA <= 0) return '';
    var totalLE = numOf(rec, 'liabilitiesandequity');
    if (totalLE == null || totalLE <= 0) totalLE = totalA;
    var cash = numOf(rec, 'cashandcashequivalents'), recv = numOf(rec, 'traderreceivables'), inv = numOf(rec, 'inventories');
    var curA = numOf(rec, 'currentassets'), ppe = numOf(rec, 'propertyplantandequipment'), nonA = numOf(rec, 'noncurrentassets');
    var otherCur = (curA != null) ? Math.max(curA - (cash || 0) - (recv || 0) - (inv || 0), 0) : null;
    var otherNon = (nonA != null) ? Math.max(nonA - (ppe || 0), 0) : null;
    var assetSegs = [
      { v: cash, c: '#bfdbfe', l: rowLabel(BALANCE_ROWS, 'cashandcashequivalents') },
      { v: recv, c: '#93c5fd', l: rowLabel(BALANCE_ROWS, 'traderreceivables') },
      { v: inv, c: '#60a5fa', l: rowLabel(BALANCE_ROWS, 'inventories') },
      { v: otherCur, c: '#3b82f6', l: t('financeOtherCurrent') },
      { v: ppe, c: '#2563eb', l: rowLabel(BALANCE_ROWS, 'propertyplantandequipment') },
      { v: otherNon, c: '#1d4ed8', l: t('financeOtherNonCurrent') }
    ].filter(function (s) { return s.v != null && s.v > 0; });
    var curL = numOf(rec, 'currentliabilities'), nonL = numOf(rec, 'noncurrentliabilities'), eq = numOf(rec, 'equity');
    var fundSegs = [
      { v: curL, c: '#94a3b8', l: rowLabel(BALANCE_ROWS, 'currentliabilities') },
      { v: nonL, c: '#64748b', l: rowLabel(BALANCE_ROWS, 'noncurrentliabilities') },
      { v: eq, c: '#11803f', l: rowLabel(BALANCE_ROWS, 'equity') }
    ].filter(function (s) { return s.v != null && s.v > 0; });
    if (!assetSegs.length || !fundSegs.length) return '';
    function barRow(labelKey, segs, total) {
      var bar = segs.map(function (s) {
        var pct = s.v / total * 100;
        return '<div class="biz-fin-scaleseg" style="width:' + pct.toFixed(2) + '%;background:' + s.c + ';">' + (pct >= 9 ? escapeHtml(s.l) : '') + '</div>';
      }).join('');
      return '<div class="biz-fin-scalerow"><div class="biz-fin-scalerow__label">' + escapeHtml(t(labelKey)) + '</div>' +
        '<div class="biz-fin-scalebar">' + bar + '</div>' +
        '<div class="biz-fin-scalerow__total biz-fin-figure">' + escapeHtml(moneyShort(total)) + '</div></div>';
    }
    // 每条 bar 各自紧跟自己的图例(不再把资产侧+资金侧图例混堆成一段折行大杂烩),
    // 颜色和名称能直接对应到上面那一条 bar,不用来回找
    function legendRow(segs) {
      return '<div class="biz-fin-legend biz-fin-legend--row">' + segs.map(function (s) {
        return '<div class="biz-fin-legenditem"><span class="biz-fin-legenddot" style="background:' + s.c + ';"></span>' + escapeHtml(s.l) + '</div>';
      }).join('') + '</div>';
    }
    return '<div class="biz-fin-scale">' +
      barRow('financeAssetSide', assetSegs, totalA) + legendRow(assetSegs) +
      barRow('financeFundingSide', fundSegs, totalLE) + legendRow(fundSegs) +
      '</div>';
  }
  // 单个明细卡片:大数字 + 同比 + 占父级总额比例的细条 + 多年迷你趋势(全部字段一个不少,只是不再拼成表格)
  function finTile(field, label, rec, chartYears, annual, base, opts) {
    opts = opts || {};
    var v = numOf(rec, field);
    var pc = numOf(rec, field + 'Pc');
    var vals = chartYears.map(function (y) { return numOf(annual[y] || {}, field); });
    var yoyHtml = (pc != null && pc !== 0) ? ('<span class="biz-fin-tile__yoy ' + (pc > 0 ? 'is-up' : 'is-down') + '">' + (pc > 0 ? '▲' : '▼') + escapeHtml(fmtNum(Math.abs(pc), 1)) + '%</span>') : '';
    var propHtml = '';
    if (base && base > 0 && v != null) {
      var pct = Math.max(0, Math.min(100, v / base * 100));
      propHtml = '<div class="biz-fin-tile__propbar"><i style="width:' + pct.toFixed(1) + '%;"></i></div>';
    }
    var sparkHtml = opts.emph ? miniSpark(vals, false) : '';
    var bottomHtml = (propHtml || sparkHtml) ? ('<div class="biz-fin-tile__bottom">' + propHtml + sparkHtml + '</div>') : '';
    return '<div class="biz-fin-tile' + (opts.emph ? ' is-emph' : '') + '">' +
      '<div class="biz-fin-tile__label">' + escapeHtml(label) + '</div>' +
      '<div class="biz-fin-tile__row"><span class="biz-fin-tile__val biz-fin-figure">' + (v == null ? '-' : escapeHtml(moneyShort(v))) + '</span>' + yoyHtml + '</div>' +
      bottomHtml + '</div>';
  }
  function finTileColumn(titleKey, heroField, tiles, rec, chartYears, annual, base) {
    var heroVal = numOf(rec, heroField);
    return '<div><div class="biz-fin-tilehead"><h3>' + escapeHtml(t(titleKey)) + '</h3><span class="biz-fin-tilehead__hero biz-fin-figure">' + (heroVal == null ? '-' : escapeHtml(moneyShort(heroVal))) + '</span></div>' +
      '<div class="biz-fin-tilegrid">' + tiles.map(function (d) { return finTile(d.f, d.l, rec, chartYears, annual, base, { emph: d.emph }); }).join('') + '</div></div>';
  }
  // 损益表:费用构成甜甜圈(占营收百分比,门禁不锁——比率保持可见,只锁绝对金额)
  function finExpenseDonut(rec) {
    var revenue = numOf(rec, 'revenue');
    var cogs = numOf(rec, 'costsofsaleofgoodorservice');
    if (revenue == null || revenue <= 0 || cogs == null) return '';
    var sell = numOf(rec, 'sellingandserviceexpense'), adm = numOf(rec, 'administrativeexpense');
    var np = numOf(rec, 'profitloss');
    var otherAmt = Math.max(revenue - cogs - (sell || 0) - (adm || 0) - Math.max(np || 0, 0), 0);
    var segs = [
      { v: cogs, c: '#2563eb', l: t('cogs') },
      { v: sell, c: '#60a5fa', l: rowLabel(INCOME_ROWS, 'sellingandserviceexpense') },
      { v: adm, c: '#1d4ed8', l: rowLabel(INCOME_ROWS, 'administrativeexpense') },
      { v: otherAmt, c: '#d97706', l: t('financeExpOther') }
    ].filter(function (s) { return s.v != null && s.v > 0; });
    var sum = segs.reduce(function (a, s) { return a + s.v; }, 0);
    if (!sum) return '';
    var acc = 0;
    var stops = segs.map(function (s) {
      var from = acc / sum * 100; acc += s.v;
      return s.c + ' ' + from.toFixed(2) + '% ' + (acc / sum * 100).toFixed(2) + '%';
    }).join(', ');
    var gm = numOf(rec, 'grossProfitMargin');
    var centerVal = gm != null ? fmtNum(gm, 1) : (pctOf(revenue - cogs, revenue) || '-');
    var legend = segs.map(function (s) {
      return '<div class="biz-fin-legenditem"><span class="biz-fin-legenddot" style="background:' + s.c + ';"></span>' + escapeHtml(s.l) + ' ' + Math.round(s.v / sum * 100) + '%</div>';
    }).join('');
    return '<div class="biz-fin-donutwrap"><div class="biz-fin-donut" style="background:conic-gradient(' + stops + ');">' +
      '<div class="biz-fin-donut__center"><strong>' + escapeHtml(centerVal) + '%</strong><span>' + escapeHtml(t('grossMargin')) + '</span></div></div>' +
      '<div class="biz-fin-legend biz-fin-legend--center">' + legend + '</div></div>';
  }
  // 财务数据 tab 共享年份选择器:统一驱动资产负债表/损益表/财务比率三个模块,取代原来只嵌在
  // 损益表桑基图里、范围过窄的下拉(那个旧下拉换年只会重画桑基图 + 一段文案,不会动其余任何内容)
  function finYearSelectHtml(years, selected) {
    var opts = years.slice().reverse().map(function (y) {
      var yce = ceFromYear(y);
      var ylabel = yce == null ? String(y) : String(LANG === 'th' ? yce + BE : yce);
      return '<option value="' + escapeHtml(y) + '"' + (y === selected ? ' selected' : '') + '>' + escapeHtml(ylabel) + '</option>';
    }).join('');
    return '<label class="biz-fin-yearbar"><span>' + escapeHtml(t('finYearPicker')) + '</span><select data-fin-year>' + opts + '</select></label>';
  }
  // 换年整体重建 innerHTML 前,先销毁旧 canvas 上挂的 Chart.js 实例(复用 drawSankey 已有的 destroy 写法)
  function destroyFinCharts(container) {
    Array.prototype.forEach.call(container.querySelectorAll('canvas'), function (cv) {
      if (cv.__chart) { try { cv.__chart.destroy(); } catch (e) {} cv.__chart = null; }
    });
  }
  function finBalanceModule(user, rec, chartYears, annual) {
    var scaleHtml = finCompositionBars(rec);
    var riskHtml = finRiskCards(rec);
    var totalA = numOf(rec, 'assets');
    var totalLE = numOf(rec, 'liabilitiesandequity') || totalA;
    var assetCol = finTileColumn('financeAssetDetail', 'assets', [
      { f: 'cashandcashequivalents', l: rowLabel(BALANCE_ROWS, 'cashandcashequivalents') },
      { f: 'traderreceivables', l: rowLabel(BALANCE_ROWS, 'traderreceivables') },
      { f: 'inventories', l: rowLabel(BALANCE_ROWS, 'inventories') },
      { f: 'currentassets', l: rowLabel(BALANCE_ROWS, 'currentassets'), emph: true },
      { f: 'propertyplantandequipment', l: rowLabel(BALANCE_ROWS, 'propertyplantandequipment') },
      { f: 'noncurrentassets', l: rowLabel(BALANCE_ROWS, 'noncurrentassets'), emph: true }
    ], rec, chartYears, annual, totalA);
    var liabCol = finTileColumn('financeLiabEquityDetail', 'liabilitiesandequity', [
      { f: 'currentliabilities', l: rowLabel(BALANCE_ROWS, 'currentliabilities') },
      { f: 'noncurrentliabilities', l: rowLabel(BALANCE_ROWS, 'noncurrentliabilities') },
      { f: 'liabilities', l: rowLabel(BALANCE_ROWS, 'liabilities'), emph: true },
      { f: 'equity', l: rowLabel(BALANCE_ROWS, 'equity'), emph: true }
    ], rec, chartYears, annual, totalLE);
    var body = scaleHtml + '<div class="biz-fin-tilecols">' + assetCol + liabCol + '</div>';
    var content = riskHtml + body;
    return '<div class="biz-fin-module">' +
      '<div class="biz-fin-module__head"><h2 class="biz-fin-module__title">' + escapeHtml(t('balanceSheet')) + '</h2></div>' +
      content + '</div>';
  }
  function finIncomeModule(user, rec, chartYears, annual, flowData, yLbl) {
    var hasFlow = flowData.flows.length >= 3;
    var flowChartHtml = hasFlow
      ? ('<div class="biz-frp__flow-head"><p class="biz-frp__note" data-fin-flow-note>' + escapeHtml(tt('secFlowNote', { y: yLbl })) + '</p></div><div class="biz-fin-chart biz-frp__sankey"><canvas data-fin-sankey="income"></canvas></div>')
      : '<div class="biz-fin-chart"><canvas data-fin-chart="income"></canvas></div>';
    var stepsHtml = '<div data-fin-steps>' + finFlowSteps(flowData, rec, yLbl) + '</div>';
    var donutHtml = finExpenseDonut(rec);
    var revenue = numOf(rec, 'revenue');
    var tiles = [
      { f: 'revfromsaleorrevfromservice', l: rowLabel(INCOME_ROWS, 'revfromsaleorrevfromservice') },
      { f: 'otherincomes', l: rowLabel(INCOME_ROWS, 'otherincomes') },
      { f: 'costsofsaleofgoodorservice', l: rowLabel(INCOME_ROWS, 'costsofsaleofgoodorservice') },
      { f: 'grossprofit', l: rowLabel(INCOME_ROWS, 'grossprofit'), emph: true },
      { f: 'sellingandserviceexpense', l: rowLabel(INCOME_ROWS, 'sellingandserviceexpense') },
      { f: 'administrativeexpense', l: rowLabel(INCOME_ROWS, 'administrativeexpense') },
      { f: 'expenses', l: rowLabel(INCOME_ROWS, 'expenses'), emph: true },
      { f: 'interestexpense', l: rowLabel(INCOME_ROWS, 'interestexpense') },
      { f: 'plbeforeincometaxexpense', l: rowLabel(INCOME_ROWS, 'plbeforeincometaxexpense'), emph: true },
      { f: 'taxexpenseincome', l: rowLabel(INCOME_ROWS, 'taxexpenseincome') },
      { f: 'profitloss', l: rowLabel(INCOME_ROWS, 'profitloss'), emph: true }
    ].map(function (d) { return finTile(d.f, d.l, rec, chartYears, annual, revenue, { emph: d.emph }); }).join('');
    var detailHtml = '<div class="biz-fin-tilehead"><h3>' + escapeHtml(t('financeIncomeDetail')) + '</h3><span class="biz-fin-tilehead__hero biz-fin-figure">' + (revenue == null ? '-' : escapeHtml(moneyShort(revenue))) + '</span></div>' +
      '<div class="biz-fin-tilegrid">' + tiles + '</div>';
    var growthHtml = '';
    if (chartYears.length > 1) {
      growthHtml = '<h4 class="biz-frp__subhead">' + escapeHtml(t('secGrowth')) + '</h4>' +
        '<div class="biz-fin-chart"><canvas data-fin-growth="income"></canvas></div>';
    }
    var content = flowChartHtml + stepsHtml + donutHtml + detailHtml + growthHtml;
    return '<div class="biz-fin-module">' +
      '<div class="biz-fin-module__head"><h2 class="biz-fin-module__title">' + escapeHtml(t('incomeStatement')) + '</h2></div>' +
      content + '</div>';
  }
  function finRatioModule(user, rec, chartYears, annual) {
    var eps = numOf(rec, 'earningPerShare');
    var epsHtml = '';
    if (eps != null) {
      var epsPc = numOf(rec, 'earningPerSharePc');
      var epsVals = chartYears.map(function (y) { return numOf(annual[y] || {}, 'earningPerShare'); });
      var epsYoy = (epsPc != null && epsPc !== 0) ? ('<div class="biz-fin-eps__yoy ' + (epsPc > 0 ? 'is-up' : 'is-down') + '">' + (epsPc > 0 ? '▲' : '▼') + ' ' + escapeHtml(t('yoy')) + ' ' + escapeHtml(fmtNum(Math.abs(epsPc), 1)) + '%</div>') : '';
      epsHtml = '<div class="biz-fin-eps"><div><div class="biz-fin-eps__label">' + escapeHtml(rowLabel(RATIO_ROWS, 'earningPerShare')) + '</div>' +
        '<span class="biz-fin-eps__num biz-fin-figure">' + escapeHtml(fmtNum(eps, 2)) + '</span> <span class="biz-fin-eps__unit">' + escapeHtml(t('financeEpsUnit')) + '</span>' + epsYoy + '</div>' +
        miniSpark(epsVals, true) + '</div>';
    }
    function gaugeRow(field, label, maxScale, unit, capFn) {
      var v = numOf(rec, field);
      if (v == null) return '';
      var vals = chartYears.map(function (y) { return numOf(annual[y] || {}, field); });
      var pct = Math.max(0, Math.min(100, (v / maxScale) * 100));
      var capText = capFn ? capFn(v) : '';
      return '<div class="biz-fin-gauge"><div class="biz-fin-gauge__top"><span>' + escapeHtml(label) + '</span><b>' + escapeHtml(fmtNum(v, 2)) + escapeHtml(unit) + '</b></div>' +
        '<div class="biz-fin-gauge__row"><div class="biz-fin-gauge__track"><div class="biz-fin-gauge__fill" style="width:' + pct.toFixed(1) + '%;"></div></div>' + miniSpark(vals, false) + '</div>' +
        (capText ? ('<p class="biz-fin-gauge__cap">' + escapeHtml(capText) + '</p>') : '') + '</div>';
    }
    var profitRows = [
      gaugeRow('grossProfitMargin', rowLabel(RATIO_ROWS, 'grossProfitMargin'), 50, '%'),
      gaugeRow('operatingProfitMargin', rowLabel(RATIO_ROWS, 'operatingProfitMargin'), 50, '%'),
      gaugeRow('netProfitMargin', rowLabel(RATIO_ROWS, 'netProfitMargin'), 50, '%'),
      gaugeRow('returnOnAsset', rowLabel(RATIO_ROWS, 'returnOnAsset'), 30, '%'),
      gaugeRow('returnOnEquity', rowLabel(RATIO_ROWS, 'returnOnEquity'), 30, '%')
    ].join('');
    function daysFrom(v) { return v > 0 ? Math.round(365 / v) : null; }
    var unitX = ' ' + t('financeTimesPerYear');
    var effRows = [
      gaugeRow('inventoryTurnover', rowLabel(RATIO_ROWS, 'inventoryTurnover'), 10, unitX, function (v) { var d = daysFrom(v); return d ? tt('financeInvTurnoverCap', { d: d }) : ''; }),
      gaugeRow('accountReceivableTurnover', rowLabel(RATIO_ROWS, 'accountReceivableTurnover'), 10, unitX, function (v) { var d = daysFrom(v); return d ? tt('financeRecvTurnoverCap', { d: d }) : ''; }),
      gaugeRow('totalAssetTurnover', rowLabel(RATIO_ROWS, 'totalAssetTurnover'), 2, unitX, function (v) { return tt('financeAssetTurnoverCap', { v: fmtNum(v, 2) }); })
    ].join('');
    // 判空(与登录状态无关):这一年确实没有任何比率数据时,不管有没有登录都不渲染这个模块,
    // 避免匿名态对着一个其实这年没有数据的年份也弹登录提示
    if (!epsHtml && !profitRows && !effRows) return '';
    var body = epsHtml +
      (profitRows ? ('<div class="biz-fin-tilehead"><h3>' + escapeHtml(t('financeProfitability')) + '</h3></div><div class="biz-fin-gaugelist">' + profitRows + '</div>') : '') +
      (effRows ? ('<div class="biz-fin-tilehead"><h3>' + escapeHtml(t('financeEfficiency')) + '</h3></div><div class="biz-fin-gaugelist">' + effRows + '</div>') : '');
    return '<div class="biz-fin-module">' +
      '<div class="biz-fin-module__head"><h2 class="biz-fin-module__title">' + escapeHtml(t('financialRatios')) + '</h2></div>' +
      body +
      '<p class="biz-fin-xref">' + escapeHtml(t('financeXrefNote')) + '</p></div>';
  }

  function renderFinancial(user) {
    // 营收/利润/资产趋势卡 + 市场地位排名常驻「登记档案」tab;资产负债表/损益表/财务比率三段在「财务数据」tab
    var pp = panel('profile');
    var summaryEl = pp && pp.querySelector('[data-fin-summary]');
    var p = panel('finance');
    if (!summaryEl && !p) return;
    var fs = raw.financialStatements || {};
    var years = (fs.years || []).slice().map(String).sort().reverse();
    var annual = fs.annualData || {};
    var latest = null;
    for (var i = 0; i < years.length; i += 1) { if (yearHasData(years[i], annual)) { latest = years[i]; break; } }
    var chartYears = years.slice().reverse().filter(function (y) { return yearHasData(y, annual); });
    var hasBalance = yearsWithData(years, BALANCE_ROWS, annual).length > 0;
    var hasIncome = yearsWithData(years, INCOME_ROWS, annual).length > 0;
    var hasRatios = yearsWithData(years, RATIO_ROWS, annual).length > 0;

    var rec = latest ? (annual[latest] || {}) : {};
    var ce = latest ? ceFromYear(latest) : null;
    var yLbl = ce == null ? String(latest) : String(LANG === 'th' ? ce + BE : ce);

    if (summaryEl) {
      var trendGrid = renderTrendGrid(user, latest, chartYears, annual);
      var mapHtml = finMapBlock();
      // 市场地位依赖站点排行财年(异步取),先占位再填,避免用「最新财年」误展示旧年排名
      summaryEl.innerHTML = trendGrid + '<div data-fin-rank-slot></div>' + mapHtml;
      getRankingYearBe().then(function (rankBe) {
        var slot = summaryEl.querySelector('[data-fin-rank-slot]');
        if (!slot) return;
        var html = finRankBlock(annual, rankBe);
        if (html) slot.outerHTML = html;
        else slot.remove();
      });
      if (latest) {
        finSummaryDraw = function () { drawTrendCharts(summaryEl, chartYears, annual); };
        if (pp && !pp.hidden) { var fsd0 = finSummaryDraw; finSummaryDraw = null; fsd0(); }
      }
    }

    if (!p) return;
    if (!latest || (!hasBalance && !hasIncome && !hasRatios)) {
      p.innerHTML = '<div class="biz-detail-empty">' + escapeHtml(t('noFinancial')) + '</div>';
      return;
    }
    var flowData = finFlowData(rec);

    // sankey/柱状图/增长趋势图的实际绘制逻辑,首次懒绘制和换年后重绘共用一份,避免同一套判断分支写两遍、改一处忘了改另一处
    var drawIncomeCharts = function (fd) {
      if (!window.Chart || !hasIncome) return;
      if (fd.flows.length >= 3) {
        var cvs = p.querySelector('[data-fin-sankey="income"]');
        if (cvs) drawSankey(cvs, fd);
      } else {
        var cvi = p.querySelector('[data-fin-chart="income"]');
        if (cvi) drawOneChart(cvi, 'income', chartYears, annual);
      }
      var cvg = p.querySelector('[data-fin-growth="income"]');
      if (cvg) drawGrowthChart(cvg, chartYears, annual);
    };

    function bindYearHandler(sel) {
      if (sel) sel.addEventListener('change', onYearChange);
    }
    // 换年:整体重建资产负债表/损益表/财务比率三个模块(不再是原来那种只 patch 桑基图+一段文案+
    // Step 讲解三处的半成品做法),风险卡/结构横条/36 项明细卡/EPS/进度条全部联动到选中年份;
    // 多年趋势图(增长趋势折线图、各卡片迷你趋势条)依旧展示完整历史,不受选中年份影响
    function onYearChange() {
      var sel = p.querySelector('[data-fin-year]');
      var y = sel.value;
      var newRec = annual[y] || {};
      var newFd = finFlowData(newRec);
      var yce = ceFromYear(y);
      var newYLbl = yce == null ? String(y) : String(LANG === 'th' ? yce + BE : yce);

      destroyFinCharts(p);
      var newBalanceHtml = hasBalance ? finBalanceModule(user, newRec, chartYears, annual) : '';
      var newIncomeHtml = hasIncome ? finIncomeModule(user, newRec, chartYears, annual, newFd, newYLbl) : '';
      var newRatiosHtml = hasRatios ? finRatioModule(user, newRec, chartYears, annual) : '';

      var scrollY = window.scrollY;
      p.innerHTML = finYearSelectHtml(chartYears, y) + newBalanceHtml + newIncomeHtml + newRatiosHtml;
      window.scrollTo(0, scrollY);
      bindYearHandler(p.querySelector('[data-fin-year]'));
      loadChart(function () { drawIncomeCharts(newFd); });
    }

    var balanceHtml = hasBalance ? finBalanceModule(user, rec, chartYears, annual) : '';
    var incomeHtml = hasIncome ? finIncomeModule(user, rec, chartYears, annual, flowData, yLbl) : '';
    var ratiosHtml = hasRatios ? finRatioModule(user, rec, chartYears, annual) : '';

    p.innerHTML = finYearSelectHtml(chartYears, latest) + balanceHtml + incomeHtml + ratiosHtml;
    bindYearHandler(p.querySelector('[data-fin-year]'));

    var subsDrawn = false;
    finDraw = function () {
      loadChart(function () {
        if (subsDrawn) return;
        subsDrawn = true;
        drawIncomeCharts(flowData);
      });
    };
    if (p && !p.hidden) { var fd = finDraw; finDraw = null; fd(); }
  }

  function cmtDate(v) {
    if (Array.isArray(v)) v = v.join('-');
    v = text(v);
    if (!v) return '';
    var m = v.match(/^(\d{4})[,\/-](\d{1,2})[,\/-](\d{1,2})/);
    if (m) return dualDate(m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2));
    return dualDate(v);
  }

  function joinRecord(rec, keys) {
    return keys.map(function (k) { return text(rec[k]).trim(); }).filter(Boolean).join(' ');
  }

  /* ===== 董事国籍(ntCode → 旗帜+国名,覆盖常见国家;查不到时退化成旗帜占位+代码本身,不报错)===== */
  var NATIONALITY_MAP = {
    TH: { flag: '🇹🇭', en: 'Thailand', th: 'ไทย', zh: '泰国' },
    CN: { flag: '🇨🇳', en: 'China', th: 'จีน', zh: '中国' },
    US: { flag: '🇺🇸', en: 'United States', th: 'สหรัฐอเมริกา', zh: '美国' },
    JP: { flag: '🇯🇵', en: 'Japan', th: 'ญี่ปุ่น', zh: '日本' },
    KR: { flag: '🇰🇷', en: 'South Korea', th: 'เกาหลีใต้', zh: '韩国' },
    GB: { flag: '🇬🇧', en: 'United Kingdom', th: 'สหราชอาณาจักร', zh: '英国' },
    DE: { flag: '🇩🇪', en: 'Germany', th: 'เยอรมนี', zh: '德国' },
    FR: { flag: '🇫🇷', en: 'France', th: 'ฝรั่งเศส', zh: '法国' },
    IN: { flag: '🇮🇳', en: 'India', th: 'อินเดีย', zh: '印度' },
    SG: { flag: '🇸🇬', en: 'Singapore', th: 'สิงคโปร์', zh: '新加坡' },
    MY: { flag: '🇲🇾', en: 'Malaysia', th: 'มาเลเซีย', zh: '马来西亚' },
    HK: { flag: '🇭🇰', en: 'Hong Kong', th: 'ฮ่องกง', zh: '中国香港' },
    TW: { flag: '🇹🇼', en: 'Taiwan', th: 'ไต้หวัน', zh: '中国台湾' },
    VN: { flag: '🇻🇳', en: 'Vietnam', th: 'เวียดนาม', zh: '越南' },
    ID: { flag: '🇮🇩', en: 'Indonesia', th: 'อินโดนีเซีย', zh: '印度尼西亚' },
    PH: { flag: '🇵🇭', en: 'Philippines', th: 'ฟิลิปปินส์', zh: '菲律宾' },
    NL: { flag: '🇳🇱', en: 'Netherlands', th: 'เนเธอร์แลนด์', zh: '荷兰' },
    CH: { flag: '🇨🇭', en: 'Switzerland', th: 'สวิตเซอร์แลนด์', zh: '瑞士' },
    SE: { flag: '🇸🇪', en: 'Sweden', th: 'สวีเดน', zh: '瑞典' },
    IT: { flag: '🇮🇹', en: 'Italy', th: 'อิตาลี', zh: '意大利' },
    ES: { flag: '🇪🇸', en: 'Spain', th: 'สเปน', zh: '西班牙' },
    AU: { flag: '🇦🇺', en: 'Australia', th: 'ออสเตรเลีย', zh: '澳大利亚' },
    CA: { flag: '🇨🇦', en: 'Canada', th: 'แคนาดา', zh: '加拿大' },
    NZ: { flag: '🇳🇿', en: 'New Zealand', th: 'นิวซีแลนด์', zh: '新西兰' },
    RU: { flag: '🇷🇺', en: 'Russia', th: 'รัสเซีย', zh: '俄罗斯' },
    AE: { flag: '🇦🇪', en: 'UAE', th: 'สหรัฐอาหรับเอมิเรตส์', zh: '阿联酋' },
    PK: { flag: '🇵🇰', en: 'Pakistan', th: 'ปากีสถาน', zh: '巴基斯坦' },
    BD: { flag: '🇧🇩', en: 'Bangladesh', th: 'บังกลาเทศ', zh: '孟加拉国' },
    LK: { flag: '🇱🇰', en: 'Sri Lanka', th: 'ศรีลังกา', zh: '斯里兰卡' },
    NP: { flag: '🇳🇵', en: 'Nepal', th: 'เนปาล', zh: '尼泊尔' },
    MM: { flag: '🇲🇲', en: 'Myanmar', th: 'เมียนมา', zh: '缅甸' },
    LA: { flag: '🇱🇦', en: 'Laos', th: 'ลาว', zh: '老挝' },
    KH: { flag: '🇰🇭', en: 'Cambodia', th: 'กัมพูชา', zh: '柬埔寨' },
    LT: { flag: '🇱🇹', en: 'Lithuania', th: 'ลิทัวเนีย', zh: '立陶宛' },
    BR: { flag: '🇧🇷', en: 'Brazil', th: 'บราซิล', zh: '巴西' },
    ZA: { flag: '🇿🇦', en: 'South Africa', th: 'แอฟริกาใต้', zh: '南非' },
    NG: { flag: '🇳🇬', en: 'Nigeria', th: 'ไนจีเรีย', zh: '尼日利亚' },
    IL: { flag: '🇮🇱', en: 'Israel', th: 'อิสราเอล', zh: '以色列' },
    SA: { flag: '🇸🇦', en: 'Saudi Arabia', th: 'ซาอุดีอาระเบีย', zh: '沙特阿拉伯' },
    NO: { flag: '🇳🇴', en: 'Norway', th: 'นอร์เวย์', zh: '挪威' },
    DK: { flag: '🇩🇰', en: 'Denmark', th: 'เดนมาร์ก', zh: '丹麦' },
    FI: { flag: '🇫🇮', en: 'Finland', th: 'ฟินแลนด์', zh: '芬兰' },
    BE: { flag: '🇧🇪', en: 'Belgium', th: 'เบลเยียม', zh: '比利时' },
    AT: { flag: '🇦🇹', en: 'Austria', th: 'ออสเตรีย', zh: '奥地利' },
    PL: { flag: '🇵🇱', en: 'Poland', th: 'โปแลนด์', zh: '波兰' }
  };
  function nationalityInfo(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return null;
    var e = NATIONALITY_MAP[code];
    return { code: code, flag: e ? e.flag : '🏳️', name: e ? (e[LANG] || e.en) : code };
  }
  // 签字权限比对:signCommittees 是自由文本(如"นายจรัญ เจียรวนนท์ ประธานกรรมการกิตติมศักดิ์"),
  // 姓名前后有无空格不统一(称谓与名字之间常无空格),故去掉全部空白后做子串匹配,比死板对齐更稳
  // 名字比对前统一清洗:去空白 + 去掉源数据里偶发的杂散分隔符(如 lastName 尾部混入的 "/"),
  // 否则会因为一边有杂散字符、一边没有而误判成"没签字权限"(漏判比误判安全,但这种可清洗的噪声应该先洗掉)
  function stripSpace(s) { return String(s || '').replace(/[\s/,]+/g, ''); }
  function hasSignAuthority(nameTh, nameEn, signs) {
    if (!signs || !signs.length) return false;
    var needleTh = stripSpace(nameTh), needleEn = stripSpace(nameEn);
    return signs.some(function (s) {
      var d = stripSpace(text(s.signDescription)), de = stripSpace(text(s.signDescriptionE));
      return (needleTh.length > 3 && d.indexOf(needleTh) !== -1) || (needleEn.length > 3 && de.length > 0 && de.indexOf(needleEn) !== -1);
    });
  }
  // 按国籍统计董事人数占比——jpNations(真实股权资本数据)缺失时的兜底口径,不是出资金额占比
  function nationalityBreakdown(coms) {
    var counts = {}, order = [];
    coms.forEach(function (c) {
      var code = String(c.ntCode || '').trim().toUpperCase();
      if (!code) return;
      if (!counts[code]) { counts[code] = 0; order.push(code); }
      counts[code] += 1;
    });
    var total = order.reduce(function (s, code) { return s + counts[code]; }, 0);
    if (!total) return [];
    order.sort(function (a, b) { return counts[b] - counts[a]; });
    return order.map(function (code) {
      var info = nationalityInfo(code);
      var pct = (counts[code] / total * 100).toFixed(1);
      return { code: code, flag: info.flag, name: info.name, count: counts[code], pct: pct, tooltipLabel: info.flag + ' ' + info.name + ': ' + counts[code] + ' (' + pct + '%)' };
    });
  }
  // 按国籍统计真实股权资本占比——jpNations 是 2026-07-04 新推送的字段,每行是一个真实国籍的持股汇总
  // (ntCode 顶层为 null 的那一行是"全部国籍"合计行,不是真实国籍,过滤掉)
  function jpNationsBreakdown(jpNations) {
    if (!Array.isArray(jpNations)) return [];
    var rows = jpNations.filter(function (n) { return n && n.ntCode; });
    if (!rows.length) return [];
    return rows.map(function (n) {
      var info = nationalityInfo(n.ntCode);
      var shareVol = numOf(n, 'shareVol'), shareAmt = numOf(n, 'shareAmt'), pctRaw = numOf(n, 'sharePctVol');
      var pct = pctRaw != null ? fmtNum(pctRaw, 2) : null;
      return {
        code: info.code, flag: info.flag, name: info.name,
        count: shareAmt != null ? shareAmt : (shareVol || 0),
        shareVol: shareVol, shareAmt: shareAmt, pct: pct,
        tooltipLabel: info.flag + ' ' + info.name + ': ' + (shareAmt != null ? moneyShort(shareAmt) : '-') + (pct != null ? ' (' + pct + '%)' : '')
      };
    }).sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
  }
  var NAT_PALETTE = ['#7901b2', '#11803f', '#d97706', '#0f6cbd', '#c02638', '#57535e', '#9333ea', '#0a8f4f', '#b45309', '#1d4ed8'];
  function drawNationalityChart(cv, breakdown) {
    loadChart(function () {
      if (!window.Chart) return;
      if (cv.__chart) { try { cv.__chart.destroy(); } catch (e) {} }
      cv.__chart = new window.Chart(cv, {
        type: 'pie',
        data: {
          labels: breakdown.map(function (b) { return b.flag + ' ' + b.name; }),
          datasets: [{ data: breakdown.map(function (b) { return b.count; }), backgroundColor: breakdown.map(function (_, i) { return NAT_PALETTE[i % NAT_PALETTE.length]; }), borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 12 }, color: '#34303b' } },
            tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, callbacks: { label: function (c) { return ' ' + breakdown[c.dataIndex].tooltipLabel; } } }
          }
        }
      });
    });
  }

  // 历年泰籍/外籍持股比例趋势(shareHistTHDps/shareHistOTDps,2026-07-04 从「数据分析」tab 挪到这里,
  // 「数据分析」tab 本来就是纯 SSR、没有客户端渲染逻辑,这里是这两个字段第一次有客户端版本)
  function chartPctNum(p) {
    if (!p) return null;
    if (p.y != null && isFinite(Number(p.y))) return Number(p.y);
    if (p.sharePctVol != null && p.sharePctVol !== '') { var n = Number(p.sharePctVol); return isFinite(n) ? n : null; }
    if (p.indexLabel != null) { var n2 = Number(String(p.indexLabel).replace('%', '')); return isFinite(n2) ? n2 : null; }
    return null;
  }
  function shareHistTrend(meta) {
    var jnc = (meta.jpNationCharts && typeof meta.jpNationCharts === 'object') ? meta.jpNationCharts : {};
    var bfc = (meta.basicFinCharts && typeof meta.basicFinCharts === 'object') ? meta.basicFinCharts : {};
    var jncCC = (jnc.customChart && typeof jnc.customChart === 'object') ? jnc.customChart : {};
    var bfcCC = (bfc.customChart && typeof bfc.customChart === 'object') ? bfc.customChart : {};
    function pick(k) { return (Array.isArray(jncCC[k]) && jncCC[k].length) ? jncCC[k] : ((Array.isArray(bfcCC[k]) && bfcCC[k].length) ? bfcCC[k] : []); }
    var thPoints = pick('shareHistTHDps'), otPoints = pick('shareHistOTDps');
    if (!thPoints.length && !otPoints.length) return [];
    var byLabel = {}, order = [];
    function add(points, key) {
      points.forEach(function (p) {
        if (!p || p.label == null) return;
        var label = String(p.label);
        if (!byLabel[label]) { byLabel[label] = {}; order.push(label); }
        var v = chartPctNum(p);
        if (v != null) byLabel[label][key] = v;
      });
    }
    add(thPoints, 'th');
    add(otPoints, 'ot');
    return order.filter(function (label) { return byLabel[label].th != null || byLabel[label].ot != null; })
      .map(function (label) { return { label: label, th: byLabel[label].th, ot: byLabel[label].ot }; });
  }
  function drawShareTrendChart(cv, rows) {
    loadChart(function () {
      if (!window.Chart) return;
      if (cv.__chart) { try { cv.__chart.destroy(); } catch (e) {} }
      cv.__chart = new window.Chart(cv, {
        type: 'bar',
        data: {
          // 源数据年份是泰历(BE,如 "2565"),按语言转成对应历法短标签(th 佛历,zh/en 公历)
          labels: rows.map(function (r) { var ce = ceFromYear(r.label); return ce == null ? String(r.label) : String(LANG === 'th' ? ce + BE : ce); }),
          datasets: [
            { label: t('metricShareHistTH'), data: rows.map(function (r) { return r.th != null ? r.th : null; }), backgroundColor: '#1e3a5f', stack: 's' },
            { label: t('metricShareHistOT'), data: rows.map(function (r) { return r.ot != null ? r.ot : null; }), backgroundColor: '#8fadd1', stack: 's' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 12 }, color: '#34303b' } },
            tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + (c.raw != null ? fmtNum(c.raw, 2) : '-') + '%'; } } }
          }
        }
      });
    });
  }

  function renderDirectors(user) {
    var pp = panel('directors');
    var p = pp;
    // 2026-07-12:认领会员能在会员中心针对自己公司把 meta.directorsPublic 设为三态字符串
    // ('public'/'hidden'/未设置,不是布尔——认领编辑表单一次性提交全部字段,布尔+checkbox
    // 会导致"没碰过这个设置"被悄悄改成"明确选择隐藏",见 resolver/src/server.js 同名变量注释)。
    // 'public'(明确选择公开)时不管有没有登录都正常展示全量数据(这条数据已经是认领会员本人同意
    // 公开,不需要再挡);'hidden'(明确选择打码)不是整段不显示——接口层(sanitizer)已经把
    // committees 里的姓名打码后原样保留(其它字段如国籍/更新日期未受影响),这里跟着正常渲染就行,
    // 不用整段短路,后面卡片会用到的现成"拼 title+first+middle+last"逻辑天然就会拼出打码后的姓名。
    var directorsPublic = meta.directorsPublic === 'public';
    var directorsHidden = meta.directorsPublic === 'hidden';
    // 董事姓名/签字权限(committees/signCommittees)默认只登录会员可见——接口层(sanitizer)已经
    // 按登录态(以及上面 directorsPublic/directorsHidden 的覆盖)过滤这两个字段,未登录且未被公开/
    // 打码时它们本来就是空的。所以"是否为空"只有登录会员、或 directorsPublic/directorsHidden
    // 为真时这个判断才可信——都不满足时不去猜"这家公司到底有没有登记董事",统一显示登录提示
    // (下面 personnelHtml),不区分"有数据但被隐藏"和"真的没有数据"这两种情况,顺便避免被匿名
    // 探测出"哪些公司有董事数据"。jpNations(国籍/持股构成)是聚合数据、不含个人身份,不受这道
    // 门槛影响,继续对所有人可见。
    var coms = Array.isArray(raw.committees) ? raw.committees : [];
    var signs = Array.isArray(raw.signCommittees) ? raw.signCommittees : [];
    var capBreakdown = jpNationsBreakdown(raw.jpNations);
    // jpNations(股权国籍数据)与 committees(董事名录)是两个独立字段——有的公司只有前者没有后者
    // (如刚推送测试数据的样例:0 名登记董事但有真实股权构成),三者都空才算真的"无董事数据"
    // (这个早退判断只在已登录、已公开或已打码时可信,见上面注释)
    if ((user || directorsPublic || directorsHidden) && !coms.length && !signs.length && !capBreakdown.length) { p.innerHTML = '<div class="biz-detail-empty">' + escapeHtml(t('noDirectors')) + '</div>'; return; }
    // 外籍董事排在前面(分组+高亮的前提);排序只影响展示顺序,detail 链接的 seq 兜底仍用各自原始下标
    var indexed = coms.map(function (c, i) { return { c: c, i: i }; });
    indexed.sort(function (a, b) {
      var af = (a.c.ntCode && a.c.ntCode !== 'TH') ? 0 : 1;
      var bf = (b.c.ntCode && b.c.ntCode !== 'TH') ? 0 : 1;
      return af - bf;
    });
    var cards = indexed.map(function (item) {
      var c = item.c, i = item.i;
      var th = joinRecord(c, ['titleName', 'firstName', 'middleName', 'lastName']);
      var en = joinRecord(c, ['titleNameE', 'firstNameE', 'middleNameE', 'lastNameE']);
      var primary = LANG === 'th' ? (th || en) : (en || th);
      if (!primary) return '';
      var sub = LANG === 'th' ? (en && en !== primary ? en : '') : (th && th !== primary ? th : '');
      var seq = text(c.cmtSeq) || String(i + 1);
      var nat = nationalityInfo(c.ntCode);
      var isForeign = nat && nat.code !== 'TH';
      var badges = (nat ? '<span class="biz-entcard__nat">' + escapeHtml(nat.flag) + ' ' + escapeHtml(nat.name) + '</span>' : '') +
        (hasSignAuthority(th, en, signs) ? '<span class="biz-entcard__tag biz-entcard__tag--sign">' + escapeHtml(t('signAuthorityBadge')) + '</span>' : '');
      // 董事卡片不展示电话(隐私考虑);日期前缀标签说明这是"数据更新"时间,不是入职/变更日期,避免误读
      var updDate = cmtDate(c.updateDate);
      var meta = (updDate ? '<span>' + escapeHtml(t('lastUpdated')) + '：' + escapeHtml(updDate) + '</span>' : '');
      var nameBlock = (badges ? '<span class="biz-entcard__top">' + badges + '</span>' : '') +
        '<span class="biz-entcard__name">' + escapeHtml(primary) + '</span>' +
        (sub ? '<span class="biz-entcard__sub">' + escapeHtml(sub) + '</span>' : '') +
        (meta ? '<span class="biz-entcard__meta">' + meta + '</span>' : '');
      // 打码状态(directorsHidden)下不再链到独立董事反查页——那个页面本身还是全量姓名,链过去
      // 等于绕开了这里的打码。
      return directorsHidden
        ? '<div class="biz-entcard' + (isForeign ? ' is-foreign' : '') + '">' + nameBlock + '</div>'
        : '<a class="biz-entcard' + (isForeign ? ' is-foreign' : '') + '" href="/director-' + encodeURIComponent(jpno) + '-' + encodeURIComponent(seq) + '.html">' + nameBlock + '</a>';
    }).join('');
    var table = coms.length ? '<div class="biz-detail-block"><h3>' + escapeHtml(t('registeredDirectors')) + '</h3><div class="biz-entlist">' + cards + '</div></div>' +
      (directorsPublic || directorsHidden ? '<p class="biz-detail-editnote">' + escapeHtml(t(directorsHidden ? 'ownerHiddenNotice' : 'ownerPublicNotice')) + '</p>' : '') : '';
    // capBreakdown 已在函数顶部算好(用于早退判断);缺失时兜底用董事人数占比
    var breakdown = capBreakdown.length ? capBreakdown : nationalityBreakdown(coms);
    var isCapMode = capBreakdown.length > 0;
    var natHtml = '';
    if (breakdown.length) {
      var natRows = breakdown.map(function (b) {
        var extraCol = isCapMode ? ('<td>' + (b.shareVol != null ? escapeHtml(fmtNum(b.shareVol, 0)) : '-') + '</td><td>' + (b.shareAmt != null ? escapeHtml(fmtNum(b.shareAmt, 0)) : '-') + '</td>') : ('<td>' + escapeHtml(String(b.count)) + '</td>');
        return '<tr><td>' + escapeHtml(b.flag) + ' ' + escapeHtml(b.name) + '</td>' + extraCol + '<td>' + (b.pct != null ? escapeHtml(String(b.pct)) + '%' : '-') + '</td></tr>';
      }).join('');
      var headCols = isCapMode
        ? ('<th>' + escapeHtml(t('natTableNat')) + '</th><th>' + escapeHtml(t('capTableShares')) + '</th><th>' + escapeHtml(t('capTableValue')) + '</th><th>' + escapeHtml(t('natTablePct')) + '</th>')
        : ('<th>' + escapeHtml(t('natTableNat')) + '</th><th>' + escapeHtml(t('natTableCount')) + '</th><th>' + escapeHtml(t('natTablePct')) + '</th>');
      natHtml = '<div class="biz-detail-block biz-dir-nat"><h3>' + escapeHtml(t(isCapMode ? 'capBreakdownTitle' : 'natBreakdownTitle')) + '</h3>' +
        '<p class="biz-frp__note">' + escapeHtml(t(isCapMode ? 'capBreakdownNote' : 'natBreakdownNote')) + '</p>' +
        '<div class="biz-dir-nat__body"><div class="biz-dir-nat__chart"><canvas data-dir-nat-chart></canvas></div>' +
        '<table class="biz-dir-nat__table"><thead><tr>' + headCols + '</tr></thead><tbody>' + natRows + '</tbody></table></div></div>';
    }
    // 历年泰籍/外籍持股比例趋势(2026-07-04 从「数据分析」tab 挪过来,和现状构成放在一起对比更直观)
    var shareTrend = shareHistTrend(meta);
    var trendHtml = '';
    if (shareTrend.length) {
      var compactTable = isCapMode
        ? ('<table class="biz-dir-nat__table"><thead><tr><th>' + escapeHtml(t('natTableNat')) + '</th><th>' + escapeHtml(t('capTableValue')) + '</th><th>' + escapeHtml(t('natTablePct')) + '</th></tr></thead><tbody>' +
          capBreakdown.map(function (b) { return '<tr><td>' + escapeHtml(b.flag) + ' ' + escapeHtml(b.name) + '</td><td>' + (b.shareAmt != null ? escapeHtml(fmtNum(b.shareAmt, 0)) : '-') + '</td><td>' + (b.pct != null ? escapeHtml(String(b.pct)) + '%' : '-') + '</td></tr>'; }).join('') +
          '</tbody></table>')
        : '';
      trendHtml = '<div class="biz-detail-block biz-share-trend-block"><h3>' + escapeHtml(t('shareTrendTitle')) + '</h3>' +
        '<p class="biz-frp__note">' + escapeHtml(t('shareTrendNote')) + '</p>' +
        '<div class="biz-share-trend__body">' + compactTable + '<div class="biz-share-trend__chart"><canvas data-dir-trend-chart></canvas></div></div></div>';
    }
    var signHtml = '';
    if (signs.length) {
      signHtml = '<div class="biz-detail-block"><h3>' + escapeHtml(t('signingAuthority')) + '</h3><ol class="biz-dir-sign">' +
        signs.map(function (s) {
          var d = text(s.signDescription), de = text(s.signDescriptionE);
          var main = (LANG === 'en' && de) ? de : (d || de);
          return '<li>' + escapeHtml(main) + '</li>';
        }).join('') + '</ol></div>';
    }
    // 董事卡片 + 签字权限这两块是"人事信息",未登录且未被认领会员公开/打码时整段换成登录提示
    // (同「企业关联图谱」tab 样式);国籍/持股聚合(natHtml/trendHtml)不含个人身份,不受影响,
    // 已经在上面正常拼好了。directorsHidden 时 signs 在接口层已经被剥空,signHtml 自然是空字符串,
    // 不需要在这里额外判断。
    var personnelHtml = (user || directorsPublic || directorsHidden) ? (table + signHtml) : (
      '<div style="margin:20px 0;padding:40px 20px;text-align:center;border:1px solid rgba(121,1,178,.15);border-radius:10px;background:rgba(121,1,178,.04)">' +
      '<p style="margin:0 0 14px;font-size:15px;color:#34303b">' + escapeHtml(t('directorsGate')) + '</p>' +
      '<button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escapeHtml(t('signIn')) + '</button>' +
      '</div>'
    );
    p.innerHTML = natHtml + trendHtml + personnelHtml;
    if (breakdown.length || shareTrend.length) {
      dirDraw = function () {
        var cv = p.querySelector('[data-dir-nat-chart]'); if (cv) drawNationalityChart(cv, breakdown);
        var cv2 = p.querySelector('[data-dir-trend-chart]'); if (cv2) drawShareTrendChart(cv2, shareTrend);
      };
      if (pp && !pp.hidden) { var dd = dirDraw; dirDraw = null; dd(); }
    }
  }

  /* ===== 企业关联图谱(移植旧 RelationshipGraph:自绘 SVG 双侧水平树;边=共享董事)===== */
  var NET_W = 170, NET_H = 44, NET_HALF = 85, NET_COL = 240, NET_ROW = 56;
  function netDeg(d) { return d === 0 ? '#18181b' : d === 1 ? '#7901b2' : d === 2 ? '#2f6bff' : '#8a8594'; }
  function netEC(n) { return n >= 3 ? '#7901b2' : n === 2 ? '#9a55c8' : '#d3d3da'; }
  function netEW(n) { return Math.min(1.3 + n * 0.7, 5); }
  function netClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function netEkey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function netName(n) { return (LANG === 'th' ? (n.nameTh || n.nameEn) : (n.nameEn || n.nameTh)) || n.jpNo; }
  function netDir(d) { return LANG === 'th' ? (d.nameTh || d.nameEn) : (d.nameEn || d.nameTh); }

  function netBuildTree(nodes, links) {
    var root = '';
    for (var i = 0; i < nodes.length; i += 1) { if (nodes[i].degree === 0) { root = nodes[i].jpNo; break; } }
    if (!root && nodes[0]) root = nodes[0].jpNo;
    var ids = {}, deg = {};
    nodes.forEach(function (n) { ids[n.jpNo] = 1; deg[n.jpNo] = n.degree; });
    var parent = {}, pEdge = {}, best = {};
    links.forEach(function (l) {
      if (!ids[l.source] || !ids[l.target]) return;
      var ds = deg[l.source] || 0, dt = deg[l.target] || 0;
      if (ds === dt) return;
      var child = ds > dt ? l.source : l.target, par = ds > dt ? l.target : l.source;
      if ((best[child] == null ? -1 : best[child]) < l.sharedCount) { best[child] = l.sharedCount; parent[child] = par; pEdge[child] = { sharedCount: l.sharedCount, dirs: l.sharedDirectors || [] }; }
    });
    var children = {}, tk = {};
    nodes.forEach(function (n) { if (n.jpNo === root) return; var par = parent[n.jpNo] || root; (children[par] = children[par] || []).push(n.jpNo); tk[netEkey(par, n.jpNo)] = 1; });
    var leaf = {};
    function cl(id) { var ch = children[id]; if (!ch || !ch.length) { leaf[id] = 1; return 1; } var s2 = 0; ch.forEach(function (c) { s2 += cl(c); }); leaf[id] = s2; return s2; }
    if (root) cl(root);
    Object.keys(children).forEach(function (k) { children[k].sort(function (a, b) { return (best[b] || 0) - (best[a] || 0); }); });
    var cross = links.filter(function (l) { return ids[l.source] && ids[l.target] && l.source !== l.target && !tk[netEkey(l.source, l.target)]; });
    return { root: root, parent: parent, pEdge: pEdge, children: children, leaf: leaf, cross: cross };
  }
  function netLayout(t) {
    var pos = {}, ch = t.children, leaf = t.leaf, root = t.root;
    if (!root) return { pos: pos, b: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
    var firsts = (ch[root] || []).slice().sort(function (a, b) { return (leaf[b] || 1) - (leaf[a] || 1); });
    var right = [], left = [], rW = 0, lW = 0;
    firsts.forEach(function (f) { if (rW <= lW) { right.push(f); rW += leaf[f] || 1; } else { left.push(f); lW += leaf[f] || 1; } });
    function side(id, depth, sd, cur) {
      var c = ch[id] || [], y;
      if (!c.length) { y = cur.v; cur.v += NET_ROW; }
      else { c.forEach(function (x) { side(x, depth + 1, sd, cur); }); y = (pos[c[0]].y + pos[c[c.length - 1]].y) / 2; }
      pos[id] = { x: sd * depth * NET_COL, y: y };
    }
    var rc = { v: 0 }; right.forEach(function (f) { side(f, 1, 1, rc); });
    var lc = { v: 0 }; left.forEach(function (f) { side(f, 1, -1, lc); });
    pos[root] = { x: 0, y: Math.max(rc.v, lc.v, NET_ROW) / 2 - NET_ROW / 2 };
    var minX = 0, maxX = 0, minY = 0, maxY = 0;
    Object.keys(pos).forEach(function (k) { var p = pos[k]; minX = Math.min(minX, p.x - NET_HALF); maxX = Math.max(maxX, p.x + NET_HALF); minY = Math.min(minY, p.y - NET_H / 2); maxY = Math.max(maxY, p.y + NET_H / 2); });
    return { pos: pos, b: { minX: minX, maxX: maxX, minY: minY, maxY: maxY } };
  }
  function netTP(p, c) { var sg = c.x >= p.x ? 1 : -1, x1 = p.x + sg * NET_HALF, y1 = p.y, x2 = c.x - sg * NET_HALF, y2 = c.y, mx = (x1 + x2) / 2; return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2; }
  function netCP(p, c) { var mx = (p.x + c.x) / 2; return 'M' + p.x + ',' + p.y + ' C' + mx + ',' + p.y + ' ' + mx + ',' + c.y + ' ' + c.x + ',' + c.y; }

  function renderNetwork(user) {
    var pane = panel('network');
    if (!pane) return;
    // 关联图谱接口需登录;访客不发请求(否则控制台刷 401),直接出示登录门禁
    if (!user) {
      pane.innerHTML =
        '<div style="margin:20px 0;padding:40px 20px;text-align:center;border:1px solid rgba(121,1,178,.15);border-radius:10px;background:rgba(121,1,178,.04)">' +
        '<p style="margin:0 0 14px;font-size:15px;color:#34303b">' + escapeHtml(t('networkGate')) + '</p>' +
        '<button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escapeHtml(t('signIn')) + '</button>' +
        '</div>';
      return;
    }
    pane.innerHTML = '<div class="biz-net" data-net><div class="biz-detail-status">' + escapeHtml(t('networkBuilding')) + '</div></div>';
    var rootEl = pane.querySelector('[data-net]');
    Promise.all([
      fetch('/api/site/v1/companies/' + encodeURIComponent(jpno) + '/network?depth=3&maxNodes=100&minShared=1', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/site/v1/companies/' + encodeURIComponent(jpno) + '/related?limit=100', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var nr = res[0], rr = res[1];
      var nodes = (nr && nr.nodes) || [];
      var links = ((nr && nr.edges) || []).map(function (e) { return { source: e.source, target: e.target, sharedCount: e.sharedCount, sharedDirectors: e.sharedDirectors || [] }; });
      netUI(rootEl, nodes, links, (rr && rr.related) || [], (rr && rr.total) || 0, nr && nr.truncated);
    }).catch(function () { rootEl.innerHTML = '<div class="biz-detail-empty">' + escapeHtml(t('networkEmpty')) + '</div>'; });
  }

  function netUI(rootEl, nodes, links, related, total, truncated) {
    if (!nodes || nodes.length <= 1) { rootEl.innerHTML = '<div class="biz-detail-empty">' + escapeHtml(t('networkEmpty')) + '</div>'; return; }
    if (!total) total = related.length;
    var tree = netBuildTree(nodes, links), lay = netLayout(tree), P = lay.pos;
    var legend = [0, 1, 2, 3].map(function (d) { return '<span><i style="background:' + netDeg(d) + '"></i>' + escapeHtml(d === 0 ? t('netSubject') : (d + '°')) + '</span>'; }).join('');
    rootEl.innerHTML =
      '<div class="biz-detail-block biz-net-block"><h3>' + escapeHtml(t('relatedCompanies')) + ' <small>' + escapeHtml(t('networkSub')) + '</small></h3>' +
      '<div class="biz-net-stage" data-net-stage>' +
        '<div class="biz-net-world" data-net-world><svg class="biz-net-svg" data-net-svg></svg><div data-net-layer></div></div>' +
        '<div class="biz-net-ctrl"><button type="button" data-net-zoom="in">+</button><button type="button" data-net-zoom="out">−</button><button type="button" data-net-zoom="fit">·</button></div>' +
        '<div class="biz-net-legend">' + legend + '</div>' +
        '<div class="biz-net-tip" data-net-tip hidden></div>' +
      '</div>' +
      '<p class="biz-net-hint">' + escapeHtml(t('networkHint')) + '</p>' +
      '<p class="biz-detail-related__note">' + escapeHtml(t('relatedNote')) + '</p>' +
      '</div>';
    var svg = rootEl.querySelector('[data-net-svg]'), layer = rootEl.querySelector('[data-net-layer]');
    var eh = '';
    tree.cross.forEach(function (l) { var a = P[l.source], b = P[l.target]; if (a && b) eh += '<path d="' + netCP(a, b) + '" fill="none" stroke="rgba(150,160,175,0.3)" stroke-width="0.8" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>'; });
    nodes.forEach(function (n) { if (n.jpNo === tree.root) return; var c = P[n.jpNo], pa = P[tree.parent[n.jpNo] || tree.root]; if (!c || !pa) return; var sc = (tree.pEdge[n.jpNo] || {}).sharedCount || 1; eh += '<path d="' + netTP(pa, c) + '" fill="none" stroke="' + netEC(sc) + '" stroke-width="' + netEW(sc) + '" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity="0.85"/>'; });
    svg.innerHTML = eh;
    layer.innerHTML = nodes.map(function (n) {
      var p = P[n.jpNo]; if (!p) return '';
      var rt = n.degree === 0, sc = (tree.pEdge[n.jpNo] || {}).sharedCount || 0;
      return '<div class="biz-net-node' + (rt ? ' is-root' : '') + '" data-net-jp="' + escapeHtml(n.jpNo) + '" style="left:' + (p.x - NET_HALF) + 'px;top:' + (p.y - NET_H / 2) + 'px;width:' + NET_W + 'px;height:' + NET_H + 'px">' +
        '<i class="biz-net-bar" style="background:' + netDeg(n.degree) + '"></i><span class="biz-net-nm">' + escapeHtml(netName(n)) + '</span>' +
        (!rt && sc ? '<span class="biz-net-cnt">' + sc + '</span>' : '') + '</div>';
    }).join('');
    netWire(rootEl, P, tree, nodes, related, total);
  }

  function netWire(rootEl, P, tree, nodes, related, total) {
    var stage = rootEl.querySelector('[data-net-stage]'), world = rootEl.querySelector('[data-net-world]'), tip = rootEl.querySelector('[data-net-tip]');
    var view = { k: 1, tx: 0, ty: 0 };
    function apply() { world.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.k + ')'; }
    var minX = 0, maxX = 0, minY = 0, maxY = 0;
    Object.keys(P).forEach(function (k) { var p = P[k]; minX = Math.min(minX, p.x - NET_HALF); maxX = Math.max(maxX, p.x + NET_HALF); minY = Math.min(minY, p.y - NET_H / 2); maxY = Math.max(maxY, p.y + NET_H / 2); });
    function fit() { var W = stage.clientWidth || 800, H = stage.clientHeight || 460, pad = 48, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, hw = Math.max((maxX - minX) / 2, 1); var k = netClamp((W - 2 * pad) / (2 * hw), 0.35, 1.3); view = { k: k, tx: W / 2 - cx * k, ty: H / 2 - cy * k }; apply(); }
    netFit = fit;
    stage.addEventListener('wheel', function (e) { e.preventDefault(); var r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = netClamp(view.k * Math.exp(-e.deltaY * 0.0015), 0.12, 3), wx = (mx - view.tx) / view.k, wy = (my - view.ty) / view.k; view = { k: k, tx: mx - wx * k, ty: my - wy * k }; apply(); }, { passive: false });
    var drag = null, moved = false;
    stage.addEventListener('mousedown', function (e) { if (e.target.closest('.biz-net-ctrl')) return; drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; moved = false; });
    window.addEventListener('mousemove', function (e) { if (!drag) return; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) moved = true; view.tx = drag.tx + (e.clientX - drag.x); view.ty = drag.ty + (e.clientY - drag.y); apply(); });
    window.addEventListener('mouseup', function () { drag = null; });
    rootEl.querySelectorAll('[data-net-zoom]').forEach(function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-net-zoom'); if (a === 'fit') { fit(); return; } var f = a === 'in' ? 1.3 : 1 / 1.3, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2, k = netClamp(view.k * f, 0.12, 3), wx = (cx - view.tx) / view.k, wy = (cy - view.ty) / view.k; view = { k: k, tx: cx - wx * k, ty: cy - wy * k }; apply(); }); });
    rootEl.querySelectorAll('.biz-net-node').forEach(function (el) {
      var jp = el.getAttribute('data-net-jp'), n = nodes.filter(function (x) { return x.jpNo === jp; })[0];
      if (n && n.degree !== 0) el.addEventListener('click', function () { if (!moved && window.__starterCompanyHref) window.location.href = window.__starterCompanyHref(n.jpNo, n.nameEn || ''); });
      el.addEventListener('mouseenter', function () {
        if (!n) return;
        var pe = tree.pEdge[jp], dirs = ((pe && pe.dirs) || []).map(netDir).filter(Boolean).join(', ');
        var m = [text(n.province), text(n.status)].filter(Boolean).join(' · ');
        tip.innerHTML = '<strong>' + escapeHtml(netName(n)) + '</strong>' + (m ? '<span>' + escapeHtml(m) + '</span>' : '') + (n.degree > 0 && dirs ? '<span class="biz-net-tipd">' + escapeHtml(t('sharedDirectorsLabel')) + ': ' + escapeHtml(dirs) + '</span>' : '');
        var p = P[jp]; tip.style.left = netClamp(p.x * view.k + view.tx, 110, (stage.clientWidth || 800) - 110) + 'px'; tip.style.top = ((p.y - NET_H / 2) * view.k + view.ty - 8) + 'px'; tip.hidden = false;
      });
      el.addEventListener('mouseleave', function () { tip.hidden = true; });
    });
  }

  function netTable(related, total) {
    var rows = related.map(function (c, i) {
      var nm = LANG === 'th' ? (c.companyNameTh || c.companyNameEn) : (c.companyNameEn || c.companyNameTh);
      var dirs = (c.sharedDirectors || []).map(netDir).filter(Boolean).map(function (d) { return '<span class="biz-net-dirchip">' + escapeHtml(d) + '</span>'; }).join('');
      return '<tr><td>' + (i + 1) + '</td><td><a href="' + escapeHtml(window.__starterCompanyHref(c.jpNo, c.companyNameEn || '')) + '">' + escapeHtml(nm || c.jpNo) + '</a></td><td class="biz-net-sh">' + escapeHtml(String(c.sharedCount || 0)) + '</td><td>' + (dirs || '-') + '</td><td>' + escapeHtml(text(c.province)) + '</td></tr>';
    }).join('');
    var h = '<div class="biz-report-table-wrap"><table class="biz-report-table biz-net-tbl"><thead><tr><th>#</th><th>' + escapeHtml(t('relCompany')) + '</th><th>' + escapeHtml(t('sharedDirectors')) + '</th><th>' + escapeHtml(t('relCommon')) + '</th><th>' + escapeHtml(t('provinceShort')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    if (total > related.length) h += '<p class="biz-net-more">' + escapeHtml(t('networkShowingOf').replace('{a}', related.length).replace('{b}', total)) + '</p>';
    return h;
  }

  // 浏览量从稳定、可共享缓存的 HTML 中拆出，详情数据加载完成后再异步计数并渲染。
  var viewRequestStarted = false;
  function renderViews(n) {
    var el = q('[data-detail-views]');
    if (!el) return;
    n = parseInt(n, 10);
    if (!isFinite(n) || n <= 0) return;
    el.innerHTML = '<svg class="biz-detail-views__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' +
      '<span>' + escapeHtml(t('viewsCount').replace('{n}', fmtNum(n))) + '</span>';
    el.hidden = false;
  }
  function loadViews(entry) {
    if (viewRequestStarted) return;
    var viewJpno = root.getAttribute('data-detail-jpno') || '';
    var viewEntryId = parseInt(root.getAttribute('data-detail-entry-id') || (entry && entry.id), 10);
    if (!/^\d{6,}$/.test(viewJpno) || !isFinite(viewEntryId) || viewEntryId <= 0) return;
    viewRequestStarted = true;
    var endpoint = new URL(window.location.href);
    endpoint.search = '';
    endpoint.hash = '';
    endpoint.searchParams.set('__view', '1');
    fetch(endpoint.toString(), {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jpno: viewJpno, entryId: viewEntryId })
    })
      .then(function (r) { return r.ok && r.status !== 204 ? r.json() : null; })
      .then(function (data) { if (data && data.views) renderViews(data.views); })
      .catch(function () { /* 浏览量可选，失败不影响公司正文 */ });
  }

  function render(entry) {
    meta = entry.meta || {};
    raw = meta.raw || {};
    entryId = entry.id || (meta && meta.id) || '';
    entrySlug = entry.slug || jpno;
    entryUpdatedAt = entry.updated_at || '';
    var status = q('[data-detail-status]');
    if (status) status.hidden = true;
    renderHero();
    renderVerifiedBadge();
    loadViews(entry);
    renderTabs();
    renderBusiness();
    renderProfile();
    var _auth = AUTH();
    if (_auth) {
      _auth.me().then(function (_u) {
        if (_u) clearTabLocks();
        renderContact(_u);
        renderFinancial(_u);
        renderDirectors(_u);
        renderNetwork(_u);
      });
    } else {
      renderContact(null);
      renderFinancial(null);
      renderDirectors(null);
      renderNetwork(null);
    }
    showPanel('profile');
  }
  function showError() {
    var status = q('[data-detail-status]');
    if (status) { status.textContent = t('loadError'); status.hidden = false; }
  }

  var statusEl = q('[data-detail-status]');
  if (statusEl) statusEl.textContent = t('loading');
  var detailSlug = (root && root.getAttribute('data-detail-slug')) || '';
  var fetchKey = detailSlug || jpno;   // WooCMS 按 slug 取数:英文名 slug 公司用 jpNo 会 404,优先用 resolver 注入的真实 slug
  if (!fetchKey) { showError(); return; }
  fetch('/api/site/v1/models/thaicompany/entries/' + encodeURIComponent(fetchKey), { headers: { 'Accept': 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
    .then(function (json) {
      var d = json && json.data ? json.data : null;
      if (!d) throw new Error('nodata');
      render(d);
    })
    .catch(function () { showError(); });
})();

/* ===== 商业分析页客户端渲染(business-reports / foreign-capital / industry-overview,fetch analytics sidecar)===== */
(function () {
  var root = document.querySelector('[data-biz-analytics]');
  if (!root || !window.fetch) return;

  function text(v) { return v == null ? '' : String(v); }
  function escapeHtml(v) {
    return text(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normalizeLocale(v) {
    v = text(v).trim().toLowerCase();
    if (v === 'zh' || v.indexOf('zh') === 0) return 'zh-CN';
    if (v.indexOf('th') === 0) return 'th';
    if (v.indexOf('en') === 0) return 'en';
    return '';
  }
  function activeLocale() {
    var first = window.location.pathname.split('/').filter(Boolean)[0] || '';
    var fp = normalizeLocale(first);
    if (fp) return fp;
    var __hl = normalizeLocale(document.documentElement.lang); if (__hl) return __hl;
    return 'en';
  }
  var locale = activeLocale();
  var LANG = locale === 'zh-CN' ? 'zh' : (locale === 'th' ? 'th' : 'en');
  function pick(v) {
    if (!v) return '';
    if (LANG === 'zh') return text(v.zh || v.en || v.th);
    if (LANG === 'th') return text(v.th || v.en || v.zh);
    return text(v.en || v.th || v.zh);
  }
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '-';
    var n = Number(v);
    if (!isFinite(n)) return '-';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function moneyCompact(v) {
    var n = Number(v);
    if (!isFinite(n) || n === 0) return '฿0';
    var units = LANG === 'zh' ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
      : LANG === 'th' ? [[1e12, 'ล้านล้าน'], [1e9, 'พันล้าน'], [1e6, 'ล้าน']]
      : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i += 1) {
      if (Math.abs(n) >= units[i][0]) return '฿' + (n / units[i][0]).toFixed(2) + units[i][1];
    }
    return '฿' + fmtNum(Math.round(n));
  }
  function pct(share) {
    var n = Number(share);
    if (!isFinite(n)) return '-';
    return (n * 100).toFixed(1) + '%';
  }
  var BE = 543;
  function ceFromYear(y) { y = parseInt(y, 10); if (isNaN(y)) return null; return y >= 2400 ? y - BE : y; }
  function dualYear(yearRaw) {
    var ce = ceFromYear(yearRaw);
    if (ce === null) return text(yearRaw);
    return LANG === 'th' ? (ce + BE) + ' (' + ce + ')' : ce + ' (' + (ce + BE) + ')';
  }
  function dualDate(raw) {
    raw = text(raw);
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return raw;
    var ce = ceFromYear(m[1]);
    if (ce === null) return raw;
    var be = ce + BE, rest = '-' + m[2] + '-' + m[3];
    return LANG === 'th' ? (be + rest + ' (' + ce + ')') : (ce + rest + ' (' + be + ')');
  }
  function fmtDateTime(iso) {
    var m = text(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return text(iso);
    return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
  }

  var LABELS = {
    ovKicker: { en: 'Business Intelligence', th: 'ข้อมูลเชิงลึกธุรกิจ', zh: '商业情报' },
    ovTitle: { en: 'Thai Business Environment Analysis', th: 'การวิเคราะห์สภาพแวดล้อมธุรกิจไทย', zh: '泰国商业环境分析' },
    ovLead: { en: 'Full-database aggregates over Thai company registrations: province ranking, foreign-capital composition, industry distribution, status and the highest-capital companies. Source: DBD DataWarehouse+.', th: 'การรวมข้อมูลทั้งฐานข้อมูลบริษัทไทย: การจัดอันดับจังหวัด โครงสร้างทุนต่างชาติ การกระจายอุตสาหกรรม สถานะ และบริษัททุนสูงสุด แหล่งข้อมูล: DBD DataWarehouse+', zh: '基于全库泰国企业登记数据的聚合:府排行、外资构成、行业分布、经营状态与高资本企业。数据来源:DBD DataWarehouse+。' },
    searchSr: { en: 'Search Thai company records', th: 'ค้นหาข้อมูลบริษัทไทย', zh: '搜索泰国公司记录' },
    searchPh: { en: 'Company name, registration number, province or industry', th: 'ชื่อบริษัท เลขทะเบียน จังหวัด หรืออุตสาหกรรม', zh: '公司名称、注册号、府或行业' },
    searchBtn: { en: 'Search', th: 'ค้นหา', zh: '搜索' },
    navForeign: { en: 'Foreign Capital', th: 'ทุนต่างชาติ', zh: '外资构成' },
    navIndustry: { en: 'Industry Ranking', th: 'การจัดอันดับอุตสาหกรรม', zh: '行业排行' },
    navAll: { en: 'All Companies', th: 'บริษัททั้งหมด', zh: '全部公司' },
    navOverview: { en: 'Business Analysis', th: 'การวิเคราะห์ธุรกิจ', zh: '商业分析' },
    statCompanies: { en: 'Company records indexed', th: 'ข้อมูลบริษัทที่จัดทำดัชนี', zh: '已收录公司记录' },
    statProvinces: { en: 'Province and district terms', th: 'หมวดจังหวัดและอำเภอ', zh: '府与县分类项' },
    provincesTitle: { en: 'Province ranking by registered capital', th: 'การจัดอันดับจังหวัดตามทุนจดทะเบียน', zh: '各府注册资本排行' },
    provincesSub: { en: 'Top provinces by total registered capital and company count.', th: 'จังหวัดชั้นนำตามทุนจดทะเบียนรวมและจำนวนบริษัท', zh: '按注册资本总额与公司数排名靠前的府。' },
    foreignTitle: { en: 'Foreign-capital composition', th: 'โครงสร้างทุนต่างชาติ', zh: '外资构成' },
    foreignSub: { en: 'By shareholder / director nationality.', th: 'ตามสัญชาติผู้ถือหุ้น / กรรมการ', zh: '按股东/董事国籍。' },
    statusTitle: { en: 'Registration status', th: 'สถานะการจดทะเบียน', zh: '经营状态' },
    statusSub: { en: 'Operating vs other states.', th: 'ดำเนินกิจการเทียบกับสถานะอื่น', zh: '运营中与其他状态。' },
    industryTitle: { en: 'Industry sections by company count', th: 'หมวดอุตสาหกรรมตามจำนวนบริษัท', zh: '行业大类按公司数排行' },
    industrySub: { en: 'TSIC top-level sections across the company index.', th: 'หมวดหลัก TSIC ทั่วทั้งดัชนีบริษัท', zh: '全库企业的 TSIC 顶层大类。' },
    topCapTitle: { en: 'Highest registered capital', th: 'ทุนจดทะเบียนสูงสุด', zh: '注册资本最高企业' },
    topCapSub: { en: 'Companies with the largest registered capital.', th: 'บริษัทที่มีทุนจดทะเบียนสูงสุด', zh: '注册资本最大的企业。' },
    yearsTitle: { en: 'New registrations by year', th: 'การจดทะเบียนใหม่รายปี', zh: '历年新增登记' },
    yearsSub: { en: 'Yearly trend is a sampled estimate.', th: 'แนวโน้มรายปีเป็นค่าประมาณจากตัวอย่าง', zh: '年度趋势为抽样估算。' },
    capitalSourceTitle: { en: 'Capital origin', th: 'แหล่งที่มาของทุน', zh: '资本来源' },
    capitalSourceSub: { en: 'Thai-owned vs foreign-owned share.', th: 'สัดส่วนทุนไทยเทียบทุนต่างชาติ', zh: '泰资与外资占比。' },
    capitalTermsTitle: { en: 'Capital-origin terms', th: 'หมวดแหล่งที่มาของทุน', zh: '资本来源分类' },
    capitalTermsSub: { en: 'Backend taxonomy for capital and nationality.', th: 'หมวดหมู่ทุนและสัญชาติในระบบหลังบ้าน', zh: '后台的资本与国籍分类。' },
    foreignSamplesTitle: { en: 'Foreign-capital company samples', th: 'ตัวอย่างบริษัททุนต่างชาติ', zh: '外资企业样本' },
    foreignSamplesSub: { en: 'Companies associated with the foreign-capital taxonomy term.', th: 'บริษัทที่เชื่อมโยงกับหมวดทุนต่างชาติ', zh: '关联到外资分类的企业。' },
    industryTermsTitle: { en: 'Industry taxonomy', th: 'หมวดหมู่อุตสาหกรรม', zh: '行业分类' },
    industryTermsSub: { en: 'Backend-managed industry terms.', th: 'หมวดอุตสาหกรรมที่จัดการในระบบหลังบ้าน', zh: '后台管理的行业词条。' },
    refreshed: { en: 'Updated', th: 'อัปเดตเมื่อ', zh: '数据更新' },
    loading: { en: 'Loading analytics…', th: 'กำลังโหลดข้อมูลวิเคราะห์…', zh: '正在加载分析数据…' },
    loadError: { en: 'Unable to load analytics right now.', th: 'ไม่สามารถโหลดข้อมูลวิเคราะห์ได้ในขณะนี้', zh: '暂时无法加载分析数据。' },
    noData: { en: 'No data available.', th: 'ไม่มีข้อมูล', zh: '暂无数据。' },
    province: { en: 'Province', th: 'จังหวัด', zh: '府' },
    companies: { en: 'Companies', th: 'จำนวนบริษัท', zh: '公司数' },
    registeredCapital: { en: 'Registered capital', th: 'ทุนจดทะเบียน', zh: '注册资本' },
    avgCapital: { en: 'Avg capital', th: 'ทุนเฉลี่ย', zh: '平均资本' },
    nationality: { en: 'Nationality', th: 'สัญชาติ', zh: '国籍' },
    share: { en: 'Share', th: 'สัดส่วน', zh: '占比' },
    company: { en: 'Company', th: 'บริษัท', zh: '公司' },
    business: { en: 'Industry', th: 'อุตสาหกรรม', zh: '行业' },
    year: { en: 'Year', th: 'ปี', zh: '年份' },
    newCompanies: { en: 'New companies', th: 'บริษัทใหม่', zh: '新增企业' },
    tileTotal: { en: 'Total companies', th: 'บริษัททั้งหมด', zh: '企业总量' },
    tileCapital: { en: 'Registered capital', th: 'ทุนจดทะเบียนรวม', zh: '注册资本总额' },
    tileAvg: { en: 'Average capital', th: 'ทุนเฉลี่ย', zh: '平均注册资本' },
    tileForeign: { en: 'Foreign share', th: 'สัดส่วนทุนต่างชาติ', zh: '外资占比' },
    tileForeignTotal: { en: 'Foreign-owned companies', th: 'บริษัททุนต่างชาติ', zh: '外资企业数' },
    tileThaiTotal: { en: 'Thai-owned companies', th: 'บริษัททุนไทย', zh: '泰资企业数' },
    tileIndustries: { en: 'Industry sections', th: 'หมวดอุตสาหกรรม', zh: '行业大类数' },
    latestTitle: { en: 'Recently registered companies', th: 'บริษัทที่จดทะเบียนล่าสุด', zh: '最新登记企业' },
    latestSub: { en: 'Newest published company records.', th: 'ข้อมูลบริษัทที่เผยแพร่ล่าสุด', zh: '最新发布的公司记录。' },
    allIndustries: { en: 'All industries', th: 'ทุกอุตสาหกรรม', zh: '全部行业' },
    topProvince: { en: 'Top province', th: 'จังหวัดอันดับ 1', zh: '第一府' },
    regDate: { en: 'Registration date', th: 'วันที่จดทะเบียน', zh: '注册日期' },
    leadsTitle: { en: 'High-capital company leads', th: 'เบาะแสบริษัททุนสูง', zh: '高资本企业线索' },
    leadsSub: { en: 'Use registration number, company type, capital and province as research entry points.', th: 'ใช้เลขทะเบียน ประเภทบริษัท ทุน และจังหวัดเป็นจุดเริ่มต้นการค้นคว้า', zh: '以注册号、公司类型、资本和府作为研究入口。' },
    ownerNote: { en: 'DBD has no shareholder holdings data; ownership links are inferred from shared directors via the company relationship graph on each company page.', th: 'DBD ไม่มีข้อมูลการถือหุ้น ความเชื่อมโยงความเป็นเจ้าของอนุมานจากกรรมการร่วมผ่านกราฟความสัมพันธ์ในหน้าบริษัท', zh: 'DBD 无股东持股数据;所有权关联通过各公司页的「共享董事」关系图谱推断。' },
    provinceTermsTitle: { en: 'Province entry points', th: 'จุดเข้าถึงระดับจังหวัด', zh: '府级入口' },
    provinceTermsSub: { en: 'Server-rendered province and district terms.', th: 'หมวดจังหวัดและอำเภอ', zh: '府与县分类项。' }
  };
  function t(key) { var e = LABELS[key]; return e ? (e[LANG] || e.en) : key; }

  function each(sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }

  function buildTable(headers, rows) {
    if (!rows.length) return '<p class="biz-report-empty">' + escapeHtml(t('noData')) + '</p>';
    var thead = '<thead><tr>' + headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('') + '</tr></thead>';
    var tbody = '<tbody>' + rows.map(function (cells) {
      return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody>';
    return '<table class="biz-report-table biz-an-table">' + thead + tbody + '</table>';
  }
  function badge(n) { return '<span class="biz-rank-badge">' + n + '</span>'; }

  function capitalSourceHtml(d) {
    var cs = (d.foreignComposition || {}).capitalSource || [];
    var total = cs.reduce(function (a, r) { return a + (r.count || 0); }, 0) || 1;
    return '<div class="biz-an-bars">' + cs.map(function (r) {
      var p = (r.count / total * 100);
      return '<div class="biz-an-bar"><div class="biz-an-bar__head"><span>' + escapeHtml(pick(r.label)) +
        '</span><span>' + fmtNum(r.count) + ' · ' + p.toFixed(1) + '%</span></div>' +
        '<div class="biz-an-bar__track"><div class="biz-an-bar__fill' + (r.key === 'foreign' ? ' is-foreign' : '') +
        '" style="width:' + p.toFixed(1) + '%"></div></div></div>';
    }).join('') + '</div>';
  }
  function nationalitiesHtml(d) {
    var nats = (d.foreignComposition || {}).nationalities || [];
    return buildTable([ '#', t('nationality'), t('companies'), t('share') ],
      nats.map(function (r, i) {
        return [badge(i + 1), escapeHtml(pick(r.name) || r.code), fmtNum(r.count), pct(r.share)];
      }));
  }
  // 国家排行榜(世界地图右侧联动列表):行结构须与 worldmap 模块(data-iso/data-count/data-rank/data-name/href + .biz-rank-row__val strong)严格对应
  function countryBoardHtml(d) {
    var nats = ((d.foreignComposition || {}).nationalities || []).filter(function (r) { return r.code && r.code !== 'other'; });
    var max = nats.reduce(function (m, r) { return Math.max(m, r.count || 0); }, 1);
    return '<ul class="biz-rank-list">' + nats.map(function (r, i) {
      var rank = i + 1, name = escapeHtml(pick(r.name) || r.code);
      var barPct = Math.round(Math.sqrt((r.count || 0) / max) * 100);
      return '<li><a class="biz-rank-row' + (rank <= 3 ? ' is-top' : '') + '" href="/companies?country=' + encodeURIComponent(r.code) +
        '" data-iso="' + escapeHtml(r.code) + '" data-rank="' + rank + '" data-count="' + (r.count || 0) + '" data-name="' + name + '">' +
        '<span class="biz-rank-row__rank">' + rank + '</span>' +
        '<span class="biz-rank-row__main"><span class="biz-rank-row__name">' + name +
        '</span><span class="biz-rank-row__bar"><span style="width:' + barPct + '%"></span></span></span>' +
        '<span class="biz-rank-row__val"><strong>' + fmtNum(r.count) + '</strong><small>' + pct(r.share) + '</small></span>' +
        '</a></li>';
    }).join('') + '</ul>';
  }

  function industriesHtml(d) {
    return buildTable([ '#', t('business'), t('companies'), t('share') ],
      (d.businessTypes || []).map(function (r, i) {
        return [badge(i + 1), escapeHtml(pick(r.label)), fmtNum(r.count), pct(r.share)];
      }));
  }

  // /business-industry-overview(page-6)「行业构成」图标网格:19 个 TSIC 顶层大类(tsic-a..tsic-t,无 tsic-o)→ 强调色 + 线性图标,
  // 图标风格与首页 .starter-promo__icon 一致(24x24 stroke + .ind-fill 半透明填充),配色各不相同便于网格中区分类别
  var INDUSTRY_META = {
    'tsic-a': { color: '#16a34a', engslug: 'agriculture-forestry-fishing', icon: '<path class="ind-fill" d="M6 20C4 12 9 5 18 4c1 9-6 15-12 16z"/><path d="M6 20 16 8"/>' },
    'tsic-b': { color: '#92400e', engslug: 'mining-quarrying', icon: '<path class="ind-fill" d="M12 3 5 9l7 12 7-12-7-6z"/><path d="M5 9h14M9 9 12 21M15 9 12 21M12 3 9 9M12 3l3 6"/>' },
    'tsic-c': { color: '#2563eb', engslug: 'manufacturing', icon: '<path class="ind-fill" d="M4 20v-8l4 2.5V12l4 2.5V12l4 2.5V20H4z"/><path d="M4 20h16M7 9V5.5M17 9V5.5"/>' },
    'tsic-d': { color: '#f59e0b', engslug: 'electricity-gas-supply', icon: '<path class="ind-fill" d="M13 2 5 14h6l-1 8 9-12h-6l1-8z"/>' },
    'tsic-e': { color: '#0891b2', engslug: 'water-supply-waste-management', icon: '<path class="ind-fill" d="M12 3c4 5 6.5 8.8 6.5 11.8a6.5 6.5 0 1 1-13 0C5.5 11.8 8 5 12 3z"/>' },
    'tsic-f': { color: '#ea580c', engslug: 'construction', icon: '<path class="ind-fill" d="M4 16a8 8 0 0 1 16 0v1H4v-1z"/><path d="M12 6.5v3M2.5 17h19"/>' },
    'tsic-g': { color: '#7901b2', engslug: 'wholesale-retail-trade', icon: '<path class="ind-fill" d="M5 8h14l-1.2 12.5a1 1 0 0 1-1 .9H7.2a1 1 0 0 1-1-.9L5 8z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>' },
    'tsic-h': { color: '#0d9488', engslug: 'transportation-storage', icon: '<path class="ind-fill" d="M3 7h10v9H3z"/><path d="M13 10h4l3 3v3h-7v-6zM3 16h1M20 16h1"/><circle cx="7.5" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/>' },
    'tsic-i': { color: '#e11d48', engslug: 'accommodation-food-service', icon: '<path class="ind-fill" d="M5 10h11v5a5.5 5.5 0 0 1-5.5 5.5H10.5A5.5 5.5 0 0 1 5 15v-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1-1 1-1 2M12 3.5c0 1-1 1-1 2"/>' },
    'tsic-j': { color: '#4f46e5', engslug: 'information-communication', icon: '<path d="M4 10a12 12 0 0 1 16 0M7 13.5a7.5 7.5 0 0 1 10 0"/><circle class="ind-fill" cx="12" cy="17.5" r="2.2"/>' },
    'tsic-k': { color: '#059669', engslug: 'finance-insurance', icon: '<path class="ind-fill" d="M3 9 12 4l9 5v1.5H3V9z"/><path d="M4 11v7M9 11v7M15 11v7M20 11v7M2.5 20h19"/>' },
    'tsic-l': { color: '#8b5cf6', engslug: 'real-estate', icon: '<path class="ind-fill" d="M5 11 12 5l7 6v9H5v-9z"/><path d="M10 20v-6h4v6"/>' },
    'tsic-m': { color: '#0ea5e9', engslug: 'professional-scientific-technical', icon: '<path class="ind-fill" d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4A1.5 1.5 0 0 0 19.5 19L14 9.5V3"/><path d="M8.5 3h7M8 15h8"/>' },
    'tsic-n': { color: '#64748b', engslug: 'administrative-support-service', icon: '<path class="ind-fill" d="M4 9h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V9z"/><path d="M9 9V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V9M4 13h16"/>' },
    'tsic-p': { color: '#4338ca', engslug: 'education', icon: '<path class="ind-fill" d="M12 4 2 9l10 5 10-5-10-5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5M21 9v6"/>' },
    'tsic-q': { color: '#dc2626', engslug: 'health-social-work', icon: '<path class="ind-fill" d="M12 20s-7-4.5-9-9.5C1.5 6 4 3.5 7 3.5c2 0 3.7 1.2 5 3 1.3-1.8 3-3 5-3 3 0 5.5 2.5 4 7-2 5-9 9.5-9 9.5z"/>' },
    'tsic-r': { color: '#c026d3', engslug: 'arts-entertainment-recreation', icon: '<path class="ind-fill" d="M12 4a8 8 0 1 0 0 16h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1-2.6H17a4 4 0 0 0 4-4c0-3.3-4-6-9-6z"/><circle cx="8.2" cy="11" r=".9"/><circle cx="11.5" cy="8.3" r=".9"/><circle cx="15.3" cy="9.5" r=".9"/>' },
    'tsic-s': { color: '#6b7280', engslug: 'other-service-activities', icon: '<path class="ind-fill" d="M14.7 6.3a3.5 3.5 0 0 0-4.6 4.2L4 16.6V20h3.4l6.1-6.1a3.5 3.5 0 0 0 4.2-4.6l-2.5 2.5-2-2 2.5-2.5a3.5 3.5 0 0 0-1.9-.6z"/>' },
    'tsic-t': { color: '#a16207', engslug: 'household-employment-activities', icon: '<path class="ind-fill" d="M6 12 12 7l6 5v7a1 1 0 0 1-1 1h-3v-5H10v5H7a1 1 0 0 1-1-1v-7z"/><circle cx="12" cy="4" r="1.4"/>' }
  };
  function industryIcon(key) {
    return INDUSTRY_META[key] || { color: '#7901b2', icon: '<circle class="ind-fill" cx="12" cy="12" r="8"/>' };
  }
  // 行业构成图标网格:占比按「已分类行业合计」重新计算(而非 API 原始 share,那是相对全库含未分类企业的粗粒度百分比,
  // 19 个大类里有近一半会四舍五入成 0%);网格卡片底部的比例条按 count/max 换算,最大类别的条视觉上"满格",直观体现构成差异
  function industryGridHtml(d) {
    var rows = (d.businessTypes || []).filter(function (r) { return r.count > 0; });
    if (!rows.length) return '<p class="biz-report-empty">' + escapeHtml(t('noData')) + '</p>';
    var total = rows.reduce(function (a, r) { return a + r.count; }, 0) || 1;
    var max = rows.reduce(function (m, r) { return Math.max(m, r.count); }, 1);
    return '<div class="biz-ind-grid">' + rows.map(function (r) {
      var meta = industryIcon(r.key);
      var barPct = Math.round(r.count / max * 100);
      var finePct = (r.count / total * 100).toFixed(1);
      // 直接落地扁平 canonical URL(而非 /t/industry/<slug>),避免落地后被 convergeUrl() 悄悄 replaceState 到扁平页,
      // 让链接文本与实际落地页不一致(SEO 工具会把这种落地页跳变判成跳转链)
      var indHref = meta.engslug ? ('/industry-' + meta.engslug + '.html') : ('/t/industry/' + encodeURIComponent(r.key));
      return '<a class="biz-ind-card" href="' + indHref + '" style="--ind-accent:' + meta.color + '">' +
        '<span class="biz-ind-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + meta.icon + '</svg></span>' +
        '<span class="biz-ind-card__body">' +
        '<strong class="biz-ind-card__name">' + escapeHtml(pick(r.label)) + '</strong>' +
        '<span class="biz-ind-card__meta"><strong>' + fmtNum(r.count) + '</strong> · ' + finePct + '%</span>' +
        '</span>' +
        '<span class="biz-ind-card__bar"><span style="width:' + barPct + '%"></span></span>' +
        '</a>';
    }).join('') + '</div>';
  }

  // 公司卡片(latestCards/leadCards 共用):与 buildTable 的 topCapital/latest 用的是同一份公司数据形状
  function companyCardHtml(r) {
    var name = pick(r.name) || r.code;
    var href = window.__starterCompanyHref(r.code, r.name && r.name.en);
    return '<a class="biz-industry-item" href="' + escapeHtml(href) + '">' +
      '<span class="biz-industry-item__body">' +
      '<strong class="biz-industry-item__name">' + escapeHtml(name) + '</strong>' +
      '<span class="biz-industry-item__sub">' +
      '<span class="biz-industry-item__obj">' + escapeHtml(pick(r.business)) + '</span>' +
      '<span class="biz-industry-item__jpno">' + escapeHtml(pick(r.province)) + (r.regDate ? ' · ' + escapeHtml(dualDate(r.regDate)) : '') + '</span>' +
      '</span></span>' +
      '<span class="biz-industry-item__aside"><span class="biz-industry-item__cap">' + moneyCompact(r.capital) + '</span></span>' +
      '</a>';
  }
  function companyCardsHtml(rows) {
    if (!rows || !rows.length) return '<p class="biz-report-empty">' + escapeHtml(t('noData')) + '</p>';
    return '<div class="biz-industry-list">' + rows.map(companyCardHtml).join('') + '</div>';
  }

  // 通用横向柱状图数据块(供 [data-hbar] 模块消费):items = [{label, value}],按 value 降序传入
  function hbarHtml(items, opts) {
    opts = opts || {};
    var fmt = opts.money ? moneyCompact : fmtNum;
    var ranges = opts.ranges || [10, 20];
    var series = items.map(function (r) { return { label: r.label, value: r.value }; });
    var pills = ranges.map(function (n, i) {
      return '<button type="button" class="biz-newchart__pill' + (i === 0 ? ' is-active' : '') + '" data-hbarrange="' + n + '">' + n + '</button>';
    }).join('');
    var max = items.reduce(function (m, r) { return Math.max(m, r.value || 0); }, 1);
    var rows = items.map(function (r, i) {
      var barPct = Math.round((r.value || 0) / max * 100);
      return '<li class="biz-newchart__row"' + (i >= ranges[0] ? ' hidden' : '') + '>' +
        '<span class="biz-newchart__year">' + escapeHtml(r.label) + '</span>' +
        '<span class="biz-newchart__track"><span style="width:' + barPct + '%"></span></span>' +
        '<span class="biz-newchart__figure"><strong>' + fmt(r.value) + '</strong></span>' +
        '</li>';
    }).join('');
    return '<div data-hbar data-hbar-money="' + (opts.money ? '1' : '0') + '">' +
      '<div class="biz-newchart__bar"><div class="biz-newchart__pills" data-hbar-range>' + pills + '</div></div>' +
      '<div class="biz-newchart__canvas"><canvas data-hbar-canvas></canvas></div>' +
      '<script type="application/json" data-hbar-series>' + JSON.stringify(series).replace(/</g, '\\u003c') + '</script>' +
      '<ul class="biz-newchart__list" data-hbar-list>' + rows + '</ul>' +
      '</div>';
  }

  // 历年图表数据块(供 [data-newchart] 模块消费);列表按最新在前展示,图表本身按年份升序
  function newChartHtml(years) {
    var series = years.map(function (r, i) {
      return { y: dualYear(r.year), count: r.companyCount, capital: r.registeredCapital, partial: i === years.length - 1 };
    });
    var listYears = years.slice().reverse();
    var max = years.reduce(function (m, r) { return Math.max(m, r.companyCount || 0); }, 1);
    var rows = listYears.map(function (r, i) {
      var barPct = Math.round((r.companyCount || 0) / max * 100);
      return '<li class="biz-newchart__row"' + (i >= 10 ? ' hidden' : '') + '>' +
        '<span class="biz-newchart__year">' + escapeHtml(dualYear(r.year)) + '</span>' +
        '<span class="biz-newchart__track"><span style="width:' + barPct + '%"></span></span>' +
        '<span class="biz-newchart__figure"><strong>' + fmtNum(r.companyCount) + '</strong></span>' +
        '</li>';
    }).join('');
    return '<div data-newchart>' +
      '<div class="biz-newchart__bar">' +
      '<div class="biz-newchart__pills" data-newchart-metric>' +
      '<button type="button" class="biz-newchart__pill is-active" data-metric="count">' + escapeHtml(t('newCompanies')) + '</button>' +
      '<button type="button" class="biz-newchart__pill" data-metric="capital">' + escapeHtml(t('registeredCapital')) + '</button>' +
      '</div>' +
      '<div class="biz-newchart__pills" data-newchart-range>' +
      '<button type="button" class="biz-newchart__pill is-active" data-range="10">10</button>' +
      '<button type="button" class="biz-newchart__pill" data-range="5">5</button>' +
      '</div></div>' +
      '<div class="biz-newchart__canvas"><canvas data-newchart-canvas></canvas></div>' +
      '<script type="application/json" data-newchart-series>' + JSON.stringify(series).replace(/</g, '\\u003c') + '</script>' +
      '<ul class="biz-newchart__list" data-newchart-list>' + rows + '</ul>' +
      '</div>';
  }

  // 府英文名 → SVG data-prov-eng 用的短横线 slug;与后端 listProvinces()/industrySections() 同一套转换,已核对一致
  function slugifyEn(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  // /regions 给出府 taxonomy slug(用于 /companies?province= 跳转);只有行业透视(无 provinceSlug)时才需要,惰性拉取一次
  var regionsPromise = null;
  function loadRegions() {
    return regionsPromise || (regionsPromise = fetch('/api/site/v1/analytics/regions', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.provinces) || []; })
      .catch(function () { return []; }));
  }

  function provinceRowsHtml(rows) {
    return '<ul class="biz-rank-list">' + rows.map(function (r) {
      var eng = slugifyEn(r.province.en), name = escapeHtml(pick(r.province));
      return '<li><a class="biz-rank-row' + (r.rank <= 3 ? ' is-top' : '') + '" href="' + escapeHtml(r.href) +
        '" data-prov-eng="' + escapeHtml(eng) + '" data-rank="' + r.rank + '" data-name="' + name + '">' +
        '<span class="biz-rank-row__rank">' + r.rank + '</span>' +
        '<span class="biz-rank-row__main"><span class="biz-rank-row__name">' + name + '</span>' +
        '<span class="biz-rank-row__bar"><span style="width:' + r.barPct + '%"></span></span></span>' +
        '<span class="biz-rank-row__val"><strong>' + r.value + '</strong><small>' + r.valueSmall + '</small></span>' +
        '</a></li>';
    }).join('') + '</ul>';
  }
  function defaultProvinceBoardRows(d) {
    var rows = d.provinceRanking || [];
    // 排序依据(?sort=count_desc)决定哪个指标是主指标——不仅决定排序,也决定哪个值加粗放大置顶(value)、
    // 哪个值缩小放在下面(valueSmall),以及排行条 barPct 跟着哪个指标算,三者须与当前排序一致
    var byCount = new URLSearchParams(window.location.search).get('sort') === 'count_desc';
    var max = rows.reduce(function (m, r) { return Math.max(m, (byCount ? r.companyCount : r.registeredCapital) || 0); }, 1);
    return rows.map(function (r) {
      var capitalText = moneyCompact(r.registeredCapital), countText = fmtNum(r.companyCount) + ' ' + t('companies');
      return {
        rank: r.rank, province: r.province,
        href: '/companies?province=' + encodeURIComponent(r.provinceSlug || ''),
        value: byCount ? countText : capitalText, valueSmall: byCount ? capitalText : countText,
        barPct: Math.round(Math.sqrt(((byCount ? r.companyCount : r.registeredCapital) || 0) / max) * 100),
      };
    });
  }

  var FILLERS = {
    metrics: function (el, d) {
      var fc = d.foreignComposition || {};
      var TILE = {
        total: [t('tileTotal'), fmtNum(d.total)],
        capital: [t('tileCapital'), moneyCompact(d.sampleCapital)],
        avg: [t('tileAvg'), moneyCompact(d.avgCapital)],
        foreign: [t('tileForeign'), pct(d.foreignShare)],
        foreignTotal: [t('tileForeignTotal'), fmtNum(fc.foreignTotal)],
        thaiTotal: [t('tileThaiTotal'), fmtNum(fc.thaiTotal)],
        industries: [t('tileIndustries'), fmtNum((d.businessTypes || []).length)]
      };
      var tiles = (el.getAttribute('data-tiles') || '').split(',');
      el.innerHTML = tiles.map(function (k) {
        var p = TILE[k.trim()];
        if (!p) return '';
        return '<div class="biz-an-tile"><span class="biz-an-tile__label">' + escapeHtml(p[0]) +
          '</span><strong class="biz-an-tile__value">' + escapeHtml(p[1]) + '</strong></div>';
      }).join('');
    },
    provinces: function (el, d) {
      el.innerHTML = buildTable([ '#', t('province'), t('companies'), t('registeredCapital'), t('avgCapital') ],
        (d.provinceRanking || []).map(function (r, i) {
          return [badge(r.rank || i + 1), escapeHtml(pick(r.province)), fmtNum(r.companyCount), moneyCompact(r.registeredCapital), moneyCompact(r.avgCapital)];
        }));
    },
    nationalities: function (el, d) { el.innerHTML = nationalitiesHtml(d); },
    capitalSource: function (el, d) { el.innerHTML = capitalSourceHtml(d); },
    // /business-foreign-capital(page-4):国家排行 + 世界地图联动列表,原先模板引用但从未实现,地图恒灰
    foreignSpotlight: function (el, d) { el.innerHTML = capitalSourceHtml(d) + nationalitiesHtml(d); },
    countryBoard: function (el, d) { el.innerHTML = countryBoardHtml(d); },
    industries: function (el, d) { el.innerHTML = industriesHtml(d); },
    industrySpotlight: function (el, d) { el.innerHTML = industryGridHtml(d); },
    industryChart: function (el, d) {
      el.innerHTML = hbarHtml((d.businessTypes || []).map(function (r) { return { label: pick(r.label), value: r.count }; }));
    },
    // /business-owner-shareholder-leads(page-8):与 page-4 的 foreignSpotlight 同一份数据,不同页面语境下的展示名
    ownerSpotlight: function (el, d) { el.innerHTML = capitalSourceHtml(d) + nationalitiesHtml(d); },
    nationalityChart: function (el, d) {
      var nats = ((d.foreignComposition || {}).nationalities || []).filter(function (r) { return r.code && r.code !== 'other'; });
      el.innerHTML = hbarHtml(nats.map(function (r) { return { label: pick(r.name) || r.code, value: r.count }; }));
    },
    leadCards: function (el, d) { el.innerHTML = companyCardsHtml(d.topCapitalCompanies); },
    latestCards: function (el, d) { el.innerHTML = companyCardsHtml(d.latestCompanies); },
    yearChips: function (el, d) {
      var years = (d.newCompaniesByYear || []).slice().sort(function (a, b) { return b.year - a.year; });
      el.innerHTML = '<div class="biz-fl-chips">' + years.map(function (r) {
        return '<a class="biz-fl-chip" href="/new-companies-' + r.year + '.html">' + escapeHtml(dualYear(r.year)) + '</a>';
      }).join('') + '</div>';
    },
    newChart: function (el, d) { el.innerHTML = newChartHtml(d.newCompaniesByYear || []); },
    newSpotlight: function (el, d) {
      var ys = d.newCompaniesByYear || [];
      var cur = ys[ys.length - 1], prev = ys[ys.length - 2];
      var tiles = [];
      if (cur) {
        tiles.push([t('newCompanies') + ' · ' + dualYear(cur.year), fmtNum(cur.companyCount)]);
        tiles.push([t('registeredCapital') + ' · ' + dualYear(cur.year), moneyCompact(cur.registeredCapital)]);
      }
      if (prev) {
        tiles.push([t('newCompanies') + ' · ' + dualYear(prev.year), fmtNum(prev.companyCount)]);
        tiles.push([t('registeredCapital') + ' · ' + dualYear(prev.year), moneyCompact(prev.registeredCapital)]);
      }
      el.innerHTML = '<div class="biz-an-metrics">' + tiles.map(function (p) {
        return '<div class="biz-an-tile"><span class="biz-an-tile__label">' + escapeHtml(p[0]) +
          '</span><strong class="biz-an-tile__value">' + escapeHtml(p[1]) + '</strong></div>';
      }).join('') + '</div>';
    },
    provinceChart: function (el, d) {
      el.innerHTML = hbarHtml((d.provinceRanking || []).map(function (r) { return { label: pick(r.province), value: r.registeredCapital }; }), { money: true });
    },
    summarySpotlight: function (el, d) {
      var top = (d.provinceRanking || [])[0];
      var tiles = [[t('tileTotal'), fmtNum(d.total)], [t('tileForeign'), pct(d.foreignShare)]];
      if (top) {
        tiles.push([t('topProvince'), escapeHtml(pick(top.province))]);
        tiles.push([t('registeredCapital') + ' · ' + escapeHtml(pick(top.province)), moneyCompact(top.registeredCapital)]);
      }
      el.innerHTML = '<div class="biz-an-metrics">' + tiles.map(function (p) {
        return '<div class="biz-an-tile"><span class="biz-an-tile__label">' + p[0] +
          '</span><strong class="biz-an-tile__value">' + p[1] + '</strong></div>';
      }).join('') + '</div>';
    },
    // /business-regional-investment-map(page-7)与 /regional-rankings(page-11)共用:默认用同一份 provinceRanking;
    // page-7 的 ?industry= 透视需要另一份 industry-provinces 数据(无 provinceSlug),拉取 /regions 反查 taxonomy slug
    provincesBoard: function (el, d) {
      el.innerHTML = provinceRowsHtml(defaultProvinceBoardRows(d));
      var industry = new URLSearchParams(window.location.search).get('industry');
      if (!industry) return;
      Promise.all([
        fetch('/api/site/v1/analytics/industry-provinces?industry=' + encodeURIComponent(industry), { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; }),
        loadRegions(),
      ]).then(function (res) {
        var data = res[0], regions = res[1];
        if (!data || !data.provinceRanking) return;
        var zhToRegion = {};
        regions.forEach(function (p) { if (p.name) zhToRegion[p.name.zh] = p; });
        var rows = data.provinceRanking;
        var max = rows.reduce(function (m, r) { return Math.max(m, r.registeredCapital || 0); }, 1);
        var built = rows.map(function (r, i) {
          // province.en 来自 thaicompany_facts 原始抓取字段(大小写/空格不规范,如 "BURI RAM"),
          // 与 SVG/taxonomy 用的规范英文名("Buriram")不一致;能匹配上 /regions 时改用规范名,保证 data-prov-eng 和跳转 slug 都对得上
          var region = zhToRegion[r.province.zh];
          return {
            rank: i + 1, province: region ? region.name : r.province,
            href: '/companies?province=' + encodeURIComponent(region ? region.slug : ''),
            value: moneyCompact(r.registeredCapital), valueSmall: fmtNum(r.companyCount) + ' ' + t('companies'),
            barPct: Math.round(Math.sqrt((r.registeredCapital || 0) / max) * 100),
          };
        });
        el.innerHTML = provinceRowsHtml(built);
        var titleEl = document.querySelector('[data-biz-fill="boardTitle"]');
        if (titleEl && data.industryName) titleEl.textContent = pick(data.industryName);
        // 这次是板块内容第二次替换(行业透视覆盖了默认榜单),thmap 模块得再扫一遍才能按新数据重新上色
        document.dispatchEvent(new CustomEvent('biz:rendered'));
      }).catch(function () {});
    },
    // 默认保留模板里的 SSR <wc-t> 文案;仅 page-7 选中 ?industry= 时由 provincesBoard 异步改写
    boardTitle: function () {},
    industryChipsFill: function (el) {
      fetch('/api/site/v1/analytics/industry-sections', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var sections = (j && j.sections) || [];
          var cur = new URLSearchParams(window.location.search).get('industry') || '';
          var chips = ['<a class="biz-fl-chip' + (!cur ? ' is-active' : '') + '" data-ind-slug="" href="?">' + escapeHtml(t('allIndustries')) + '</a>']
            .concat(sections.map(function (s) {
              return '<a class="biz-fl-chip' + (s.slug === cur ? ' is-active' : '') + '" data-ind-slug="' + escapeHtml(s.slug) +
                '" href="?industry=' + encodeURIComponent(s.slug) + '">' + escapeHtml(pick(s.name)) + '</a>';
            }));
          el.innerHTML = '<div class="biz-fl-chips" data-map-indchips>' + chips.join('') + '</div>';
        }).catch(function () { el.innerHTML = ''; });
    },
    // 经营状态:改用比例条(风格与 capitalSourceHtml 一致)而非纯文字列表;「运营中」(key===1)高亮为品牌色,其余状态统一用默认色,
    // 不对 DBD 其余状态码(清算/解散/破产等)做进一步语义猜测配色
    statuses: function (el, d) {
      var st = d.statuses || [];
      el.innerHTML = '<div class="biz-an-bars biz-an-bars--split">' + st.map(function (r) {
        var p = (r.share || 0) * 100;
        return '<div class="biz-an-bar"><div class="biz-an-bar__head"><span>' + escapeHtml(pick(r.label) || r.key) +
          '</span><span>' + fmtNum(r.count) + (r.share != null ? ' · ' + pct(r.share) : '') + '</span></div>' +
          '<div class="biz-an-bar__track"><div class="biz-an-bar__fill' + (r.key === '1' ? ' is-active' : '') +
          '" style="width:' + p.toFixed(1) + '%"></div></div></div>';
      }).join('') + '</div>';
    },
    topCapital: function (el, d) {
      el.innerHTML = buildTable([ '#', t('company'), t('province'), t('business'), t('registeredCapital') ],
        (d.topCapitalCompanies || []).map(function (r, i) {
          var name = pick(r.name) || r.code;
          var cell = '<a href="' + escapeHtml(window.__starterCompanyHref(r.code, r.name && r.name.en)) + '" class="biz-an-link"><strong>' +
            escapeHtml(name) + '</strong><small>' + escapeHtml(r.code) + '</small></a>';
          return [badge(i + 1), cell, escapeHtml(pick(r.province)), escapeHtml(pick(r.business)), moneyCompact(r.capital)];
        }));
    },
    years: function (el, d) {
      var ys = (d.newCompaniesByYear || []).slice().sort(function (a, b) { return b.year - a.year; });
      el.innerHTML = buildTable([ t('year'), t('newCompanies'), t('registeredCapital'), t('avgCapital') ],
        ys.map(function (r) {
          return [escapeHtml(dualYear(r.year)), fmtNum(r.companyCount), moneyCompact(r.registeredCapital), moneyCompact(r.avgCapital)];
        }));
    },
    latest: function (el, d) {
      el.innerHTML = buildTable([ '#', t('company'), t('province'), t('regDate') ],
        (d.latestCompanies || []).map(function (r, i) {
          var name = pick(r.name) || r.code;
          var cell = '<a href="' + escapeHtml(window.__starterCompanyHref(r.code, r.name && r.name.en)) + '" class="biz-an-link"><strong>' +
            escapeHtml(name) + '</strong><small>' + escapeHtml(r.code) + '</small></a>';
          return [badge(i + 1), cell, escapeHtml(pick(r.province)), escapeHtml(dualDate(r.regDate))];
        }));
    }
  };

  // 先本地化静态文案(不等数据)
  each('[data-biz-label]', function (el) { var k = el.getAttribute('data-biz-label'); if (LABELS[k]) el.textContent = t(k); });
  each('[data-biz-ph]', function (el) { var k = el.getAttribute('data-biz-ph'); if (LABELS[k]) el.setAttribute('placeholder', t(k)); });

  // resolver 已服务端注入数据(data-biz-ssr)→ 跳过客户端 fetch(数据已在 HTML 里,爬虫可抓;切换语言走子域名重渲染)
  if (root.getAttribute('data-biz-ssr')) return;

  function render(d) {
    each('[data-biz-fill]', function (el) {
      var fn = FILLERS[el.getAttribute('data-biz-fill')];
      if (fn) { try { fn(el, d); } catch (e) { el.innerHTML = ''; } }
    });
    each('[data-biz-refreshed]', function (el) { if (d.refreshedAt) el.textContent = t('refreshed') + ' · ' + fmtDateTime(d.refreshedAt); });
    var s = root.querySelector('[data-biz-status]'); if (s) s.hidden = true;
  }
  function showError() {
    var s = root.querySelector('[data-biz-status]');
    if (s) { s.textContent = t('loadError'); s.hidden = false; }
  }

  var statusEl = root.querySelector('[data-biz-status]');
  if (statusEl) statusEl.textContent = t('loading');
  // limit 控制 provinceRanking 条数;泰国全境只有 77 个府,provincesBoard/thmap 要给全部 77 个上色,
  // 不能只给 top 20——之前用 20 会导致地图上一大半府因为榜单里根本没有它的行,永远上不了色(看着像"缺数据")
  var URL = '/api/site/v1/analytics/business?limit=100&businessLimit=25&foreignLimit=20&statusLimit=10&latestLimit=10';
  var __sort = new URLSearchParams(window.location.search).get('sort');
  if (__sort) URL += '&sort=' + encodeURIComponent(__sort);
  fetch(URL, { headers: { 'Accept': 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
    .then(function (d) {
      if (!d || typeof d !== 'object') throw new Error('nodata');
      render(d);
      // provincesBoard/countryBoard 是这里异步填的;地图模块(thmap/worldmap)脚本先执行、板块当时还是空的,
      // 靠这个事件通知它们数据已就绪、该重新扫一遍 board 上色了(否则地图永远读到空板块,恒灰)
      document.dispatchEvent(new CustomEvent('biz:rendered'));
    })
    .catch(function () { showError(); });
})();

/* ===== 商业报告页筛选:控件变更即导航到带参数 URL(resolver 服务端按参数重渲染;每组合都是可抓取的 SSR 页)===== */
(function () {
  var controls = document.querySelectorAll('[data-biz-filter]');
  if (!controls.length) return;
  var params = new URLSearchParams(window.location.search);
  Array.prototype.forEach.call(controls, function (el) {
    var key = el.getAttribute('data-biz-filter');
    var cur = params.get(key);
    if (cur != null && el.options) {
      var has = Array.prototype.some.call(el.options, function (o) { return o.value === cur; });
      if (has) el.value = cur;
    }
    el.addEventListener('change', function () {
      var p = new URLSearchParams(window.location.search);
      if (el.value) p.set(key, el.value); else p.delete(key);
      var qs = p.toString();
      window.location.href = window.location.pathname + (qs ? '?' + qs : '');
    });
  });
})();

/* ===== 精选榜单「上榜原因」弹窗(2026-07-06 新增):点表格里的按钮,弹窗展示该行服务端已经拼好的 ===== */
/* ===== 原因文字(data-reason 已经过 esc() 转义,这里走 textContent 赋值,不需要也不应该再转一次)===== */
(function () {
  var links = document.querySelectorAll('.biz-rank-reason-link');
  if (!links.length) return;
  var LANG = (document.documentElement.lang || 'en').toLowerCase();
  LANG = LANG.indexOf('zh') === 0 ? 'zh' : (LANG.indexOf('th') === 0 ? 'th' : 'en');
  var LABELS = {
    reasonModalTitle: { en: 'Why ranked', th: 'เหตุผลที่ติดอันดับ', zh: '上榜原因' },
    reasonModalClose: { en: 'Close', th: 'ปิด', zh: '关闭' },
  };
  function t(key) { var e = LABELS[key]; return e ? (e[LANG] || e.en) : key; }
  function escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var modalEl = null;
  function buildReasonModal() {
    if (modalEl) return modalEl;
    var el = document.createElement('div');
    el.className = 'biz-reason-modal'; el.setAttribute('data-reason-modal', ''); el.hidden = true;
    el.innerHTML =
      '<div class="biz-reason-modal__backdrop" data-reason-close></div>' +
      '<div class="biz-reason-modal__card" role="dialog" aria-modal="true" aria-label="' + escapeHtml(t('reasonModalTitle')) + '">' +
        '<button type="button" class="biz-reason-modal__x" data-reason-close aria-label="' + escapeHtml(t('reasonModalClose')) + '">×</button>' +
        '<h2 class="biz-reason-modal__title">' + escapeHtml(t('reasonModalTitle')) + '</h2>' +
        '<p class="biz-reason-modal__body" data-reason-modal-body></p>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-reason-close]')) closeReasonModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modalEl && !modalEl.hidden) closeReasonModal(); });
    modalEl = el; return el;
  }
  function openReasonModal(text) {
    var el = buildReasonModal();
    el.querySelector('[data-reason-modal-body]').textContent = text || '';
    el.hidden = false; document.body.classList.add('reason-modal-open');
  }
  function closeReasonModal() { if (!modalEl) return; modalEl.hidden = true; document.body.classList.remove('reason-modal-open'); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.biz-rank-reason-link');
    if (!btn) return;
    openReasonModal(btn.getAttribute('data-reason'));
  });
})();

/* ===== 新注册页「历年图表」:SSR 嵌入 JSON 序列 → Chart.js 柱状图 + 范围/指标切换(无刷新)+ 同步逐年明细 ===== */
(function () {
  var host = document.querySelector('[data-newchart]');
  if (!host) return;
  var dataEl = host.querySelector('[data-newchart-series]');
  var canvas = host.querySelector('[data-newchart-canvas]');
  if (!dataEl || !canvas) return;
  var series;
  try { series = JSON.parse(dataEl.textContent || '[]'); } catch (e) { return; }
  if (!series.length) return;

  var LANG = (document.documentElement.lang || 'en').toLowerCase();
  LANG = LANG.indexOf('zh') === 0 ? 'zh' : (LANG.indexOf('th') === 0 ? 'th' : 'en');
  function num(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(v) {
    var n = Number(v); if (!isFinite(n) || n === 0) return '฿0';
    var units = LANG === 'zh' ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
      : LANG === 'th' ? [[1e12, 'ล้านล้าน'], [1e9, 'พันล้าน'], [1e6, 'ล้าน']]
        : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i += 1) { if (Math.abs(n) >= units[i][0]) return '฿' + (n / units[i][0]).toFixed(1) + units[i][1]; }
    return '฿' + num(n);
  }
  function loadChart(cb) {
    if (window.Chart) { cb(); return; }
    if (window.__finChartCbs) { window.__finChartCbs.push(cb); return; }
    window.__finChartCbs = [cb];
    var sc = document.createElement('script');
    sc.src = '/theme-assets/starter/chart.umd.min.js';
    sc.onload = function () { var q = window.__finChartCbs || []; window.__finChartCbs = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
    sc.onerror = function () { window.__finChartCbs = null; };
    document.head.appendChild(sc);
  }

  var state = { range: 10, metric: 'count' };
  var chart = null;
  function viewSeries() { return series.slice(Math.max(0, series.length - state.range)); }
  function metricLabel() {
    var b = host.querySelector('[data-newchart-metric] [data-metric="' + state.metric + '"]');
    return b ? b.textContent : '';
  }
  function draw() {
    loadChart(function () {
      if (!window.Chart) return;
      var view = viewSeries();
      var isMoney = state.metric === 'capital';
      var fmt = function (v) { return isMoney ? money(v) : num(v); };
      var data = view.map(function (r) { return isMoney ? r.capital : r.count; });
      var colors = view.map(function (r) { return r.partial ? 'rgba(121,1,178,0.34)' : '#7901b2'; });
      if (chart) { chart.destroy(); chart = null; }
      chart = new window.Chart(canvas, {
        type: 'bar',
        data: { labels: view.map(function (r) { return r.y; }), datasets: [{ label: metricLabel(), data: data, backgroundColor: colors, borderRadius: 10, borderSkipped: false, maxBarThickness: 48 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, displayColors: false, callbacks: { title: function (c) { return c[0] ? c[0].label : ''; }, label: function (c) { return ' ' + metricLabel() + ': ' + fmt(c.parsed.y); } } }
          },
          scales: {
            x: { grid: { display: false }, border: { color: 'rgba(20,20,30,0.1)' }, ticks: { color: '#8a8594', font: { size: 11 } } },
            y: { grid: { color: 'rgba(20,20,30,0.06)' }, border: { display: false }, ticks: { color: '#8a8594', font: { size: 11 }, maxTicksLimit: 5, callback: function (v) { return fmt(v); } } }
          }
        }
      });
    });
  }
  function syncList() {
    var rows = host.querySelectorAll('[data-newchart-list] > li');
    Array.prototype.forEach.call(rows, function (li, i) { li.hidden = i >= state.range; });
  }
  function bindPills(group, attr, apply) {
    var wrap = host.querySelector(group);
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[' + attr + ']');
      if (!b) return;
      Array.prototype.forEach.call(wrap.querySelectorAll('[' + attr + ']'), function (x) { x.classList.toggle('is-active', x === b); });
      apply(b.getAttribute(attr));
      draw();
    });
  }
  bindPills('[data-newchart-range]', 'data-range', function (v) { state.range = parseInt(v, 10) || 10; syncList(); });
  bindPills('[data-newchart-metric]', 'data-metric', function (v) { state.metric = v; });
  syncList();
  draw();
})();

/* ===== 通用横向柱状图 [data-hbar]:SSR 嵌入 JSON → Chart.js 横向柱状图 + 前10/前20 切换(无刷新)+ 同步明细 ===== */
/* 外资国籍 / 府注册资本 / 行业大类等共用;data-hbar-money 时金额格式化轴与 tooltip;一页可多个 ===== */
(function () {
  var LANG = (document.documentElement.lang || 'en').toLowerCase();
  LANG = LANG.indexOf('zh') === 0 ? 'zh' : (LANG.indexOf('th') === 0 ? 'th' : 'en');
  function num(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(v) {
    var n = Number(v); if (!isFinite(n) || n === 0) return '฿0';
    var units = LANG === 'zh' ? [[1e12, '万亿'], [1e8, '亿'], [1e4, '万']]
      : LANG === 'th' ? [[1e12, 'ล้านล้าน'], [1e9, 'พันล้าน'], [1e6, 'ล้าน']]
        : [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < units.length; i += 1) { if (Math.abs(n) >= units[i][0]) return '฿' + (n / units[i][0]).toFixed(1) + units[i][1]; }
    return '฿' + num(n);
  }
  function loadChart(cb) {
    if (window.Chart) { cb(); return; }
    if (window.__finChartCbs) { window.__finChartCbs.push(cb); return; }
    window.__finChartCbs = [cb];
    var sc = document.createElement('script');
    sc.src = '/theme-assets/starter/chart.umd.min.js';
    sc.onload = function () { var q = window.__finChartCbs || []; window.__finChartCbs = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
    sc.onerror = function () { window.__finChartCbs = null; };
    document.head.appendChild(sc);
  }
  function initHbar(host) {
    if (host.__hbarInit) return;
    var dataEl = host.querySelector('[data-hbar-series]');
    var canvas = host.querySelector('[data-hbar-canvas]');
    if (!dataEl || !canvas) return;
    host.__hbarInit = true;
    var series;
    try { series = JSON.parse(dataEl.textContent || '[]'); } catch (e) { return; }
    if (!series.length) return;
    var isMoney = host.getAttribute('data-hbar-money') === '1';
    var fmt = function (v) { return isMoney ? money(v) : num(v); };
    var state = { range: 10 };
    var chart = null;
    function view() { return series.slice(0, state.range); }
    function draw() {
      loadChart(function () {
        if (!window.Chart) return;
        var v = view();
        if (chart) { chart.destroy(); chart = null; }
        chart = new window.Chart(canvas, {
          type: 'bar',
          data: { labels: v.map(function (r) { return r.label; }), datasets: [{ data: v.map(function (r) { return r.value; }), backgroundColor: '#7901b2', borderRadius: 10, borderSkipped: false, maxBarThickness: 22 }] },
          options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { backgroundColor: '#18181b', padding: 10, cornerRadius: 10, displayColors: false, callbacks: { label: function (c) { return ' ' + fmt(c.parsed.x); } } } },
            scales: {
              x: { grid: { color: 'rgba(20,20,30,0.06)' }, border: { display: false }, ticks: { color: '#8a8594', font: { size: 11 }, maxTicksLimit: 5, callback: function (val) { return fmt(val); } } },
              y: { grid: { display: false }, border: { color: 'rgba(20,20,30,0.1)' }, ticks: { color: '#6b5d73', font: { size: 12 } } }
            }
          }
        });
      });
    }
    function syncList() {
      var rows = host.querySelectorAll('[data-hbar-list] > li');
      Array.prototype.forEach.call(rows, function (li, i) { li.hidden = i >= state.range; });
    }
    var wrap = host.querySelector('[data-hbar-range]');
    if (wrap) wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-hbarrange]');
      if (!b) return;
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-hbarrange]'), function (x) { x.classList.toggle('is-active', x === b); });
      state.range = parseInt(b.getAttribute('data-hbarrange'), 10) || 10;
      syncList();
      draw();
    });
    syncList();
    draw();
  }
  // industryChart/nationalityChart/provinceChart 等 [data-hbar] 内容都是 biz-analytics 模块异步 fetch 完才由
  // data-biz-fill 填入的,这个 IIFE 脚本执行时对应 DOM 通常还不存在(此前 querySelectorAll 一次拿到 0 个就直接 return,
  // 图表canvas 因此从未真正初始化过);和 thmap/worldmap 一样,把扫描逻辑抽成 refresh(),此刻先跑一次(兜底 SSR 场景),
  // 再监听 biz:rendered 在数据到位后重扫一遍,initHbar 内部用 __hbarInit 防止同一个 host 被重复初始化
  function refresh() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-hbar]'), initHbar);
  }
  refresh();
  document.addEventListener('biz:rendered', refresh);
})();

/* ===== 股东/老板统一搜索:hero 表单回填 URL 的 q(结果由 resolver SSR 注入)===== */
(function () {
  var form = document.querySelector('[data-owner-search]');
  if (!form) return;
  var q = new URLSearchParams(window.location.search).get('q');
  var input = form.querySelector('[data-owner-q]');
  if (input && q) input.value = q;
})();

/* ===== 投资地图:行业 chips 按 ?industry 标记当前激活(SSR 已渲染对应行业的地图/排行)===== */
(function () {
  var wrap = document.querySelector('[data-map-indchips]');
  if (!wrap) return;
  var cur = new URLSearchParams(window.location.search).get('industry') || '';
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-ind-slug]'), function (a) {
    a.classList.toggle('is-active', a.getAttribute('data-ind-slug') === cur);
  });
})();

/* ===== 地区排名「泰国地图」模块:加载 SVG + 按排名 choropleth 上色 + 悬浮/点击联动右侧排行榜 ===== */
(function () {
  var host = document.querySelector('[data-thmap]');
  if (!host || !window.fetch) return;
  var board = document.querySelector('.biz-rank-map__board');
  var tip = document.querySelector('[data-thmap-tip]');
  function esc(v) { return v == null ? '' : String(v); }

  var byEng = {};
  var total = 1;
  var svgLoaded = false;

  function colorFor(rank) {
    if (!rank) return 'rgba(20,20,30,0.06)';
    var t = 1 - (rank - 1) / Math.max(1, total - 1);
    return 'rgba(121,1,178,' + (0.10 + t * 0.82).toFixed(3) + ')';
  }
  function hover(eng, on) {
    var p = host.querySelector('path[data-prov-eng="' + eng + '"]');
    if (p) p.classList.toggle('is-hot', on);
    if (byEng[eng]) byEng[eng].row.classList.toggle('is-hot', on);
  }
  function moveTip(e) {
    if (!tip || tip.hidden) return;
    var r = host.getBoundingClientRect();
    tip.style.left = (e.clientX - r.left) + 'px';
    tip.style.top = (e.clientY - r.top) + 'px';
  }
  function showTip(e, info) {
    if (!tip) return;
    tip.innerHTML = '<strong>' + esc(info.name) + '</strong><span>#' + info.rank + ' · ' + esc(info.val) + '</span>';
    tip.hidden = false; moveTip(e);
  }

  function paintMap() {
    if (!svgLoaded) return;
    Array.prototype.forEach.call(host.querySelectorAll('path[data-prov-eng]'), function (p) {
      var eng = p.getAttribute('data-prov-eng'), info = byEng[eng];
      p.classList.add('thmap-prov');
      p.style.fill = colorFor(info ? info.rank : 0);
      p.style.cursor = info ? 'pointer' : '';
    });
  }
  function bindRowHover() {
    Object.keys(byEng).forEach(function (eng) {
      var row = byEng[eng].row;
      if (row.__thmapBound) return;
      row.__thmapBound = true;
      row.addEventListener('mouseenter', function () { hover(eng, true); });
      row.addEventListener('mouseleave', function () { hover(eng, false); });
    });
  }
  // provincesBoard 是 biz-analytics 模块异步 fetch 完才填的;board 内容可能在这个 IIFE 跑完之后才出现,
  // 所以扫描逻辑单独抽出来,既在此刻跑一次(SSR/已有数据时管用),也监听 biz:rendered 在数据到位后重跑一次
  function refresh() {
    byEng = {};
    var rows = board ? board.querySelectorAll('.biz-rank-row') : [];
    total = rows.length || 1;
    Array.prototype.forEach.call(rows, function (row) {
      var eng = row.getAttribute('data-prov-eng'); if (!eng) return;
      var v = row.querySelector('.biz-rank-row__val strong');
      byEng[eng] = { rank: parseInt(row.getAttribute('data-rank'), 10) || 0, href: row.getAttribute('href'),
        name: row.getAttribute('data-name') || '', val: v ? v.textContent : '', row: row };
    });
    paintMap();
    bindRowHover();
  }
  refresh();
  document.addEventListener('biz:rendered', refresh);

  fetch(host.getAttribute('data-thmap-src')).then(function (r) { return r.ok ? r.text() : null; }).then(function (svg) {
    if (!svg) return;
    host.innerHTML = svg;
    svgLoaded = true;
    paintMap();
    Array.prototype.forEach.call(host.querySelectorAll('path[data-prov-eng]'), function (p) {
      var eng = p.getAttribute('data-prov-eng');
      p.addEventListener('mouseenter', function (e) { var info = byEng[eng]; if (info) { hover(eng, true); showTip(e, info); } });
      p.addEventListener('mousemove', moveTip);
      p.addEventListener('mouseleave', function () { hover(eng, false); if (tip) tip.hidden = true; });
      p.addEventListener('click', function () { var info = byEng[eng]; if (info && info.href) window.location.href = info.href; });
    });
  }).catch(function () { });
})();

/* ===== 外资页「世界地图」模块:加载世界 SVG + 按公司数 choropleth 上色 + 悬浮/点击联动右侧国家排行 ===== */
(function () {
  var host = document.querySelector('[data-worldmap]');
  if (!host || !window.fetch) return;
  var board = document.querySelector('[data-worldmap-board]');
  var tip = document.querySelector('[data-worldmap-tip]');
  function esc(v) { return v == null ? '' : String(v); }

  var byIso = {};
  var maxCount = 1;
  var svgLoaded = false;

  // 公司数差异极大 → 用 sqrt 压缩,弱者也可辨;无数据国家=浅灰底
  function colorFor(count) {
    if (!count) return 'rgba(20,20,30,0.06)';
    var t = Math.sqrt(count / maxCount);
    return 'rgba(121,1,178,' + (0.14 + t * 0.78).toFixed(3) + ')';
  }
  function hover(iso, on) {
    var p = host.querySelector('path[data-iso="' + iso + '"]');
    if (p) p.classList.toggle('is-hot', on);
    if (byIso[iso]) byIso[iso].row.classList.toggle('is-hot', on);
  }
  function moveTip(e) {
    if (!tip || tip.hidden) return;
    var r = host.getBoundingClientRect();
    tip.style.left = (e.clientX - r.left) + 'px';
    tip.style.top = (e.clientY - r.top) + 'px';
  }
  function showTip(e, info) {
    if (!tip) return;
    tip.innerHTML = '<strong>' + esc(info.name) + '</strong><span>#' + info.rank + ' · ' + esc(info.val) + '</span>';
    tip.hidden = false; moveTip(e);
  }

  function paintMap() {
    if (!svgLoaded) return;
    Array.prototype.forEach.call(host.querySelectorAll('path[data-iso]'), function (p) {
      var iso = p.getAttribute('data-iso'), info = byIso[iso];
      p.classList.add('worldmap-country');
      p.classList.toggle('has-data', Boolean(info));
      p.style.fill = colorFor(info ? info.count : 0);
      p.style.cursor = info ? 'pointer' : '';
    });
  }
  function bindRowHover() {
    Object.keys(byIso).forEach(function (iso) {
      var row = byIso[iso].row;
      if (row.__worldmapBound) return;
      row.__worldmapBound = true;
      row.addEventListener('mouseenter', function () { hover(iso, true); });
      row.addEventListener('mouseleave', function () { hover(iso, false); });
    });
  }
  // countryBoard 是 biz-analytics 模块异步 fetch 完才填的;board 内容可能在这个 IIFE 跑完之后才出现,
  // 所以扫描逻辑单独抽出来,既在此刻跑一次(SSR/已有数据时管用),也监听 biz:rendered 在数据到位后重跑一次
  function refresh() {
    byIso = {}; maxCount = 1;
    var rows = board ? board.querySelectorAll('.biz-rank-row') : [];
    Array.prototype.forEach.call(rows, function (row) {
      var iso = row.getAttribute('data-iso'); if (!iso) return;
      var c = parseInt(row.getAttribute('data-count'), 10) || 0;
      if (c > maxCount) maxCount = c;
    });
    Array.prototype.forEach.call(rows, function (row) {
      var iso = row.getAttribute('data-iso'); if (!iso) return;
      var v = row.querySelector('.biz-rank-row__val strong');
      byIso[iso] = { rank: parseInt(row.getAttribute('data-rank'), 10) || 0, href: row.getAttribute('href'),
        name: row.getAttribute('data-name') || '', count: parseInt(row.getAttribute('data-count'), 10) || 0,
        val: v ? v.textContent : '', row: row };
    });
    paintMap();
    bindRowHover();
  }
  refresh();
  document.addEventListener('biz:rendered', refresh);

  fetch(host.getAttribute('data-worldmap-src')).then(function (r) { return r.ok ? r.text() : null; }).then(function (svg) {
    if (!svg) return;
    host.innerHTML = svg;
    svgLoaded = true;
    paintMap();
    Array.prototype.forEach.call(host.querySelectorAll('path[data-iso]'), function (p) {
      var iso = p.getAttribute('data-iso');
      p.addEventListener('mouseenter', function (e) { var info = byIso[iso]; if (info) { hover(iso, true); showTip(e, info); } });
      p.addEventListener('mousemove', moveTip);
      p.addEventListener('mouseleave', function () { hover(iso, false); if (tip) tip.hidden = true; });
      p.addEventListener('click', function () { var info = byIso[iso]; if (info && info.href) window.location.href = info.href; });
    });
  }).catch(function () { });
})();

/* 地区排名排序 pill:按 URL ?sort 标记当前项(纯链接,非表单) */
(function () {
  var pills = document.querySelectorAll('[data-rank-sort]');
  if (!pills.length) return;
  var cur = new URLSearchParams(window.location.search).get('sort') || 'capital_desc';
  Array.prototype.forEach.call(pills, function (a) {
    if (a.getAttribute('data-rank-sort') === cur) a.classList.add('is-active');
  });
})();
/* ===== 首页公司列表:英文名输出 + 随机刷新 + 统计千分位 ===== */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function text(v) { return v == null ? '' : String(v); }
  function escapeHtml(v) {
    return text(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugifyName(name) {
    return text(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  }

  function formatStats() {
    var nums = document.querySelectorAll('.starter-stat__num, .biz-report-stat strong, .biz-company-stat strong');
    Array.prototype.forEach.call(nums, function (el) {
      var raw = text(el.textContent).replace(/[,\s]/g, '');
      if (/^\d{4,}$/.test(raw)) el.textContent = Number(raw).toLocaleString('en-US');
    });
  }

  // 公司名输出英文(SSR 已是 jpnamee);无英文名(约 3%)降级 data-fallback(泰文 title)。
  // 有英文名时把链接改写成规范的纯英文名 slug(利于 SEO);否则保留注册号 .html。
  function fixCloud(grid) {
    var items = grid.querySelectorAll('.starter-cloud__item');
    Array.prototype.forEach.call(items, function (item) {
      var name = text(item.textContent).trim();
      if (!name) { name = text(item.getAttribute('data-fallback')); item.textContent = name; }
      var slug = slugifyName(name);
      if (slug) item.setAttribute('href', '/' + slug + '.html');
    });
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('bad'); return r.json();
    });
  }

  // 真人访问时拉随机 offset 刷新列表(SSR 那份保持可抓取);公司名仍输出英文。
  function randomize(grid) {
    var limit = parseInt(grid.getAttribute('data-limit'), 10) || 60;
    var api = '/api/site/v1/models/thaicompany/entries';
    fetchJson(api + '?limit=1&offset=0').then(function (j) {
      var data = (j && j.data) || {};
      var total = Number(data.total) || 0;
      if (total <= limit) return null;
      var offset = Math.floor(Math.random() * (total - limit + 1));
      return fetchJson(api + '?limit=' + limit + '&offset=' + offset);
    }).then(function (j) {
      if (!j || !j.data || !j.data.items || !j.data.items.length) return;
      var html = j.data.items.map(function (it) {
        var meta = it.meta || {};
        var i18n = meta.i18n || {};
        var en = (i18n.en && i18n.en.name) || meta.jpnamee || '';
        var name = en || it.title || meta.jpno || '';
        var slug = slugifyName(en) || it.slug || encodeURIComponent(text(meta.jpno));
        return '<a class="starter-cloud__item" href="/' + escapeHtml(slug) + '.html">' + escapeHtml(name) + '</a>';
      }).join('');
      if (html) grid.innerHTML = html;
    }).catch(function () {});
  }

  ready(function () {
    formatStats();
    var grid = document.querySelector('[data-company-cloud]');
    if (!grid) return;
    fixCloud(grid);
    if (window.fetch) randomize(grid);
  });
})();

// 分类法归档列表(行业 /t/industry/<slug>):
// - 行业大类用 taxonomy-industry-<slug>.html,首屏 20 条由 wc-data 服务端渲染(爬虫可抓)+ SSR 准确总数,
//   JS 仅做三语切换(SSR 默认英文,th/zh 子域名按 data-* 属性替换)与第 2 页起的翻页。
// - 细类回退通用模板 taxonomy-industry.html(无 SSR 首屏),JS 客户端 fetch 首屏。
// site API 过滤已支持真实 total + limit + offset。
(function () {
  var root = document.querySelector('[data-industry-archive]');
  if (!root) return;

  function text(v) { return v == null ? '' : String(v); }
  function escapeHtml(v) {
    return text(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function metaValue(m, lower, camel) {
    var v = m && m[lower];
    if (v !== undefined && v !== null && v !== '') return v;
    return camel && m ? m[camel] : undefined;
  }
  function firstValue(m, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var v = m && m[keys[i]];
      if (v !== undefined && v !== null && v !== '') return text(v);
    }
    return '';
  }
  function normalizeLocale(v) {
    v = text(v).trim().toLowerCase();
    if (v === 'zh' || v.indexOf('zh') === 0) return 'zh-CN';
    if (v.indexOf('th') === 0) return 'th';
    if (v.indexOf('en') === 0) return 'en';
    return '';
  }
  function activeLocale() {
    var first = window.location.pathname.split('/').filter(Boolean)[0] || '';
    var fp = normalizeLocale(first); if (fp) return fp;
    var hl = normalizeLocale(document.documentElement.lang); if (hl) return hl;
    return 'en';
  }
  function fmtNum(v) {
    var n = Number(text(v).replace(/[,\s]/g, ''));
    if (!isFinite(n)) return text(v);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  var locale = activeLocale();
  var LANG = locale === 'zh-CN' ? 'zh' : (locale === 'th' ? 'th' : 'en');

  var LABELS = {
    loading: { en: 'Loading companies…', th: 'กำลังโหลดบริษัท…', zh: '正在加载公司…' },
    empty: { en: 'No companies in this industry yet.', th: 'ยังไม่มีบริษัทในอุตสาหกรรมนี้', zh: '该行业暂无公司。' },
    error: { en: 'Unable to load companies. Please try again.', th: 'ไม่สามารถโหลดบริษัทได้ โปรดลองใหม่อีกครั้ง', zh: '无法加载公司，请重试。' },
    prev: { en: 'Previous', th: 'ก่อนหน้า', zh: '上一页' },
    next: { en: 'Next', th: 'ถัดไป', zh: '下一页' },
    na: { en: '—', th: '—', zh: '—' },
    showing: { en: 'Showing {from}–{to} of {total}', th: 'แสดง {from}–{to} จาก {total}', zh: '显示第 {from}–{to} 条，共 {total} 条' },
    showAll: { en: 'Show all {n}', th: 'ดูทั้งหมด {n}', zh: '查看全部 {n} 个' },
    showLess: { en: 'Show less', th: 'ย่อ', zh: '收起' },
    filterByProvince: { en: 'Filter by province', th: 'กรองตามจังหวัด', zh: '按府筛选' },
    allProvinces: { en: 'All', th: 'ทั้งหมด', zh: '全部' },
    loginMore: { en: 'Sign in to see more results', th: 'เข้าสู่ระบบเพื่อดูข้อมูลเพิ่มเติม', zh: '登录后查看更多公司' },
    loginBtn: { en: 'Sign in', th: 'เข้าสู่ระบบ', zh: '登录' }
  };
  function t(k) { var e = LABELS[k]; return e ? (e[LANG] || e.en) : k; }

  // 行业扁平 URL(集中一处):/industry-<slug>.html。细类 slug 已是英文名;
  // 大类传 slug=tsic-x 也可访问(resolver 兼容),canonical 收敛用英文名(见 convergeUrl)。
  function industryHref(s) { return '/industry-' + encodeURIComponent(s) + '.html'; }

  var listEl = root.querySelector('[data-industry-list]');
  // resolver 会把模板占位符替换成可抓取的 SSR 分页(.biz-fl-pager);
  // 两种形态都要接管,否则两栏初始化后 SSR 分页会成为 grid 第三个子项并掉到左栏下一行。
  var pagerEl = root.querySelector('[data-industry-pager], .biz-fl-pager');
  var rangeEl = root.querySelector('[data-industry-range]');
  if (!listEl) return;

  var termAttr = listEl.getAttribute('data-industry-term') || '';
  var taxonomy = root.getAttribute('data-taxonomy') || 'industry';
  var slug;
  // 真实 term slug 优先取自 WooCMS canonical(/t/industry/<slug>);从扁平 /industry-x.html 进入时 URL 尾段不可靠
  var canonEl = document.querySelector('link[rel="canonical"]');
  var canonM = canonEl && (canonEl.getAttribute('href') || '').match(/\/t\/[^/]+\/([^/?#]+)/);
  if (canonM) { slug = decodeURIComponent(canonM[1]); }
  else if (termAttr.indexOf(':') > -1) { taxonomy = termAttr.split(':')[0]; slug = termAttr.slice(taxonomy.length + 1); }
  else { slug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || ''); }
  var PER = 20;
  // 与 analytics browseCompanies / resolver MAX_BROWSE_OFFSET 对齐:深分页封顶后继续翻页
  // 内容重复且服务端已 404,前端分页器不能再画到真实 total 对应的几万页。
  var MAX_BROWSE_OFFSET = 96000;
  function maxBrowsePages(n) {
    return Math.min(Math.floor(MAX_BROWSE_OFFSET / PER) + 1, Math.max(1, Math.ceil((Number(n) || 0) / PER)));
  }
  var total = 0;

  // WooCMS 原生 sort 对 cpt:thaicompany 是 no-op(id_asc/id_desc/任意取值渲染结果完全一致,
  // 已实测确认,见 woocms-upstream-bugs.md)。归档页(无关键词输入)统一走 analytics 边车做
  // "正常经营优先"排序,与 /companies(data-company-directory 控制器)同一手法。
  function api(page) {
    return '/api/site/v1/analytics/company-list?taxonomy=' + encodeURIComponent(taxonomy)
      + '&term=' + encodeURIComponent(slug) + '&limit=' + PER + '&offset=' + ((page - 1) * PER);
  }
  function companyHref(jpno, en) {
    return window.__starterCompanyHref ? window.__starterCompanyHref(jpno, en) : '/' + encodeURIComponent(jpno) + '.html';
  }

  // 子类导航:大类 hero 的 data-children-of=<termId> → fetch 该大类直接子类渲染 chips。
  // term name 已按子域名本地化(同域 fetch 自带 Host),无需 data-* 三语切换。
  // 一次拉全部 taxonomy terms(API 上限 200/页,offset 翻页),本地定位当前 slug 的层级
  function fetchAllTerms(acc, off) {
    acc = acc || []; off = off || 0;
    return fetch('/api/site/v1/taxonomies/' + encodeURIComponent(taxonomy) + '/terms?limit=200&offset=' + off + '&sort=sort_order_asc', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var d = (j && j.data) || {}, items = d.items || [];
        acc = acc.concat(items);
        var tot = Number(d.total) || acc.length;
        if (acc.length < tot && items.length) return fetchAllTerms(acc, off + 200);
        return acc;
      });
  }
  // 兄弟类目太多时(如 Manufacturing 下 185 个)按名称首字母分组,做成类似网站地图的多栏索引。
  // 返回按字母分好的 groups,以及同一份按名称排好序的扁平 sorted 兜底(见下方 loadNav 里的占比判断)。
  // 非拉丁文名称(th/zh 子域名取回的本地化名字)分不出字母,统一归到末尾的 "#" 桶。
  function groupByLetter(list) {
    var sorted = list.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var groups = [], byKey = {};
    sorted.forEach(function (it) {
      var ch = (it.name || '').trim().charAt(0).toUpperCase();
      var key = /[A-Z]/.test(ch) ? ch : '#';
      var g = byKey[key];
      if (!g) { g = { letter: key, items: [] }; byKey[key] = g; groups.push(g); }
      g.items.push(it);
    });
    groups.sort(function (a, b) {
      if (a.letter === '#') return 1;
      if (b.letter === '#') return -1;
      return a.letter < b.letter ? -1 : (a.letter > b.letter ? 1 : 0);
    });
    return { sorted: sorted, groups: groups };
  }
  // 细类 slug 尾部 TSIC 数字码(如 …-42909 → 42909);大类 tsic-x 不命中,不展示。
  function industryTsicCode(slug) {
    var m = String(slug || '').toLowerCase().match(/-(\d{4,5})$/);
    if (!m) return '';
    return m[1].length === 4 ? ('0' + m[1]) : m[1];
  }
  function navLink(it, currentSlug) {
    var on = currentSlug && it.slug === currentSlug;
    var code = industryTsicCode(it.slug);
    return '<a class="industry-hero__link' + (on ? ' is-active' : '') + '" href="' + escapeHtml(industryHref(it.slug)) + '"' + (on ? ' aria-current="page"' : '') + '>' +
      (code ? '<span class="industry-hero__code">' + escapeHtml(code) + '</span>' : '') +
      '<span class="industry-hero__link-name">' + escapeHtml(it.name) + '</span>' +
      '</a>';
  }
  // 子类导航:大类页列其子类;细类页列父大类的全部子类(兄弟)并高亮当前 + 给出大类入口
  function loadNav() {
    var navEl = root.querySelector('[data-industry-nav]');
    if (!navEl || !slug) return;
    var cntWrap = root.querySelector('[data-industry-childwrap]');
    var cntEl = root.querySelector('[data-industry-childcount]');
    fetchAllTerms().then(function (items) {
      if (!items.length) return;
      var byId = {}, bySlug = {};
      items.forEach(function (it) { byId[it.id] = it; bySlug[it.slug] = it; });
      var cur = bySlug[slug];
      if (!cur) return;
      var isTop = cur.parent_id == null;
      var parentId = isTop ? cur.id : cur.parent_id;
      var currentSlug = isTop ? null : cur.slug;          // 细类页高亮自己
      var parent = byId[parentId];
      var siblings = items.filter(function (it) { return it.parent_id === parentId; });
      if (!siblings.length) return;
      if (cntEl) cntEl.textContent = fmtNum(siblings.length);
      if (cntWrap) cntWrap.hidden = false;
      // 当前细类页标题旁补 TSIC 编码(大类页无数字码,跳过)
      var pageCode = industryTsicCode(cur.slug);
      var titleEl = root.querySelector('.industry-hero__title');
      if (titleEl && pageCode && !titleEl.querySelector('.industry-hero__code')) {
        titleEl.insertAdjacentHTML('afterbegin', '<span class="industry-hero__code industry-hero__code--title">' + escapeHtml(pageCode) + '</span>');
      }
      var html = '';
      if (parent) html += '<a class="industry-hero__cat' + (isTop ? ' is-current' : '') + '" href="' + escapeHtml(industryHref(parent.slug)) + '">' + escapeHtml(parent.name) + '</a>';
      var byLetter = groupByLetter(siblings);
      // TSIC 行业名大量共享固定起手词(如 "Manufacture of …"),按首字母分组常常一个字母吃掉大半列表
      // (实测 Manufacturing 下 185 个兄弟类目里 152 个是 M);这种情况分组不产生信息增益,
      // 退化成不分组但仍按名称排好序的密排多栏文字流,比字母索引更诚实。
      var maxGroupSize = byLetter.groups.reduce(function (m, g) { return Math.max(m, g.items.length); }, 0);
      var lettered = byLetter.groups.length > 1 && maxGroupSize / siblings.length <= 0.5;
      html += '<div class="industry-hero__groups" data-industry-chips>';
      if (lettered) {
        byLetter.groups.forEach(function (g) {
          html += '<div class="industry-hero__group"><span class="industry-hero__group-letter">' + escapeHtml(g.letter) + '</span>';
          g.items.forEach(function (it) { html += navLink(it, currentSlug); });
          html += '</div>';
        });
      } else {
        byLetter.sorted.forEach(function (it) { html += navLink(it, currentSlug); });
      }
      html += '</div>';
      html += '<button type="button" class="industry-hero__more" data-industry-children-toggle hidden></button>';
      navEl.innerHTML = html;
      navEl.hidden = false;
      var chipsEl = navEl.querySelector('[data-industry-chips]');
      var toggle = navEl.querySelector('[data-industry-children-toggle]');
      var COLLAPSED = 24;
      // 大类页、细类页统一折叠;折叠会把当前高亮的兄弟类目裁到可视区外时才放弃折叠(保底全展开)
      if (siblings.length > COLLAPSED && toggle && chipsEl) {
        chipsEl.classList.add('is-collapsed');
        var activeEl = currentSlug ? chipsEl.querySelector('.is-active') : null;
        var hidesActive = activeEl && activeEl.getBoundingClientRect().bottom > chipsEl.getBoundingClientRect().bottom;
        if (hidesActive) {
          chipsEl.classList.remove('is-collapsed');
        } else {
          var expanded = false;
          var setLabel = function () { toggle.textContent = expanded ? t('showLess') : t('showAll').replace('{n}', fmtNum(siblings.length)); };
          toggle.hidden = false; setLabel();
          toggle.addEventListener('click', function () {
            expanded = !expanded;
            chipsEl.classList.toggle('is-collapsed', !expanded);
            setLabel();
          });
        }
      }
    }).catch(function () { });
  }

  // 把地址栏收敛到扁平 URL(大类用英文名 slug,细类用 term slug 已是英文名)。
  // 不改写 SSR canonical——此前会丢掉 /zh|/th 前缀,违反 Google JS-SEO 指引。
  function convergeUrl() {
    if (taxonomy !== 'industry') return;  // 仅行业归档页收敛到 /industry-<slug>.html;府归档页 URL 已是 /<英文名>.html,勿动
    if (root.getAttribute('data-cross-prov')) return;  // 交叉页:URL 已是 /industry-<行业>-<府>.html,不收敛回纯行业
    var hero = root.querySelector('[data-industry-hero]');
    var eng = hero && hero.getAttribute('data-industry-engslug');
    if (!slug && !eng) return;
    var first = window.location.pathname.split('/').filter(Boolean)[0] || '';
    var localePrefix = (first === 'zh' || first === 'th') ? '/' + first : '';
    var target = localePrefix + industryHref(eng || slug);
    if (window.location.pathname !== target && window.history && history.replaceState) {
      try { history.replaceState(null, '', target + (window.location.search || '')); } catch (e) { }
    }
  }

  // 三语切换:卡片数据由 data-* 属性带齐,按 LANG 设置可见文本(缺当前语言回退英文)
  function applyCard(card) {
    var nameEl = card.querySelector('.biz-industry-item__name') || card.querySelector('strong');
    if (nameEl) nameEl.textContent = card.getAttribute('data-name-' + LANG) || card.getAttribute('data-name-en') || nameEl.textContent;
    Array.prototype.forEach.call(card.querySelectorAll('[data-en]'), function (sp) {
      var v = sp.getAttribute('data-' + LANG) || sp.getAttribute('data-en') || '';
      sp.textContent = v; sp.hidden = !v;
    });
    var capEl = card.querySelector('[data-cap]');
    if (capEl) { var cv = capEl.getAttribute('data-cap'); var ok = !(cv === '' || cv == null); capEl.textContent = ok ? ('฿' + fmtNum(cv)) : ''; capEl.hidden = !ok; }
    if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(card);
  }
  function applyAll() {
    Array.prototype.forEach.call(listEl.querySelectorAll('.biz-industry-item'), applyCard); if (window.__bizthaiApplyRecentlyUpdated) window.__bizthaiApplyRecentlyUpdated(listEl);
  }

  function renderRows(items) {
    return items.map(function (it) {
      var m = it.meta || {};
      var jpno = text(m.jpno || it.slug);
      var enName = metaValue(m, 'jpnamee', 'jpNameE') || (m.i18n && m.i18n.en && m.i18n.en.name) || it.title || jpno;
      var thName = metaValue(m, 'jpname', 'jpName') || (m.i18n && m.i18n.th && m.i18n.th.name) || '';
      var zhName = m.jpnamezh || ''; // 无中文名时留空 → applyCard 回退英文(公司名约定:zh 站显示英文罗马名,而非泰文)
      var provEN = metaValue(m, 'provincee', 'provinceE') || '', provTH = m.province || '', provZH = m.provincezh || '';
      var objEN = firstValue(m, ['setupobjdesce', 'submitobjdesce']), objTH = firstValue(m, ['setupobjdesc', 'submitobjdesc']), objZH = firstValue(m, ['setupobjdesczh', 'submitobjdesczh']);
      var cap = (m.capamt != null ? m.capamt : '');
      var stEN = metaValue(m, 'jpstatdesce', 'jpStatDescE') || '', stTH = m.jpstatdesc || '', stZH = m.statuszh || '';
      return '<a class="biz-industry-item" href="' + escapeHtml(companyHref(jpno, enName)) + '" data-en-name="' + escapeHtml(enName) + '"'
        + ' data-name-en="' + escapeHtml(enName) + '" data-name-th="' + escapeHtml(thName) + '" data-name-zh="' + escapeHtml(zhName) + '">'
        + '<span class="biz-industry-item__body">'
        + '<span class="biz-industry-item__namewrap">'
        + '<strong class="biz-industry-item__name">' + escapeHtml(enName) + '</strong>'
        + '<span data-updated-slot></span>'
        + '</span>'
        + '<span class="biz-industry-item__sub">'
        + '<span class="biz-industry-item__obj" data-en="' + escapeHtml(objEN) + '" data-th="' + escapeHtml(objTH) + '" data-zh="' + escapeHtml(objZH) + '">' + escapeHtml(objEN) + '</span>'
        + '<span class="biz-industry-item__loc" data-en="' + escapeHtml(provEN) + '" data-th="' + escapeHtml(provTH) + '" data-zh="' + escapeHtml(provZH) + '">' + escapeHtml(provEN) + '</span>'
        + '<span class="biz-industry-item__jpno">' + escapeHtml(jpno) + '</span>'
        + '</span></span>'
        + '<span class="biz-industry-item__aside">'
        + '<span class="biz-industry-item__cap" data-cap="' + escapeHtml(cap) + '">' + escapeHtml(cap) + '</span>'
        + '<span class="biz-industry-item__status" data-en="' + escapeHtml(stEN) + '" data-th="' + escapeHtml(stTH) + '" data-zh="' + escapeHtml(stZH) + '">' + escapeHtml(stEN) + '</span>'
        + '</span>'
        + '</a>';
    }).join('');
  }

  function pageWindow(page, totalPages) {
    var out = [], lo = Math.max(1, page - 2), hi = Math.min(totalPages, page + 2);
    if (lo > 1) { out.push(1); if (lo > 2) out.push('…'); }
    for (var p = lo; p <= hi; p += 1) out.push(p);
    if (hi < totalPages) { if (hi < totalPages - 1) out.push('…'); out.push(totalPages); }
    return out;
  }
  function renderPager(page, totalPages) {
    if (!pagerEl) return;
    if (totalPages <= 1) { pagerEl.hidden = true; pagerEl.innerHTML = ''; return; }
    var html = '<button type="button" class="biz-arch-pager__btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>' + escapeHtml(t('prev')) + '</button>';
    pageWindow(page, totalPages).forEach(function (p) {
      if (p === '…') { html += '<span class="biz-arch-pager__gap">…</span>'; return; }
      html += '<button type="button" class="biz-arch-pager__num' + (p === page ? ' is-current' : '') + '" data-page="' + p + '"' + (p === page ? ' aria-current="page"' : '') + '>' + p + '</button>';
    });
    html += '<button type="button" class="biz-arch-pager__btn" data-page="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>' + escapeHtml(t('next')) + '</button>';
    pagerEl.innerHTML = html;
    pagerEl.hidden = false;
  }

  function setCount(n) {
    ['[data-industry-count]', '[data-industry-count-aside]'].forEach(function (sel) {
      var el = root.querySelector(sel); if (el) el.textContent = fmtNum(n);
    });
    var line = root.querySelector('[data-industry-count-line]'), fb = root.querySelector('[data-industry-lead-fallback]');
    if (line && fb) { line.hidden = false; fb.hidden = true; }
  }
  function setRange(page, count) {
    if (!rangeEl) return;
    if (!count) { rangeEl.textContent = ''; return; }
    var from = (page - 1) * PER + 1, to = (page - 1) * PER + count;
    rangeEl.textContent = t('showing').replace('{from}', fmtNum(from)).replace('{to}', fmtNum(to)).replace('{total}', fmtNum(total));
  }

  function load(page, _authed) {
    if (!_authed && page > 1 && window.__starterAuth) {
      window.__starterAuth.me().then(function (u) {
        if (!u) { listEl.innerHTML = '<div style="text-align:center;padding:36px 20px 32px;border:1px solid rgba(121,1,178,.18);border-radius:10px;background:rgba(121,1,178,.04);margin:8px 0"><p style="margin:0 0 14px;font-size:15px;color:#34303b">' + escapeHtml(t('loginMore')) + '</p><button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escapeHtml(t('loginBtn')) + '</button></div>'; if (pagerEl) pagerEl.hidden = true; }
        else { load(page, true); }
      });
      return;
    }
    listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('loading')) + '</p>';
    fetch(api(page), { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('bad'); return r.json();
    }).then(function (j) {
      var d = (j && j.data) || {}, items = d.items || [];
      if (!items.length) { listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('empty')) + '</p>'; if (pagerEl) pagerEl.hidden = true; setRange(page, 0); return; }
      total = Number(d.total) || items.length;
      setCount(total);
      var pages = maxBrowsePages(total);
      if (page > pages) { currentLoad(pages, true); return; }
      listEl.innerHTML = renderRows(items);
      applyAll();
      renderPager(page, pages);
      setRange(page, items.length);
    }).catch(function () {
      listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('error')) + '</p>'; if (pagerEl) pagerEl.hidden = true;
    });
  }

  // ── 府筛选:WooCMS API 不支持 industry+province AND,走 analytics sidecar 直查 DB 交叉 ──
  // (sidecar=独立服务,核心二进制更新不影响;将来核心原生支持 AND 后,只需把 loadCross 换回核心 API)
  var ANALYTICS = '/api/site/v1/analytics';
  var activeProv = root.getAttribute('data-cross-prov') || null;  // 交叉页:当前府 slug,翻页走 /cross
  function pickName(o) { return o ? (o[LANG] || o.en || o.th || o.zh || '') : ''; }
  function currentLoad(page, _authed) { return activeProv ? loadCross(page, _authed) : load(page, _authed); }
  function loadCross(page, _authed) {
    if (!_authed && page > 1 && window.__starterAuth) {
      window.__starterAuth.me().then(function (u) {
        if (!u) { listEl.innerHTML = '<div style="text-align:center;padding:36px 20px 32px;border:1px solid rgba(121,1,178,.18);border-radius:10px;background:rgba(121,1,178,.04);margin:8px 0"><p style="margin:0 0 14px;font-size:15px;color:#34303b">' + escapeHtml(t('loginMore')) + '</p><button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escapeHtml(t('loginBtn')) + '</button></div>'; if (pagerEl) pagerEl.hidden = true; }
        else { loadCross(page, true); }
      });
      return;
    }
    listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('loading')) + '</p>';
    fetch(ANALYTICS + '/cross?industry=' + encodeURIComponent(slug) + '&province=' + encodeURIComponent(activeProv) + '&limit=' + PER + '&offset=' + ((page - 1) * PER), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (j) {
        var d = (j && j.data) || {}, items = d.items || [];
        if (!items.length) { listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('empty')) + '</p>'; if (pagerEl) pagerEl.hidden = true; setRange(page, 0); return; }
        total = Number(d.total) || items.length;
        var pages = maxBrowsePages(total);
        if (page > pages) { loadCross(pages, true); return; }
        listEl.innerHTML = renderRows(items);
        applyAll();
        renderPager(page, pages);
        setRange(page, items.length);
      }).catch(function () {
        listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t('error')) + '</p>'; if (pagerEl) pagerEl.hidden = true;
      });
  }
  // 左侧 = 泰国地图 + 府列表(都链到 SSR 交叉页 /industry-<行业>-<府>.html),右侧 = 企业列表。两栏布局。
  function setupProvinceFilter() {
    if (taxonomy !== 'industry') return; // 府交叉筛选(地图+府列表→/industry-<行业>-<府>.html)仅行业归档页用;府归档页(taxonomy=province)不渲染
    if (!slug || !listEl.parentNode) return;
    var main = listEl.parentNode;
    var hero = root.querySelector('[data-industry-hero]');
    var indEng = (hero && hero.getAttribute('data-industry-engslug')) || slug;
    var curProvEng = root.getAttribute('data-cross-prov-eng') || '';
    function crossHref(eng) { return '/industry-' + indEng + '-' + eng + '.html'; }
    function cleanup() { main.classList.remove('industry-twocol'); if (aside.parentNode) aside.parentNode.removeChild(aside); if (rightCol.parentNode) { while (rightCol.firstChild) main.appendChild(rightCol.firstChild); rightCol.parentNode.removeChild(rightCol); } }

    var aside = document.createElement('aside');
    aside.className = 'industry-mapnav';
    aside.innerHTML = '<div class="industry-mapnav__map" data-thmap></div><div class="industry-mapnav__list" data-prov-list></div>';
    var rightCol = document.createElement('div');
    rightCol.className = 'industry-rightcol';
    main.insertBefore(aside, listEl);
    main.insertBefore(rightCol, listEl);
    rightCol.appendChild(listEl);
    if (pagerEl) rightCol.appendChild(pagerEl);
    main.classList.add('industry-twocol');

    Promise.all([
      fetch(ANALYTICS + '/regions', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/theme-assets/starter/thailand.svg').then(function (r) { return r.ok ? r.text() : ''; })
    ]).then(function (res) {
      var provs = (res[0] && res[0].provinces) || [];
      if (!provs.length) { cleanup(); return; }
      var listC = aside.querySelector('[data-prov-list]');
      var html = '<a class="industry-provitem' + (curProvEng ? '' : ' is-active') + '" href="' + escapeHtml(industryHref(indEng)) + '">' + escapeHtml(t('allProvinces')) + '</a>';
      html += provs.map(function (p) {
        var on = curProvEng && p.engslug === curProvEng;
        return '<a class="industry-provitem' + (on ? ' is-active' : '') + '" data-prov-eng="' + escapeHtml(p.engslug) + '" href="' + escapeHtml(crossHref(p.engslug)) + '">' + escapeHtml(pickName(p.name)) + '</a>';
      }).join('');
      listC.innerHTML = html;
      var svg = res[1] || '', mapC = aside.querySelector('[data-thmap]');
      var nameByEng = {};
      provs.forEach(function (p) { nameByEng[p.engslug] = pickName(p.name); });
      function hoverSync(eng) {
        Array.prototype.forEach.call(aside.querySelectorAll('.is-hover'), function (n) { n.classList.remove('is-hover'); });
        if (!eng) return;
        var mp = aside.querySelector('svg [data-prov-eng="' + eng + '"]'); if (mp) mp.classList.add('is-hover');
        var li = listC.querySelector('[data-prov-eng="' + eng + '"]'); if (li) li.classList.add('is-hover');
      }
      listC.addEventListener('mouseover', function (e) { var li = e.target.closest && e.target.closest('[data-prov-eng]'); hoverSync(li ? li.getAttribute('data-prov-eng') : ''); });
      listC.addEventListener('mouseleave', function () { hoverSync(''); });
      if (svg && mapC) {
        mapC.innerHTML = '<div class="industry-mapnav__mapwrap" data-thmap-wrap>' + svg + '</div>'
          + '<div class="industry-mapnav__zoom"><button type="button" data-zoom="out" aria-label="zoom out">−</button><button type="button" data-zoom="in" aria-label="zoom in">+</button></div>'
          + '<span class="industry-mapnav__tip" data-thmap-tip hidden></span>';
        var wrap = mapC.querySelector('[data-thmap-wrap]'), svgEl = mapC.querySelector('svg'), tip = mapC.querySelector('[data-thmap-tip]');
        if (svgEl) {
          if (curProvEng) { var a0 = svgEl.querySelector('[data-prov-eng="' + curProvEng + '"]'); if (a0) a0.classList.add('is-active'); }
          // 缩放(scale)+ 拖动平移(translate),容器 overflow:hidden,无滚动条
          var zoom = 1, tx = 0, ty = 0;
          function applyTransform() { svgEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + zoom + ')'; }
          mapC.querySelector('[data-zoom="in"]').addEventListener('click', function () { zoom = Math.min(5, zoom + 0.5); applyTransform(); });
          mapC.querySelector('[data-zoom="out"]').addEventListener('click', function () { zoom = Math.max(1, zoom - 0.5); if (zoom === 1) { tx = 0; ty = 0; } applyTransform(); });
          // 拖动平移
          var dragging = false, sx = 0, sy = 0, stx = 0, sty = 0, moved = false;
          wrap.addEventListener('mousedown', function (e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; wrap.classList.add('is-dragging'); tip.hidden = true; e.preventDefault(); });
          window.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            tx = stx + dx; ty = sty + dy; applyTransform();
          });
          window.addEventListener('mouseup', function () { if (dragging) { dragging = false; wrap.classList.remove('is-dragging'); } });
          // 点击跳转(拖动后不触发)
          svgEl.addEventListener('click', function (e) { if (moved) { moved = false; return; } var p = e.target.closest && e.target.closest('[data-prov-eng]'); if (p) window.location.href = crossHref(p.getAttribute('data-prov-eng')); });
          // hover tooltip(拖动时不显示)
          svgEl.addEventListener('mousemove', function (e) {
            if (dragging) return;
            var p = e.target.closest && e.target.closest('[data-prov-eng]');
            if (!p) { tip.hidden = true; hoverSync(''); return; }
            var eng = p.getAttribute('data-prov-eng'), r = mapC.getBoundingClientRect();
            tip.textContent = nameByEng[eng] || eng; tip.hidden = false;
            tip.style.left = (e.clientX - r.left) + 'px';
            tip.style.top = (e.clientY - r.top) + 'px';
            hoverSync(eng);
          });
          svgEl.addEventListener('mouseleave', function () { if (!dragging) { tip.hidden = true; hoverSync(''); } });
        }
      }
      var actItem = listC.querySelector('.industry-provitem.is-active');
      if (curProvEng && actItem && actItem.scrollIntoView) actItem.scrollIntoView({ block: 'nearest' });
    }).catch(function () { cleanup(); });
  }

  if (pagerEl) pagerEl.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    var p = parseInt(btn.getAttribute('data-page'), 10);
    if (isNaN(p) || p < 1) return;
    currentLoad(p);
    var top = root.querySelector('.biz-industry-list');
    if (top && top.scrollIntoView) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  var ssrRows = root.hasAttribute('data-industry-ssr') ? listEl.querySelectorAll('.biz-industry-item') : null;
  if (activeProv && ssrRows && ssrRows.length) {
    // 交叉页(行业×府):SSR 由 analytics crossCompanies() 渲染(已按"正常经营优先"排序),可信任首屏
    var c = root.querySelector('[data-industry-count]');
    total = c ? (parseInt(text(c.textContent).replace(/[,\s]/g, ''), 10) || 0) : ssrRows.length;
    setCount(total);
    applyAll();
    renderPager(1, maxBrowsePages(total));
    setRange(1, ssrRows.length);
  } else if (window.fetch && slug) {
    // 单 taxonomy 归档页:SSR 走 WooCMS 原生 sort(no-op,顺序与边车不一致),首屏也须重新拉取,
    // 否则第 1 页(WooCMS 顺序)和第 2 页(边车状态排序)顺序衔接不上、可能重复或跳过。
    currentLoad(1);
  }

  if (window.fetch) loadNav();
  if (window.fetch) setupProvinceFilter();
  convergeUrl();
})();

/* ===== 全部公司名录(/companies · page-10):多重筛选(关键词 + 府/行业/资本)+ 分页 =====
   SSR 首屏 24 条(爬虫可抓)+ JS 渐进增强。entries 站点 API 实测:
   - keyword 可与「一个」分类法 facet 正确 AND(后端支持);多个 taxonomy 不做 AND(只认第一个),
     故府/行业/资本三个 facet 互斥(一次只生效一个),保证每页计数精确、不误导。
   - sort 参数后端忽略,故不提供排序控件。
   - 府用内置 77 府表(prov+md5 slug;后端 province 分类法含县/分区共 8492 term,不便枚举);
     行业大类一次拉取(sort_order 前列即 19 个 tsic-x,名称已按子域名本地化)。 */
// 区(amphoe/khet)ampurcode -> 区域排名页区级 slug(<罗马音>-<ampurcode>);供详情页「同区企业」按 ampurcode 反查,与 analytics /province-districts 一致
var STARTER_DISTRICTS={"1001":"khet-phra-nakhon-1001","1002":"khet-dusit-1002","1003":"khet-nong-chok-1003","1004":"khet-bang-rak-1004","1005":"khet-bang-khen-1005","1006":"khet-bang-kapi-1006","1007":"khet-pathum-wan-1007","1008":"khet-pom-prap-sattru-phai-1008","1009":"khet-phra-khanong-1009","1010":"khet-min-buri-1010","1011":"khet-lat-krabang-1011","1012":"khet-yan-nawa-1012","1013":"khet-samphanthawong-1013","1014":"khet-phaya-thai-1014","1015":"khet-thon-buri-1015","1016":"khet-bangkok-yai-1016","1017":"khet-huai-khwang-1017","1018":"khet-khlong-san-1018","1019":"khet-taling-chan-1019","1020":"khet-bangkok-noi-1020","1021":"khet-bang-khun-thian-1021","1022":"khet-phasi-charoen-1022","1023":"khet-nong-khaem-1023","1024":"khet-rat-burana-1024","1025":"khet-bang-phlat-1025","1026":"khet-din-daeng-1026","1027":"khet-bueng-kum-1027","1028":"khet-sathon-1028","1029":"khet-bang-sue-1029","1030":"khet-chatuchak-1030","1031":"khet-bang-kho-laem-1031","1032":"khet-prawet-1032","1033":"khet-khlong-toei-1033","1034":"khet-suan-luang-1034","1035":"khet-chom-thong-1035","1036":"khet-don-mueang-1036","1037":"khet-ratchathewi-1037","1038":"khet-lat-phrao-1038","1039":"khet-watthana-1039","1040":"khet-bang-khae-1040","1041":"khet-lak-si-1041","1042":"khet-sai-mai-1042","1043":"khet-khan-na-yao-1043","1044":"khet-saphan-sung-1044","1045":"khet-wang-thonglang-1045","1046":"khet-khlong-sam-wa-1046","1047":"khet-bang-na-1047","1048":"khet-thawi-watthana-1048","1049":"khet-thung-khru-1049","1050":"khet-bang-bon-1050","1101":"mueang-samut-prakan-1101","1102":"bang-bo-1102","1103":"bang-phli-1103","1104":"phra-pradaeng-1104","1105":"phra-samut-chedi-1105","1106":"bang-sao-thong-1106","1201":"mueang-nonthaburi-1201","1202":"bang-kruai-1202","1203":"bang-yai-1203","1204":"bang-bua-thong-1204","1205":"sai-noi-1205","1206":"pak-kret-1206","1301":"mueang-pathum-thani-1301","1302":"khlong-luang-1302","1303":"thanyaburi-1303","1304":"nong-suea-1304","1305":"lat-lum-kaeo-1305","1306":"lam-luk-ka-1306","1307":"sam-khok-1307","1401":"phra-nakhon-si-ayutthaya-1401","1402":"tha-ruea-1402","1403":"nakhon-luang-1403","1404":"bang-sai-1404","1405":"bang-ban-1405","1406":"bang-pa-in-1406","1407":"bang-pahan-1407","1408":"phak-hai-1408","1409":"phachi-1409","1410":"lat-bua-luang-1410","1411":"wang-noi-1411","1412":"sena-1412","1413":"bang-sai-1413","1414":"uthai-1414","1415":"maha-rat-1415","1416":"ban-phraek-1416","1501":"mueang-ang-thong-1501","1502":"chaiyo-1502","1503":"pa-mok-1503","1504":"pho-thong-1504","1505":"sawaeng-ha-1505","1506":"wiset-chai-chan-1506","1507":"samko-1507","1601":"mueang-lop-buri-1601","1602":"phatthana-nikhom-1602","1603":"khok-samrong-1603","1604":"chai-badan-1604","1605":"tha-wung-1605","1606":"ban-mi-1606","1607":"tha-luang-1607","1608":"sa-bot-1608","1609":"khok-charoen-1609","1610":"lam-sonthi-1610","1611":"nong-muang-1611","1701":"mueang-sing-buri-1701","1702":"bang-rachan-1702","1703":"khai-bang-rachan-1703","1704":"phrom-buri-1704","1705":"tha-chang-1705","1706":"in-buri-1706","1801":"mueang-chai-nat-1801","1802":"manorom-1802","1803":"wat-sing-1803","1804":"sapphaya-1804","1805":"sankhaburi-1805","1806":"hankha-1806","1807":"nong-mamong-1807","1808":"noen-kham-1808","1901":"mueang-saraburi-1901","1902":"kaeng-khoi-1902","1903":"nong-khae-1903","1904":"wihan-daeng-1904","1905":"nong-saeng-1905","1906":"ban-mo-1906","1907":"don-phut-1907","1908":"nong-don-1908","1909":"phra-phutthabat-1909","1910":"sao-hai-1910","1911":"muak-lek-1911","1912":"wang-muang-1912","1913":"chaloem-phra-kiat-1913","2001":"mueang-chon-buri-2001","2002":"ban-bueng-2002","2003":"nong-yai-2003","2004":"bang-lamung-2004","2005":"phan-thong-2005","2006":"phanat-nikhom-2006","2007":"si-racha-2007","2008":"ko-sichang-2008","2009":"sattahip-2009","2010":"bo-thong-2010","2011":"ko-chan-2011","2101":"mueang-rayong-2101","2102":"ban-chang-2102","2103":"klaeng-2103","2104":"wang-chan-2104","2105":"ban-khai-2105","2106":"pluak-daeng-2106","2107":"khao-chamao-2107","2108":"nikhom-phatthana-2108","2201":"mueang-chanthaburi-2201","2202":"khlung-2202","2203":"tha-mai-2203","2204":"pong-nam-ron-2204","2205":"makham-2205","2206":"laem-sing-2206","2207":"soi-dao-2207","2208":"kaeng-hang-maeo-2208","2209":"na-yai-am-2209","2210":"khao-khitchakut-2210","2301":"mueang-trat-2301","2302":"khlong-yai-2302","2303":"khao-saming-2303","2304":"bo-rai-2304","2305":"laem-ngop-2305","2306":"ko-kut-2306","2307":"ko-chang-2307","2401":"mueang-chachoengsao-2401","2402":"bang-khla-2402","2403":"bang-nam-priao-2403","2404":"bang-pakong-2404","2405":"ban-pho-2405","2406":"phanom-sarakham-2406","2407":"ratchasan-2407","2408":"sanam-chai-khet-2408","2409":"plaeng-yao-2409","2410":"tha-takiap-2410","2411":"khlong-khuean-2411","2501":"mueang-prachin-buri-2501","2502":"kabin-buri-2502","2503":"na-di-2503","2506":"ban-sang-2506","2507":"prachantakham-2507","2508":"si-maha-phot-2508","2509":"si-mahosot-2509","2601":"mueang-nakhon-nayok-2601","2602":"pak-phli-2602","2603":"ban-na-2603","2604":"ongkharak-2604","2701":"mueang-sa-kaeo-2701","2702":"khlong-hat-2702","2703":"ta-phraya-2703","2704":"wang-nam-yen-2704","2705":"watthana-nakhon-2705","2706":"aranyaprathet-2706","2707":"khao-chakan-2707","2708":"khok-sung-2708","2709":"wang-sombun-2709","3001":"mueang-nakhon-ratchasima-3001","3002":"khon-buri-3002","3003":"soeng-sang-3003","3004":"khong-3004","3005":"ban-lueam-3005","3006":"chakkarat-3006","3007":"chok-chai-3007","3008":"dan-khun-thot-3008","3009":"non-thai-3009","3010":"non-sung-3010","3011":"kham-sakaesaeng-3011","3012":"bua-yai-3012","3013":"prathai-3013","3014":"pak-thong-chai-3014","3015":"phimai-3015","3016":"huai-thalaeng-3016","3017":"chum-phuang-3017","3018":"sung-noen-3018","3019":"kham-thale-so-3019","3020":"sikhio-3020","3021":"pak-chong-3021","3022":"nong-bun-mak-3022","3023":"kaeng-sanam-nang-3023","3024":"non-daeng-3024","3025":"wang-nam-khiao-3025","3026":"thepharak-3026","3027":"mueang-yang-3027","3028":"phra-thong-kham-3028","3029":"lam-thamenchai-3029","3030":"bua-lai-3030","3031":"sida-3031","3032":"chaloem-phra-kiat-3032","3101":"mueang-buri-ram-3101","3102":"khu-mueang-3102","3103":"krasang-3103","3104":"nang-rong-3104","3105":"nong-ki-3105","3106":"lahan-sai-3106","3107":"prakhon-chai-3107","3108":"ban-kruat-3108","3109":"phutthaisong-3109","3110":"lam-plai-mat-3110","3111":"satuek-3111","3112":"pakham-3112","3113":"na-pho-3113","3114":"nong-hong-3114","3115":"phlapphla-chai-3115","3116":"huai-rat-3116","3117":"non-suwan-3117","3118":"chamni-3118","3119":"ban-mai-chaiyaphot-3119","3120":"non-din-daeng-3120","3121":"ban-dan-3121","3122":"khaen-dong-3122","3123":"chaloem-phra-kiat-3123","3201":"mueang-surin-3201","3202":"chumphon-buri-3202","3203":"tha-tum-3203","3204":"chom-phra-3204","3205":"prasat-3205","3206":"kap-choeng-3206","3207":"rattanaburi-3207","3208":"sanom-3208","3209":"sikhoraphum-3209","3210":"sangkha-3210","3211":"lamduan-3211","3212":"samrong-thap-3212","3213":"buachet-3213","3214":"phanom-dong-rak-3214","3215":"si-narong-3215","3216":"khwao-sinarin-3216","3217":"non-narai-3217","3301":"mueang-si-sa-ket-3301","3302":"yang-chum-noi-3302","3303":"kanthararom-3303","3304":"kantharalak-3304","3305":"khukhan-3305","3306":"phrai-bueng-3306","3307":"prang-ku-3307","3308":"khun-han-3308","3309":"rasi-salai-3309","3310":"uthumphon-phisai-3310","3311":"bueng-bun-3311","3312":"huai-thap-than-3312","3313":"non-khun-3313","3314":"si-rattana-3314","3315":"nam-kliang-3315","3316":"wang-hin-3316","3317":"phu-sing-3317","3318":"mueang-chan-3318","3319":"benchalak-3319","3320":"phayu-3320","3321":"pho-si-suwan-3321","3322":"sila-lat-3322","3401":"mueang-ubon-ratchathani-3401","3402":"si-mueang-mai-3402","3403":"khong-chiam-3403","3404":"khueang-nai-3404","3405":"khemarat-3405","3407":"det-udom-3407","3408":"na-chaluai-3408","3409":"nam-yuen-3409","3410":"buntharik-3410","3411":"trakan-phuet-phon-3411","3412":"kut-khaopun-3412","3414":"muang-sam-sip-3414","3415":"warin-chamrap-3415","3419":"phibun-mangsahan-3419","3420":"tan-sum-3420","3421":"pho-sai-3421","3422":"samrong-3422","3424":"don-mot-daeng-3424","3425":"sirindhorn-3425","3426":"thung-si-udom-3426","3429":"na-yia-3429","3430":"na-tan-3430","3431":"lao-suea-kok-3431","3432":"sawang-wirawong-3432","3433":"nam-khun-3433","3501":"mueang-yasothon-3501","3502":"sai-mun-3502","3503":"kut-chum-3503","3504":"kham-khuean-kaeo-3504","3505":"pa-tio-3505","3506":"maha-chana-chai-3506","3507":"kho-wang-3507","3508":"loeng-nok-tha-3508","3509":"thai-charoen-3509","3601":"mueang-chaiyaphum-3601","3602":"ban-khwao-3602","3603":"khon-sawan-3603","3604":"kaset-sombun-3604","3605":"nong-bua-daeng-3605","3606":"chatturat-3606","3607":"bamnet-narong-3607","3608":"nong-bua-rawe-3608","3609":"thep-sathit-3609","3610":"phu-khiao-3610","3611":"ban-thaen-3611","3612":"kaeng-khro-3612","3613":"khon-san-3613","3614":"phakdi-chumphon-3614","3615":"noen-sa-nga-3615","3616":"sap-yai-3616","3701":"mueang-amnat-charoen-3701","3702":"chanuman-3702","3703":"pathum-ratchawongsa-3703","3704":"phana-3704","3705":"senangkhanikhom-3705","3706":"hua-taphan-3706","3707":"lue-amnat-3707","3801":"mueang-bueng-kan-3801","3802":"seka-3802","3803":"so-phisai-3803","3804":"phon-charoen-3804","3805":"si-wilai-3805","3806":"bueng-khong-long-3806","3807":"pak-khat-3807","3808":"bung-khla-3808","3901":"mueang-nong-bua-lam-phu-3901","3902":"na-klang-3902","3903":"non-sang-3903","3904":"si-bun-rueang-3904","3905":"suwannakhuha-3905","3906":"na-wang-3906","4001":"mueang-khon-kaen-4001","4002":"ban-fang-4002","4003":"phra-yuen-4003","4004":"nong-ruea-4004","4005":"chum-phae-4005","4006":"si-chomphu-4006","4007":"nam-phong-4007","4008":"ubolratana-4008","4009":"kranuan-4009","4010":"ban-phai-4010","4011":"pueai-noi-4011","4012":"phon-4012","4013":"waeng-yai-4013","4014":"waeng-noi-4014","4015":"nong-song-hong-4015","4016":"phu-wiang-4016","4017":"mancha-khiri-4017","4018":"chonnabot-4018","4019":"khao-suan-kwang-4019","4020":"phu-pha-man-4020","4021":"sam-sung-4021","4022":"khok-pho-chai-4022","4023":"nong-na-kham-4023","4024":"ban-haet-4024","4025":"non-sila-4025","4029":"wiang-kao-4029","4101":"mueang-udon-thani-4101","4102":"kut-chap-4102","4103":"nong-wua-so-4103","4104":"kumphawapi-4104","4105":"non-sa-at-4105","4106":"nong-han-4106","4107":"thung-fon-4107","4108":"chai-wan-4108","4109":"si-that-4109","4110":"wang-sam-mo-4110","4111":"ban-dung-4111","4117":"ban-phue-4117","4118":"nam-som-4118","4119":"phen-4119","4120":"sang-khom-4120","4121":"nong-saeng-4121","4122":"na-yung-4122","4123":"phibun-rak-4123","4124":"ku-kaeo-4124","4125":"prachaksinlapakhom-4125","4201":"mueang-loei-4201","4202":"na-duang-4202","4203":"chiang-khan-4203","4204":"pak-chom-4204","4205":"dan-sai-4205","4206":"na-haeo-4206","4207":"phu-ruea-4207","4208":"tha-li-4208","4209":"wang-saphung-4209","4210":"phu-kradueng-4210","4211":"phu-luang-4211","4212":"pha-khao-4212","4213":"erawan-4213","4214":"nong-hin-4214","4301":"mueang-nong-khai-4301","4302":"tha-bo-4302","4305":"phon-phisai-4305","4307":"si-chiang-mai-4307","4308":"sangkhom-4308","4314":"sakhrai-4314","4315":"fao-rai-4315","4316":"rattanawapi-4316","4317":"pho-tak-4317","4401":"mueang-maha-sarakham-4401","4402":"kae-dam-4402","4403":"kosum-phisai-4403","4404":"kantharawichai-4404","4405":"chiang-yuen-4405","4406":"borabue-4406","4407":"na-chueak-4407","4408":"phayakkhaphum-phisai-4408","4409":"wapi-pathum-4409","4410":"na-dun-4410","4411":"yang-sisurat-4411","4412":"kut-rang-4412","4413":"chuen-chom-4413","4501":"mueang-roi-et-4501","4502":"kaset-wisai-4502","4503":"pathum-rat-4503","4504":"chaturaphak-phiman-4504","4505":"thawat-buri-4505","4506":"phanom-phrai-4506","4507":"phon-thong-4507","4508":"pho-chai-4508","4509":"nong-phok-4509","4510":"selaphum-4510","4511":"suwannaphum-4511","4512":"mueang-suang-4512","4513":"phon-sai-4513","4514":"at-samat-4514","4515":"moei-wadi-4515","4516":"si-somdet-4516","4517":"changhan-4517","4518":"chiang-khwan-4518","4519":"nong-hi-4519","4520":"thung-khao-luang-4520","4601":"mueang-kalasin-4601","4602":"na-mon-4602","4603":"kamalasai-4603","4604":"rong-kham-4604","4605":"kuchinarai-4605","4606":"khao-wong-4606","4607":"yang-talat-4607","4608":"huai-mek-4608","4609":"sahatsakhan-4609","4610":"kham-muang-4610","4611":"tha-khantho-4611","4612":"nong-kung-si-4612","4613":"somdet-4613","4614":"huai-phueng-4614","4615":"sam-chai-4615","4616":"na-khu-4616","4617":"don-chan-4617","4618":"khong-chai-4618","4701":"mueang-sakon-nakhon-4701","4702":"kusuman-4702","4703":"kut-bak-4703","4704":"phanna-nikhom-4704","4705":"phang-khon-4705","4706":"waritchaphum-4706","4707":"nikhom-nam-un-4707","4708":"wanon-niwat-4708","4709":"kham-ta-kla-4709","4710":"ban-muang-4710","4711":"akat-amnuai-4711","4712":"sawang-daen-din-4712","4713":"song-dao-4713","4714":"tao-ngoi-4714","4715":"khok-si-suphan-4715","4716":"charoen-sin-4716","4717":"phon-na-kaeo-4717","4718":"phu-phan-4718","4801":"mueang-nakhon-phanom-4801","4802":"pla-pak-4802","4803":"tha-uthen-4803","4804":"ban-phaeng-4804","4805":"that-phanom-4805","4806":"renu-nakhon-4806","4807":"na-kae-4807","4808":"si-songkhram-4808","4809":"na-wa-4809","4810":"phon-sawan-4810","4811":"na-thom-4811","4812":"wang-yang-4812","4901":"mueang-mukdahan-4901","4902":"nikhom-kham-soi-4902","4903":"don-tan-4903","4904":"dong-luang-4904","4905":"khamcha-i-4905","4906":"wan-yai-4906","4907":"nong-sung-4907","5001":"mueang-chiang-mai-5001","5002":"chom-thong-5002","5003":"mae-chaem-5003","5004":"chiang-dao-5004","5005":"doi-saket-5005","5006":"mae-taeng-5006","5007":"mae-rim-5007","5008":"samoeng-5008","5009":"fang-5009","5010":"mae-ai-5010","5011":"phrao-5011","5012":"san-pa-tong-5012","5013":"san-kamphaeng-5013","5014":"san-sai-5014","5015":"hang-dong-5015","5016":"hot-5016","5017":"doi-tao-5017","5018":"omkoi-5018","5019":"saraphi-5019","5020":"wiang-haeng-5020","5021":"chai-prakan-5021","5022":"mae-wang-5022","5023":"mae-on-5023","5024":"doi-lo-5024","5025":"galyani-vadhana-5025","5101":"mueang-lamphun-5101","5102":"mae-tha-5102","5103":"ban-hong-5103","5104":"li-5104","5105":"thung-hua-chang-5105","5106":"pa-sang-5106","5107":"ban-thi-5107","5108":"wiang-nong-long-5108","5201":"mueang-lampang-5201","5202":"mae-mo-5202","5203":"ko-kha-5203","5204":"soem-ngam-5204","5205":"ngao-5205","5206":"chae-hom-5206","5207":"wang-nuea-5207","5208":"thoen-5208","5209":"mae-phrik-5209","5210":"mae-tha-5210","5211":"sop-prap-5211","5212":"hang-chat-5212","5213":"mueang-pan-5213","5301":"mueang-uttaradit-5301","5302":"tron-5302","5303":"tha-pla-5303","5304":"nam-pat-5304","5305":"fak-tha-5305","5306":"ban-khok-5306","5307":"phichai-5307","5308":"laplae-5308","5309":"thong-saen-khan-5309","5401":"mueang-phrae-5401","5402":"rong-kwang-5402","5403":"long-5403","5404":"sung-men-5404","5405":"den-chai-5405","5406":"song-5406","5407":"wang-chin-5407","5408":"nong-muang-khai-5408","5501":"mueang-nan-5501","5502":"mae-charim-5502","5503":"ban-luang-5503","5504":"na-noi-5504","5505":"pua-5505","5506":"tha-wang-pha-5506","5507":"wiang-sa-5507","5508":"thung-chang-5508","5509":"chiang-klang-5509","5510":"na-muen-5510","5511":"santi-suk-5511","5512":"bo-kluea-5512","5513":"song-khwae-5513","5514":"phu-phiang-5514","5515":"chaloem-phra-kiat-5515","5601":"mueang-phayao-5601","5602":"chun-5602","5603":"chiang-kham-5603","5604":"chiang-muan-5604","5605":"dok-khamtai-5605","5606":"pong-5606","5607":"mae-chai-5607","5608":"phu-sang-5608","5609":"phu-kamyao-5609","5701":"mueang-chiang-rai-5701","5702":"wiang-chai-5702","5703":"chiang-khong-5703","5704":"thoeng-5704","5705":"phan-5705","5706":"pa-daet-5706","5707":"mae-chan-5707","5708":"chiang-saen-5708","5709":"mae-sai-5709","5710":"mae-suai-5710","5711":"wiang-pa-pao-5711","5712":"phaya-mengrai-5712","5713":"wiang-kaen-5713","5714":"khun-tan-5714","5715":"mae-fa-luang-5715","5716":"mae-lao-5716","5717":"wiang-chiang-rung-5717","5718":"doi-luang-5718","5801":"mueang-mae-hong-son-5801","5802":"khun-yuam-5802","5803":"pai-5803","5804":"mae-sariang-5804","5805":"mae-la-noi-5805","5806":"sop-moei-5806","5807":"pang-mapha-5807","6001":"mueang-nakhon-sawan-6001","6002":"krok-phra-6002","6003":"chum-saeng-6003","6004":"nong-bua-6004","6005":"banphot-phisai-6005","6006":"kao-liao-6006","6007":"takhli-6007","6008":"takhli-6008","6009":"phaisali-6009","6010":"phayuha-khiri-6010","6011":"phayuha-khiri-6011","6012":"tak-fa-6012","6013":"mae-wong-6013","6014":"mae-poen-6014","6015":"chum-ta-bong-6015","6101":"mueang-uthai-thani-6101","6102":"thap-than-6102","6103":"sawang-arom-6103","6104":"nong-chang-6104","6105":"nong-khayang-6105","6106":"ban-rai-6106","6107":"lan-sak-6107","6108":"huai-khot-6108","6201":"mueang-kamphaeng-phet-6201","6202":"sai-ngam-6202","6203":"khlong-lan-6203","6204":"khanu-woralaksaburi-6204","6205":"khlong-khlung-6205","6206":"phran-kratai-6206","6207":"lan-krabue-6207","6208":"sai-thong-watthana-6208","6209":"pang-sila-thong-6209","6210":"bueng-samakkhi-6210","6211":"kosamphi-nakhon-6211","6301":"mueang-tak-6301","6302":"ban-tak-6302","6303":"sam-ngao-6303","6304":"mae-ramat-6304","6305":"tha-song-yang-6305","6306":"mae-sot-6306","6307":"phop-phra-6307","6308":"umphang-6308","6309":"wang-chao-6309","6401":"mueang-sukhothai-6401","6402":"ban-dan-lan-hoi-6402","6403":"khiri-mat-6403","6404":"kong-krailat-6404","6405":"si-satchanalai-6405","6406":"si-samrong-6406","6407":"sawankhalok-6407","6408":"si-nakhon-6408","6409":"thung-saliam-6409","6501":"mueang-phitsanulok-6501","6502":"nakhon-thai-6502","6503":"chat-trakan-6503","6504":"bang-rakam-6504","6505":"bang-krathum-6505","6506":"phrom-phiram-6506","6507":"wat-bot-6507","6508":"wang-thong-6508","6509":"noen-maprang-6509","6601":"mueang-phichit-6601","6602":"wang-sai-phun-6602","6603":"pho-prathap-chang-6603","6604":"taphan-hin-6604","6605":"bang-mun-nak-6605","6606":"pho-thale-6606","6607":"sam-ngam-6607","6608":"tap-khlo-6608","6609":"sak-lek-6609","6610":"bueng-na-rang-6610","6611":"dong-charoen-6611","6612":"wachirabarami-6612","6701":"mueang-phetchabun-6701","6702":"chon-daen-6702","6703":"lom-sak-6703","6704":"lom-kao-6704","6705":"wichian-buri-6705","6706":"si-thep-6706","6707":"nong-phai-6707","6708":"bueng-sam-phan-6708","6709":"nam-nao-6709","6710":"wang-pong-6710","6711":"khao-kho-6711","7001":"mueang-ratchaburi-7001","7002":"chom-bueng-7002","7003":"suan-phueng-7003","7004":"damnoen-saduak-7004","7005":"ban-pong-7005","7006":"bang-phae-7006","7007":"photharam-7007","7008":"pak-tho-7008","7009":"wat-phleng-7009","7010":"ban-kha-7010","7074":"tet-saban-ban-kong-7074","7101":"mueang-kanchanaburi-7101","7102":"sai-yok-7102","7103":"bo-phloi-7103","7104":"si-sawat-7104","7105":"tha-maka-7105","7106":"tha-muang-7106","7107":"pha-phum-7107","7108":"sangkhla-buri-7108","7109":"phanom-thuan-7109","7110":"lao-khwan-7110","7111":"dan-makham-tia-7111","7112":"nong-prue-7112","7113":"huai-krachao-7113","7201":"mueang-suphan-buri-7201","7202":"doem-bang-nang-buat-7202","7203":"dan-chang-7203","7204":"bang-pla-ma-7204","7205":"si-prachan-7205","7206":"don-chedi-7206","7207":"song-phi-nong-7207","7208":"sam-chuk-7208","7209":"u-thong-7209","7210":"nong-ya-sai-7210","7301":"mueang-nakhon-pathom-7301","7302":"kamphaeng-saen-7302","7303":"nakhon-chai-si-7303","7304":"don-tum-7304","7305":"bang-len-7305","7306":"sam-phran-7306","7307":"phutthamonthon-7307","7401":"mueang-samut-sakhon-7401","7402":"krathum-baen-7402","7403":"ban-phaeo-7403","7501":"mueang-samut-songkhram-7501","7502":"bang-khonthi-7502","7503":"amphawa-7503","7601":"mueang-phetchaburi-7601","7602":"khao-yoi-7602","7603":"nong-ya-plong-7603","7604":"cha-am-7604","7605":"tha-yang-7605","7606":"ban-lat-7606","7607":"ban-laem-7607","7608":"kaeng-krachan-7608","7701":"mueang-prachuap-khiri-khan-7701","7702":"kui-buri-7702","7703":"thap-sakae-7703","7704":"bang-saphan-7704","7705":"bang-saphan-noi-7705","7706":"pran-buri-7706","7707":"hua-hin-7707","7708":"sam-roi-yot-7708","8001":"mueang-nakhon-si-thammarat-8001","8002":"phrom-khiri-8002","8003":"lan-saka-8003","8004":"chawang-8004","8005":"phipun-8005","8006":"chian-yai-8006","8007":"cha-uat-8007","8008":"tha-sala-8008","8009":"thung-song-8009","8010":"na-bon-8010","8011":"thung-yai-8011","8012":"pak-phanang-8012","8013":"ron-phibun-8013","8014":"sichon-8014","8015":"khanom-8015","8016":"hua-sai-8016","8017":"bang-khan-8017","8018":"tham-phannara-8018","8019":"chulabhorn-8019","8020":"phra-phrom-8020","8021":"nopphitam-8021","8022":"chang-klang-8022","8023":"chaloem-phra-kiat-8023","8101":"mueang-krabi-8101","8102":"khao-phanom-8102","8103":"ko-lanta-8103","8104":"khlong-thom-8104","8105":"ao-luek-8105","8106":"plai-phraya-8106","8107":"lam-thap-8107","8108":"nuea-khlong-8108","8201":"mueang-phang-nga-8201","8202":"ko-yao-8202","8203":"kapong-8203","8204":"takua-thung-8204","8205":"takua-pa-8205","8206":"khura-buri-8206","8207":"thap-put-8207","8208":"thai-mueang-8208","8301":"mueang-phuket-8301","8302":"kathu-8302","8303":"thalang-8303","8401":"mueang-surat-thani-8401","8402":"kanchanadit-8402","8403":"don-sak-8403","8404":"ko-samui-8404","8405":"ko-pha-ngan-8405","8406":"chaiya-8406","8407":"tha-chana-8407","8408":"khiri-rat-nikhom-8408","8409":"ban-ta-khun-8409","8410":"phanom-8410","8411":"tha-chang-8411","8412":"ban-na-san-8412","8413":"ban-na-doem-8413","8414":"khian-sa-8414","8415":"wiang-sa-8415","8416":"phrasaeng-8416","8417":"phunphin-8417","8418":"chai-buri-8418","8419":"vibhavadi-8419","8501":"mueang-ranong-8501","8502":"la-un-8502","8503":"kapoe-8503","8504":"kra-buri-8504","8505":"suk-samran-8505","8601":"mueang-chumphon-8601","8602":"tha-sae-8602","8603":"pathio-8603","8604":"lang-suan-8604","8605":"lamae-8605","8606":"phato-8606","8607":"sawi-8607","8608":"thung-tako-8608","9001":"mueang-songkhla-9001","9002":"sathing-phra-9002","9003":"chana-9003","9004":"na-thawi-9004","9005":"thepha-9005","9006":"saba-yoi-9006","9007":"ranot-9007","9008":"krasae-sin-9008","9009":"rattaphum-9009","9010":"sadao-9010","9011":"hat-yai-9011","9012":"na-mom-9012","9013":"khuan-niang-9013","9014":"bang-klam-9014","9015":"singhanakhon-9015","9016":"khlong-hoi-khong-9016","9077":"sum-nung-kam-9077","9101":"mueang-satun-9101","9102":"khuan-don-9102","9103":"khuan-kalong-9103","9104":"tha-phae-9104","9105":"la-ngu-9105","9106":"thung-wa-9106","9107":"manang-9107","9201":"mueang-trang-9201","9202":"kantang-9202","9203":"yan-ta-khao-9203","9204":"palian-9204","9205":"sikao-9205","9206":"huai-yot-9206","9207":"wang-wiset-9207","9208":"na-yong-9208","9209":"ratsada-9209","9210":"hat-samran-9210","9301":"mueang-phatthalung-9301","9302":"kong-ra-9302","9303":"khao-chaison-9303","9304":"tamot-9304","9305":"khuan-khanun-9305","9306":"pak-phayun-9306","9307":"si-banphot-9307","9308":"pa-bon-9308","9309":"bang-kaeo-9309","9310":"pa-phayom-9310","9311":"srinagarindra-9311","9401":"mueang-pattani-9401","9402":"khok-pho-9402","9403":"nong-chik-9403","9404":"panare-9404","9405":"mayo-9405","9406":"thung-yang-daeng-9406","9407":"sai-buri-9407","9408":"mai-kaen-9408","9409":"yaring-9409","9410":"yarang-9410","9411":"kapho-9411","9412":"mae-lan-9412","9501":"mueang-yala-9501","9502":"betong-9502","9503":"bannang-sata-9503","9504":"than-to-9504","9505":"yaha-9505","9506":"raman-9506","9507":"kabang-9507","9508":"krong-pinang-9508","9601":"mueang-narathiwat-9601","9602":"tak-bai-9602","9603":"bacho-9603","9604":"yi-ngo-9604","9605":"ra-ngae-9605","9606":"rueso-9606","9607":"si-sakhon-9607","9608":"waeng-9608","9609":"sukhirin-9609","9610":"su-ngai-kolok-9610","9611":"su-ngai-padi-9611","9612":"chanae-9612","9613":"cho-airong-9613"};
var STARTER_PROVINCES=[["prov0517d8d9fc","Amnat Charoen","อำนาจเจริญ","安纳乍能"],
["prov195266d87b","Ang Thong","อ่างทอง","红统"],
["provf9f6448bf9","Bangkok","กรุงเทพมหานคร","曼谷"],
["prov69124c5b3a","Bueng Kan","บึงกาฬ","汶干"],
["provf8788a2493","Buriram","บุรีรัมย์","武里南"],
["provb851058bc8","Chachoengsao","ฉะเชิงเทรา","北柳"],
["provc41e5236c1","Chai Nat","ชัยนาท","猜纳"],
["prov3711006c81","Chaiyaphum","ชัยภูมิ","猜也奔"],
["provfae19908eb","Chanthaburi","จันทบุรี","尖竹汶"],
["prov938e63ce50","Chiang Mai","เชียงใหม่","清迈"],
["prov089a23e052","Chiang Rai","เชียงราย","清莱"],
["provb87bb14243","Chonburi","ชลบุรี","春武里"],
["prov3c3e05feac","Chumphon","ชุมพร","春蓬"],
["prov169ab44eed","Kalasin","กาฬสินธุ์","加拉信"],
["prov6dbc2c6819","Kamphaeng Phet","กำแพงเพชร","甘烹碧"],
["prov833d43138c","Kanchanaburi","กาญจนบุรี","北碧"],
["prov65290436ae","Khon Kaen","ขอนแก่น","孔敬"],
["prov4e287bf0d6","Krabi","กระบี่","甲米"],
["provd478ad47d4","Lampang","ลำปาง","南邦"],
["prov88ba64f297","Lamphun","ลำพูน","南奔"],
["prov06873e0a56","Loei","เลย","黎府"],
["prov45d7969e90","Lopburi","ลพบุรี","华富里"],
["prov2614720cd8","Mae Hong Son","แม่ฮ่องสอน","夜丰颂"],
["provc4112a6125","Maha Sarakham","มหาสารคาม","玛哈沙拉堪"],
["prov9688a3b9bb","Mukdahan","มุกดาหาร","莫达汉"],
["prov15d05e15c6","Nakhon Nayok","นครนายก","那空那育"],
["prov0563220ad2","Nakhon Pathom","นครปฐม","佛统"],
["prov82903c7ffd","Nakhon Phanom","นครพนม","那空帕农"],
["prov7cd0c08ad9","Nakhon Ratchasima","นครราชสีมา","呵叻"],
["prov8820814434","Nakhon Sawan","นครสวรรค์","那空沙旺"],
["prov62beb67938","Nakhon Si Thammarat","นครศรีธรรมราช","洛坤"],
["prov0b5979c53d","Nan","น่าน","楠府"],
["provee7b91d72e","Narathiwat","นราธิวาส","陶公"],
["provac81677f49","Nong Bua Lamphu","หนองบัวลำภู","农磨兰普"],
["provd2cd3c8884","Nong Khai","หนองคาย","廊开"],
["prov47594a90e1","Nonthaburi","นนทบุรี","暖武里"],
["prov85dd91fc2d","Pathum Thani","ปทุมธานี","巴吞他尼"],
["prov0a35cedcea","Pattani","ปัตตานี","北大年"],
["prova25bf4de3e","Phang Nga","พังงา","攀牙"],
["provdfcb9c2cb1","Phatthalung","พัทลุง","博他仑"],
["prove78110d707","Phayao","พะเยา","帕尧"],
["prov299e7b9ad1","Phetchabun","เพชรบูรณ์","碧差汶"],
["prov4c3f07615c","Phetchaburi","เพชรบุรี","佛丕"],
["prov7951213eaa","Phichit","พิจิตร","披集"],
["prov0b9a874519","Phitsanulok","พิษณุโลก","彭世洛"],
["provcc1d3f07cf","Phra Nakhon Si Ayutthaya","พระนครศรีอยุธยา","大城"],
["provd2114a7888","Phrae","แพร่","帕府"],
["prov8d2440a16f","Phuket","ภูเก็ต","普吉"],
["prov25efe2fbd5","Prachinburi","ปราจีนบุรี","巴真"],
["prov47c7699faf","Prachuap Khiri Khan","ประจวบคีรีขันธ์","班武里"],
["prove5418fd64f","Ranong","ระนอง","拉廊"],
["prov5971e7121e","Ratchaburi","ราชบุรี","叻丕"],
["provdd56d1d575","Rayong","ระยอง","罗勇"],
["prov479ffe6264","Roi Et","ร้อยเอ็ด","黎逸"],
["prov068f71070a","Sa Kaeo","สระแก้ว","沙缴"],
["provd8a5dfb57f","Sakon Nakhon","สกลนคร","色军"],
["prov48827ea6d4","Samut Prakan","สมุทรปราการ","北榄"],
["provf34477bea7","Samut Sakhon","สมุทรสาคร","龙仔厝"],
["prov457304ae9b","Samut Songkhram","สมุทรสงคราม","夜功"],
["prov8a23b46492","Saraburi","สระบุรี","北标"],
["prov6abd9bf370","Satun","สตูล","沙敦"],
["provf6b54242f8","Sing Buri","สิงห์บุรี","信武里"],
["proveb6fa9e41e","Sisaket","ศรีสะเกษ","四色菊"],
["prov4f114b68fa","Songkhla","สงขลา","宋卡"],
["prov5313ac3c04","Sukhothai","สุโขทัย","素可泰"],
["provdd90c673e2","Suphan Buri","สุพรรณบุรี","素攀"],
["prov18f04a2f42","Surat Thani","สุราษฎร์ธานี","素叻他尼"],
["prov1930211d5b","Surin","สุรินทร์","素林"],
["provbcc01ff563","Tak","ตาก","来兴"],
["provca85b5002b","Trang","ตรัง","董里"],
["prova27b9e2215","Trat","ตราด","桐艾"],
["provf50cf87b49","Ubon Ratchathani","อุบลราชธานี","乌汶"],
["prov0f80dba88d","Udon Thani","อุดรธานี","乌隆"],
["prov0a47b718e4","Uthai Thani","อุทัยธานี","乌泰他尼"],
["prov39a74183f5","Uttaradit","อุตรดิตถ์","程逸"],
["prov2ac0799c5f","Yala","ยะลา","也拉"],
["prov703d4b5737","Yasothon","ยโสธร","益梭通"]];
(function () {
  var root = document.querySelector('[data-company-directory]');
  if (!root) return;

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function text(v) { return v == null ? '' : String(v); }
  function escapeHtml(v) { return text(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function metaValue(m, lower, camel) { var v = m && m[lower]; if (v !== undefined && v !== null && v !== '') return v; return camel && m ? m[camel] : undefined; }
  function firstValue(m, keys) { for (var i = 0; i < keys.length; i += 1) { var v = m && m[keys[i]]; if (v !== undefined && v !== null && v !== '') return text(v); } return ''; }
  function normalizeLocale(v) { v = text(v).trim().toLowerCase(); if (v === 'zh' || v.indexOf('zh') === 0) return 'zh-CN'; if (v.indexOf('th') === 0) return 'th'; if (v.indexOf('en') === 0) return 'en'; return ''; }
  function activeLocale() { var first = window.location.pathname.split('/').filter(Boolean)[0] || ''; var fp = normalizeLocale(first); if (fp) return fp; var hl = normalizeLocale(document.documentElement.lang); if (hl) return hl; return 'en'; }
  function fmtNum(v) { var n = Number(text(v).replace(/[,\s]/g, '')); if (!isFinite(n)) return text(v); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var locale = activeLocale();
  var LANG = locale === 'zh-CN' ? 'zh' : (locale === 'th' ? 'th' : 'en');
  function provLabel(r) { return LANG === 'zh' ? r[3] : (LANG === 'th' ? r[2] : r[1]); }

  var LABELS = {
    loading: { en: 'Loading companies…', th: 'กำลังโหลดบริษัท…', zh: '正在加载公司…' },
    loadingCountries: { en: 'Loading countries…', th: 'กำลังโหลดประเทศ…', zh: '正在加载国家列表…' },
    empty: { en: 'No companies match these filters.', th: 'ไม่มีบริษัทที่ตรงกับตัวกรอง', zh: '没有符合这些筛选条件的公司。' },
    error: { en: 'Couldn’t load companies. Please try again.', th: 'ไม่สามารถโหลดบริษัทได้ โปรดลองใหม่อีกครั้ง', zh: '无法加载公司，请重试。' },
    prev: { en: 'Previous', th: 'ก่อนหน้า', zh: '上一页' },
    next: { en: 'Next', th: 'ถัดไป', zh: '下一页' },
    showing: { en: 'Showing {from}–{to} of {total} companies', th: 'แสดง {from}–{to} จาก {total} บริษัท', zh: '显示第 {from}–{to} 家，共 {total} 家公司' },
    loginMore: { en: 'Sign in to see more companies', th: 'เข้าสู่ระบบเพื่อดูบริษัทเพิ่มเติม', zh: '登录后查看更多公司' },
    loginBtn: { en: 'Sign in', th: 'เข้าสู่ระบบ', zh: '登录' },
    allCountries: { en: 'All countries', th: 'ทุกประเทศ', zh: '所有国家' },
    noCountries: { en: 'No countries found', th: 'ไม่พบประเทศ', zh: '未找到国家' },
    selectCountry: { en: 'Select country', th: 'เลือกประเทศ', zh: '按国家筛选' },
    searchCountry: { en: 'Search countries…', th: 'ค้นหาประเทศ…', zh: '搜索国家…' },
    showingActive: { en: 'Showing {from}–{to} of {total} operating companies', th: 'แสดง {from}–{to} จาก {total} บริษัทที่ดำเนินกิจการ', zh: '显示第 {from}–{to} 家，共 {total} 家运营中公司' },
    showingAll: { en: 'Showing {from}–{to} of {total} companies (including inactive)', th: 'แสดง {from}–{to} จาก {total} บริษัท (รวมที่ไม่ดำเนินกิจการ)', zh: '显示第 {from}–{to} 家，共 {total} 家（含非运营）' },
    allIndustries: { en: 'All industries', th: 'ทุกอุตสาหกรรม', zh: '全部行业' },
    industryCategories: { en: 'Industry categories', th: 'หมวดหมู่อุตสาหกรรม', zh: '行业分类' },
    clearIndustry: { en: 'Clear industry', th: 'ล้างอุตสาหกรรม', zh: '清除行业' },
    collapse: { en: 'Collapse', th: 'ย่อ', zh: '收起' },
    expand: { en: 'Expand', th: 'ขยาย', zh: '展开' },
    searchIndustry: { en: 'Search industry or TSIC code…', th: 'ค้นหาอุตสาหกรรมหรือรหัส TSIC…', zh: '搜索行业名称或 TSIC 编号…' },
    wholeSection: { en: 'All in this section', th: 'ทั้งหมดในหมวดนี้', zh: '该大类全部' },
    noSubIndustries: { en: 'No sub-industries found.', th: 'ไม่พบหมวดย่อย', zh: '暂无二级分类' },
    loadingIndustries: { en: 'Loading categories…', th: 'กำลังโหลดหมวดหมู่…', zh: '正在加载分类…' },
    industriesUnavailable: { en: 'Categories unavailable.', th: 'ไม่สามารถโหลดหมวดหมู่ได้', zh: '分类暂不可用' },
    searchResults: { en: 'Search results', th: 'ผลการค้นหา', zh: '搜索结果' }
  };
  function t(k) { var e = LABELS[k]; return e ? (e[LANG] || e.en) : k; }

  var listEl = root.querySelector('[data-company-list]');
  if (!listEl) return;
  var pagerEl = root.querySelector('[data-company-pager]');
  var rangeEl = root.querySelector('[data-company-range]');
  var formEl = root.querySelector('[data-company-filters]');
  var keywordEl = root.querySelector('[data-filter-keyword]');
  var inactiveEl = root.querySelector('[data-filter-inactive]');
  var provSel = root.querySelector('[data-filter-province]');
  var indBrowse = root.querySelector('[data-industry-browse]');
  var indTitleEl = root.querySelector('[data-industry-title]');
  var indSelEl = root.querySelector('[data-industry-selection]');
  var indClearEl = root.querySelector('[data-industry-clear]');
  var indToggleEl = root.querySelector('[data-industry-toggle]');
  var indBodyEl = root.querySelector('[data-industry-body]');
  var indSearchEl = root.querySelector('[data-industry-search]');
  var indSectionsEl = root.querySelector('[data-industry-sections]');
  var indContentEl = root.querySelector('[data-industry-content]');
  var capSel = root.querySelector('[data-filter-capital]');
  var resetEl = root.querySelector('[data-filter-reset]');
  var countryBtn = root.querySelector('[data-filter-country-btn]');
  var countryFlagEl = root.querySelector('[data-filter-country-flag]');
  var countryNameEl = root.querySelector('[data-filter-country-name]');
  var countryModal = root.querySelector('[data-country-modal]');
  var countryModalTitle = root.querySelector('[data-country-modal-title]');
  var countrySearchEl = root.querySelector('[data-country-search]');
  var countryListEl = root.querySelector('[data-country-list]');

  var PER = 24;
  // 与 analytics browseCompanies / resolver MAX_BROWSE_OFFSET 对齐:深分页封顶后服务端 404,
  // 前端不能再按完整 total 画出几万页链接(否则点 4002+ 就进 404)。
  var MAX_BROWSE_OFFSET = 96000;
  function maxBrowsePages(n) {
    return Math.min(Math.floor(MAX_BROWSE_OFFSET / PER) + 1, Math.max(1, Math.ceil((Number(n) || 0) / PER)));
  }
  // 默认硬过滤运营中(analytics company-list);勾选「含非运营」传 includeInactive=1。
  // WooCMS 原生 sort 对 cpt:thaicompany 是 no-op,排序/过滤都走 analytics 边车。
  var BROWSE_API = '/api/site/v1/analytics/company-list';
  var total = 0;
  var state = { keyword: '', province: '', industry: '', subIndustry: '', capital: '', country: '', includeInactive: false, page: 1 };

  function companyHref(jpno, en) { return window.__starterCompanyHref ? window.__starterCompanyHref(jpno, en) : '/' + encodeURIComponent(jpno) + '.html'; }

  function renderRows(items) {
    return items.map(function (it) {
      var m = it.meta || {};
      var jpno = text(m.jpno || it.slug);
      var enName = metaValue(m, 'jpnamee', 'jpNameE') || (m.i18n && m.i18n.en && m.i18n.en.name) || it.title || jpno;
      var thName = metaValue(m, 'jpname', 'jpName') || (m.i18n && m.i18n.th && m.i18n.th.name) || '';
      var zhName = m.jpnamezh || ''; // 无中文名时留空 → applyCard 回退英文(公司名约定:zh 站显示英文罗马名,而非泰文)
      var provEN = metaValue(m, 'provincee', 'provinceE') || '', provTH = m.province || '', provZH = m.provincezh || '';
      var objEN = firstValue(m, ['setupobjdesce', 'submitobjdesce']), objTH = firstValue(m, ['setupobjdesc', 'submitobjdesc']), objZH = firstValue(m, ['setupobjdesczh', 'submitobjdesczh']);
      var cap = (m.capamt != null ? m.capamt : '');
      var stEN = metaValue(m, 'jpstatdesce', 'jpStatDescE') || '', stTH = m.jpstatdesc || '', stZH = m.statuszh || '';
      return '<a class="biz-industry-item" href="' + escapeHtml(companyHref(jpno, enName)) + '" data-en-name="' + escapeHtml(enName) + '"'
        + ' data-name-en="' + escapeHtml(enName) + '" data-name-th="' + escapeHtml(thName) + '" data-name-zh="' + escapeHtml(zhName) + '">'
        + '<span class="biz-industry-item__body">'
        + '<span class="biz-industry-item__namewrap">'
        + '<strong class="biz-industry-item__name">' + escapeHtml(enName) + '</strong>'
        + '<span data-updated-slot></span>'
        + '</span>'
        + '<span class="biz-industry-item__sub">'
        + '<span class="biz-industry-item__obj" data-en="' + escapeHtml(objEN) + '" data-th="' + escapeHtml(objTH) + '" data-zh="' + escapeHtml(objZH) + '">' + escapeHtml(objEN) + '</span>'
        + '<span class="biz-industry-item__loc" data-en="' + escapeHtml(provEN) + '" data-th="' + escapeHtml(provTH) + '" data-zh="' + escapeHtml(provZH) + '">' + escapeHtml(provEN) + '</span>'
        + '<span class="biz-industry-item__jpno">' + escapeHtml(jpno) + '</span>'
        + '</span></span>'
        + '<span class="biz-industry-item__aside">'
        + '<span class="biz-industry-item__cap" data-cap="' + escapeHtml(cap) + '">' + escapeHtml(cap) + '</span>'
        + '<span class="biz-industry-item__status" data-en="' + escapeHtml(stEN) + '" data-th="' + escapeHtml(stTH) + '" data-zh="' + escapeHtml(stZH) + '">' + escapeHtml(stEN) + '</span>'
        + '</span>'
        + '</a>';
    }).join('');
  }

  function applyCard(card) {
    var nameEl = card.querySelector('.biz-industry-item__name') || card.querySelector('strong');
    if (nameEl) nameEl.textContent = card.getAttribute('data-name-' + LANG) || card.getAttribute('data-name-en') || card.getAttribute('data-name-th') || nameEl.textContent;
    Array.prototype.forEach.call(card.querySelectorAll('[data-en]'), function (sp) {
      var v = sp.getAttribute('data-' + LANG) || sp.getAttribute('data-en') || '';
      sp.textContent = v; sp.hidden = !v;
    });
    var capEl = card.querySelector('[data-cap]');
    if (capEl) { var cv = capEl.getAttribute('data-cap'); var ok = !(cv === '' || cv == null); capEl.textContent = ok ? ('฿' + fmtNum(cv)) : ''; capEl.hidden = !ok; }
    if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(card);
  }
  function applyAll() { Array.prototype.forEach.call(listEl.querySelectorAll('.biz-industry-item'), applyCard); if (window.__bizthaiApplyRecentlyUpdated) window.__bizthaiApplyRecentlyUpdated(listEl); }

  function pageWindow(page, totalPages) {
    var out = [], lo = Math.max(1, page - 2), hi = Math.min(totalPages, page + 2);
    if (lo > 1) { out.push(1); if (lo > 2) out.push('…'); }
    for (var p = lo; p <= hi; p += 1) out.push(p);
    if (hi < totalPages) { if (hi < totalPages - 1) out.push('…'); out.push(totalPages); }
    return out;
  }
  function renderPager(page, totalPages) {
    if (!pagerEl) return;
    if (totalPages <= 1) { pagerEl.hidden = true; pagerEl.innerHTML = ''; return; }
    var html = '<button type="button" class="biz-arch-pager__btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>' + escapeHtml(t('prev')) + '</button>';
    pageWindow(page, totalPages).forEach(function (p) {
      if (p === '…') { html += '<span class="biz-arch-pager__gap">…</span>'; return; }
      html += '<button type="button" class="biz-arch-pager__num' + (p === page ? ' is-current' : '') + '" data-page="' + p + '"' + (p === page ? ' aria-current="page"' : '') + '>' + p + '</button>';
    });
    html += '<button type="button" class="biz-arch-pager__btn" data-page="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>' + escapeHtml(t('next')) + '</button>';
    pagerEl.innerHTML = html;
    pagerEl.hidden = false;
  }

  function setRange(page, count) {
    if (!rangeEl) return;
    if (!count) { rangeEl.textContent = ''; return; }
    var from = (page - 1) * PER + 1, to = (page - 1) * PER + count;
    var key = state.includeInactive ? 'showingAll' : 'showingActive';
    rangeEl.textContent = t(key).replace('{from}', fmtNum(from)).replace('{to}', fmtNum(to)).replace('{total}', fmtNum(total));
  }

  var ZH_COUNTRY = { cn:'中国',jp:'日本',us:'美国',sg:'新加坡',gb:'英国',de:'德国',fr:'法国',kr:'韩国',au:'澳大利亚',nl:'荷兰',ch:'瑞士',hk:'香港',tw:'台湾',in:'印度',my:'马来西亚',id:'印度尼西亚',vn:'越南',ph:'菲律宾',kh:'柬埔寨',mm:'缅甸',la:'老挝',bn:'文莱',mo:'澳门',be:'比利时',ca:'加拿大',it:'意大利',es:'西班牙',se:'瑞典',no:'挪威',dk:'丹麦',fi:'芬兰',at:'奥地利',nz:'新西兰',br:'巴西',mx:'墨西哥',za:'南非',ae:'阿联酋',sa:'沙特阿拉伯',ru:'俄罗斯',ua:'乌克兰',tr:'土耳其',il:'以色列',eg:'埃及',ng:'尼日利亚',ke:'肯尼亚',ar:'阿根廷',cl:'智利',co:'哥伦比亚',pt:'葡萄牙',gr:'希腊',pl:'波兰',cz:'捷克',hu:'匈牙利',ro:'罗马尼亚',bg:'保加利亚',hr:'克罗地亚',sk:'斯洛伐克',si:'斯洛文尼亚',ee:'爱沙尼亚',lv:'拉脱维亚',lt:'立陶宛',ie:'爱尔兰',lu:'卢森堡',mt:'马耳他',cy:'塞浦路斯',is:'冰岛',kw:'科威特',qa:'卡塔尔',bh:'巴林',om:'阿曼',jo:'约旦',lb:'黎巴嫩',pk:'巴基斯坦',bd:'孟加拉国',lk:'斯里兰卡',np:'尼泊尔',mv:'马尔代夫',am:'亚美尼亚',ge:'格鲁吉亚',az:'阿塞拜疆',kz:'哈萨克斯坦',uz:'乌兹别克斯坦',mn:'蒙古',md:'摩尔多瓦' };

  function isoToFlag(code) {
    if (!code || code.length !== 2) return '';
    return code.toUpperCase().replace(/[A-Z]/g, function(c) { return String.fromCodePoint(c.charCodeAt(0) + 127397); });
  }
  function countryDisplayName(slug, enName) {
    return (LANG === 'zh' && ZH_COUNTRY[slug]) ? ZH_COUNTRY[slug] : enName;
  }

  var allCountries = [];
  var countriesLoaded = false;

  function updateCountryBtn() {
    if (!countryBtn) return;
    if (state.country) {
      var found = null;
      for (var i = 0; i < allCountries.length; i++) { if (allCountries[i].slug === state.country) { found = allCountries[i]; break; } }
      var dname = found ? countryDisplayName(found.slug, found.name) : state.country.toUpperCase();
      if (countryFlagEl) countryFlagEl.textContent = isoToFlag(state.country);
      if (countryNameEl) countryNameEl.textContent = dname;
      countryBtn.classList.add('is-active');
    } else {
      if (countryFlagEl) countryFlagEl.textContent = '';
      if (countryNameEl) countryNameEl.textContent = t('allCountries');
      countryBtn.classList.remove('is-active');
    }
  }

  function renderCountryList(q) {
    if (!countryListEl) return;
    if (!allCountries.length) { countryListEl.innerHTML = '<p class="biz-country-empty">' + escapeHtml(t('loadingCountries')) + '</p>'; return; }
    var qLow = (q || '').toLowerCase().trim();
    var filtered = qLow ? allCountries.filter(function(c) {
      var zh = ZH_COUNTRY[c.slug] || '';
      return c.name.toLowerCase().indexOf(qLow) !== -1 || zh.indexOf(qLow) !== -1;
    }) : allCountries;
    if (!filtered.length) { countryListEl.innerHTML = '<p class="biz-country-empty">' + escapeHtml(t('noCountries')) + '</p>'; return; }
    countryListEl.innerHTML = filtered.map(function(c) {
      var flag = isoToFlag(c.slug);
      var dname = countryDisplayName(c.slug, c.name);
      var isActive = state.country === c.slug;
      return '<button type="button" class="biz-country-item' + (isActive ? ' is-active' : '') + '" data-country-slug="' + escapeHtml(c.slug) + '">' +
        '<span class="biz-country-item__flag">' + flag + '</span>' +
        '<span class="biz-country-item__name">' + escapeHtml(dname) + '</span>' +
        '</button>';
    }).join('');
  }

  function openCountryModal() {
    if (!countryModal) return;
    if (countryModalTitle) countryModalTitle.textContent = t('selectCountry');
    if (countrySearchEl) { countrySearchEl.placeholder = t('searchCountry'); countrySearchEl.value = ''; }
    renderCountryList('');
    countryModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (countrySearchEl) countrySearchEl.focus();
  }
  function closeCountryModal() {
    if (!countryModal) return;
    countryModal.hidden = true;
    document.body.style.overflow = '';
  }
  function selectCountry(slug) {
    state.country = (state.country === slug) ? '' : slug;
    if (capSel) capSel.value = ''; // 国家和"所有权"选的是同一个 capital 维度,互斥;province/industry 是独立维度,不清空
    updateCountryBtn();
    closeCountryModal();
    applyFromControls();
  }
  function loadCountries(cb) {
    if (countriesLoaded) { if (cb) cb(); return; }
    fetch('/api/site/v1/taxonomies/capital/terms?limit=300&offset=0&sort=name_asc', { headers: { Accept: 'application/json' } })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(j) {
        var items = ((j && j.data) || {}).items || [];
        allCountries = items.filter(function(it) { return it.slug !== 'thai-capital' && it.slug !== 'foreign-capital'; });
        countriesLoaded = true;
        if (cb) cb();
      }).catch(function() { countriesLoaded = true; if (cb) cb(); });
  }

  function buildUrl(page) {
    var p = new URLSearchParams();
    var offset = (page - 1) * PER;
    if (state.keyword) p.set('keyword', state.keyword);
    if (state.province) p.set('province', state.province);
    // 选了细分行业就按细分查(它本身也是 industry taxonomy 的一个 term,比大类更精确)
    if (state.subIndustry) p.set('industry', state.subIndustry);
    else if (state.industry) p.set('industry', state.industry);
    if (state.capital) p.set('capital', state.capital);
    if (state.includeInactive) p.set('includeInactive', '1');
    p.set('limit', PER); p.set('offset', offset);
    return BROWSE_API + '?' + p.toString();
  }
  function showMsg(k) { listEl.innerHTML = '<p class="biz-report-empty">' + escapeHtml(t(k)) + '</p>'; if (pagerEl) pagerEl.hidden = true; }
  function showMsgLogin() { listEl.innerHTML = '<div style="text-align:center;padding:36px 20px 32px;border:1px solid rgba(121,1,178,.18);border-radius:10px;background:rgba(121,1,178,.04);margin:8px 0"><p style="margin:0 0 14px;font-size:15px;color:#34303b">' + escapeHtml(t('loginMore')) + '</p><button type="button" style="padding:10px 24px;border:0;border-radius:8px;background:#7901b2;color:#fff;font-size:14px;font-weight:600;cursor:pointer" onclick="if(window.__starterAuth)window.__starterAuth.requireLogin()">' + escapeHtml(t('loginBtn')) + '</button></div>'; }

  function load(page, _authed) {
    if (!_authed && page > 1 && window.__starterAuth) {
      window.__starterAuth.me().then(function (u) {
        if (!u) { showMsgLogin(); if (pagerEl) pagerEl.hidden = true; }
        else { load(page, true); }
      });
      return;
    }
    state.page = page; syncUrl();
    showMsg('loading');
    fetch(buildUrl(page), { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      var d = (j && j.data) || {}, items = d.items || [];
      total = Number(d.total) || items.length;
      var pages = maxBrowsePages(total);
      if (page > pages) { load(pages, true); return; }
      if (!items.length) { showMsg('empty'); setRange(page, 0); return; }
      listEl.innerHTML = renderRows(items);
      applyAll();
      renderPager(page, pages);
      setRange(page, items.length);
    }).catch(function () { showMsg('error'); setRange(state.page, 0); });
  }

  function syncReset() { if (resetEl) resetEl.hidden = !(state.keyword || state.province || state.industry || state.subIndustry || state.capital || state.includeInactive); }
  function syncUrl() {
    if (!(window.history && history.replaceState)) return;
    var p = new URLSearchParams();
    if (state.keyword) p.set('q', state.keyword);
    if (state.province) p.set('province', state.province);
    if (state.industry) p.set('industry', state.industry);
    if (state.subIndustry) p.set('subindustry', state.subIndustry);
    if (state.country) p.set('country', state.country);
    else if (state.capital) p.set('ownership', state.capital);
    if (state.includeInactive) p.set('inactive', '1');
    if (state.page > 1) p.set('page', state.page);
    var qs = p.toString();
    try { history.replaceState(null, '', window.location.pathname + (qs ? ('?' + qs) : '')); } catch (e) { }
  }
  // province/industry/capital 是三个独立维度,同时选中按 AND 组合;capital 维度内部
  // ("所有权"下拉 vs 具体国家)互斥,选其一清空另一个,以 capSel 的值优先。
  function applyFromControls() {
    state.keyword = keywordEl ? keywordEl.value.trim() : '';
    state.province = provSel ? provSel.value : '';
    // 行业/细分行业由选择面板直接写 state,这里不从表单控件读
    // 勾选含非运营,或输入 13 位注册号时自动放开(精确查号应能命中已解散公司)
    state.includeInactive = !!(inactiveEl && inactiveEl.checked) || /^\d{13}$/.test(state.keyword);
    if (inactiveEl && state.includeInactive && /^\d{13}$/.test(state.keyword)) inactiveEl.checked = true;
    if (capSel && capSel.value) { state.capital = capSel.value; state.country = ''; }
    else if (state.country) { state.capital = state.country; }
    else { state.capital = ''; }
    updateCountryBtn();
    syncReset();
    load(1);
  }
  function onSelectChange(active) {
    if (active === capSel && capSel.value) { state.country = ''; updateCountryBtn(); }
    applyFromControls();
  }

  function populateProvinces() {
    if (!provSel || typeof STARTER_PROVINCES === 'undefined') return;
    var rows = STARTER_PROVINCES.slice().sort(function (a, b) { var x = provLabel(a), y = provLabel(b); return x < y ? -1 : (x > y ? 1 : 0); });
    var html = '';
    rows.forEach(function (r) { html += '<option value="' + escapeHtml(r[0]) + '">' + escapeHtml(provLabel(r)) + '</option>'; });
    provSel.insertAdjacentHTML('beforeend', html);
  }
  // ---- 行业选择面板(左侧 TSIC 大类 + 右侧五位子类卡片,与 header 分类面板同形态)----
  // taxonomy 接口带 ?lang= 会连子类一起返回中文/泰文译名,所以不用再额外取 industry-sections。
  var indApiLang = LANG === 'zh' ? 'zh-CN' : LANG;
  var indTops = [];          // 大类,按 sort_order
  var indChildren = {};      // 大类 id → 子类数组
  var indBySlug = {};        // slug → term(大类与子类都在)
  var indParentSlug = {};    // 子类 slug → 大类 slug
  var indLoaded = false;
  var indFailed = false;
  var indLoading = null;
  var indActiveSection = '';

  // 子类 TSIC 数字编码取 slug 尾部(…-01112 → 01112);大类没有编码。
  function indCode(term) {
    var m = String((term && term.slug) || '').match(/-(\d{4,5})$/);
    if (!m) return '';
    return m[1].length === 4 ? '0' + m[1] : m[1];
  }
  function indSortFn(a, b) {
    return (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || String(a.name || '').localeCompare(String(b.name || ''));
  }

  function loadIndustryTerms() {
    if (indLoaded) return Promise.resolve();
    if (indLoading) return indLoading;
    var all = [];
    function page(offset) {
      return fetch('/api/site/v1/taxonomies/industry/terms?limit=500&offset=' + offset + '&lang=' + encodeURIComponent(indApiLang), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var d = (j && j.data) || {};
          var items = d.items || [];
          all = all.concat(items);
          var tot = Number(d.total || all.length);
          if (items.length && all.length < tot && offset < 3000) return page(offset + items.length);
          return null;
        });
    }
    indLoading = page(0).then(function () {
      indTops = []; indChildren = {}; indBySlug = {}; indParentSlug = {};
      var seen = {};
      all.forEach(function (it) {
        if (!it || !it.slug || seen[it.id]) return; // 分页边界重叠时同一 term 可能回来两次
        seen[it.id] = 1;
        indBySlug[it.slug] = it;
        if (it.parent_id == null) { indTops.push(it); return; }
        var k = String(it.parent_id);
        (indChildren[k] = indChildren[k] || []).push(it);
      });
      indTops.sort(indSortFn);
      indTops.forEach(function (top) {
        var kids = indChildren[String(top.id)] || [];
        kids.sort(indSortFn);
        kids.forEach(function (kid) { indParentSlug[kid.slug] = top.slug; });
      });
      indLoaded = true;
      indFailed = false;
    }).catch(function () { indLoading = null; indFailed = true; });
    return indLoading;
  }

  // 面包屑式的当前选择:大类 › 05100 子类;没选就显示「全部行业」
  function updateIndustrySelection() {
    if (indClearEl) indClearEl.hidden = !(state.industry || state.subIndustry);
    if (!indSelEl) return;
    if (!state.industry && !state.subIndustry) { indSelEl.textContent = t('allIndustries'); indSelEl.classList.remove('is-active'); return; }
    var parts = [];
    var sec = indBySlug[state.industry];
    if (sec) parts.push(sec.name);
    else if (state.industry) parts.push(state.industry);
    if (state.subIndustry) {
      var kid = indBySlug[state.subIndustry];
      var code = kid ? indCode(kid) : '';
      parts.push(kid ? ((code ? code + ' ' : '') + kid.name) : state.subIndustry);
    }
    indSelEl.textContent = parts.join(' › ');
    indSelEl.classList.add('is-active');
  }

  function renderIndustrySections() {
    if (!indSectionsEl) return;
    var html = '<button type="button" class="biz-indpick__item' + (!state.industry ? ' is-active' : '') + '" data-ind-section="">'
      + '<span class="biz-indpick__item-text">' + escapeHtml(t('allIndustries')) + '</span></button>';
    indTops.forEach(function (top) {
      var kids = indChildren[String(top.id)] || [];
      var on = indActiveSection === top.slug;
      html += '<button type="button" class="biz-indpick__item' + (on ? ' is-active' : '') + (state.industry === top.slug ? ' is-picked' : '') + '" data-ind-section="' + escapeHtml(top.slug) + '">'
        + '<span class="biz-indpick__item-text">' + escapeHtml(top.name) + '</span>'
        + '<span class="biz-indpick__item-count">' + kids.length + '</span></button>';
    });
    indSectionsEl.innerHTML = html;
  }

  // 切大类只改左栏高亮 + 重画右栏;左栏不重建 DOM,否则 hover 中的按钮被替换会抖动
  function setActiveSection(slug) {
    indActiveSection = slug;
    if (indSectionsEl) {
      Array.prototype.forEach.call(indSectionsEl.querySelectorAll('[data-ind-section]'), function (el) {
        el.classList.toggle('is-active', el.getAttribute('data-ind-section') === slug);
      });
    }
    renderIndustryContent('');
  }

  function industryCards(list) {
    return list.map(function (kid) {
      var code = indCode(kid);
      return '<button type="button" class="biz-indpick__card' + (state.subIndustry === kid.slug ? ' is-active' : '') + '" data-ind-term="' + escapeHtml(kid.slug) + '">'
        + (code ? '<span class="biz-indpick__code">' + escapeHtml(code) + '</span>' : '')
        + '<span class="biz-indpick__cardname">' + escapeHtml(kid.name) + '</span></button>';
    }).join('');
  }

  function renderIndustryContent(q, keepScroll) {
    if (!indContentEl) return;
    var scroll = keepScroll ? indContentEl.scrollTop : 0;
    if (!indLoaded) {
      indContentEl.innerHTML = '<p class="biz-country-empty">' + escapeHtml(t(indFailed ? 'industriesUnavailable' : 'loadingIndustries')) + '</p>';
      return;
    }
    var query = (q || '').trim().toLowerCase();
    if (query) {
      var hits = [];
      indTops.forEach(function (top) {
        (indChildren[String(top.id)] || []).forEach(function (kid) {
          if (hits.length >= 150) return;
          if (String(kid.name).toLowerCase().indexOf(query) !== -1 || indCode(kid).indexOf(query) === 0) hits.push(kid);
        });
      });
      indContentEl.innerHTML = '<div class="biz-indpick__head"><h4>' + escapeHtml(t('searchResults')) + '</h4></div>'
        + (hits.length ? '<div class="biz-indpick__grid">' + industryCards(hits) + '</div>' : '<p class="biz-country-empty">' + escapeHtml(t('noSubIndustries')) + '</p>');
      indContentEl.scrollTop = scroll;
      return;
    }
    var top = indBySlug[indActiveSection] || indTops[0];
    if (!top) { indContentEl.innerHTML = '<p class="biz-country-empty">' + escapeHtml(t('industriesUnavailable')) + '</p>'; return; }
    indActiveSection = top.slug;
    var kids = indChildren[String(top.id)] || [];
    var allOn = state.industry === top.slug && !state.subIndustry;
    indContentEl.innerHTML = '<div class="biz-indpick__head">'
      + '<h4>' + escapeHtml(top.name) + '</h4>'
      + '<button type="button" class="biz-indpick__all' + (allOn ? ' is-active' : '') + '" data-ind-section-all="' + escapeHtml(top.slug) + '">' + escapeHtml(t('wholeSection')) + '</button>'
      + '</div>'
      + (kids.length ? '<div class="biz-indpick__grid">' + industryCards(kids) + '</div>' : '<p class="biz-country-empty">' + escapeHtml(t('noSubIndustries')) + '</p>');
    indContentEl.scrollTop = scroll;
  }

  function setIndustryOpen(open) {
    if (!indBrowse || !indToggleEl) return;
    indBrowse.classList.toggle('is-collapsed', !open);
    if (indBodyEl) indBodyEl.hidden = !open;
    indToggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    indToggleEl.textContent = t(open ? 'collapse' : 'expand');
  }

  function initIndustryBrowse() {
    if (!indBrowse) return;
    indBrowse.setAttribute('data-industry-layout', 'stacked');
    if (indTitleEl) indTitleEl.textContent = t('industryCategories');
    if (indSearchEl) indSearchEl.placeholder = t('searchIndustry');
    if (indClearEl) indClearEl.textContent = t('clearIndustry');
    setIndustryOpen(true);
    updateIndustrySelection();
    renderIndustrySections();
    renderIndustryContent('');
    loadIndustryTerms().then(function () {
      indActiveSection = state.subIndustry ? (indParentSlug[state.subIndustry] || state.industry) : state.industry;
      updateIndustrySelection();
      renderIndustrySections();
      renderIndustryContent(indSearchEl ? indSearchEl.value : '');
    });
  }

  function pickIndustry(sectionSlug, termSlug) {
    state.industry = sectionSlug || '';
    state.subIndustry = termSlug || '';
    updateIndustrySelection();
    renderIndustrySections();
    renderIndustryContent(indSearchEl ? indSearchEl.value : '', true);
    applyFromControls();
  }

  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    var kw = p.get('q') || '';
    var prov = p.get('province') || '', ind = p.get('industry') || '', own = p.get('ownership') || '', ctry = p.get('country') || '';
    var subInd = p.get('subindustry') || '';
    var inactive = p.get('inactive') === '1' || p.get('includeInactive') === '1';
    var page = parseInt(p.get('page'), 10); if (isNaN(page) || page < 1) page = 1;
    if (keywordEl && kw) keywordEl.value = kw;
    if (provSel && prov) provSel.value = prov;
    state.keyword = kw.trim();
    state.province = prov;
    state.industry = ind;
    state.subIndustry = ind ? subInd : '';
    state.includeInactive = inactive || /^\d{13}$/.test(state.keyword);
    if (inactiveEl) inactiveEl.checked = state.includeInactive;
    state.country = '';
    if (ctry) { state.country = ctry; state.capital = ctry; }
    else if (own) { state.capital = own; if (capSel) capSel.value = own; }
    else { state.capital = ''; }
    state.page = page;
    updateCountryBtn();
    updateIndustrySelection();
    syncReset();
    return !!(state.keyword || state.province || state.industry || state.subIndustry || state.capital || state.includeInactive || page > 1);
  }

  ready(function () {
    populateProvinces();
    readUrl();
    // 筛选栏「含非运营」勾选文案 + hint 按当前语言就地切换
    Array.prototype.forEach.call(root.querySelectorAll('.biz-filterbar__check [data-en], [data-company-hint][data-en]'), function (el) {
      el.textContent = el.getAttribute('data-' + LANG) || el.getAttribute('data-en') || el.textContent;
    });
    if (provSel) provSel.addEventListener('change', function () { onSelectChange(provSel); });
    if (capSel) capSel.addEventListener('change', function () { onSelectChange(capSel); });
    if (formEl) formEl.addEventListener('submit', function (e) { e.preventDefault(); applyFromControls(); });
    if (keywordEl) keywordEl.addEventListener('search', function () { applyFromControls(); });
    if (inactiveEl) inactiveEl.addEventListener('change', function () { applyFromControls(); });
    if (resetEl) resetEl.addEventListener('click', function () {
      if (keywordEl) keywordEl.value = '';
      if (inactiveEl) inactiveEl.checked = false;
      [provSel, capSel].forEach(function (s) { if (s) s.value = ''; });
      if (indSearchEl) indSearchEl.value = '';
      state.industry = ''; state.subIndustry = ''; indActiveSection = '';
      updateIndustrySelection(); renderIndustrySections(); renderIndustryContent('');
      state.country = ''; updateCountryBtn();
      applyFromControls();
    });
    if (pagerEl) pagerEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      var pg = parseInt(b.getAttribute('data-page'), 10);
      if (isNaN(pg) || pg < 1) return;
      load(pg);
      if (listEl.scrollIntoView) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    if (countryBtn) {
      countryBtn.addEventListener('click', function() {
        openCountryModal();
        loadCountries(function() { renderCountryList(countrySearchEl ? countrySearchEl.value : ''); });
      });
    }
    if (countryModal) {
      countryModal.addEventListener('click', function(e) {
        if (e.target.hasAttribute('data-country-modal-close') || (e.target.closest && e.target.closest('[data-country-modal-close]'))) { closeCountryModal(); return; }
        var item = e.target.closest && e.target.closest('[data-country-slug]');
        if (item) selectCountry(item.getAttribute('data-country-slug'));
      });
    }
    if (countrySearchEl) {
      countrySearchEl.addEventListener('input', function() { renderCountryList(this.value); });
      countrySearchEl.addEventListener('search', function() { renderCountryList(this.value); });
    }

    initIndustryBrowse();
    if (indToggleEl) indToggleEl.addEventListener('click', function () {
      setIndustryOpen(indToggleEl.getAttribute('aria-expanded') !== 'true');
    });
    if (indClearEl) indClearEl.addEventListener('click', function () {
      if (indSearchEl) indSearchEl.value = '';
      indActiveSection = '';
      pickIndustry('', '');
    });
    if (indBrowse) {
      indBrowse.addEventListener('click', function (e) {
        var el = e.target;
        if (!el || !el.closest) return;
        var card = el.closest('[data-ind-term]');
        if (card) {
          var slug = card.getAttribute('data-ind-term');
          // 再点一次已选中的子类 = 取消,回到它所属大类
          if (state.subIndustry === slug) pickIndustry(indParentSlug[slug] || '', '');
          else pickIndustry(indParentSlug[slug] || '', slug);
          return;
        }
        var whole = el.closest('[data-ind-section-all]');
        if (whole) {
          var sec = whole.getAttribute('data-ind-section-all');
          pickIndustry(state.industry === sec && !state.subIndustry ? '' : sec, '');
          return;
        }
        // 左栏只切换右侧内容;「全部行业」那一项直接清空筛选
        var item = el.closest('[data-ind-section]');
        if (item) {
          var sl = item.getAttribute('data-ind-section');
          if (!sl) { indActiveSection = ''; pickIndustry('', ''); return; }
          if (indSearchEl) indSearchEl.value = '';
          setActiveSection(sl);
        }
      });
      indBrowse.addEventListener('mouseover', function (e) {
        var item = e.target.closest && e.target.closest('[data-ind-section]');
        if (!item) return;
        var sl = item.getAttribute('data-ind-section');
        if (!sl || sl === indActiveSection || (indSearchEl && indSearchEl.value.trim())) return;
        setActiveSection(sl);
      });
    }
    if (indSearchEl) {
      indSearchEl.addEventListener('input', function () { renderIndustryContent(this.value); });
      indSearchEl.addEventListener('search', function () { renderIndustryContent(this.value); });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && countryModal && !countryModal.hidden) closeCountryModal();
    });

    if (window.fetch) {
      if (state.country) loadCountries(function() { load(state.page); });
      else load(state.page);
    }
    updateCountryBtn();
  });
})();

/* ===== 会员系统:登录 / 注册 / 找回密码 / 会员中心 + 详情页 CTA 鉴权 =====
   - 共享 API 挂 window.__starterAuth(供公司详情页 CTA 调用)
   - header 登录态:guest(登录/注册)↔ account(账号菜单)
   - 按页控制器:data-auth-page=login|register|forgot|reset|account
   会员存储:WooCMS 会员 API 无收藏端点 → 收藏存 localStorage 并按用户 id 隔离。 */
(function () {
  if (!window.fetch) return;
  var SITE = '/api/site/v1';

  function text(v) { return v == null ? '' : String(v); }
  function esc(v) { return text(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(s, vars) { return text(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; }); }
  function normLoc(v) { v = text(v).trim().toLowerCase(); if (v.indexOf('zh') === 0) return 'zh'; if (v.indexOf('th') === 0) return 'th'; if (v.indexOf('en') === 0) return 'en'; return ''; }
  function cookieLang() {
    var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
    return m ? normLoc(decodeURIComponent(m[1])) : '';
  }
  function detectLang() {
    var seg = window.location.pathname.split('/').filter(Boolean)[0] || ''; var fp = normLoc(seg); if (fp) return fp;
    var hl = normLoc(document.documentElement.lang); if (hl) return hl;
    return 'en';
  }
  var LANG = detectLang();
  function L(o) { return o ? (o[LANG] || o.en) : ''; }

  var T = {
    networkErr: { en: 'Network error, please try again.', th: 'เครือข่ายมีปัญหา โปรดลองอีกครั้ง', zh: '网络异常,请重试。' },
    invalidLogin: { en: 'Incorrect email or password.', th: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', zh: '邮箱或密码不正确。' },
    fillEmailPwd: { en: 'Please enter your email and password.', th: 'โปรดกรอกอีเมลและรหัสผ่าน', zh: '请填写邮箱和密码。' },
    needEmail: { en: 'Please enter your email.', th: 'โปรดกรอกอีเมล', zh: '请填写邮箱。' },
    pwdShort: { en: 'Password must be at least 8 characters.', th: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', zh: '密码至少 8 位。' },
    pwdMismatch: { en: 'The two passwords do not match.', th: 'รหัสผ่านไม่ตรงกัน', zh: '两次输入的密码不一致。' },
    emailTaken: { en: 'This email is already registered. Try signing in.', th: 'อีเมลนี้ถูกใช้แล้ว ลองเข้าสู่ระบบ', zh: '该邮箱已注册,请尝试登录。' },
    forgotSent: { en: 'If that email is registered, we have sent a password reset link. Please check your inbox.', th: 'หากอีเมลนี้ลงทะเบียนไว้ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านแล้ว โปรดตรวจสอบกล่องจดหมาย', zh: '若该邮箱已注册,我们已发送密码重置链接,请查收邮箱。' },
    resetNoToken: { en: 'This reset link is invalid or has expired. Please request a new one.', th: 'ลิงก์รีเซ็ตไม่ถูกต้องหรือหมดอายุ โปรดขอใหม่', zh: '重置链接无效或已过期,请重新申请。' },
    resetDone: { en: 'Password updated. Redirecting to sign in…', th: 'อัปเดตรหัสผ่านแล้ว กำลังไปหน้าเข้าสู่ระบบ…', zh: '密码已更新,正在跳转登录…' },
    resetBadToken: { en: 'Could not reset password. The link may have expired.', th: 'รีเซ็ตรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ', zh: '重置失败,链接可能已过期。' },
    working: { en: 'Please wait…', th: 'โปรดรอ…', zh: '处理中…' },
    profileSaved: { en: 'Profile updated.', th: 'อัปเดตโปรไฟล์แล้ว', zh: '资料已更新。' },
    profileErr: { en: 'Could not update profile.', th: 'อัปเดตโปรไฟล์ไม่สำเร็จ', zh: '资料更新失败。' },
    pwdChanged: { en: 'Password changed.', th: 'เปลี่ยนรหัสผ่านแล้ว', zh: '密码已修改。' },
    pwdWrong: { en: 'Current password is incorrect.', th: 'รหัสผ่านปัจจุบันไม่ถูกต้อง', zh: '当前密码不正确。' },
    greeting: { en: 'Hi, {n}', th: 'สวัสดี {n}', zh: '你好,{n}' },
    statusPending: { en: 'Pending review', th: 'รอตรวจสอบ', zh: '待审核' },
    statusApproved: { en: 'Approved', th: 'อนุมัติแล้ว', zh: '已通过' },
    statusRejected: { en: 'Rejected', th: 'ถูกปฏิเสธ', zh: '已驳回' },
    rejectReasonLabel: { en: 'Reason for rejection', th: 'เหตุผลที่ถูกปฏิเสธ', zh: '驳回理由' },
    editCompany: { en: 'Edit company info', th: 'แก้ไขข้อมูล', zh: '编辑公司信息' },
    editSaved: { en: 'Changes saved', th: 'บันทึกแล้ว', zh: '已保存' },
    editErr: { en: 'Save failed, please try again.', th: 'บันทึกไม่สำเร็จ โปรดลองใหม่', zh: '保存失败,请重试。' },
    editCancel: { en: 'Cancel', th: 'ยกเลิก', zh: '取消' },
    saveChanges: { en: 'Save changes', th: 'บันทึก', zh: '保存' },
    editLoading: { en: 'Loading…', th: 'กำลังโหลด…', zh: '加载中…' },
    editNoFields: { en: 'No editable fields have been configured for this company.', th: 'ไม่มีฟิลด์ที่แก้ไขได้', zh: '该公司暂无可编辑字段,请联系管理员配置。' },
    savedCount: { en: 'Saved: {n}', th: 'บันทึก {n} รายการ', zh: '共 {n} 家' },
    remove: { en: 'Remove', th: 'นำออก', zh: '移除' },
    loadErr: { en: 'Could not load. Please refresh.', th: 'โหลดไม่สำเร็จ โปรดรีเฟรช', zh: '加载失败,请刷新。' },
    memberCenter: { en: 'Member center', th: 'ศูนย์สมาชิก', zh: '会员中心' },
    signOut: { en: 'Sign out', th: 'ออกจากระบบ', zh: '退出登录' },
    resent: { en: 'Verification email sent', th: 'ส่งอีเมลยืนยันแล้ว', zh: '验证邮件已发送' },
    sendCode: { en: 'Send code', th: 'ส่งรหัส', zh: '发送验证码' },
    sending: { en: 'Sending…', th: 'กำลังส่ง…', zh: '发送中…' },
    resendIn: { en: 'Resend in {s}s', th: 'ส่งใหม่ใน {s} วิ', zh: '{s} 秒后重发' },
    codeSent: { en: "We've sent a 6-digit code to your email. It expires in 10 minutes.", th: 'เราได้ส่งรหัส 6 หลักไปยังอีเมลของคุณ หมดอายุใน 10 นาที', zh: '已发送 6 位验证码到你的邮箱,10 分钟内有效。' },
    needEmailFirst: { en: 'Enter your email first.', th: 'กรอกอีเมลก่อน', zh: '请先填写邮箱。' },
    needCode: { en: 'Enter the 6-digit code from your email.', th: 'กรอกรหัส 6 หลักจากอีเมล', zh: '请输入邮箱收到的 6 位验证码。' },
    codeWrong: { en: 'The code is incorrect or has expired. Please get a new one.', th: 'รหัสไม่ถูกต้องหรือหมดอายุ โปรดขอรหัสใหม่', zh: '验证码错误或已过期,请重新获取。' },
    cooldownMsg: { en: 'Please wait a moment before requesting another code.', th: 'โปรดรอสักครู่ก่อนขอรหัสใหม่', zh: '发送过于频繁,请稍后再试。' },
    invalidEmailMsg: { en: 'Please enter a valid email address.', th: 'โปรดกรอกอีเมลที่ถูกต้อง', zh: '请输入有效的邮箱地址。' },
    loginUnverified: { en: "Your email isn't verified yet. We've re-sent the verification link to {e} — please check your inbox.", th: 'อีเมลของคุณยังไม่ได้รับการยืนยัน เราได้ส่งลิงก์ยืนยันไปที่ {e} อีกครั้ง โปรดตรวจสอบกล่องจดหมาย', zh: '你的邮箱还未验证。我们已重新发送验证链接到 {e},请查收邮箱。' },
    verifyOkTitle: { en: 'Email verified', th: 'ยืนยันอีเมลแล้ว', zh: '邮箱已验证' },
    verifyOkText: { en: 'Your email is verified. You can sign in now.', th: 'อีเมลของคุณได้รับการยืนยันแล้ว เข้าสู่ระบบได้เลย', zh: '你的邮箱已验证,现在可以登录。' },
    verifyFailTitle: { en: 'Verification failed', th: 'ยืนยันไม่สำเร็จ', zh: '验证失败' },
    verifyFailText: { en: 'This link is invalid or has expired. Please sign in and resend the verification email.', th: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ โปรดเข้าสู่ระบบและขอส่งอีเมลยืนยันใหม่', zh: '链接无效或已过期,请登录后重新发送验证邮件。' },
    verifyNoToken: { en: 'Missing verification token.', th: 'ไม่มีโทเค็นยืนยัน', zh: '缺少验证令牌。' }
  };

  /* ---- HTTP(封套 {success,data}/{success:false,error}) ---- */
  function parse(r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok && j && j.success !== false, data: (j && j.data) || null, error: (j && j.error) || null }; }); }
  function getJSON(path) { return fetch(SITE + path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(parse); }
  function csrf() { return getJSON('/auth/csrf').then(function (res) { return (res.data && res.data.csrf_token) || ''; }).catch(function () { return ''; }); }
  function send(method, path, body) {
    return csrf().then(function (tok) {
      var opt = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
      if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
      if (tok) opt.headers['X-CSRF-Token'] = tok;
      return fetch(SITE + path, opt).then(parse);
    });
  }

  /* ---- 登录态(缓存)---- */
  var meCache = null;
  // 无会话 cookie 时不打 /auth/me——未登录返回 401 会被浏览器打进控制台红字
  function hasSessionCookie() {
    return /(?:^|;\s*)(?:woocms_session|wc_session)=([^;]+)/.test(document.cookie);
  }
  function me(force) {
    if (meCache && !force) return meCache;
    if (!force && !hasSessionCookie()) {
      meCache = Promise.resolve(null);
      return meCache;
    }
    meCache = getJSON('/auth/me').then(function (res) {
      return res.ok && res.data && res.data.user ? res.data.user : null;
    }).catch(function () { return null; });
    return meCache;
  }
  function logout() { return send('POST', '/auth/logout', {}).then(function () { meCache = null; }); }
  function requireLogin(next) {
    var n = next || (window.location.pathname + window.location.search);
    window.location.href = '/login?next=' + encodeURIComponent(n);
  }

  /* ---- 收藏(原生服务端 API,账号级跨设备;type=entry,id=entry 数字 id)---- */
  function favList(limit, offset) { return getJSON('/favorites?type=entry&limit=' + (limit || 50) + '&offset=' + (offset || 0)); }
  function favCheck(id) { return getJSON('/favorites/entry/' + encodeURIComponent(id)); }
  function favAdd(id) { return send('POST', '/favorites', { type: 'entry', id: id }); }
  function favRemove(id) { return send('DELETE', '/favorites/entry/' + encodeURIComponent(id)); }

  /* ---- 用户名自动生成(邮箱本地名 + 随机后缀,满足 ^[a-z0-9]+$)---- */
  function genUsername(email) {
    var base = text(email).split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (base.length < 3) base = 'user' + base;
    return base.slice(0, 16) + Date.now().toString(36).slice(-5) + Math.floor(10 + Math.random() * 89);
  }

  /* ---- 公开 API ---- */
  window.__starterAuth = {
    me: me, getJSON: getJSON, post: function (p, b) { return send('POST', p, b); }, put: function (p, b) { return send('PUT', p, b); }, del: function (p) { return send('DELETE', p); },
    logout: logout, requireLogin: requireLogin, favList: favList, favCheck: favCheck, favAdd: favAdd, favRemove: favRemove, lang: LANG, L: L
  };

  /* ---- 鉴权卡提示 ---- */
  function showAlert(box, type, msg) { if (!box) return; box.className = 'auth-alert is-' + type; box.textContent = msg; box.hidden = false; }
  function hideAlert(box) { if (box) box.hidden = true; }
  function busy(btn, on, original) { if (!btn) return original; if (on) { btn.dataset.orig = btn.textContent; btn.disabled = true; btn.textContent = L(T.working); } else { btn.disabled = false; if (btn.dataset.orig) btn.textContent = btn.dataset.orig; } }

  /* ---- 公司名(三语)---- */
  function entName(ent) {
    var m = (ent && ent.meta) || {}, i = m.i18n || {};
    var en = (i.en && i.en.name) || m.jpnamee || '', th = (i.th && i.th.name) || m.jpname || (ent && ent.title) || '', zh = (i.zh && i.zh.name) || '';
    if (LANG === 'th') return th || en || zh; if (LANG === 'zh') return en || th || zh; return en || th || zh;
  }
  function entEnName(ent) { var m = (ent && ent.meta) || {}, i = m.i18n || {}; return (i.en && i.en.name) || m.jpnamee || ''; }
  function companyHref(jp, enName) { return (window.__starterCompanyHref && window.__starterCompanyHref(jp, enName)) || ('/' + encodeURIComponent(jp) + '.html'); }

  /* ============ header 登录态 ============ */
  function initHeader() {
    me().then(function (user) {
      var guest = document.querySelector('[data-auth-guest]');
      var acct = document.querySelector('[data-auth-account]');
      if (user && acct) {
        if (guest) guest.hidden = true;
        acct.hidden = false;
        var nameEl = acct.querySelector('[data-account-name]'); if (nameEl) nameEl.textContent = user.display_name || user.username || (user.email || '').split('@')[0];
        var avEl = acct.querySelector('[data-account-avatar]'); if (avEl) avEl.textContent = (text(user.display_name || user.username || user.email).trim()[0] || 'U').toUpperCase();
        wireAccountMenu(acct);
        var lo = acct.querySelector('[data-account-logout]'); if (lo) lo.addEventListener('click', function () { logout().then(function () { window.location.href = '/'; }); });
      } else {
        if (guest) guest.hidden = false;
        if (acct) acct.hidden = true;
      }
    });
  }
  function wireAccountMenu(acct) {
    var btn = acct.querySelector('[data-account-toggle]'), menu = acct.querySelector('[data-account-menu]');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) { e.stopPropagation(); var open = acct.classList.toggle('is-open'); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    document.addEventListener('click', function (e) { if (!acct.contains(e.target)) { acct.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); } });
  }

  /* ============ 组合页(登录/注册 Tab 切换,独立无页头页脚)============ */
  function initAuthCombined(rootEl) {
    var loginPane = rootEl.querySelector('[data-auth-pane="login"]');
    var regPane = rootEl.querySelector('[data-auth-pane="register"]');
    if (loginPane) initLogin(loginPane);
    if (regPane) initRegister(regPane);
    var tabs = Array.prototype.slice.call(rootEl.querySelectorAll('[data-auth-switch]'));
    var panes = Array.prototype.slice.call(rootEl.querySelectorAll('[data-auth-pane]'));
    function activate(key) {
      tabs.forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-auth-switch') === key); });
      panes.forEach(function (p) { p.hidden = p.getAttribute('data-auth-pane') !== key; });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t.getAttribute('data-auth-switch')); }); });
    var claim = new URLSearchParams(window.location.search).get('claim');
    activate(claim ? 'register' : (rootEl.getAttribute('data-auth-default') || 'login'));
  }

  /* ============ login(成功后校验邮箱已验证,未验证则拦下并重发)============ */
  function initLogin(rootEl) {
    var form = rootEl.querySelector('[data-auth-form]'), box = rootEl.querySelector('[data-auth-alert]'), btn = rootEl.querySelector('[data-auth-submit]');
    if (!form) return;
    me().then(function (u) { if (u && u.email_verified !== false) { window.location.href = nextUrl('/account'); } });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box);
      var email = form.email.value.trim(), pwd = form.password.value;
      if (!email || !pwd) { showAlert(box, 'error', L(T.fillEmailPwd)); return; }
      busy(btn, true);
      send('POST', '/auth/login', { login: email, password: pwd }).then(function (res) {
        if (res.ok) {
          meCache = null;
          me(true).then(function (u) {
            if (u && u.email_verified === false) { blockUnverified(box, btn, u.email || email); return; }
            window.location.href = nextUrl('/account');
          });
          return;
        }
        var blob = JSON.stringify(res.error || '');
        if (/verif/i.test(blob)) { blockUnverified(box, btn, email); return; }
        showAlert(box, 'error', L(T.invalidLogin)); busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }
  function blockUnverified(box, btn, email) {
    send('POST', '/auth/resend-verification', { email: email }).catch(function () {});
    logout().catch(function () {});
    showAlert(box, 'error', fmt(L(T.loginUnverified), { e: email }));
    busy(btn, false);
  }
  function nextUrl(fallback) { var n = new URLSearchParams(window.location.search).get('next'); return (n && n.charAt(0) === '/') ? n : fallback; }

  /* ============ register(邮箱验证码注册:发码→输码→注册即自动验证+自动登录)============ */
  function initRegister(rootEl) {
    var form = rootEl.querySelector('[data-auth-form]'), box = rootEl.querySelector('[data-auth-alert]'), btn = rootEl.querySelector('[data-auth-submit]');
    var note = rootEl.querySelector('[data-auth-claim-note]');
    var claim = new URLSearchParams(window.location.search).get('claim') || '';
    if (claim && note) note.hidden = false;
    if (!form) return;

    // 发送验证码按钮 + 60s 冷却
    var sendBtn = rootEl.querySelector('[data-send-code]'), cdTimer = null;
    function cooldown(secs) {
      if (!sendBtn) return;
      var n = secs; sendBtn.disabled = true; sendBtn.textContent = fmt(L(T.resendIn), { s: n });
      if (cdTimer) clearInterval(cdTimer);
      cdTimer = setInterval(function () {
        n -= 1;
        if (n <= 0) { clearInterval(cdTimer); cdTimer = null; sendBtn.disabled = false; sendBtn.textContent = L(T.sendCode); }
        else sendBtn.textContent = fmt(L(T.resendIn), { s: n });
      }, 1000);
    }
    if (sendBtn) sendBtn.addEventListener('click', function () {
      var email = form.email.value.trim();
      if (!email) { showAlert(box, 'error', L(T.needEmailFirst)); form.email.focus(); return; }
      hideAlert(box); sendBtn.disabled = true; sendBtn.textContent = L(T.sending);
      send('POST', '/auth/send-code', { email: email }).then(function (res) {
        if (res.ok) { showAlert(box, 'success', L(T.codeSent)); if (form.code) form.code.focus(); cooldown(60); return; }
        var c = (res.error && res.error.code) || '';
        showAlert(box, 'error', c === 'email_taken' ? L(T.emailTaken) : c === 'code_cooldown' ? L(T.cooldownMsg) : c === 'invalid_email' ? L(T.invalidEmailMsg) : ((res.error && res.error.message) || L(T.networkErr)));
        if (c === 'code_cooldown') cooldown(60); else { sendBtn.disabled = false; sendBtn.textContent = L(T.sendCode); }
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); sendBtn.disabled = false; sendBtn.textContent = L(T.sendCode); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box);
      var email = form.email.value.trim(), code = form.code ? form.code.value.trim() : '', pwd = form.password.value;
      if (!email) { showAlert(box, 'error', L(T.needEmail)); return; }
      if (!code) { showAlert(box, 'error', L(T.needCode)); return; }
      if (pwd.length < 8) { showAlert(box, 'error', L(T.pwdShort)); return; }
      busy(btn, true);
      send('POST', '/auth/register', { username: genUsername(email), email: email, password: pwd, code: code, display_name: text(email).split('@')[0], phone: '' }).then(function (res) {
        if (res.ok) { meCache = null; afterRegister(claim); return; }
        var blob = JSON.stringify(res.error || ''), ec = (res.error && res.error.code) || '';
        var msg = (/code|验证码/i.test(ec) || /验证码/.test(blob)) ? L(T.codeWrong) : /email|exist|taken/i.test(blob) ? L(T.emailTaken) : ((res.error && res.error.message) || L(T.networkErr));
        showAlert(box, 'error', msg); busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }
  function afterRegister(claim) {
    // 带码注册已「自动验证 + 自动登录」。带 ?claim → 跳回该公司详情页并自动弹出认领表单(填资料 + 必填理由)
    if (claim) { window.location.href = '/' + encodeURIComponent(claim) + '.html?claimopen=1'; return; }
    window.location.href = '/account';
  }

  /* ============ verify-email(邮件链接落地:读 ?token= 调验证接口)============ */
  function initVerify(rootEl) {
    var box = rootEl.querySelector('[data-auth-alert]');
    var icon = rootEl.querySelector('[data-verify-icon]'), title = rootEl.querySelector('[data-verify-title]'), text2 = rootEl.querySelector('[data-verify-text]'), loginBtn = rootEl.querySelector('[data-verify-login]');
    function done(ok, msg) {
      if (icon) icon.textContent = ok ? '✅' : '⚠️';
      if (title) title.textContent = ok ? L(T.verifyOkTitle) : L(T.verifyFailTitle);
      if (text2) text2.textContent = msg;
      if (loginBtn) loginBtn.hidden = false;
    }
    var token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) { done(false, L(T.verifyNoToken)); return; }
    send('POST', '/auth/verify-email', { token: token }).then(function (res) {
      done(!!res.ok, res.ok ? L(T.verifyOkText) : L(T.verifyFailText));
    }).catch(function () { done(false, L(T.networkErr)); });
  }

  /* ============ forgot ============ */
  function initForgot(rootEl) {
    var form = rootEl.querySelector('[data-auth-form]'), box = rootEl.querySelector('[data-auth-alert]'), btn = rootEl.querySelector('[data-auth-submit]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box);
      var email = form.email.value.trim();
      if (!email) { showAlert(box, 'error', L(T.needEmail)); return; }
      busy(btn, true);
      send('POST', '/auth/forgot-password', { email: email }).then(function () {
        showAlert(box, 'success', L(T.forgotSent)); form.reset(); busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }

  /* ============ reset ============ */
  function initReset(rootEl) {
    var form = rootEl.querySelector('[data-auth-form]'), box = rootEl.querySelector('[data-auth-alert]'), btn = rootEl.querySelector('[data-auth-submit]');
    if (!form) return;
    var token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) { showAlert(box, 'error', L(T.resetNoToken)); if (btn) btn.disabled = true; return; }
    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box);
      var pwd = form.password.value, conf = form.password_confirm.value;
      if (pwd.length < 8) { showAlert(box, 'error', L(T.pwdShort)); return; }
      if (pwd !== conf) { showAlert(box, 'error', L(T.pwdMismatch)); return; }
      busy(btn, true);
      send('POST', '/auth/reset-password', { token: token, new_password: pwd }).then(function (res) {
        if (res.ok) { showAlert(box, 'success', L(T.resetDone)); setTimeout(function () { window.location.href = '/login'; }, 1400); return; }
        showAlert(box, 'error', L(T.resetBadToken)); busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }

  /* ============ account(会员中心)============ */
  function initAccount(rootEl) {
    me(true).then(function (user) {
      if (!user) { requireLogin('/account'); return; }
      var loading = rootEl.querySelector('[data-account-loading]'); if (loading) loading.hidden = true;
      var body = rootEl.querySelector('[data-account-body]'); if (body) body.hidden = false;
      var nm = user.display_name || user.username || (user.email || '').split('@')[0];
      var greet = rootEl.querySelector('[data-account-greeting]'); if (greet) greet.textContent = fmt(L(T.greeting), { n: nm });
      // 身份卡查询限定在 .account-nav 内:data-account-name/avatar 在 header 账号菜单也存在,rootEl 全局查会抢到 DOM 在前的 header 那个
      var navEl = rootEl.querySelector('.account-nav');
      var emailEl = navEl && navEl.querySelector('[data-account-email]'); if (emailEl) emailEl.textContent = user.email || '';
      var nameEl = navEl && navEl.querySelector('[data-account-name]'); if (nameEl) nameEl.textContent = nm;
      var avEl = navEl && navEl.querySelector('[data-account-avatar]'); if (avEl) avEl.textContent = (text(nm).trim()[0] || 'U').toUpperCase();
      wireTabs(rootEl);
      renderSaved(rootEl, user);
      renderClaims(rootEl);
      fillProfile(rootEl, user);
      wireProfileForm(rootEl);
      wirePasswordForm(rootEl);
      Array.prototype.forEach.call(rootEl.querySelectorAll('[data-account-logout]'), function (b) { b.addEventListener('click', function () { logout().then(function () { window.location.href = '/'; }); }); });
    });
  }
  function wireTabs(rootEl) {
    var tabs = Array.prototype.slice.call(rootEl.querySelectorAll('[data-account-tab]'));
    var panels = Array.prototype.slice.call(rootEl.querySelectorAll('[data-account-panel]'));
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-account-tab');
        tabs.forEach(function (t2) { t2.classList.toggle('is-active', t2 === tab); });
        panels.forEach(function (p) { p.hidden = p.getAttribute('data-account-panel') !== key; });
      });
    });
  }
  function renderSaved(rootEl, user) {
    var status = rootEl.querySelector('[data-account-saved-status]'), list = rootEl.querySelector('[data-account-saved-list]'),
      empty = rootEl.querySelector('[data-account-saved-empty]'), countEl = rootEl.querySelector('[data-account-saved-count]');
    var a = window.__starterAuth;
    a.favList(100, 0).then(function (res) {
      if (!res.ok) { if (status) status.textContent = L(T.loadErr); return; }
      var items = (res.data && res.data.items) || [];
      var total = (res.data && res.data.total != null) ? res.data.total : items.length;
      if (countEl) countEl.textContent = fmt(L(T.savedCount), { n: total });
      if (!items.length) { if (status) status.hidden = true; if (empty) empty.hidden = false; return; }
      Promise.all(items.map(function (it) { return getJSON('/models/thaicompany/entries/' + encodeURIComponent(it.slug)).then(function (r) { return { it: it, ent: r.data }; }).catch(function () { return { it: it, ent: null }; }); })).then(function (rows) {
        if (status) status.hidden = true; if (list) { list.hidden = false; list.innerHTML = rows.map(function (r) { return savedCard(r.it, r.ent); }).join(''); }
        if (list) list.addEventListener('click', function (e) {
          var b = e.target.closest('[data-fav-remove]'); if (!b) return; e.preventDefault();
          var id = b.getAttribute('data-fav-remove');
          a.favRemove(id).then(function () {
            var card = b.closest('[data-saved-card]'); if (card) card.parentNode.removeChild(card);
            var n = list.querySelectorAll('[data-saved-card]').length;
            if (countEl) countEl.textContent = fmt(L(T.savedCount), { n: n });
            if (!n) { if (list) list.hidden = true; if (empty) empty.hidden = false; }
          });
        });
      });
    }).catch(function () { if (status) status.textContent = L(T.loadErr); });
  }
  function savedCard(it, ent) {
    var name = ent ? entName(ent) : (it.title || it.slug);
    return '<div class="biz-entcard account-savedcard" data-saved-card>' +
      '<a class="biz-entcard__name" href="' + esc(companyHref(it.slug, entEnName(ent))) + '">' + esc(name) + '</a>' +
      '<span class="biz-entcard__sub">' + esc(it.slug) + '</span>' +
      '<button type="button" class="account-card__remove" data-fav-remove="' + esc(it.entity_id) + '">' + esc(L(T.remove)) + '</button>' +
      '</div>';
  }
  var CLAIM_FIELD_LABELS = {
    objective_zh: { en: '公司介绍 [中文]', th: 'แนะนำบริษัท [中文]', zh: '公司介绍 [中文]' },
    objective_en: { en: 'Company Introduction [English]', th: 'แนะนำบริษัท [English]', zh: '公司介绍 [English]' },
    objective_th: { en: 'แนะนำบริษัท [ภาษาไทย]', th: 'แนะนำบริษัท [ภาษาไทย]', zh: 'แนะนำบริษัท [ภาษาไทย]' },
    phoneno: { en: 'Phone', th: 'โทรศัพท์', zh: '联系电话' },
    email: { en: 'Email', th: 'อีเมล', zh: '联系邮箱' },
    website1: { en: 'Website', th: 'เว็บไซต์', zh: '官网' },
    logourl: { en: 'Company logo (square, transparent PNG recommended)', th: 'โลโก้บริษัท (สี่เหลี่ยมจัตุรัส)', zh: '公司 Logo（方形，建议透明 PNG）' },
    herourl: { en: 'Header image (16:9 business photo)', th: 'ภาพหัวเรื่อง (16:9)', zh: '页头商务图（16:9 横图）' },
    directorsPublic: { en: 'Shareholder/director info visibility', th: 'การมองเห็นข้อมูลผู้ถือหุ้น/กรรมการ', zh: '股东/董事信息可见范围' }
  };
  // 三态字段的说明文案,放在 label 下面
  var CLAIM_FIELD_HINTS = {
    directorsPublic: { en: 'Default: full names shown, signed-in members only. Public: full names shown to anyone, including search engines. Masked: names shown partially masked (e.g. "j*****o") to everyone, including signed-in members.', th: 'ค่าเริ่มต้น: แสดงชื่อเต็มเฉพาะสมาชิกที่เข้าสู่ระบบ สาธารณะ: แสดงชื่อเต็มแก่ทุกคน รวมถึงเครื่องมือค้นหา ปิดบังบางส่วน: แสดงชื่อแบบปิดบังบางส่วน (เช่น "j*****o") แก่ทุกคน รวมถึงสมาชิกที่เข้าสู่ระบบ', zh: '默认：仅登录会员可见完整姓名。公开：任何人（含搜索引擎）都能看到完整姓名。部分打码：任何人（含登录会员）看到的都是打码后的姓名（如"j*****o"）。' }
  };
  // 三态字段(值是 'public'/'hidden'/未设置的字符串,不是布尔——原因见 renderDirectors() 里
  // directorsPublic 变量的注释),渲染成 <select> 而不是 checkbox,避免"没碰过这个字段"和
  // "明确选择默认值"这两种状态在提交时被搞混。目前只有 directorsPublic 一个,先按具体字段名
  // 判断,不猜测命名规律(owner_editable_fields 本身不带类型信息,见 db.js 相关注释)。
  // 2026-07-12 改:'hidden' 选项的语义从"完全不可见"改成"打码后对所有人可见"(接口层已经把姓名
  // 换成打码后的值,不是整段不返回),选项文案跟着改。
  var CLAIM_FIELD_TRISTATE_OPTIONS = {
    directorsPublic: [
      { value: '', label: { en: 'Default (full name, signed-in members only)', th: 'ค่าเริ่มต้น (ชื่อเต็ม เฉพาะสมาชิกที่เข้าสู่ระบบ)', zh: '默认（完整姓名，仅登录会员可见）' } },
      { value: 'public', label: { en: 'Public (full name, anyone including search engines)', th: 'สาธารณะ (ชื่อเต็ม ทุกคน รวมถึงเครื่องมือค้นหา)', zh: '公开（完整姓名，任何人，含搜索引擎）' } },
      { value: 'hidden', label: { en: 'Masked (partial name, e.g. "j*****o", visible to everyone)', th: 'ปิดบังบางส่วน (ชื่อบางส่วน เช่น "j*****o" ทุกคนเห็นได้)', zh: '部分打码（如"j*****o"，任何人都能看到）' } }
    ]
  };
  function claimFieldIsImage(name) { return name === 'logourl' || name === 'herourl'; }
  function claimFieldTristateOptions(name) { return CLAIM_FIELD_TRISTATE_OPTIONS[name] || null; }
  function claimFieldLabel(name) {
    var m = CLAIM_FIELD_LABELS[name];
    if (m) return m[LANG] || m.en;
    return name.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function claimFieldHint(name) {
    var m = CLAIM_FIELD_HINTS[name];
    return m ? (m[LANG] || m.en) : '';
  }
  function claimFieldIsLong(name) {
    return /objective|desc|intro|about|biography|note|text|content/i.test(name);
  }
  function buildClaimEditForm(entryId, fields, values) {
    if (!fields.length) {
      return '<div class="account-claim-edit"><p class="account-claim-edit__nofields">' + esc(L(T.editNoFields)) + '</p></div>';
    }
    var inputs = fields.map(function (f) {
      var label = esc(claimFieldLabel(f));
      var raw = String(values[f] != null ? values[f] : '');
      var val = esc(raw);
      var inputHtml;
      var tristate = claimFieldTristateOptions(f);
      if (tristate) {
        inputHtml = '<select class="account-claim-edit__input" name="' + esc(f) + '">' +
          tristate.map(function (opt) {
            var optLabel = esc(opt.label[LANG] || opt.label.en);
            return '<option value="' + esc(opt.value) + '"' + (raw === opt.value ? ' selected' : '') + '>' + optLabel + '</option>';
          }).join('') + '</select>';
        var hint = claimFieldHint(f);
        if (hint) inputHtml += '<p class="account-claim-edit__hint">' + esc(hint) + '</p>';
      } else if (claimFieldIsImage(f)) {
        var kind = f === 'logourl' ? 'logo' : 'hero';
        inputHtml = '<div class="account-claim-img" data-img-field="' + kind + '">'
          + '<input type="hidden" name="' + esc(f) + '" value="' + val + '" data-img-url>'
          + '<div class="account-claim-img__preview' + (raw ? '' : ' is-empty') + '" data-img-preview><img src="' + val + '" alt="" data-img-prev></div>'
          + '<label class="account-claim-img__btn"><input type="file" accept="image/png,image/jpeg,image/webp" hidden data-img-file>'
          + esc(LANG === 'zh' ? '选择图片上传' : LANG === 'th' ? 'เลือกรูปเพื่ออัปโหลด' : 'Choose image') + '</label>'
          + '<span class="account-claim-img__status" data-img-status></span>'
          + '</div>';
      } else {
        inputHtml = claimFieldIsLong(f)
          ? '<textarea class="account-claim-edit__textarea" name="' + esc(f) + '" rows="4">' + val + '</textarea>'
          : '<input class="account-claim-edit__input" type="text" name="' + esc(f) + '" value="' + val + '">';
      }
      return '<div class="account-claim-edit__field"><label class="account-claim-edit__label">' + label + '</label>' + inputHtml + '</div>';
    }).join('');
    return '<div class="account-claim-edit">' +
      '<div class="auth-alert account-claim-edit__alert" data-claim-edit-alert hidden></div>' +
      '<form data-claim-edit-form="' + esc(String(entryId)) + '" novalidate>' +
        inputs +
        '<div class="account-claim-edit__actions">' +
          '<button type="submit" class="account-claim-edit__save" data-claim-edit-save>' + esc(L(T.saveChanges)) + '</button>' +
          '<button type="button" class="account-claim-edit__cancel" data-claim-edit-cancel>' + esc(L(T.editCancel)) + '</button>' +
        '</div>' +
      '</form>' +
      '</div>';
  }
  function openClaimEdit(panel, entryId) {
    if (panel.dataset.loaded === '1') { panel.hidden = false; return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="account-claim-edit"><p class="account-claim-edit__nofields">' + esc(L(T.editLoading)) + '</p></div>';
    getJSON('/my-entries/' + encodeURIComponent(entryId)).then(function (res) {
      if (!res || !res.ok) {
        panel.innerHTML = '<div class="account-claim-edit"><p class="account-claim-edit__nofields">' + esc(L(T.loadErr)) + '</p></div>';
        return;
      }
      var data = res.data || {};
      var fields = data.editable_fields || [];
      var liveVals = data.editable_values || {};
      var pendingVals = (data.pending_revision || {}).proposed_meta || {};
      var values = Object.assign({}, liveVals, pendingVals);
      panel.innerHTML = buildClaimEditForm(entryId, fields, values);
      panel.dataset.loaded = '1';
      var form = panel.querySelector('[data-claim-edit-form]');
      var cancelBtn = panel.querySelector('[data-claim-edit-cancel]');
      var alertBox = panel.querySelector('[data-claim-edit-alert]');
      // 图片上传字段:选图→读 base64→POST 上传端点(校验认领归属)→回填隐藏 URL + 预览;随后点保存写入 entry
      Array.prototype.forEach.call(panel.querySelectorAll('[data-img-field]'), function (box) {
        var kind = box.getAttribute('data-img-field');
        var fileInput = box.querySelector('[data-img-file]');
        var urlInput = box.querySelector('[data-img-url]');
        var preview = box.querySelector('[data-img-preview]');
        var prevImg = box.querySelector('[data-img-prev]');
        var statusEl = box.querySelector('[data-img-status]');
        if (!fileInput) return;
        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          if (file.size > 8 * 1024 * 1024) { statusEl.textContent = (LANG === 'zh' ? '图片过大(需≤8MB)' : 'Image too large (≤8MB)'); return; }
          statusEl.textContent = (LANG === 'zh' ? '上传中…' : LANG === 'th' ? 'กำลังอัปโหลด…' : 'Uploading…');
          var reader = new FileReader();
          reader.onload = function () {
            fetch(window.location.origin + '/api/site/v1/ai/company-image', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ entryId: entryId, kind: kind, data: reader.result })
            }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); }).then(function (j) {
              if (!j || !j.url) throw new Error('no url');
              urlInput.value = j.url;
              if (prevImg) prevImg.src = j.url + '?t=' + Date.now();
              if (preview) preview.classList.remove('is-empty');
              statusEl.textContent = (LANG === 'zh' ? '已上传 ✓ 记得点保存' : LANG === 'th' ? 'อัปโหลดแล้ว ✓ อย่าลืมบันทึก' : 'Uploaded ✓ — remember to save');
            }).catch(function () {
              statusEl.textContent = (LANG === 'zh' ? '上传失败,请重试' : LANG === 'th' ? 'อัปโหลดไม่สำเร็จ' : 'Upload failed');
            });
          };
          reader.readAsDataURL(file);
        });
      });
      if (cancelBtn) cancelBtn.addEventListener('click', function () { panel.hidden = true; panel.dataset.loaded = ''; });
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var saveBtn = form.querySelector('[data-claim-edit-save]');
          if (alertBox) { alertBox.hidden = true; }
          if (saveBtn) { saveBtn.disabled = true; saveBtn.dataset.orig = saveBtn.textContent; saveBtn.textContent = L(T.working); }
          var vals = {};
          Array.prototype.forEach.call(form.elements, function (el) { if (el.name && el.name !== '') vals[el.name] = el.value; });
          send('PUT', '/my-entries/' + encodeURIComponent(entryId), { values: vals }).then(function (res2) {
            if (res2 && res2.ok) {
              if (alertBox) { alertBox.className = 'auth-alert is-success account-claim-edit__alert'; alertBox.textContent = L(T.editSaved); alertBox.hidden = false; }
              panel.dataset.loaded = '';
            } else {
              if (alertBox) { alertBox.className = 'auth-alert is-error account-claim-edit__alert'; alertBox.textContent = (res2 && res2.error && res2.error.message) || L(T.editErr); alertBox.hidden = false; }
            }
            if (saveBtn) { saveBtn.disabled = false; if (saveBtn.dataset.orig) saveBtn.textContent = saveBtn.dataset.orig; }
          }).catch(function () {
            if (alertBox) { alertBox.className = 'auth-alert is-error account-claim-edit__alert'; alertBox.textContent = L(T.editErr); alertBox.hidden = false; }
            if (saveBtn) { saveBtn.disabled = false; if (saveBtn.dataset.orig) saveBtn.textContent = saveBtn.dataset.orig; }
          });
        });
      }
    }).catch(function () {
      panel.innerHTML = '<div class="account-claim-edit"><p class="account-claim-edit__nofields">' + esc(L(T.loadErr)) + '</p></div>';
    });
  }
  function renderClaims(rootEl) {
    var status = rootEl.querySelector('[data-account-claims-status]'), list = rootEl.querySelector('[data-account-claims-list]'), empty = rootEl.querySelector('[data-account-claims-empty]');
    getJSON('/claims/mine').then(function (res) {
      if (!res.ok) { if (status) status.textContent = L(T.loadErr); return; }
      var items = (res.data && res.data.items) || [];
      if (!items.length) { if (status) status.hidden = true; if (empty) empty.hidden = false; return; }
      if (status) status.hidden = true;
      if (list) {
        list.hidden = false;
        list.innerHTML = items.map(claimRow).join('');
        list.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-claim-edit]');
          if (!btn) return;
          var entryId = btn.getAttribute('data-claim-edit');
          var panel = list.querySelector('[data-claim-editpanel="' + entryId + '"]');
          if (!panel) return;
          if (!panel.hidden && panel.dataset.loaded === '1') { panel.hidden = true; return; }
          openClaimEdit(panel, entryId);
        });
      }
    }).catch(function () { if (status) status.textContent = L(T.loadErr); });
  }
  function claimRow(it) {
    var map = { approved: { k: 'statusApproved', c: 'is-ok' }, rejected: { k: 'statusRejected', c: 'is-bad' } };
    var st = map[it.status] || { k: 'statusPending', c: 'is-pending' };
    var jp = it.entry_slug || '';
    var reason = '';
    if (it.status === 'rejected' && it.reject_reason) {
      reason = '<div class="account-claim-reason"><span class="account-claim-reason__label">' + esc(L(T.rejectReasonLabel)) + '</span>' +
        '<p class="account-claim-reason__text">' + esc(it.reject_reason) + '</p></div>';
    }
    var editBtn = (it.status === 'approved' && it.entry_id)
      ? '<button type="button" class="account-claimrow__edit-btn" data-claim-edit="' + esc(String(it.entry_id)) + '">' + esc(L(T.editCompany)) + '</button>'
      : '';
    var editPanel = (it.status === 'approved' && it.entry_id)
      ? '<div class="account-claim-editpanel" data-claim-editpanel="' + esc(String(it.entry_id)) + '" hidden></div>'
      : '';
    return '<div class="account-claimrow">' +
      '<div class="account-claimrow__top">' +
        '<div class="account-claimrow__main"><a class="account-claimrow__name" href="' + esc(jp ? ('/' + encodeURIComponent(jp) + '.html') : '#') + '">' + esc(it.entry_title || jp) + '</a><span class="account-claimrow__sub">' + esc(jp) + '</span></div>' +
        '<div class="account-claimrow__actions">' + editBtn + '<span class="account-claim-badge ' + st.c + '">' + esc(L(T[st.k])) + '</span></div>' +
      '</div>' + reason + editPanel +
      '</div>';
  }
  function fillProfile(rootEl, user) {
    var form = rootEl.querySelector('[data-account-profile-form]'); if (!form) return;
    if (form.display_name) form.display_name.value = user.display_name || '';
    if (form.email) form.email.value = user.email || '';
    if (form.phone) form.phone.value = user.phone || '';
  }
  function wireProfileForm(rootEl) {
    var form = rootEl.querySelector('[data-account-profile-form]'), box = rootEl.querySelector('[data-account-profile-alert]'), btn = form && form.querySelector('[data-auth-submit]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box); busy(btn, true);
      send('PUT', '/auth/me', { display_name: form.display_name.value.trim(), phone: form.phone.value.trim() }).then(function (res) {
        if (res.ok) { meCache = null; showAlert(box, 'success', L(T.profileSaved)); } else showAlert(box, 'error', (res.error && res.error.message) || L(T.profileErr));
        busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }
  function wirePasswordForm(rootEl) {
    var form = rootEl.querySelector('[data-account-password-form]'), box = rootEl.querySelector('[data-account-password-alert]'), btn = form && form.querySelector('[data-auth-submit]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault(); hideAlert(box);
      var oldp = form.old_password.value, newp = form.new_password.value;
      if (newp.length < 8) { showAlert(box, 'error', L(T.pwdShort)); return; }
      busy(btn, true);
      send('POST', '/auth/change-password', { old_password: oldp, new_password: newp }).then(function (res) {
        if (res.ok) { showAlert(box, 'success', L(T.pwdChanged)); form.reset(); }
        else showAlert(box, 'error', /old|current|incorrect|invalid/i.test(JSON.stringify(res.error || '')) ? L(T.pwdWrong) : ((res.error && res.error.message) || L(T.networkErr)));
        busy(btn, false);
      }).catch(function () { showAlert(box, 'error', L(T.networkErr)); busy(btn, false); });
    });
  }

  /* ============ 启动 ============ */
  function boot() {
    initHeader();
    var pageRoot = document.querySelector('[data-auth-page]');
    if (!pageRoot) return;
    var kind = pageRoot.getAttribute('data-auth-page');
    if (kind === 'auth') initAuthCombined(pageRoot);
    else if (kind === 'login') initLogin(pageRoot);
    else if (kind === 'register') initRegister(pageRoot);
    else if (kind === 'verify') initVerify(pageRoot);
    else if (kind === 'forgot') initForgot(pageRoot);
    else if (kind === 'reset') initReset(pageRoot);
    else if (kind === 'account') initAccount(pageRoot);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
