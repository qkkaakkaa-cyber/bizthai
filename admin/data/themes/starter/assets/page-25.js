(function () {
    /* ── Tab switching ── */
    var btns = document.querySelectorAll('.bz-tabs__btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = this.getAttribute('aria-controls');
        btns.forEach(function (b) { b.setAttribute('aria-selected', 'false'); });
        this.setAttribute('aria-selected', 'true');
        document.querySelectorAll('.bz-tabs__panel').forEach(function (p) {
          if (p.id === target) { p.removeAttribute('hidden'); }
          else { p.setAttribute('hidden', ''); }
        });
      });
    });

    /* ── Registered-capital: masked teaser ── */
    (function () {
      var CAP_LABEL = { zh: '注册资金', th: 'ทุนจดทะเบียน', en: 'Capital' };
      function _nl(v) { v = String(v || '').toLowerCase(); if (v.indexOf('zh') === 0) return 'zh'; if (v.indexOf('th') === 0) return 'th'; return 'en'; }
      var _lg = _nl(document.documentElement.lang);
      if (_lg === 'en') _lg = _nl((window.location.pathname.split('/').filter(Boolean)[0] || ''));
      if (_lg === 'en') _lg = _nl(new URLSearchParams(window.location.search).get('lang'));
      var _label = CAP_LABEL[_lg] || CAP_LABEL.en;
      document.querySelectorAll('.bz-co__cap[data-cap]').forEach(function (el) {
        var raw = el.getAttribute('data-cap');
        var n = Number(raw);
        if (raw === '' || raw == null || !isFinite(n) || n === 0) { el.remove(); return; }
        el.textContent = _label + ' ฿' + n.toLocaleString('en-US');
      });
    }());

    /* ── 随机展示：每个列表从预取池中随机洗牌抽 8 个 ── */
    document.querySelectorAll('.bz-cos').forEach(function (cos) {
      var items = Array.prototype.slice.call(cos.querySelectorAll('.bz-co'));
      if (items.length <= 8) return;
      for (var i = items.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var t = items[i]; items[i] = items[j]; items[j] = t;
      }
      items.forEach(function (el, idx) { el.style.display = idx < 8 ? '' : 'none'; });
      for (var k = 7; k >= 0; k--) { cos.insertBefore(items[k], cos.firstChild); }
    });

    /* ── "最近有更新"徽标:只标已展示的最多 8 个(重排后就是每个 .bz-cos 的前 8 个 .bz-co),
       不能标全部预取池(部分列表预取了上百条,徽标接口有批量上限,标不展示的是浪费)。首页
       卡片位小,用极简圆点(kind='dot'),不用带文字的完整标签。
       theme.js 是 <script defer>,比这段内联脚本晚执行(defer 在解析完成后、DOMContentLoaded
       前才跑)——这里此刻拿 window.__bizthaiApplyRecentlyUpdatedTo 必然还是 undefined,
       必须等 DOMContentLoaded(此时 defer 脚本已跑完)才能拿到,不能直接调用。 */
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.__bizthaiApplyRecentlyUpdatedTo) return;
      document.querySelectorAll('.bz-cos').forEach(function (cos) {
        var visible = Array.prototype.slice.call(cos.querySelectorAll('.bz-co'), 0, 8);
        visible.forEach(function (el) {
          if (!el.querySelector('[data-updated-slot]')) {
            var nm = el.querySelector('.bz-co__nm');
            var slot = document.createElement('span');
            slot.setAttribute('data-updated-slot', '');
            if (nm && nm.parentNode) nm.parentNode.insertBefore(slot, nm.nextSibling);
            else el.appendChild(slot);
          }
        });
        window.__bizthaiApplyRecentlyUpdatedTo(visible, 'dot');
      });
    });

    /* ── Language swap ── */
    function normLang(v) { v = String(v || '').toLowerCase(); if (v.indexOf('zh') === 0) return 'zh'; if (v.indexOf('th') === 0) return 'th'; return 'en'; }
    var lang = normLang(document.documentElement.lang);
    if (lang === 'en') { var s = (window.location.pathname.split('/').filter(Boolean)[0] || ''); lang = normLang(s); }
    if (lang === 'en') { lang = normLang(new URLSearchParams(window.location.search).get('lang')); }
    if (lang === 'en') return;
    var attr = lang === 'zh' ? 'data-zh' : 'data-th';
    document.querySelectorAll('[data-en]').forEach(function (el) {
      var v = el.getAttribute(attr) || el.getAttribute('data-en');
      if (v) el.textContent = v;
    });
  }());

  /* ── Subscribe form ── */
  (function () {
    var form = document.getElementById('footer-sub-form');
    if (!form) return;
    var statusEl = document.getElementById('footer-sub-status');
    var btn = form.querySelector('button[type="submit"]');
    function showStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = 'market-footer__subscribe-status is-visible market-footer__subscribe-status--' + type;
    }
    function hideStatus() {
      if (!statusEl) return;
      statusEl.className = 'market-footer__subscribe-status';
      statusEl.textContent = '';
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = document.getElementById('footer-subscribe-email');
      var email = emailInput ? emailInput.value.trim() : '';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showStatus('Please enter a valid email address.', 'err'); return; }
      hideStatus();
      if (btn) btn.setAttribute('aria-busy', 'true');
      fetch('/api/site/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: email })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (r.ok) { showStatus(r.data.message || 'Subscribed! Thank you.', 'ok'); form.reset(); }
          else { showStatus(r.data.message || r.data.error || 'Something went wrong. Please try again.', 'err'); }
        })
        .catch(function () { showStatus('Network error. Please try again.', 'err'); })
        .finally(function () { if (btn) btn.removeAttribute('aria-busy'); });
    });
  }());
