(function () {
    var root = document.querySelector("[data-ai-search]");
    if (!root) return;
    var params = new URLSearchParams(window.location.search);
    var q = (params.get("q") || "").trim();
    var type = (params.get("type") || "companies").toLowerCase();
    var PER = 20;

    function normLoc(v) { v = String(v || "").trim().toLowerCase(); if (v.indexOf("zh") === 0) return "zh"; if (v.indexOf("th") === 0) return "th"; if (v.indexOf("en") === 0) return "en"; return ""; }
    function cookieLang() {
      var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
      return m ? normLoc(decodeURIComponent(m[1])) : "";
    }
    function detectLang() {
      var seg = window.location.pathname.split("/").filter(Boolean)[0] || ""; var fp = normLoc(seg); if (fp) return fp;
      var fc = cookieLang(); if (fc) return fc;
      var hl = normLoc(document.documentElement.lang); if (hl) return hl;
      var fq = normLoc(params.get("lang")); if (fq) return fq; return "en";
    }
    var LANG = detectLang();
    var T = {
      en: { kicker: "Smart search", hero: "Find the right Thai company", sub: "Search Thai companies by name, industry or province using official registry data.", ph: "e.g. company name, industry or province", btn: "Search", searching: "Finding companies…", results: "Matching companies", title: "Search results for “{q}”", none: "No matching companies found. Try a different keyword — an industry, a province or a company type. Tip: enable “Include dissolved / inactive” if you are looking up a closed company.", note: "{n} operating companies found", noteAll: "{n} companies found (including inactive)", inactive: "Include dissolved / inactive companies", prev: "Prev", next: "Next" },
      zh: { kicker: "智能搜索", hero: "找到对的泰国公司", sub: "按公司名称、行业或省份搜索官方登记数据。", ph: "例如:公司名称、行业或省份", btn: "搜索", searching: "正在匹配公司…", results: "匹配的公司", title: "“{q}” 的搜索结果", none: "未找到匹配的公司。换个关键词试试 —— 一个行业、一个府或一种公司类型。若在查已解散公司，请勾选「包含已解散 / 非运营」。", note: "共找到 {n} 家运营中公司", noteAll: "共找到 {n} 家公司（含非运营）", inactive: "包含已解散 / 非运营公司", prev: "上一页", next: "下一页" },
      th: { kicker: "ค้นหาอัจฉริยะ", hero: "ค้นหาบริษัทไทยที่ใช่", sub: "ค้นหาบริษัทไทยจากชื่อ อุตสาหกรรม หรือจังหวัด โดยใช้ข้อมูลทะเบียนทางการ", ph: "เช่น ชื่อบริษัท อุตสาหกรรม หรือจังหวัด", btn: "ค้นหา", searching: "กำลังค้นหาบริษัท…", results: "บริษัทที่ตรงกัน", title: "ผลการค้นหา “{q}”", none: "ไม่พบบริษัทที่ตรงกัน ลองคำอื่น — อุตสาหกรรม จังหวัด หรือประเภทบริษัท หากค้นหาบริษัทที่เลิกกิจการ ให้เปิด “รวมบริษัทที่ไม่ดำเนินกิจการ”", note: "พบ {n} บริษัทที่ดำเนินกิจการ", noteAll: "พบ {n} บริษัท (รวมที่ไม่ดำเนินกิจการ)", inactive: "รวมบริษัทที่เลิกกิจการ / ไม่ดำเนินกิจการ", prev: "ก่อนหน้า", next: "ถัดไป" }
    };
    function L(k) { return (T[LANG] || T.en)[k] || T.en[k] || ""; }
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function reEsc(s) { return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    function hitTokens() {
      return q.split(/[\s,，;；]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 2; }).slice(0, 6);
    }
    var HIT_RE = (function () {
      var toks = hitTokens().map(reEsc);
      return toks.length ? new RegExp("(" + toks.join("|") + ")", "gi") : null;
    }());
    function highlightEscaped(html) {
      if (!HIT_RE) return html;
      return String(html || "").replace(HIT_RE, '<mark class="search-hit">$1</mark>');
    }
    function highlightText(s) { return highlightEscaped(esc(s)); }
    function fmtCap(v) { if (v == null || v === "") return ""; var n = Number(v); if (!isFinite(n)) return ""; return n.toLocaleString("en-US"); }
    function href(jpno, en) {
      if (window.__starterCompanyHref) return window.__starterCompanyHref(jpno, en);
      var s = String(en || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return s ? "/" + s + ".html" : (jpno ? "/" + encodeURIComponent(jpno) + ".html" : "#");
    }

    // 本地化搜索框 UI/文案
    (function localizeBar() {
      var k = root.querySelector("[data-ai-kicker]"); if (k) k.innerHTML = '<span aria-hidden="true">✦</span> ' + esc(L("kicker"));
      var sub = root.querySelector("[data-search-summary]"); if (sub) sub.textContent = L("sub");
      var inp = root.querySelector("[data-search-input]"); if (inp) { inp.setAttribute("placeholder", L("ph")); if (q) inp.value = q; }
      var btn = root.querySelector("[data-ai-searchbtn]"); if (btn) btn.textContent = L("btn");
      var crumb = root.querySelector(".industry-hero__crumb span:last-of-type"); if (crumb) crumb.textContent = L("btn");
    }());

    var titleEl = root.querySelector("[data-search-title]");
    if (titleEl) titleEl.textContent = q ? L("title").replace("{q}", q) : L("hero");
    if (!q || (type && type !== "companies")) return;

    var wrap = root.querySelector("[data-search-results-wrap]");
    var listEl = root.querySelector("[data-search-results]");
    var emptyEl = root.querySelector("[data-search-results-empty]");
    var noteEl = root.querySelector("[data-search-results-note]");
    var pagerEl = root.querySelector("[data-search-pager]");
    var titleResEl = root.querySelector("[data-search-results-title]");
    if (titleResEl) titleResEl.textContent = L("results");

    var includeInactive = params.get("inactive") === "1" || params.get("includeInactive") === "1" || /^\d{13}$/.test(q);
    var search = { keyword: q, provinceSlug: "" }, page = 0, total = 0;
    var inactiveEl = root.querySelector("[data-search-inactive]");
    var inactiveLabel = root.querySelector("[data-search-inactive-label]");
    if (inactiveLabel) inactiveLabel.textContent = L("inactive");
    if (inactiveEl) {
      inactiveEl.checked = includeInactive;
      inactiveEl.addEventListener("change", function () {
        includeInactive = !!inactiveEl.checked;
        try {
          var u = new URL(window.location.href);
          if (includeInactive) u.searchParams.set("inactive", "1"); else u.searchParams.delete("inactive");
          history.replaceState(null, "", u.pathname + u.search);
        } catch (e) {}
        gotoPage(0);
      });
    }

    function mapEntry(it) {
      var m = it.meta || {};
      var jpno = String(m.jpno || it.slug || "");
      return { jpno: jpno, nameEn: m.jpnamee || it.title || jpno, nameTh: m.jpname || "", nameZh: m.jpnamezh || "",
        provinceEn: m.provincee || "", provinceTh: m.province || "", provinceZh: m.provincezh || "",
        capital: m.capamt != null ? m.capamt : null, status: m.jpstatdesce || m.jpstatdesc || "",
        business: m.setupobjdesce || m.businesstypedesce || "" };
    }
    function localName(c) { return (LANG === "zh" ? (c.nameZh || c.nameEn) : LANG === "th" ? (c.nameTh || c.nameEn) : c.nameEn) || c.jpno; }
    function localProv(c) { return (LANG === "zh" ? (c.provinceZh || c.provinceEn) : LANG === "th" ? (c.provinceTh || c.provinceEn) : c.provinceEn) || ""; }

    function renderRows(cards) {
      listEl.innerHTML = "";
      cards.forEach(function (c) {
        if (!c.jpno) return;
        var a = document.createElement("a");
        a.className = "ai-list__row"; a.href = href(c.jpno, c.nameEn);
        var sub = [];
        var pv = localProv(c); if (pv) sub.push(highlightText(pv));
        if (c.business) sub.push(highlightText(c.business));
        sub.push('<span style="opacity:.6">' + highlightText(c.jpno) + '</span>');
        var cap = fmtCap(c.capital);
        var status = c.status || "";
        a.innerHTML = '<span class="ai-list__main"><span class="ai-list__name"><span>' + highlightText(localName(c)) + '</span><span data-updated-slot></span></span>'
          + '<span class="ai-list__sub">' + sub.join('<span class="dot">·</span>') + '</span></span>'
          + '<span class="ai-list__meta">'
          + (cap ? '<span class="ai-list__cap">฿' + esc(cap) + '</span>' : '')
          + (status ? '<span class="ai-list__status">' + esc(status) + '</span>' : '')
          + '</span>';
        if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(a);
        listEl.appendChild(a);
      });
      listEl.hidden = cards.length === 0;
      if (window.__bizthaiApplyRecentlyUpdated) window.__bizthaiApplyRecentlyUpdated(listEl);
    }

    function renderPager() {
      var pages = Math.ceil(total / PER);
      pagerEl.innerHTML = "";
      if (pages <= 1) { pagerEl.hidden = true; return; }
      pagerEl.hidden = false;
      function add(label, p, opt) {
        opt = opt || {};
        var b = document.createElement(p == null ? "span" : "button");
        b.className = "search-pager__btn" + (opt.active ? " is-active" : "") + (opt.dis ? " is-dis" : "");
        b.textContent = label;
        if (p != null && !opt.dis && !opt.active) b.addEventListener("click", function () { gotoPage(p); });
        pagerEl.appendChild(b);
      }
      add(L("prev"), page > 0 ? page - 1 : null, { dis: page === 0 });
      var start = Math.max(0, page - 2), end = Math.min(pages - 1, page + 2);
      if (start > 0) { add("1", 0); if (start > 1) add("…", null, { dis: true }); }
      for (var i = start; i <= end; i++) add(String(i + 1), i, { active: i === page });
      if (end < pages - 1) { if (end < pages - 2) add("…", null, { dis: true }); add(String(pages), pages - 1); }
      add(L("next"), page < pages - 1 ? page + 1 : null, { dis: page === pages - 1 });
    }

    function gotoPage(p, _authed) {
      if (!_authed && p > 0 && window.__starterAuth) {
        window.__starterAuth.me().then(function (u) {
          if (u) { gotoPage(p, true); } else { window.__starterAuth.requireLogin(); }
        });
        return;
      }
      page = p;
      var sp = new URLSearchParams();
      // 统一走 analytics 边车「正常经营优先」排序:WooCMS 原生 sort 对 cpt:thaicompany 是
      // no-op(已实测确认,见 woocms-upstream-bugs.md)。之前只有无关键词分支走了 analytics,
      // 有关键词(真正打字搜索的场景)还在打 WooCMS 原生 /entries,状态排序对搜索结果完全
      // 不生效——browseCompanies() 本身就按 AND 组合 keyword 与 province,两个分支合并成一个。
      if (search.keyword) sp.set("keyword", search.keyword);
      if (search.provinceSlug) { sp.append("taxonomy", "province"); sp.append("term", search.provinceSlug); }
      if (includeInactive) sp.set("includeInactive", "1");
      sp.set("limit", String(PER)); sp.set("offset", String(p * PER));
      var url = "/api/site/v1/analytics/company-list?" + sp.toString();
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var d = (j && j.data) || {}, items = d.items || [];
          total = Number(d.total) || items.length;
          if (!items.length && p === 0) { emptyEl.hidden = false; emptyEl.textContent = L("none"); listEl.hidden = true; pagerEl.hidden = true; return; }
          emptyEl.hidden = true;
          renderRows(items.map(mapEntry));
          if (noteEl) noteEl.textContent = L(includeInactive ? "noteAll" : "note").replace("{n}", total.toLocaleString("en-US"));
          renderPager();
          if (p > 0) window.scrollTo({ top: wrap.offsetTop - 70, behavior: "smooth" });
        })
        .catch(function () { if (p === 0) { emptyEl.hidden = false; emptyEl.textContent = L("none"); } });
    }

    wrap.hidden = false; emptyEl.hidden = false; emptyEl.textContent = L("searching");
    gotoPage(0);
  }());
