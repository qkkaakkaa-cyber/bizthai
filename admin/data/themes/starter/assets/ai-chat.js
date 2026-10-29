(function () {
    var root = document.querySelector("[data-ai-chat]");
    if (!root || root.dataset.ready === "true") return;
    root.dataset.ready = "true";

    var transcript = root.querySelector("[data-ai-transcript]");
    var input = root.querySelector("[data-ai-input]");
    var sendBtn = root.querySelector("[data-ai-send]");
    var chips = root.querySelector("[data-ai-chips]");
    var intro = root.querySelector("[data-ai-intro]");
    var quotaEl = root.querySelector("[data-ai-quota]");

    var messages = [];
    var busy = false;
    root.classList.add("is-empty"); // 初始空状态:居中布局

    function normLoc(v) { v = String(v || "").trim().toLowerCase(); if (v.indexOf("zh") === 0) return "zh"; if (v.indexOf("th") === 0) return "th"; if (v.indexOf("en") === 0) return "en"; return ""; }
    function cookieLang() {
      var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
      return m ? normLoc(decodeURIComponent(m[1])) : "";
    }
    function detectLang() {
      var seg = window.location.pathname.split("/").filter(Boolean)[0] || ""; var fp = normLoc(seg); if (fp) return fp;
      var fc = cookieLang(); if (fc) return fc;
      var hl = normLoc(document.documentElement.lang); if (hl) return hl;
      var fq = normLoc(new URLSearchParams(window.location.search).get("lang")); if (fq) return fq;
      return "en";
    }
    var LANG = detectLang();
    function langUrl(path) {
      var first = window.location.pathname.split("/").filter(Boolean)[0] || "";
      first = first.toLowerCase();
      var routeLang = (first === "zh" || first === "th" || first === "en") ? first : LANG;
      return (routeLang === "zh" || routeLang === "th" || routeLang === "en") ? "/" + routeLang + path : path;
    }

    var I18N = {
      en: { search: "Searching companies…", get_company: "Reading the company profile…", company_relations: "Mapping related companies…", lookup_person: "Looking up the person…", market: "Analysing the market…", rank: "Ranking companies…", foreign: "Checking foreign investment…", think: "Thinking…", writing: "Writing the answer…", gate: "You've reached the free question limit. Sign in to keep exploring — it's free.", signin: "Sign in to continue", err: "Something went wrong. Please try again.", cap: "Capital", src: "Data source: DBD DataWarehouse+", updated: "Updated {d}", related: "Related companies", pdf: "Generate Report", shareImg: "Share image", download: "Download", close: "Close", quotaLeft: "{n}/{limit} free questions left today", quotaLogin: "Sign in for unlimited", quotaMember: "Signed in · unlimited questions", pdfNote: "The PDF report requires sign-in to download (1 per IP per day). The share image is free — no sign-in needed." },
      th: { search: "กำลังค้นหาบริษัท…", get_company: "กำลังอ่านข้อมูลบริษัท…", company_relations: "กำลังเชื่อมโยงบริษัทที่เกี่ยวข้อง…", lookup_person: "กำลังค้นหาบุคคล…", market: "กำลังวิเคราะห์ตลาด…", rank: "กำลังจัดอันดับบริษัท…", foreign: "กำลังตรวจสอบการลงทุนต่างชาติ…", think: "กำลังคิด…", writing: "กำลังเขียนคำตอบ…", gate: "คุณใช้สิทธิ์คำถามฟรีครบแล้ว เข้าสู่ระบบเพื่อสำรวจต่อ — ฟรี", signin: "เข้าสู่ระบบเพื่อใช้งานต่อ", err: "เกิดข้อผิดพลาด โปรดลองใหม่อีกครั้ง", cap: "ทุนจดทะเบียน", src: "แหล่งข้อมูล: DBD DataWarehouse+", updated: "อัปเดต {d}", related: "บริษัทที่เกี่ยวข้อง", pdf: "สร้างรายงาน", shareImg: "แชร์รูป", download: "ดาวน์โหลด", close: "ปิด", quotaLeft: "เหลือคำถามฟรีวันนี้ {n}/{limit}", quotaLogin: "เข้าสู่ระบบเพื่อไม่จำกัด", quotaMember: "เข้าสู่ระบบแล้ว · ถามได้ไม่จำกัด", pdfNote: "ต้องเข้าสู่ระบบเพื่อดาวน์โหลดรายงาน PDF (1 ครั้งต่อ IP ต่อวัน) · รูปแชร์สร้างได้ฟรี ไม่ต้องเข้าสู่ระบบ" },
      zh: { search: "正在检索公司…", get_company: "正在读取公司档案…", company_relations: "正在梳理关联公司…", lookup_person: "正在反查相关人员…", market: "正在分析市场…", rank: "正在排名公司…", foreign: "正在核查外资情况…", think: "正在思考…", writing: "正在整理回答…", gate: "免费提问次数已用完。登录后可继续探索 —— 免费。", signin: "登录后继续", err: "出错了，请重试。", cap: "注册资本", src: "数据来源：DBD DataWarehouse+", updated: "更新 {d}", related: "相关公司", pdf: "生成报告", shareImg: "分享长图", download: "下载图片", close: "关闭", quotaLeft: "今日剩余免费提问 {n}/{limit}", quotaLogin: "登录后不限次数", quotaMember: "已登录 · 不限次数", pdfNote: "PDF 报告需登录后下载,每个 IP 每天限 1 次;海报可直接生成、免登录。" }
    };
    function L(k) { return (I18N[LANG] || I18N.en)[k] || I18N.en[k] || ""; }

    // ── 免费提问剩余次数(匿名按 IP 每天 20 次;登录不限)──
    var quota = { anonymous: true, unlimited: false, limit: null, remaining: null };
    function renderQuota() {
      if (!quotaEl) return;
      if (quota.unlimited) { quotaEl.textContent = L("quotaMember"); quotaEl.hidden = false; return; }
      if (quota.limit == null || quota.remaining == null) { quotaEl.hidden = true; return; }
      var n = Math.max(0, quota.remaining);
      var htmlLeft = esc(L("quotaLeft")).replace("{n}", "<b>" + n + "</b>").replace("{limit}", quota.limit);
      quotaEl.innerHTML = htmlLeft + ' · <a href="#" data-ai-quota-login>' + esc(L("quotaLogin")) + "</a>";
      var lg = quotaEl.querySelector("[data-ai-quota-login]");
      if (lg) lg.addEventListener("click", function (e) {
        e.preventDefault();
        var back = window.location.pathname + window.location.search;
        if (window.__starterAuth && window.__starterAuth.requireLogin) window.__starterAuth.requireLogin(back);
        else window.location.href = langUrl("/login") + "?next=" + encodeURIComponent(back);
      });
      quotaEl.hidden = false;
    }
    function applyQuota(d) {
      if (!d) return;
      quota.anonymous = !!d.anonymous;
      quota.unlimited = (d.unlimited != null) ? !!d.unlimited : (d.limit == null);
      quota.limit = (d.limit == null ? null : d.limit);
      quota.remaining = (d.remaining == null ? null : d.remaining);
      renderQuota();
    }
    function loadQuota() {
      fetch("/api/site/v1/ai/quota", { credentials: "include" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(applyQuota).catch(function () {});
    }

    function looksLikeCompanyQuery(text) {
      var s = String(text || "").trim();
      if (!s) return false;
      if (/^\d{8,15}$/.test(s.replace(/\D/g, ""))) return true;
      if (/\b(co\.?|company|ltd\.?|limited|plc|public company|corp\.?|corporation|inc\.?)\b/i.test(s)) return true;
      if (/บริษัท|จำกัด|มหาชน/i.test(s)) return true;
      return s.length <= 90 && !/[?？]/.test(s) && !/\b(find|list|largest|newest|how many|compare|competitor|industry|market|companies in)\b/i.test(s);
    }
    function reportTask(text) {
      if (!looksLikeCompanyQuery(text)) return text;
      if (LANG === "zh") return "请把下面输入当作公司名称或注册号,先尝试解析到最匹配的泰国注册公司。如果能唯一确定是哪一家,不要反问用户,直接给出企业分析结论,必须包含:一句话总结企业;收录/登记/更新时间小标;风险评分0-100;企业信用评分0-100;行业排名或相对规模;做什么行业;规模如何;是否值得合作;企业关系图谱;老板名片/董事关联企业;企业新闻或登记事件时间轴;竞争对手分析;供应链关系判断。没有外部新闻或供应链确证时要明确写暂无接入/需核验,不能编造。但如果这个输入匹配到多家公司,或者本身是常见词导致命中海量公司,不要自己整理候选表格或逐条罗列——界面已经把匹配到的公司单独渲染出来了,你只需要用一两句话说明情况,并引导用户提供完整公司全称、13位注册号,或补充省份/行业信息缩小范围。公司输入: " + text;
      if (LANG === "th") return "ให้ถือข้อความต่อไปนี้เป็นชื่อบริษัทหรือเลขทะเบียนบริษัทไทย พยายามค้นหาบริษัทที่ตรงที่สุดก่อน ถ้าสามารถระบุได้ชัดเจนว่าเป็นบริษัทเดียว ห้ามถามกลับ ให้ตอบเป็นรายงานวิเคราะห์โดยตรงทันที ต้องมี: สรุปบริษัทหนึ่งประโยค; ป้ายวันที่เก็บ/จดทะเบียน/อัปเดต; คะแนนความเสี่ยง 0-100; คะแนนเครดิตธุรกิจ 0-100; อันดับอุตสาหกรรมหรือขนาดโดยประมาณ; ทำธุรกิจอะไร; ขนาดบริษัท; ควรร่วมมือหรือไม่; แผนผังความสัมพันธ์; นามบัตรเจ้าของ/กรรมการและบริษัทที่เกี่ยวข้อง; ไทม์ไลน์ข่าวหรือเหตุการณ์ทะเบียน; คู่แข่ง; ความสัมพันธ์ซัพพลายเชน. ถ้าไม่มีแหล่งข่าวภายนอกหรือข้อมูลซัพพลายเชนยืนยัน ให้ระบุว่าไม่มี/ต้องตรวจสอบ ห้ามแต่งข้อมูล แต่ถ้าคำนี้ตรงกับหลายบริษัท หรือเป็นคำทั่วไปที่ทำให้พบบริษัทจำนวนมาก ห้ามสร้างตารางสรุปผู้สมัครเอง — หน้าจอแสดงรายชื่อบริษัทที่ตรงกันแยกไว้ให้แล้ว ให้ตอบสั้นๆ 1-2 ประโยคอธิบายสถานการณ์ และขอให้ผู้ใช้ระบุชื่อเต็ม เลขทะเบียน 13 หลัก หรือจังหวัด/อุตสาหกรรมเพิ่มเติมเพื่อจำกัดขอบเขต บริษัท: " + text;
      return "Treat the following input as a Thai company name or registration number. First try to resolve it to the best matching registered company. If it resolves uniquely to one company, do not ask follow-up questions — directly return an enterprise intelligence report. Include: one-sentence company analysis; collected/registered/updated date badge; risk score 0-100; enterprise credit score 0-100; industry rank or relative scale; what industry it does; scale; whether it is worth cooperating with; relationship graph; boss card/director related companies; company news or registry-event timeline; competitor analysis; supply-chain relationship assessment. If external news or confirmed supply-chain data is not available, say so plainly and do not invent it. But if this input matches multiple companies, or is a generic term that matches a huge number of companies, do NOT build your own summary table of candidates or list them one by one — the UI already renders the matching companies separately. Just reply in 1-2 sentences explaining the situation and ask the user for the full company name, 13-digit registration number, or a province/industry to narrow it down. Company input: " + text;
    }
    function statusText(tool) {
      if (tool === "get_company") return L("get_company");
      if (tool === "company_relations") return L("company_relations");
      if (tool === "lookup_person") return L("lookup_person");
      if (tool === "market_snapshot") return L("market");
      if (tool === "rank_companies") return L("rank");
      if (tool === "foreign_companies") return L("foreign");
      if (tool === "search_companies") return L("search");
      return L("think");
    }
    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
    function href(jpno, en) {
      if (window.__starterCompanyHref) return window.__starterCompanyHref(jpno, en);
      var slug = String(en || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return slug ? "/" + slug + ".html" : (jpno ? "/" + encodeURIComponent(jpno) + ".html" : "#");
    }
    function localName(c) {
      if (LANG === "zh") return c.nameZh || c.nameEn || c.jpno;
      if (LANG === "th") return c.nameTh || c.nameEn || c.jpno;
      return c.nameEn || c.jpno;
    }
    function localProv(c) {
      if (LANG === "zh") return c.provinceZh || c.provinceEn || "";
      if (LANG === "th") return c.provinceTh || c.provinceEn || "";
      return c.provinceEn || "";
    }
    function localStatus(c) { return c.status || ""; }
    function shortDate(v) { if (!v) return ""; var s = String(v); var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (m[1] + "-" + m[2] + "-" + m[3]) : s.slice(0, 10); }
    function updatedBadge(c) { var d = shortDate(c.updatedAt || c.updated_at || c.updatedate || c.publishedAt || c.published_at || ""); return d ? L("updated").replace("{d}", d) : ""; }
    function fmtCap(v) { if (v == null || v === "") return ""; var n = Number(v); if (!isFinite(n)) return ""; return n.toLocaleString("en-US"); }

    // ── 极简 markdown 渲染(标题/列表/表格/粗体/代码/分隔线) ──
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      return s;
    }
    function stripProtocolText(src) {
      return String(src || "")
        .replace(/[｜︱∣❘❙❚]/g, "|")
        .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?tool_calls\s*>[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?tool_calls\s*>/gi, "")
        .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?invoke\b[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?invoke\s*>/gi, "")
        .replace(/<\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?parameter\b[\s\S]*?<\s*\/\s*\|\s*(?:\|\s*)?DSML\s*\|\s*(?:\|\s*)?parameter\s*>/gi, "")
        .replace(/^\s*<\s*\|\s*(?:\|\s*)?DSML\s*\|.*$/gmi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    function renderMd(src) {
      var lines = stripProtocolText(src).replace(/\r/g, "").split("\n");
      var html = "", i = 0;
      function isRow(l) { return /^\s*\|.*\|\s*$/.test(l); }
      while (i < lines.length) {
        var line = lines[i];
        if (!line.trim()) { i++; continue; }
        var h = line.match(/^(#{2,4})\s+(.*)$/);
        if (h) { var lv = h[1].length; html += "<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"; i++; continue; }
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
        if (isRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
          var head = line.split("|").slice(1, -1).map(function (c) { return "<th>" + inline(c.trim()) + "</th>"; }).join("");
          i += 2; var body = "";
          while (i < lines.length && isRow(lines[i])) {
            body += "<tr>" + lines[i].split("|").slice(1, -1).map(function (c) { return "<td>" + inline(c.trim()) + "</td>"; }).join("") + "</tr>"; i++;
          }
          html += "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>"; continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          var ol = ""; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { ol += "<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>"; i++; }
          html += "<ol>" + ol + "</ol>"; continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          var ul = ""; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { ul += "<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>"; i++; }
          html += "<ul>" + ul + "</ul>"; continue;
        }
        var para = [], startI = i;
        while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|\s*\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])) { para.push(inline(lines[i])); i++; }
        if (i === startI) { para.push(inline(lines[i])); i++; } // 兜底:当前行不归任何块(如流式中半截表格行)也强制消费,防死循环
        html += "<p>" + para.join("<br>") + "</p>";
      }
      return html;
    }

    // 只滚到对话区(.ai-main)底部 —— 不滚到页脚;用户上滚阅读时不打扰(除非 force=新消息)
    function scrollDown(force) {
      var main = root.querySelector(".ai-main");
      if (!main) return;
      var target = Math.max(0, main.offsetTop + main.offsetHeight - window.innerHeight);
      if (!force && (target - window.scrollY) > 320) return;
      window.scrollTo({ top: target, behavior: force ? "smooth" : "auto" });
    }

    function addTurn(role) {
      var turn = document.createElement("div");
      turn.className = "ai-turn ai-turn--" + (role === "user" ? "user" : "ai");
      if (role === "user") {
        turn.innerHTML = '<div class="ai-bubble"></div><div class="ai-turn__avatar">You</div>';
      } else {
        turn.innerHTML = '<div class="ai-turn__avatar" aria-hidden="true">✦</div><div class="ai-bubble"><div class="ai-report-head" hidden><button type="button" class="ai-report-action" data-ai-pdf><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20h12"></path><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path></svg><span></span></button><button type="button" class="ai-report-action" data-ai-share><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path><path d="M16 8 12 4 8 8"></path><path d="M12 4v12"></path></svg><span></span></button></div><p class="ai-report-note" hidden></p><div class="ai-steps"></div><span class="ai-updated-chip" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l3 3"></path><circle cx="12" cy="12" r="9"></circle></svg><span></span></span><div class="ai-md"></div><div class="ai-cards" data-ai-primary-cards hidden></div><div class="ai-list" data-ai-primary-list hidden></div><div class="ai-related" hidden><div class="ai-section-label"></div><div class="ai-list" data-ai-related-list hidden></div></div><p class="ai-turn-disclaimer" hidden></p></div>';
        var pdfSpan = turn.querySelector("[data-ai-pdf] span"); if (pdfSpan) pdfSpan.textContent = L("pdf");
        var shareSpan = turn.querySelector("[data-ai-share] span"); if (shareSpan) shareSpan.textContent = L("shareImg");
        var relLabel = turn.querySelector(".ai-related .ai-section-label"); if (relLabel) relLabel.textContent = L("related");
      }
      transcript.appendChild(turn);
      scrollDown(true);
      return turn;
    }

    function renderList(container, cards) {
      container.hidden = false;
      cards.forEach(function (c) {
        if (!c || !c.jpno) return;
        var a = document.createElement("a");
        a.className = "ai-list__row"; a.href = href(c.jpno, c.nameEn); a.setAttribute("data-name-en", c.nameEn || ""); a.setAttribute("data-jpno", c.jpno || "");
        var sub = [];
        var pv = localProv(c); if (pv) sub.push(esc(pv));
        if (c.business) sub.push(esc(c.business));
        sub.push('<span style="opacity:.6">' + esc(c.jpno) + '</span>');
        var cap = fmtCap(c.capital), status = localStatus(c), updated = updatedBadge(c);
        a.innerHTML = '<span class="ai-list__main">'
          + '<span class="ai-list__name"><span>' + esc(localName(c)) + '</span>' + (updated ? '<span class="ai-list__updated">' + esc(updated) + '</span>' : '') + '</span>'
          + '<span class="ai-list__sub">' + sub.join('<span class="dot">·</span>') + '</span>'
          + '</span>'
          + '<span class="ai-list__meta">'
          + (cap ? '<span class="ai-list__cap">฿' + esc(cap) + '</span>' : '')
          + (status ? '<span class="ai-list__status">' + esc(status) + '</span>' : '')
          + '</span>';
        if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(a);
        container.appendChild(a);
      });
      scrollDown();
    }

    // 经营状态归类(复用全站统一分类器,保证跟列表/详情页的徽标颜色判定一致;缺失时退化为一份最小本地兜底)
    function statusKind(s) {
      if (window.__bizthaiStatusKind) return window.__bizthaiStatusKind(s, "");
      var v = String(s || "").toLowerCase().trim();
      if (!v) return "unknown";
      if (v === "operating" || v === "active" || v.indexOf("正常") >= 0 || v.indexOf("ดำเนินกิจการ") >= 0) return "operating";
      if (v === "-" || v === "unknown" || v === "n/a") return "unknown";
      return "risk";
    }
    // 经营状态排序:正常优先在上,异常(解散/清算等)垫底,未知居中;同档内保持原有相对顺序(稳定排序)
    function sortByStatus(cards) {
      var rank = { operating: 0, unknown: 1, risk: 2 };
      return cards
        .map(function (c, i) { return [c, i]; })
        .sort(function (a, b) { return (rank[statusKind(a[0].status)] - rank[statusKind(b[0].status)]) || (a[1] - b[1]); })
        .map(function (p) { return p[0]; });
    }

    // 模糊匹配 2-5 家候选公司:选择卡片网格。点击即向 AI 追问该公司(带名称+注册号消除歧义),继续走深度报告
    function renderCards(container, cards) {
      container.hidden = false;
      cards.forEach(function (c) {
        if (!c || !c.jpno) return;
        var btn = document.createElement("button");
        btn.type = "button"; btn.className = "ai-card";
        var sub = [];
        var pv = localProv(c); if (pv) sub.push(esc(pv));
        if (c.business) sub.push(esc(c.business));
        sub.push('<span style="opacity:.6">' + esc(c.jpno) + '</span>');
        var cap = fmtCap(c.capital), status = localStatus(c), updated = updatedBadge(c);
        btn.innerHTML = '<span class="ai-list__name"><span>' + esc(localName(c)) + '</span>' + (updated ? '<span class="ai-list__updated">' + esc(updated) + '</span>' : '') + '</span>'
          + '<span class="ai-list__sub">' + sub.join('<span class="dot">·</span>') + '</span>'
          + '<span class="ai-card__meta">' + (cap ? '<span class="ai-list__cap">฿' + esc(cap) + '</span>' : '') + (status ? '<span class="ai-list__status">' + esc(status) + '</span>' : '') + '</span>';
        if (window.__bizthaiApplyStatusBadges) window.__bizthaiApplyStatusBadges(btn);
        btn.addEventListener("click", function () { ask(localName(c) + " (" + c.jpno + ")"); });
        container.appendChild(btn);
      });
      scrollDown();
    }

    function reportTitle(turn) {
      // 标题优先用公司名(报告就是针对这家公司的),其次才退回正文首个小标题
      var cardName = turn.querySelector(".ai-list__name span");
      var h = turn.querySelector(".ai-md h2, .ai-md h3");
      return (cardName && cardName.textContent.trim()) || (h && h.textContent.trim()) || "BizThai AI Report";
    }

    // 报告涉及的「这家公司」:取首张公司卡的名称(含英文名,用于文件名) + 在线档案绝对链接(末页二维码)
    function reportCompany(turn) {
      var row = turn.querySelector(".ai-list__row");
      var nameEl = turn.querySelector(".ai-list__name span");
      var url = "", h = row && row.getAttribute("href");
      if (h) { try { url = new URL(h, window.location.origin).href; } catch (e) { url = ""; } }
      var en = (row && row.getAttribute("data-name-en")) || "";
      var jp = (row && row.getAttribute("data-jpno")) || "";
      return { name: (nameEl && nameEl.textContent.trim()) || en, nameEn: en, jpno: jp, url: url };
    }
    function bindReportActions(turn) {
      var head = turn.querySelector(".ai-report-head"), pdf = turn.querySelector("[data-ai-pdf]"), share = turn.querySelector("[data-ai-share]");
      if (!head || head.dataset.bound === "1") return;
      head.dataset.bound = "1";
      if (pdf) pdf.addEventListener("click", function () { openReportPreview(turn); });
      if (share) share.addEventListener("click", function () { shareReportImage(turn); });
    }
    function showReportActions(turn) {
      var head = turn.querySelector(".ai-report-head");
      if (!head) return;
      bindReportActions(turn);
      head.hidden = false;
      var note = turn.querySelector(".ai-report-note");
      if (note) { note.textContent = L("pdfNote"); note.hidden = false; }
    }
    var BIZTHAI_LOGO_WHITE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="36" height="36"><rect width="40" height="40" rx="9" fill="rgba(255,255,255,.18)"/><path fill="#fff" d="M12 11.5h7.4c3.1 0 5.1 1.7 5.1 4.2 0 1.7-.9 3-2.4 3.7 2 .6 3.2 2.2 3.2 4.2 0 3-2.3 4.9-5.9 4.9H12v-17Zm6.8 6.8c1.5 0 2.4-.7 2.4-1.9s-.9-1.9-2.4-1.9h-3.5v3.8h3.5Zm.4 7.1c1.7 0 2.7-.8 2.7-2.1 0-1.4-1-2.2-2.7-2.2h-3.9v4.3h3.9Z"/></svg>';
    var BIZTHAI_LOGO_COLOR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="26" height="26"><rect width="40" height="40" rx="9" fill="#7901b2"/><path fill="#fff" d="M12 11.5h7.4c3.1 0 5.1 1.7 5.1 4.2 0 1.7-.9 3-2.4 3.7 2 .6 3.2 2.2 3.2 4.2 0 3-2.3 4.9-5.9 4.9H12v-17Zm6.8 6.8c1.5 0 2.4-.7 2.4-1.9s-.9-1.9-2.4-1.9h-3.5v3.8h3.5Zm.4 7.1c1.7 0 2.7-.8 2.7-2.1 0-1.4-1-2.2-2.7-2.2h-3.9v4.3h3.9Z"/></svg>';

    function buildReportHtml(turn, title) {
      var md = turn.querySelector(".ai-md");
      // 防护:剔除回答正文里任何整文档级标签,避免污染报告 / 触发 looksLikeFullHTML
      var stripDocTags = function (s) {
        return String(s || "")
          .replace(/<!\s*doctype[^>]*>/gi, "")
          .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
      };
      var content = stripDocTags(md ? md.innerHTML : "");
      var lang = LANG;
      var rptLabel = lang === "zh" ? "由 BizThai AI 分析" : lang === "th" ? "วิเคราะห์โดย BizThai AI" : "Analyzed by BizThai AI";
      var savePdf = lang === "zh" ? "⬇ 下载 PDF" : lang === "th" ? "⬇ บันทึก PDF" : "⬇ Save as PDF";
      var closeBtn = lang === "zh" ? "✕ 关闭" : lang === "th" ? "✕ ปิด" : "✕ Close";
      var confid = lang === "zh" ? "保密文件" : lang === "th" ? "เอกสารลับ" : "CONFIDENTIAL";
      var disclaimer = lang === "zh"
        ? "本报告由 BizThai AI 生成，数据来源：泰国商业发展局（DBD）DataWarehouse+。仅供参考，重要商业决策请以官方公司登记信息为准。"
        : lang === "th"
        ? "รายงานนี้สร้างโดย BizThai AI จากข้อมูลของกรมพัฒนาธุรกิจการค้า (DBD) DataWarehouse+ ใช้เพื่อการอ้างอิงเท่านั้น โปรดตรวจสอบข้อมูลสำคัญกับทะเบียนบริษัทอย่างเป็นทางการ"
        : "This report was generated by BizThai AI using data from Thailand’s Department of Business Development (DBD) DataWarehouse+. For reference only — verify important decisions against official registry data.";
      var esc_ = function(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); };
      var safeTitle = esc_(title);
      var css = [
        "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}",
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,'Noto Sans Thai',sans-serif;background:#f0eef5;color:#1a1625;font-size:13.5px;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".pbar{position:fixed;top:0;left:0;right:0;z-index:100;background:#14121a;display:flex;align-items:center;gap:10px;padding:0 18px;height:50px}",
        ".pbar__title{flex:1;font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".pbtn{display:inline-flex;align-items:center;padding:0 14px;height:34px;border:0;border-radius:8px;font:600 13px/1 inherit;cursor:pointer;white-space:nowrap}",
        ".pbtn--p{background:#7901b2;color:#fff}.pbtn--s{background:rgba(255,255,255,.1);color:#fff}.pbtn:hover{opacity:.85}",
        ".pwrap{padding:66px 20px 40px}",
        ".page{width:794px;margin:0 auto;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,.15);display:flex;flex-direction:column;min-height:1123px}",
        ".rh{background:#7901b2;color:#fff;padding:26px 36px 22px;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".rh-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}",
        ".rh-brand{display:flex;align-items:center;gap:11px}",
        ".rh-name{font-size:22px;font-weight:800;letter-spacing:-.03em;line-height:1;color:#fff}",
        ".rh-url{font-size:11px;color:rgba(255,255,255,.65);letter-spacing:.04em;margin-top:3px}",
        ".rh-side{display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right;min-width:0}",
        ".rh-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.15);padding:4px 12px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;width:max-content}",
        ".rh-title{font-size:19px;font-weight:700;line-height:1.3;color:#fff;text-align:right}",
        ".rb{flex:1;padding:30px 36px}",
        ".ai-md h2{font-size:15.5px;font-weight:700;color:#14121a;margin:24px 0 9px;padding-bottom:7px;border-bottom:2px solid #7901b2}",
        ".ai-md h2:first-child{margin-top:0}",
        ".ai-md h3{font-size:13.5px;font-weight:700;color:#2a1e35;margin:18px 0 6px}",
        ".ai-md h4{font-size:13px;font-weight:600;color:#34303b;margin:14px 0 5px}",
        ".ai-md p{margin:7px 0;color:#2a2535}",
        ".ai-md ul,.ai-md ol{margin:7px 0;padding-left:20px}",
        ".ai-md li{margin:3px 0}",
        ".ai-md strong{font-weight:700;color:#14121a}",
        ".ai-md code{background:#f3f0f7;padding:2px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace}",
        ".ai-md hr{border:0;border-top:1px solid #e8e5f0;margin:16px 0}",
        ".ai-md table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12.5px}",
        ".ai-md thead{background:#7901b2;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".ai-md th{background:#7901b2;color:#fff;font-weight:600;padding:9px 12px;text-align:left;font-size:12px;border:1px solid #6600a0;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".ai-md td{border:1px solid #e0dcea;padding:8px 12px;vertical-align:top;color:#2a2535}",
        ".ai-md tr:nth-child(even) td{background:#faf9fc;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".rf{padding:16px 36px 20px;border-top:3px solid #7901b2;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-top:auto}",
        ".rf-brand{display:flex;align-items:center;gap:7px;margin-bottom:5px}",
        ".rf-name{font-size:14px;font-weight:800;color:#7901b2}",
        ".rf-furl{font-size:11px;color:#7901b2}",
        ".rf-disc{font-size:10.5px;color:#6b6474;line-height:1.55;max-width:500px}",
        ".rf-confid{display:inline-flex;align-items:center;border:1.5px solid rgba(121,1,178,.3);color:#7901b2;font-size:9.5px;font-weight:800;letter-spacing:.1em;padding:4px 9px;border-radius:4px;text-transform:uppercase;white-space:nowrap;align-self:flex-start;margin-top:4px}",
        "@media print{body{background:#fff!important}.pbar{display:none!important}.pwrap{padding:0!important}.page{box-shadow:none!important;width:100%!important;min-height:0!important}@page{margin:12mm 16mm;size:A4 portrait}.ai-md h2{page-break-after:avoid}.ai-md table{page-break-inside:avoid}}"
      ].join("");
      // 拆分特殊标签，防止 nginx sub_filter / WooCMS 模板解析器对 JS 字符串做替换
      var ST = "<" + "style>", SE = "</" + "style>", HE = "</" + "head>";
      var DT = "<!" + "DOCTYPE html>", HO = "<" + "html lang=\"" + lang + "\">", HS = "<" + "head>", BO = "<" + "body>";
      var html = DT + "\n" + HO + "\n" + HS + "\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>" + safeTitle + " — BizThai</title>\n" + ST + css + SE + "\n" + HE + "\n" + BO + "\n";
      html += "<div class=\"pbar\"><span class=\"pbar__title\">" + rptLabel + " — " + safeTitle + "</span>";
      html += "<button class=\"pbtn pbtn--p\" data-dl>" + savePdf + "</button>";
      html += "<button class=\"pbtn pbtn--s\" onclick=\"window.close()\">" + closeBtn + "</button></div>\n";
      html += "<div class=\"pwrap\"><div class=\"page\">\n";
      html += "<header class=\"rh\"><div class=\"rh-top\"><div class=\"rh-brand\">" + BIZTHAI_LOGO_WHITE;
      html += "<div><div class=\"rh-name\">BizThai</div><div class=\"rh-url\">bizthai.com</div></div></div>";
      html += "<div class=\"rh-side\"><div class=\"rh-title\">" + safeTitle + "</div><div class=\"rh-badge\">✶ " + rptLabel + "</div></div>";
      html += "</div></header>\n";
      html += "<div class=\"rb\"><div class=\"ai-md\">" + content + "</div></div>\n";
      html += "<footer class=\"rf\"><div><div class=\"rf-brand\">" + BIZTHAI_LOGO_COLOR;
      html += "<span class=\"rf-name\">BizThai</span><span class=\"rf-furl\">· bizthai.com</span></div>";
      html += "<div class=\"rf-disc\">" + esc_(disclaimer) + "</div>";
      html += "<div class=\"rf-disc\" style=\"margin-top:4px;opacity:.7\">Data: DBD DataWarehouse+ · Powered by BizThai AI</div></div>";
      html += "<div class=\"rf-confid\">" + esc_(confid) + "</div></footer>\n";
      html += "</div></div>\n";
      // 下载:把报告正文 + 公司信息 POST 给服务端无头 Chrome,直接拿回 PDF 下载(不调用系统打印)
      var rc = reportCompany(turn);
      // 文件名优先用公司英文名(更通用、避免取到正文小标题),再退回标题
      var safeFn = String(rc.nameEn || rc.name || title || "bizthai-report").replace(/[^\w一-龥-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "bizthai-report";
      // back:在主页面(/ai)上下文里取当前路径,登录后回跳到这里;need/limit 覆盖未登录 / 超每日 1 次两种情形
      var DLDATA = JSON.stringify({
        ep: window.location.origin + "/api/site/v1/ai/report-pdf", locale: lang, title: title, company: rc, fname: safeFn, save: savePdf,
        back: (window.location.pathname + window.location.search),
        gen: (lang === "zh" ? "⏳ 生成中…" : lang === "th" ? "⏳ กำลังสร้าง…" : "⏳ Generating…"),
        err: (lang === "zh" ? "PDF 生成失败，请重试" : lang === "th" ? "สร้าง PDF ไม่สำเร็จ โปรดลองใหม่" : "PDF generation failed, please retry"),
        need: (lang === "zh" ? "下载 PDF 报告需先登录。登录后每个 IP 每天可下载 1 次。点「确定」去登录。" : lang === "th" ? "ต้องเข้าสู่ระบบก่อนดาวน์โหลดรายงาน PDF (1 ครั้งต่อ IP ต่อวัน) กด ตกลง เพื่อเข้าสู่ระบบ" : "Sign in to download the PDF report (1 per IP per day). Click OK to sign in."),
        limit: (lang === "zh" ? "今日 PDF 下载次数已用完(每个 IP 每天限 1 次)。" : lang === "th" ? "ถึงขีดจำกัดการดาวน์โหลด PDF วันนี้แล้ว (1 ครั้งต่อ IP ต่อวัน)" : "Daily PDF download limit reached (1 per IP per day).")
      }).replace(/</g, "\\u003c");
      var SC = "<scr" + "ipt>", SCE = "</scr" + "ipt>";
      // 报告在独立弹窗/降级 iframe 里渲染,拿不到本页的 __starterAuth——经 window.opener(弹窗)/ window.parent(iframe)跨窗访问;
      // 未登录先引导登录(不发起下载),已登录才 POST;后端 401=未登录、429=今日已达 1 次,分别给明确提示。
      html += SC + "(function(){var D=" + DLDATA + ";var b=document.querySelector('[data-dl]');if(!b)return;"
        + "function bd(){var m=document.querySelector('.ai-md');return m?m.innerHTML:'';}"
        + "function AUTH(){try{if(window.opener&&window.opener.__starterAuth)return window.opener.__starterAuth;}catch(e){}try{if(window.parent&&window.parent!==window&&window.parent.__starterAuth)return window.parent.__starterAuth;}catch(e){}return null;}"
        + "function gotoLogin(){var u='/login?next='+encodeURIComponent(D.back||'/ai');try{(window.top||window).location.href=u;}catch(e){window.location.href=u;}}"
        + "function reset(){b.disabled=false;b.textContent=D.save;}"
        + "function doFetch(){b.disabled=true;b.textContent=D.gen;"
        + "fetch(D.ep,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({locale:D.locale,title:D.title,bodyHtml:bd(),company:D.company})})"
        + ".then(function(r){if(r.status===401){var e=new Error('login');e.code=401;throw e;}if(r.status===429){var e2=new Error('limit');e2.code=429;throw e2;}if(!r.ok)throw new Error('e');return r.blob();})"
        + ".then(function(bl){var a=document.createElement('a');var u=URL.createObjectURL(bl);a.href=u;a.download=(D.fname||'bizthai-report')+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},30000);reset();})"
        + ".catch(function(err){reset();if(err&&err.code===401){if(confirm(D.need))gotoLogin();}else if(err&&err.code===429){alert(D.limit);}else{alert(D.err);}});}"
        + "b.addEventListener('click',function(){if(b.disabled)return;var A=AUTH();"
        + "if(A&&A.me){b.disabled=true;b.textContent=D.gen;A.me().then(function(u){reset();if(!u){if(confirm(D.need))gotoLogin();return;}doFetch();}).catch(function(){reset();doFetch();});}"
        + "else{doFetch();}"
        + "});})();" + SCE + "\n";
      html += "</" + "body></" + "html>";
      return html;
    }

    function openReportPreview(turn) {
      var md = turn.querySelector(".ai-md");
      if (!md || !md.textContent.trim()) return;
      var title = reportTitle(turn);
      var html = buildReportHtml(turn, title);
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      // 不能带 noopener:它会让 window.open 返回 null,被误判为「弹窗被拦截」从而又弹一个模态(重复)
      var w = window.open(url, "_blank", "width=920,height=900");
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      if (!w) {
        // 真正被浏览器拦截时,才降级到 iframe 模态
        openReportModal(html, title);
      }
    }

    function openReportModal(html, title) {
      var modal = document.querySelector("[data-ai-rpt-modal]");
      if (!modal) {
        modal = document.createElement("div");
        modal.setAttribute("data-ai-rpt-modal", "1");
        modal.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(20,18,26,.72);display:flex;flex-direction:column";
        var bar = document.createElement("div");
        bar.style.cssText = "flex:0 0 auto;background:#14121a;display:flex;align-items:center;gap:10px;padding:0 18px;height:50px";
        // 模态里不再放「下载」按钮:iframe 内的报告自带 data-dl 下载脚本(走服务端,不弹打印框);此处只留关闭
        bar.innerHTML = "<span style=\"flex:1;font-size:13px;font-weight:600;color:#fff\" data-rpt-ttl></span>"
          + "<button style=\"display:inline-flex;align-items:center;padding:0 14px;height:34px;border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;font:600 13px/1 inherit;cursor:pointer\" data-rpt-close>"
          + (LANG === "zh" ? "✕ 关闭" : LANG === "th" ? "✕ ปิด" : "✕ Close")
          + "</button>";
        var frame = document.createElement("iframe");
        frame.setAttribute("data-rpt-frame", "1");
        frame.style.cssText = "flex:1;border:0;width:100%;background:#f0eef5";
        modal.appendChild(bar);
        modal.appendChild(frame);
        document.body.appendChild(modal);
        modal.querySelector("[data-rpt-close]").addEventListener("click", function () { modal.hidden = true; });
      }
      modal.querySelector("[data-rpt-ttl]").textContent = title;
      var frame = modal.querySelector("[data-rpt-frame]");
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      frame.src = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      modal.hidden = false;
    }
    function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
      var words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
      var line = "", lines = 0;
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + " " + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, y); y += lineHeight; lines++; line = words[i];
          if (maxLines && lines >= maxLines) return y;
        } else line = test;
      }
      if (line && (!maxLines || lines < maxLines)) { ctx.fillText(line, x, y); y += lineHeight; }
      return y;
    }
    // 分享海报:服务端无头 Chrome 渲染 9:16 商务公司海报(配图+二维码+URL),前端取回 PNG 展示
    async function shareReportImage(turn) {
      var rc = reportCompany(turn);
      if (!rc.jpno) return; // 无明确公司则不出海报
      // 海报免登录、不限次(仅后端按 IP 每小时 10 张限流防滥用),此处直接生成,无需先查登录态。
      var btn = turn.querySelector("[data-ai-share]"), span = btn && btn.querySelector("span");
      var oldTx = span ? span.textContent : "";
      if (btn) { btn.disabled = true; if (span) span.textContent = (LANG === "zh" ? "生成中…" : LANG === "th" ? "กำลังสร้าง…" : "Generating…"); }
      try {
        var resp = await fetch(window.location.origin + "/api/site/v1/ai/poster", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jpno: rc.jpno, url: rc.url, locale: LANG })
        });
        if (!resp.ok) { var pe = new Error("poster"); pe.status = resp.status; throw pe; }
        var blob = await resp.blob();
        openShareModal(URL.createObjectURL(blob), rc.name || reportTitle(turn), rc.nameEn || rc.name);
      } catch (e) {
        var msg = (e && e.status === 429)
          ? (LANG === "zh" ? "海报生成太频繁,请稍后再试(每个 IP 每小时最多 10 张)。" : LANG === "th" ? "สร้างโปสเตอร์บ่อยเกินไป โปรดลองใหม่ภายหลัง (สูงสุด 10 รูปต่อ IP ต่อชั่วโมง)" : "Too many posters — please try again later (max 10 per IP per hour).")
          : (LANG === "zh" ? "海报生成失败，请重试" : LANG === "th" ? "สร้างโปสเตอร์ไม่สำเร็จ โปรดลองใหม่" : "Poster generation failed, please retry");
        alert(msg);
      } finally {
        if (btn) { btn.disabled = false; if (span) span.textContent = oldTx; }
      }
    }
    function openShareModal(src, title, fnameEn) {
      var modal = document.querySelector("[data-ai-share-modal]");
      if (!modal) {
        modal = document.createElement("div");
        modal.className = "ai-share-modal"; modal.setAttribute("data-ai-share-modal", "true");
        modal.innerHTML = '<div class="ai-share-card"><div class="ai-share-preview"><img alt=""></div><div class="ai-share-actions"><button type="button" class="ai-share-btn" data-share-download><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20h12"></path><path d="M12 4v11"></path><path d="m8 11 4 4 4-4"></path></svg><span></span></button><button type="button" class="ai-share-btn" data-share-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg><span></span></button></div></div>';
        document.body.appendChild(modal);
        modal.querySelector("[data-share-close] span").textContent = L("close");
        modal.querySelector("[data-share-download] span").textContent = L("download");
        modal.querySelector("[data-share-close]").addEventListener("click", function () { modal.hidden = true; });
        modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });
        modal.querySelector("[data-share-download]").addEventListener("click", function () {
          var a = document.createElement("a"); a.href = modal.querySelector("img").src; a.download = (modal.dataset.fname || modal.dataset.title || "bizthai-company").replace(/[^\w一-龥-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) + ".jpg"; a.click();
        });
      }
      modal.querySelector("img").src = src;
      modal.querySelector("img").alt = title;
      modal.dataset.title = title;
      modal.dataset.fname = fnameEn || title;
      modal.hidden = false;
    }

    function showGate(bubble) {
      var md = bubble.querySelector(".ai-md");
      md.innerHTML = '<div class="ai-gate"><p>' + esc(L("gate")) + '</p><button type="button" class="ai-gate__btn" data-ai-login>' + esc(L("signin")) + '</button></div>';
      var btn = md.querySelector("[data-ai-login]");
      btn.addEventListener("click", function () {
        var back = window.location.pathname + window.location.search;
        if (window.__starterAuth && window.__starterAuth.requireLogin) window.__starterAuth.requireLogin(back);
        else window.location.href = langUrl("/login") + "?redirect=" + encodeURIComponent(back);
      });
    }

    function setBusy(b) { busy = b; sendBtn.disabled = b; }

    async function ask(text) {
      text = String(text || "").trim();
      if (!text || busy) return;
      root.classList.remove("is-empty"); // 进入会话布局:transcript 撑开 + 输入框吸底
      if (intro) intro.style.display = "none";
      if (chips) chips.style.display = "none";
      setBusy(true);

      addTurn("user").querySelector(".ai-bubble").textContent = text;
      messages.push({ role: "user", content: reportTask(text) });

      var aiTurn = addTurn("ai");
      var stepsEl = aiTurn.querySelector(".ai-steps");
      var updatedChipEl = aiTurn.querySelector(".ai-updated-chip");
      var primaryCardsEl = aiTurn.querySelector("[data-ai-primary-cards]");
      var primaryListEl = aiTurn.querySelector("[data-ai-primary-list]");
      var relatedSectionEl = aiTurn.querySelector(".ai-related");
      var relatedListEl = aiTurn.querySelector("[data-ai-related-list]");
      var mdEl = aiTurn.querySelector(".ai-md");
      var raw = "", seen = {}, pending = [], related = [], flushed = false, busyLine = null, usedGetCompany = false, primaryCard = null;

      // 工作过程轨迹:全程只保留一行「进行中」spinner,文案随当前动作更新——即使一轮里并行跑多个工具
      // (真实日志里 get_company/company_relations 就经常同轮并行)也不会累积出多行。
      function showBusy(textv) {
        if (!busyLine) {
          busyLine = document.createElement("div");
          busyLine.className = "ai-step is-active";
          busyLine.innerHTML = '<span class="ai-step__ic"><span class="ai-spin"></span></span><span class="ai-step__tx"></span>';
          stepsEl.appendChild(busyLine);
        }
        busyLine.querySelector(".ai-step__tx").textContent = textv;
        scrollDown();
      }
      function hideBusy() { if (busyLine) { busyLine.remove(); busyLine = null; } }
      showBusy(L("think")); // 提交后立即给反馈

      // 精确命中公司的「更新时间」徽标:放在正文顶部,独立于 .ai-md(避免被后续 delta 整段重写冲掉)
      function showUpdatedChip(card) {
        if (!updatedChipEl || updatedChipEl.dataset.shown === "1") return;
        var d = updatedBadge(card);
        if (!d) return;
        updatedChipEl.querySelector("span").textContent = d;
        updatedChipEl.hidden = false;
        updatedChipEl.dataset.shown = "1";
      }

      // 列表渲染(幂等):任何终止路径(done/流断/异常)都保证出结果。
      // 主匹配结果按命中数量分三档:1 家→精简单行(报告已在正文);2-5 家→选择卡片;>5 家→密集列表。
      // 关联公司(company_relations,与「匹配到哪家」是两个问题)单独成一个可隐藏的分区。
      // 排序标准统一:不管主匹配结果还是关联公司,经营状态正常的都排前面,异常(解散/清算等)垫底。
      function flushList() {
        if (flushed) return; flushed = true; hideBusy();
        var sortedPending = sortByStatus(pending);
        if (sortedPending.length >= 2 && sortedPending.length <= 5) renderCards(primaryCardsEl, sortedPending);
        else if (sortedPending.length) renderList(primaryListEl, sortedPending);
        if (related.length) { relatedSectionEl.hidden = false; renderList(relatedListEl, sortByStatus(related)); }
        scrollDown();
      }

      try {
        var resp = await fetch("/api/site/v1/ai/chat", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: LANG, messages: messages })
        });
        if (!resp.ok || !resp.body) throw new Error("http " + resp.status);

        var reader = resp.body.getReader(), dec = new TextDecoder(), buf = "";
        var ev = null;
        while (true) {
          var r = await reader.read(); if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            var block = buf.slice(0, idx); buf = buf.slice(idx + 2);
            ev = null; var data = "";
            block.split("\n").forEach(function (ln) {
              if (ln.indexOf("event:") === 0) ev = ln.slice(6).trim();
              else if (ln.indexOf("data:") === 0) data += ln.slice(5).trim();
            });
            if (!ev || !data) continue;
            var d; try { d = JSON.parse(data); } catch (e) { continue; }
            if (ev === "meta") { applyQuota(d); }        // 每次提问后端回报本次后的剩余额度(会员为 unlimited)
            else if (ev === "status") { if (d.tool === "get_company") usedGetCompany = true; showBusy(statusText(d.tool)); }       // 工具开始:更新同一行文案
            else if (ev === "step") { if (d.tool === "get_company" && d.card && d.card.jpno) primaryCard = d.card; showBusy(L("writing")); } // 工具完成:仍是同一行,切到「整理中」;更新徽标先记下数据,等正文真正开始再露出(见 delta 分支)
            else if (ev === "cards") {
              (d.cards || []).forEach(function (c) {
                if (!c.jpno || seen[c.jpno]) return;
                seen[c.jpno] = 1;
                if (d.tool === "company_relations") related.push(c); else pending.push(c); // 关联公司走独立分区,不与主匹配结果混排
              });
            }
            else if (ev === "delta") { hideBusy(); if (primaryCard) showUpdatedChip(primaryCard); raw += (d.text || ""); mdEl.innerHTML = renderMd(raw); scrollDown(); } // 答案开始:此时才让更新徽标露出,不在正文出现前单独悬空
            else if (ev === "gate") { hideBusy(); showGate(aiTurn); quota.remaining = 0; renderQuota(); }
            else if (ev === "error") { hideBusy(); if (!raw && !pending.length) mdEl.innerHTML = '<p>' + esc(L("err")) + '</p>'; }
            else if (ev === "done") { flushList(); if (raw && (usedGetCompany || pending.length === 1)) showReportActions(aiTurn); }
          }
        }
      } catch (e) {
        hideBusy();
        if (!raw && !pending.length) mdEl.innerHTML = '<p>' + esc(L("err")) + '</p>';
      } finally {
        flushList(); // 兜底:流以任何方式结束都渲染缓存的公司列表
        if (raw || pending.length) {
          var disc = aiTurn.querySelector(".ai-turn-disclaimer");
          if (disc) { disc.textContent = L("src"); disc.hidden = false; }
        }
        // 仅当精准命中 1 家公司才提供「生成报告」;广泛关键词(0 或多家)按普通对话处理
        if (raw && (usedGetCompany || pending.length === 1)) showReportActions(aiTurn);
        if (raw) messages.push({ role: "assistant", content: raw });
        setBusy(false);
        input.focus();
      }
    }

    function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 168) + "px"; }
    input.addEventListener("input", autoGrow);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); var v = input.value; input.value = ""; autoGrow(); ask(v); }
    });
    sendBtn.addEventListener("click", function () { var v = input.value; input.value = ""; autoGrow(); ask(v); });
    if (chips) chips.addEventListener("click", function (e) {
      var b = e.target.closest("[data-ai-suggest]"); if (!b) return;
      ask(b.textContent.trim());
    });

    // 静态文案三语化(ui-strings 未灌译时的兜底,保证 th/zh 子域名不露英文;en 用模板原文)
    var CHROME = {
      zh: {
        title: "AI 企业尽调分析",
        desc: "输入泰国公司名称或注册号,BizThai AI 会自动解析企业并直接给出风险评分、信用评分、行业位置、董事关系、关联企业和合作建议。",
        ph: "输入公司名称或注册号…",
        disc: "AI 可能出错,重要信息请以官方公司登记为准。数据来源:DBD DataWarehouse+。",
        chips: ["Siam Commercial Bank Public Company Limited", "Charoen Pokphand Foods Public Company Limited", "分析一家春武里物流公司", "查食品出口企业的竞争对手"]
      },
      th: {
        title: "วิเคราะห์บริษัทด้วย AI",
        desc: "กรอกชื่อบริษัทไทยหรือเลขทะเบียน BizThai AI จะค้นหาบริษัทและให้ข้อสรุปทันที: ความเสี่ยง เครดิตธุรกิจ ตำแหน่งในอุตสาหกรรม กรรมการ บริษัทที่เกี่ยวข้อง และคำแนะนำการร่วมมือ",
        ph: "กรอกชื่อบริษัทหรือเลขทะเบียน…",
        disc: "AI อาจผิดพลาดได้ โปรดตรวจสอบข้อมูลสำคัญกับทะเบียนบริษัทอย่างเป็นทางการ · ข้อมูล: DBD DataWarehouse+",
        chips: ["Siam Commercial Bank Public Company Limited", "Charoen Pokphand Foods Public Company Limited", "วิเคราะห์บริษัทโลจิสติกส์ในชลบุรี", "หาคู่แข่งของบริษัทส่งออกอาหาร"]
      }
    };
    (function localizeChrome() {
      var c = CHROME[LANG];
      if (!c) return;
      var h1 = root.querySelector("[data-ai-intro] h1"); if (h1) h1.textContent = c.title;
      var p = root.querySelector("[data-ai-intro] p"); if (p) p.textContent = c.desc;
      if (input) input.setAttribute("placeholder", c.ph);
      var disc = root.querySelector(".ai-disclaimer"); if (disc) disc.textContent = c.disc;
      var sg = root.querySelectorAll("[data-ai-suggest]");
      for (var i = 0; i < sg.length && i < c.chips.length; i++) sg[i].textContent = c.chips[i];
    }());

    // 进页面即拉取一次剩余免费提问次数,展示在输入框下方(不消耗次数)
    loadQuota();

    // 从首页/页脚 starter-ai 搜索框带过来的 ?q= 自动发问
    var pq = new URLSearchParams(window.location.search).get("q");
    if (pq && pq.trim()) ask(pq.trim());
  }());
