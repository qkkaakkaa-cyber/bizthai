(function () {
    function normLoc(v) { v = String(v || '').toLowerCase(); if (v.indexOf('zh') === 0) return 'zh'; if (v.indexOf('th') === 0) return 'th'; return 'en'; }
    function activeLang() {
      var l = normLoc(document.documentElement.lang); if (l !== 'en') return l;
      var s = window.location.pathname.split('/').filter(Boolean)[0] || ''; var p = normLoc(s); if (p !== 'en') return p;
      return normLoc(new URLSearchParams(window.location.search).get('lang')) || 'en';
    }
    var LANG = activeLang();

    /* ── Industry Hub ── */
    (function () {
      var root = document.querySelector('[data-xihub]');
      if (!root || root.dataset.ready) return;
      root.dataset.ready = 'true';

      var ICOPY = {
        en: { kicker: 'Industry Classification', title: 'Explore Companies by Industry', desc: 'Browse all registered Thai businesses across major TSIC industry categories, sourced from official DBD DataWarehouse+ records.', viewAll: 'View all industries' },
        th: { kicker: 'ประเภทอุตสาหกรรม', title: 'ค้นหาบริษัทตามประเภทอุตสาหกรรม', desc: 'เรียกดูธุรกิจไทยที่จดทะเบียนทั้งหมดตามประเภทอุตสาหกรรม TSIC หลัก ข้อมูลจาก DBD DataWarehouse+ อย่างเป็นทางการ', viewAll: 'ดูอุตสาหกรรมทั้งหมด' },
        zh: { kicker: '行业分类', title: '按行业分类探索泰国企业', desc: '按照TSIC主要行业分类浏览所有泰国注册企业，数据来源于DBD DataWarehouse+官方记录。', viewAll: '查看所有行业' }
      };
      var ic = ICOPY[LANG] || ICOPY.en;
      root.querySelector('[data-xihub-kicker]').textContent = ic.kicker;
      root.querySelector('[data-xihub-title]').textContent = ic.title;
      root.querySelector('[data-xihub-desc]').textContent = ic.desc;
      var va = root.querySelector('[data-xihub-viewall]');
      if (va) { var sp = va.querySelector('span'); if (sp) sp.textContent = ic.viewAll; }

      var IC_COLOR = { 'tsic-a':'#2d9e4f','tsic-b':'#7c4b1e','tsic-c':'#e07b21','tsic-d':'#e3b40a','tsic-e':'#1ca5d4','tsic-f':'#e05c36','tsic-g':'#2563eb','tsic-h':'#0ca678','tsic-i':'#f43f5e','tsic-j':'#7c3aed','tsic-k':'#16a34a','tsic-l':'#db2777','tsic-m':'#0891b2','tsic-n':'#64748b','tsic-p':'#8b5cf6','tsic-q':'#e11d48','tsic-r':'#d97706','tsic-s':'#6366f1','tsic-t':'#059669' };
      var LETTER = { 'tsic-a':'A','tsic-b':'B','tsic-c':'C','tsic-d':'D','tsic-e':'E','tsic-f':'F','tsic-g':'G','tsic-h':'H','tsic-i':'I','tsic-j':'J','tsic-k':'K','tsic-l':'L','tsic-m':'M','tsic-n':'N','tsic-p':'P','tsic-q':'Q','tsic-r':'R','tsic-s':'S','tsic-t':'T' };
      var COUNT_LABEL = { en: ' co.', th: ' บ.', zh: ' 家' };
      var grid = root.querySelector('[data-xihub-grid]');

      function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
      function termUrl(t) { return t.permalink || ('/t/industry/' + encodeURIComponent(t.slug || '')); }
      function fmtCount(n) { if (n === '' || n == null) return ''; return Number(n).toLocaleString() + (COUNT_LABEL[LANG] || ' co.'); }

      function renderGrid(terms) {
        grid.innerHTML = terms.map(function (t) {
          var color = IC_COLOR[t.slug] || '#7901b2';
          var letter = LETTER[t.slug] || '●';
          var raw = t.child_count != null ? t.child_count : (t.children_count != null ? t.children_count : '');
          var countHtml = raw !== '' ? '<span class="xihub-card__count">' + esc(fmtCount(raw)) + '</span>' : '';
          var arrSvg = '<svg class="xihub-card__arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
          return '<a class="xihub-card" href="' + esc(termUrl(t)) + '" style="--ic:' + color + '">'
            + '<span class="xihub-card__badge">' + esc(letter) + '</span>'
            + '<span class="xihub-card__body"><span class="xihub-card__name">' + esc(t.name) + '</span>' + countHtml + '</span>'
            + arrSvg
            + '</a>';
        }).join('');
      }

      fetch('/api/site/v1/taxonomies/industry/terms?limit=500', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          var items = (payload && payload.data && Array.isArray(payload.data.items)) ? payload.data.items : [];
          var roots = items.filter(function (t) { return t.parent_id == null || t.parent_id === undefined; })
            .sort(function (a, b) { return (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || String(a.name || '').localeCompare(String(b.name || '')); });
          if (!roots.length) { grid.innerHTML = ''; return; }
          renderGrid(roots);
        })
        .catch(function () { grid.innerHTML = ''; });
    }());

    /* ── Province Hub ── */
    (function () {
      var sec = document.querySelector('[data-xphub]');
      if (!sec) return;

      var PCOPY = {
        en: { kicker: 'Hot Investment Provinces', title: "Thailand's Top Investment Provinces", desc: "Key provinces driving Thailand's economy — from Bangkok's financial centre to the EEC industrial corridor and beyond.", viewAll: 'Browse all provinces' },
        th: { kicker: 'จังหวัดลงทุนยอดนิยม', title: 'จังหวัดยอดนิยมสำหรับการลงทุนในไทย', desc: 'จังหวัดสำคัญที่ขับเคลื่อนเศรษฐกิจไทย ตั้งแต่ศูนย์กลางการเงินกรุงเทพฯ ไปจนถึงระเบียงอุตสาหกรรม EEC', viewAll: 'เรียกดูทุกจังหวัด' },
        zh: { kicker: '热门投资府', title: '泰国热门投资府', desc: '推动泰国经济的核心府——从曼谷金融中心到EEC工业走廊及其他地区。', viewAll: '浏览所有府' }
      };
      var pc = PCOPY[LANG] || PCOPY.en;
      sec.querySelector('[data-xphub-kicker]').textContent = pc.kicker;
      sec.querySelector('[data-xphub-title]').textContent = pc.title;
      sec.querySelector('[data-xphub-desc]').textContent = pc.desc;
      var va = sec.querySelector('[data-xphub-viewall]');
      if (va) { var sp = va.querySelector('span'); if (sp) sp.textContent = pc.viewAll; }

      var attr = LANG === 'th' ? 'data-th' : LANG === 'zh' ? 'data-zh' : 'data-en';
      sec.querySelectorAll('[data-en]').forEach(function (el) {
        var v = el.getAttribute(attr) || el.getAttribute('data-en');
        if (v != null) el.textContent = v;
      });
    }());
  }());
