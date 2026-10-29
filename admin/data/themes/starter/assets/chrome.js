/* ===== header 外壳脚本:原本内联在 partial 里(每页重传且阻塞解析),抽成 defer 外链。
   defer 保证按下列顺序执行,且都在 DOMContentLoaded 之前、DOM 已完整时运行。 ===== */

/* ---------- header 脚本 1 ---------- */

	      (function () {
	        var panel = document.querySelector("[data-bizthai-categories]");
	        if (!panel || panel.dataset.ready === "true") return;
	        panel.dataset.ready = "true";
	
	        var trigger = document.querySelector("[data-category-trigger]");
	        var sidebar = panel.querySelector("[data-category-sidebar]");
	        var content = panel.querySelector("[data-category-content]");
	        var triggerLabel = document.querySelector("[data-i18n-all-categories]");
	        var CATEGORY_ICONS = {
          "tsic-a": '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 21V9"></path><path d="M12 9C12 6 10 3.6 7.4 3 7.4 6 9.4 8.4 12 9Z"></path><path d="M12 9c0-3 2-5.4 4.6-6C16.6 6 14.6 8.4 12 9Z"></path><path d="M12 14.5c-2.4-.3-4.1-1.9-4.4-4.2 2.4.3 4.1 1.9 4.4 4.2Z"></path><path d="M12 14.5c2.4-.3 4.1-1.9 4.4-4.2-2.4.3-4.1 1.9-4.4 4.2Z"></path></svg>',
          "tsic-b": '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 4h12l3 5-9 11L3 9z"></path><path d="M3 9h18"></path><path d="M9 4 6 9l6 11"></path><path d="M15 4l3 5-6 11"></path></svg>',
          "tsic-c": '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 21V11l5 3V11l5 3V8l5 3v10z"></path><path d="M3 21h18"></path><path d="M7 21v-3h3v3"></path></svg>',
          "tsic-d": '<svg viewBox="0 0 24 24" focusable="false"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg>',
          "tsic-e": '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"></path><path d="M9.3 13.5a2.7 2.7 0 0 0 5.4 0"></path></svg>',
          "tsic-f": '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 18h18v2.2H3z"></path><path d="M5 18a7 7 0 0 1 14 0"></path><path d="M9 8.6V6h6v2.6"></path><path d="M12 5.2V8"></path></svg>',
          "tsic-g": '<svg viewBox="0 0 24 24" focusable="false"><path d="M5 8h14l-1.2 12H6.2z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path></svg>',
          "tsic-h": '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h11v9H3z"></path><path d="M14 9h4l3 3v3h-7z"></path><circle cx="7" cy="18" r="1.8"></circle><circle cx="17" cy="18" r="1.8"></circle></svg>',
          "tsic-i": '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 3v5a2 2 0 0 0 4 0V3"></path><path d="M8 8v13"></path><path d="M16 3c-1.6 0-2.6 2.1-2.6 5 0 2 1 3.1 2.6 3.1V21"></path></svg>',
          "tsic-j": '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="9" r="2"></circle><path d="M12 11v10"></path><path d="M7.8 4.8a8 8 0 0 0 0 8.4"></path><path d="M16.2 4.8a8 8 0 0 1 0 8.4"></path><path d="M5.2 2.5a11.5 11.5 0 0 0 0 13"></path><path d="M18.8 2.5a11.5 11.5 0 0 1 0 13"></path></svg>',
          "tsic-k": '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M14.6 9.2a2.5 2 0 0 0-5 .4c0 2.6 5.2 1.2 5.2 3.8a2.5 2 0 0 1-5.2.4"></path><path d="M12 6.8v10.4"></path></svg>',
          "tsic-l": '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 21V8l8-4 8 4v13"></path><path d="M3.5 21h17"></path><path d="M9.5 21v-5h5v5"></path><path d="M9 9.5h2M13 9.5h2M9 13h2M13 13h2"></path></svg>',
          "tsic-m": '<svg viewBox="0 0 24 24" focusable="false"><path d="M9.5 3h5"></path><path d="M10.5 3v6l-5 9.2A1.5 1.5 0 0 0 6.8 20.5h10.4a1.5 1.5 0 0 0 1.3-2.3L13.5 9V3"></path><path d="M8 15h8"></path></svg>',
          "tsic-n": '<svg viewBox="0 0 24 24" focusable="false"><path d="M6 3h9l4 4v14H6z"></path><path d="M15 3v4h4"></path><path d="M9 13h6"></path><path d="M9 17h4"></path></svg>',
          "tsic-p": '<svg viewBox="0 0 24 24" focusable="false"><path d="M2 8.5 12 4l10 4.5L12 13z"></path><path d="M6 10.5V15c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5"></path><path d="M22 8.5V14"></path></svg>',
          "tsic-q": '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 20s-7-4.6-7-10.2A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 2.8C19 15.4 12 20 12 20Z"></path><path d="M12 9.2v3.6"></path><path d="M10.2 11h3.6"></path></svg>',
          "tsic-r": '<svg viewBox="0 0 24 24" focusable="false"><path d="M9 18V5l10-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>',
          "tsic-s": '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 3.5v2.6M12 17.9v2.6M4.6 12H2M22 12h-2.6M6.3 6.3 4.7 4.7M19.3 19.3l-1.6-1.6M6.3 17.7l-1.6 1.6M19.3 4.7l-1.6 1.6"></path></svg>',
          "tsic-t": '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 21V9l8-5 8 5v12"></path><path d="M3.5 21h17"></path><circle cx="12" cy="11" r="1.6"></circle><path d="M9 21v-3a3 3 0 0 1 6 0v3"></path></svg>',
          "_default": '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5"></rect></svg>'
        };
        function svgFor(slug) { return CATEGORY_ICONS[slug] || CATEGORY_ICONS._default; }
        function itemIcon(term) { return '<span class="bizthai-category-item__icon" aria-hidden="true">' + svgFor(term && term.slug) + '</span>'; }
        function cardIcon(term) { return '<span class="bizthai-category-card__icon" aria-hidden="true">' + svgFor(term && term.slug) + '</span>'; }
	        var moreIcon = '<span class="bizthai-category-more__icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z"></path></svg></span>';
	        var closeTimer = null;
	        var childrenByParent = new Map();
	        var rootTerms = [];
	        var currentPrefix = "";
	        var currentCopy = null;

	        function escapeHtml(value) {
	          return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
	            .replace(/'/g, "&#39;");
	        }

	        function termInitial(value) {
	          var text = String(value || "").trim();
	          return Array.from(text)[0] || "";
	        }

	        function cardInitialIcon(term) {
	          return '<span class="bizthai-category-card__icon" aria-hidden="true"><span class="bizthai-category-card__initial">' + escapeHtml(termInitial(term && term.name)) + '</span></span>';
	        }

	        function normalizeLocale(value) {
	          value = String(value || "").trim().toLowerCase();
	          if (value === "zh" || value === "zh-cn" || value === "zh_cn" || value.indexOf("zh") === 0) return "zh-CN";
	          if (value === "th" || value.indexOf("th") === 0) return "th";
	          if (value === "en" || value.indexOf("en") === 0) return "en";
	          return "";
	        }
	
	        function activeLocale() {
	          return window.location.hostname === 'en.bizthai.com' ? 'en' : 'th';
	        }
	
	        function localePrefix(locale) {
	          if (locale === "zh-CN") return "";
	          if (locale === "th") return "";
	          return "";
	        }

        function slugify(value) {
          return String(value == null ? "" : value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        }

        // 大类 term.slug 是内部码 tsic-a..tsic-t(无 tsic-o),与 resolver/src/server.js 的
        // TSIC_SECTION_ENGSLUG 同一份映射——必须用这张静态表,不能现算 slugify(term.name)。
        // 之前直接 slugify(term.name) 在英文页面凑巧能用(name 恰好是英文),但这个接口按
        // ?lang= 请求参数会把 name 翻译成中文/泰文(如"农林牧渔"),slugify 对非拉丁字符
        // 全部替换成"-"再掐头去尾,整段折叠成空字符串,拼出 /industry-.html 这种死链。
        var TSIC_SECTION_ENGSLUG = {
          a: "agriculture-forestry-fishing", b: "mining-quarrying", c: "manufacturing",
          d: "electricity-gas-supply", e: "water-supply-waste-management", f: "construction",
          g: "wholesale-retail-trade", h: "transportation-storage", i: "accommodation-food-service",
          j: "information-communication", k: "finance-insurance", l: "real-estate",
          m: "professional-scientific-technical", n: "administrative-support-service", p: "education",
          q: "health-social-work", r: "arts-entertainment-recreation", s: "other-service-activities",
          t: "household-employment-activities"
        };

        function termUrl(term, prefix) {
          // 分类下拉面板统一收敛到扁平 SEO URL 形式 industry-{slug}.html,不再用 /t/industry/{slug} 这种形式;
          // 大类走 TSIC_SECTION_ENGSLUG 静态映射(与语言无关,稳定);细类 term.slug 本就是扁平 slug。
          var isTop = term.parent_id === null || term.parent_id === undefined;
          var topSec = isTop ? String(term.slug || "").replace(/^tsic-/, "").toLowerCase() : "";
          var flatSlug = isTop ? (TSIC_SECTION_ENGSLUG[topSec] || slugify(term.name)) : (term.slug || "");
          return prefix + "/industry-" + encodeURIComponent(flatSlug) + ".html";
        }

        // 细类 TSIC 数字编码:slug 尾部(如 …-01112)→ 01112;大类不展示编码。
        function termCode(term) {
          if (!term || term.parent_id === null || term.parent_id === undefined) return "";
          var slug = String(term.slug || "").toLowerCase();
          var digits = slug.match(/-(\d{4,5})$/);
          if (digits) {
            var code = digits[1];
            return code.length === 4 ? ("0" + code) : code;
          }
          if (term.sort_order != null) {
            var n = String(term.sort_order);
            if (/^\d{4,5}$/.test(n)) return n.length === 4 ? ("0" + n) : n;
          }
          return "";
        }

	        function labels(locale) {
	          if (locale === "th") {
	            return {
	              all: "หมวดหมู่ทั้งหมด",
	              browse: "ดูหมวดหมู่",
	              business: "หมวดหมู่ธุรกิจ",
	              loading: "กำลังโหลดหมวดหมู่ธุรกิจ...",
              none: "ไม่พบหมวดหมู่",
              noChildren: "ไม่พบหมวดย่อย",
              unavailable: "ไม่สามารถโหลดหมวดหมู่ได้",
              viewAll: "ดูทั้งหมด"
            };
          }
	          if (locale === "zh-CN") {
	            return {
	              all: "所有类目",
	              browse: "浏览分类",
	              business: "业务分类",
	              loading: "正在加载业务分类...",
              none: "暂无分类",
              noChildren: "暂无二级分类",
              unavailable: "分类暂不可用",
              viewAll: "查看全部"
            };
	          }
	          return {
	            all: "All Categories",
	            browse: "Browse category",
	            business: "Business categories",
	            loading: "Loading business categories...",
            none: "No categories found.",
            noChildren: "No subcategories found.",
            unavailable: "Categories unavailable.",
            viewAll: "View all"
          };
        }

	        function sortTerms(a, b) {
	          return (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || String(a.name || "").localeCompare(String(b.name || ""));
	        }
	
	        function openPanel() {
	          if (closeTimer) window.clearTimeout(closeTimer);
	          closeTimer = null;
	          panel.classList.add("is-open");
	          if (trigger) trigger.setAttribute("aria-expanded", "true");
	        }
	
	        function closePanel() {
	          panel.classList.remove("is-open");
	          if (trigger) trigger.setAttribute("aria-expanded", "false");
	        }
	
	        function closePanelSoon() {
	          if (closeTimer) window.clearTimeout(closeTimer);
	          closeTimer = window.setTimeout(closePanel, 120);
	        }

	        function setupActiveSwitch(container, selector) {
	          if (!container) return;
	          var activeItem = container.querySelector(selector + ".is-active") || container.querySelector(selector);
	          var items = Array.from(container.querySelectorAll(selector));
	
	          function setActive(item) {
	            if (!item) return;
	            items.forEach(function (entry) {
	              entry.classList.toggle("is-active", entry === item);
	            });
	          }
	
	          items.forEach(function (item) {
	            item.addEventListener("mouseenter", function () {
	              setActive(item);
	            });
	            item.addEventListener("focus", function () {
	              setActive(item);
	            });
	            item.addEventListener("click", function () {
	              activeItem = item;
	              setActive(item);
	            });
	          });
	
	          container.addEventListener("mouseleave", function () {
	            setActive(activeItem);
	          });
	          container.addEventListener("focusout", function (event) {
	            if (container.contains(event.relatedTarget)) return;
	            setActive(activeItem);
	          });
	        }

        async function fetchAllTerms(prefix, locale) {
          var terms = [];
          var limit = 500;
          var offset = 0;
          var total = Infinity;
          var guard = 0;

          while (offset < total && guard < 8) {
            var response = await fetch(prefix + "/api/site/v1/taxonomies/industry/terms?limit=" + limit + "&offset=" + offset + "&lang=" + encodeURIComponent(locale || "en"), {
              headers: { "Accept": "application/json" }
            });
            if (!response.ok) throw new Error("Category request failed");
            var payload = await response.json();
            var data = payload && payload.data ? payload.data : {};
            var items = Array.isArray(data.items) ? data.items : [];
            terms = terms.concat(items);
            total = Number(data.total || terms.length);
            if (!items.length || terms.length >= total) break;
            offset += items.length;
            guard += 1;
          }

          return terms;
        }

	        function renderSection(term) {
	          var children = childrenByParent.get(String(term.id)) || [];
		          var cards = children.map(function (child) {
		            var code = termCode(child);
		            return '<a class="bizthai-category-card" href="' + escapeHtml(termUrl(child, currentPrefix)) + '">' +
		              '<span class="bizthai-category-card__body">' +
		              (code ? '<span class="bizthai-category-card__code">' + escapeHtml(code) + '</span>' : '') +
		              '<span class="bizthai-category-card__name">' + escapeHtml(child.name) + '</span>' +
		              '</span>' +
		              '</a>';
		          }).join("");
	          var more = '<a class="bizthai-category-more" href="' + escapeHtml(termUrl(term, currentPrefix)) + '">' +
	            moreIcon +
	            '<span class="bizthai-category-card__name">' + escapeHtml(currentCopy.viewAll) + '</span>' +
	            '</a>';
	          var empty = children.length ? "" : '<p class="bizthai-category-status">' + escapeHtml(currentCopy.noChildren) + '</p>';
	
	          content.innerHTML = '<section class="bizthai-category-section" data-category-section="' + escapeHtml(term.id) + '">' +
	            '<div class="bizthai-category-section__head">' +
	            '<h2>' + escapeHtml(term.name) + '</h2>' +
	            '<a href="' + escapeHtml(termUrl(term, currentPrefix)) + '">' + escapeHtml(currentCopy.browse) + '</a>' +
	            '</div>' +
	            '<div class="bizthai-category-grid">' + cards + '</div>' +
	            empty +
	            '</section>';
	          content.scrollTop = 0;
	        }
	
	        function activate(id) {
	          sidebar.querySelectorAll("[data-category-root]").forEach(function (item) {
	            item.classList.toggle("is-active", item.dataset.categoryRoot === String(id));
	          });
	
	          var term = rootTerms.find(function (item) {
	            return String(item.id) === String(id);
	          });
	          if (term) renderSection(term);
	        }
	
	        function renderTerms(terms, prefix, copy) {
	          childrenByParent = new Map();
	          rootTerms = terms.filter(function (term) {
	            return term.parent_id === null || term.parent_id === undefined;
	          }).sort(sortTerms);

          terms.forEach(function (term) {
            if (term.parent_id === null || term.parent_id === undefined) return;
            var key = String(term.parent_id);
            if (!childrenByParent.has(key)) childrenByParent.set(key, []);
            childrenByParent.get(key).push(term);
          });

          childrenByParent.forEach(function (items) {
            items.sort(sortTerms);
          });

	          if (!rootTerms.length) {
	            sidebar.innerHTML = "";
	            content.innerHTML = '<section class="bizthai-category-section"><div class="bizthai-category-section__head"><h2>' + escapeHtml(copy.business) + '</h2></div><p class="bizthai-category-status">' + escapeHtml(copy.none) + '</p></section>';
	            return;
	          }
	
	          sidebar.innerHTML = rootTerms.map(function (term, index) {
	            var children = childrenByParent.get(String(term.id)) || [];
	            return '<a class="bizthai-category-item' + (index === 0 ? " is-active" : "") + '" href="' + escapeHtml(termUrl(term, prefix)) + '" data-category-root="' + escapeHtml(term.id) + '">' +
	              itemIcon(term) +
              '<span class="bizthai-category-item__text">' + escapeHtml(term.name) + '</span>' +
              '<span class="bizthai-category-item__count">' + escapeHtml(children.length || term.child_count || "") + '</span>' +
	              '</a>';
	          }).join("");
	          renderSection(rootTerms[0]);
	        }
	
	        sidebar.addEventListener("mouseover", function (event) {
	          var item = event.target.closest("[data-category-root]");
	          if (!item) return;
	          activate(item.dataset.categoryRoot);
	        });
	
	        sidebar.addEventListener("focusin", function (event) {
	          var item = event.target.closest("[data-category-root]");
	          if (!item) return;
	          activate(item.dataset.categoryRoot);
	        });
	
		        if (trigger) {
		          trigger.addEventListener("mouseenter", openPanel);
		          trigger.addEventListener("focus", openPanel);
	          trigger.addEventListener("mouseleave", closePanelSoon);
	          trigger.addEventListener("click", function (event) {
	            event.preventDefault();
	            if (panel.classList.contains("is-open")) {
	              closePanel();
	            } else {
	              openPanel();
	            }
	          });
	        }
	
	        panel.addEventListener("mouseenter", openPanel);
	        panel.addEventListener("mouseleave", closePanelSoon);
	        panel.addEventListener("focusin", openPanel);
	        panel.addEventListener("focusout", function (event) {
	          if (panel.contains(event.relatedTarget) || (trigger && trigger.contains(event.relatedTarget))) return;
	          closePanelSoon();
	        });
		        document.addEventListener("keydown", function (event) {
		          if (event.key === "Escape") closePanel();
		        });
	
	
		        var locale = activeLocale();
	        var prefix = localePrefix(locale);
	        var copy = labels(locale);
	        currentPrefix = prefix;
	        currentCopy = copy;
	        if (triggerLabel) triggerLabel.textContent = copy.all;
	        panel.setAttribute("aria-label", copy.business);
	        sidebar.setAttribute("aria-label", copy.business);
	        content.innerHTML = '<section class="bizthai-category-section"><div class="bizthai-category-section__head"><h2>' + escapeHtml(copy.business) + '</h2></div><p class="bizthai-category-status">' + escapeHtml(copy.loading) + '</p></section>';
	        fetchAllTerms(prefix, locale)
	          .then(function (terms) { renderTerms(terms, prefix, copy); })
	          .catch(function () {
            sidebar.innerHTML = "";
            content.innerHTML = '<section class="bizthai-category-section"><div class="bizthai-category-section__head"><h2>' + escapeHtml(copy.business) + '</h2></div><p class="bizthai-category-status">' + escapeHtml(copy.unavailable) + '</p></section>';
          });
      }());

/* ---------- header 脚本 2 ---------- */

    /* ---------- 0. 语言 cookie 只跟随当前 URL,绝不自动跳转 ----------
       URL 路径前缀是语言唯一真相:/zh|/th → 对应语言;无前缀 → 英文。
       不再根据浏览器 Accept-Language / navigator.language / 旧 cookie 把英文页踢到 /zh。
       用户用语言切换器显式选择时,仍由下方 go() 写 cookie 并跳转。 */
    (function () {
      var first = (window.location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
      var lang = (first === "zh" || first === "th") ? first : "en";
      document.cookie = "bizthai_lang=" + lang + "; Path=/; Max-Age=31536000; SameSite=Lax" + (window.location.protocol === "https:" ? "; Secure" : "");
    }());

    /* ---------- 0.5 站内链接语言前缀化:当前在 /zh|/th 下时,给干净的页面路由链接补同前缀,
       点击后不再掉回无前缀位、被上面的跳转 guard 二次弹回(消除闪烁)。
       刻意排除:.html(公司详情/扁平行业页由 resolver + theme.js 各自处理,且会被客户端美化重写,
       不掺和以免时序冲突)、/theme-assets|/api 等资源接口、已带语言前缀、协议相对外链。 */
    (function () {
      var seg = (window.location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
      var lang = (seg === "zh" || seg === "th") ? seg : "";
      if (!lang) return;  // 英文规范位无前缀,链接本就正确,不动
      function run() {
        var links = document.querySelectorAll('a[href^="/"]');
        Array.prototype.forEach.call(links, function (a) {
          var href = a.getAttribute("href");
          if (!href || href.charAt(0) !== "/" || href.charAt(1) === "/") return;
          if (/^\/(zh|th|en)(\/|$)/.test(href)) return;                 // 已带语言前缀
          if (/^\/(theme-assets|api|wp-|admin)(\/|$)/.test(href)) return; // 资源/接口/后台
          if (/\.html($|[?#])/.test(href)) return;                       // 详情页/扁平页,交给各自机制
          // 索引型 /sitemap.xml 要进 /th|/zh 前缀;其它 .xml(分片/xsl)保持根路径
          if (href === "/sitemap.xml") { a.setAttribute("href", "/" + lang + "/sitemap.xml"); return; }
          if (/\.xml($|[?#])/.test(href)) return;
          a.setAttribute("href", href === "/" ? "/" + lang : "/" + lang + href);
        });
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
      else run();
    }());

    (function () {
      var header = document.querySelector(".bizthai-header");
      if (!header || header.dataset.navReady === "true") return;
      header.dataset.navReady = "true";

      var topBar = header.querySelector(".market-header__top");
      var nav = header.querySelector(".market-mainnav");
      var collapse = header.querySelector("[data-mobile-panel]");
      var burger = header.querySelector("[data-mobile-toggle]");
      var backdrop = header.querySelector("[data-mobile-backdrop]");
      var closeBtn = header.querySelector("[data-mobile-close]");
      var trigger = header.querySelector("[data-category-trigger]");
      var panel = header.querySelector("[data-bizthai-categories]");
      var mqMobile = window.matchMedia("(max-width: 860px)");

      /* ---------- 1. 当前页高亮 ---------- */
      function cleanPath(p) {
        p = (p || "").split("?")[0].split("#")[0];
        p = p.replace(/^\/(zh|th|en)(?=\/|$)/, "");
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p || "/";
      }

      var here = cleanPath(window.location.pathname);
      var links = nav ? Array.prototype.slice.call(nav.querySelectorAll("a")) : [];
      var activeLink = null;
      var bestLen = -1;
      links.forEach(function (a) {
        var raw = a.getAttribute("href") || "";
        if (!raw || raw.charAt(0) === "#") return;
        var ap;
        try { ap = cleanPath(new URL(a.href, window.location.origin).pathname); }
        catch (e) { ap = cleanPath(raw); }
        if (ap === "/") return;
        if (here === ap || here.indexOf(ap + "/") === 0) {
          if (ap.length > bestLen) { bestLen = ap.length; activeLink = a; }
        }
      });
      links.forEach(function (a) { a.classList.toggle("is-active", a === activeLink); });

      /* ---------- 2. 主导航滑动指示条 ---------- */
      var indicator = null;
      if (nav) {
        indicator = document.createElement("span");
        indicator.className = "market-mainnav__indicator";
        indicator.setAttribute("aria-hidden", "true");
        nav.appendChild(indicator);
      }

      function moveIndicator(target, animate) {
        if (!indicator) return;
        if (!target || mqMobile.matches) { indicator.style.opacity = "0"; return; }
        if (!animate) indicator.style.transitionDuration = "0s";
        indicator.style.transform = "translateX(" + target.offsetLeft + "px)";
        indicator.style.width = target.offsetWidth + "px";
        indicator.style.opacity = "1";
        if (!animate) {
          void indicator.offsetWidth;
          indicator.style.transitionDuration = "";
        }
      }
      function resetIndicator(animate) { moveIndicator(activeLink, animate); }

      links.forEach(function (a) {
        a.addEventListener("mouseenter", function () { moveIndicator(a, true); });
        a.addEventListener("focus", function () { moveIndicator(a, true); });
      });
      if (nav) {
        nav.addEventListener("mouseleave", function () { resetIndicator(true); });
        nav.addEventListener("focusout", function (e) {
          if (nav.contains(e.relatedTarget)) return;
          resetIndicator(true);
        });
      }

      /* ---------- 3. 分类弹层定位变量(移动端用) ---------- */
      function syncCatTop() {
        if (!topBar) return;
        var b = topBar.getBoundingClientRect().bottom;
        header.style.setProperty("--market-cat-top", Math.max(0, Math.round(b) + 6) + "px");
      }
      syncCatTop();
      window.addEventListener("scroll", syncCatTop, { passive: true });

      /* 初次/字体/缩放后重新定位指示条 */
      function relayout() { resetIndicator(false); syncCatTop(); }
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { resetIndicator(false); });
      } else {
        resetIndicator(false);
      }
      window.addEventListener("load", function () { resetIndicator(false); });
      window.addEventListener("resize", relayout);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { resetIndicator(false); });
      }

      /* ---------- 4. 移动端抽屉 ---------- */
      function openDrawer() {
        if (collapse) collapse.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-open");
        if (burger) burger.setAttribute("aria-expanded", "true");
        document.body.classList.add("nav-open");
      }
      function closeDrawer() {
        if (collapse) collapse.classList.remove("is-open");
        if (panel) panel.classList.remove("is-open");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
        if (backdrop) backdrop.classList.remove("is-open");
        if (burger) burger.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
      }
      function toggleDrawer() {
        if (collapse && collapse.classList.contains("is-open")) closeDrawer();
        else openDrawer();
      }

      if (burger) burger.addEventListener("click", toggleDrawer);
      if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
      if (backdrop) backdrop.addEventListener("click", closeDrawer);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeDrawer();
      });

      /* 点击抽屉内链接后收起;分类触发器则切换到全宽分类浮层 */
      if (collapse) {
        collapse.addEventListener("click", function (e) {
          if (!mqMobile.matches) return;
          var link = e.target.closest("a");
          if (!link) return;
          if (link === trigger) {
            if (collapse) collapse.classList.remove("is-open");
            syncCatTop();
            if (backdrop) backdrop.classList.add("is-open");
            document.body.classList.add("nav-open");
            /* 防止触摸离开触发的自动收起,确保浮层保持打开 */
            window.setTimeout(function () {
              if (panel) panel.classList.add("is-open");
            }, 160);
            return;
          }
          closeDrawer();
        });
      }

      /* ---------- 5. 首页英雄区搜索:tab 模式 ---------- */
      (function initHomeSearchTabs() {
        var form = header.querySelector("[data-home-search]");
        if (!form) return;
        var input = form.querySelector("#market-search-input");
        var hidden = form.querySelector("[data-search-mode-value]");
        var tabs = Array.prototype.slice.call(form.querySelectorAll("[data-search-mode]"));
        var hint = form.querySelector("[data-search-mode-hint]");
        if (!input || !tabs.length) return;

        function cookieLang() {
          var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
          return m ? decodeURIComponent(m[1]) : "";
        }
        function locale() {
          var first = window.location.pathname.split("/").filter(Boolean)[0] || "";
          var l = (first || cookieLang() || document.documentElement.lang || "en").toLowerCase();
          if (l.indexOf("zh") === 0) return "zh";
          if (l.indexOf("th") === 0) return "th";
          return "en";
        }

        var COPY = {
          en: {
            tabs: { ai: "AI Mode", companies: "Companies", owners: "Owners" },
            ph: {
              ai: "Ask AI about a Thai company, owner or sector",
              companies: "Company name, registration number or industry keyword",
              owners: "Owner, director or shareholder name"
            },
            hint: { ai: "AI chat mode", companies: "Traditional company search", owners: "Traditional owner search" }
          },
          zh: {
            tabs: { ai: "AI 模式", companies: "搜公司", owners: "搜老板" },
            ph: {
              ai: "描述你要找的公司、老板或行业",
              companies: "输入公司名称 / 注册号 / 行业关键词",
              owners: "输入老板、董事或股东姓名"
            },
            hint: { ai: "AI 对话模式", companies: "传统公司搜索", owners: "传统老板搜索" }
          },
          th: {
            tabs: { ai: "โหมด AI", companies: "ค้นหาบริษัท", owners: "ค้นหาเจ้าของ" },
            ph: {
              ai: "อธิบายบริษัท เจ้าของ หรืออุตสาหกรรมที่ต้องการ",
              companies: "ชื่อบริษัท เลขทะเบียน หรือคำค้นอุตสาหกรรม",
              owners: "ชื่อเจ้าของ กรรมการ หรือผู้ถือหุ้น"
            },
            hint: { ai: "โหมดแชต AI", companies: "ค้นหาบริษัทแบบปกติ", owners: "ค้นหาเจ้าของแบบปกติ" }
          }
        };
        var lc = locale();
        var copy = COPY[lc] || COPY.en;
        var routeLang = (function () {
          var first = window.location.pathname.split("/").filter(Boolean)[0] || "";
          first = first.toLowerCase();
          if (first === "zh" || first === "th" || first === "en") return first;
          var saved = locale();
          return (saved === "zh" || saved === "th" || saved === "en") ? saved : "";
        }());
        function langUrl(path) {
          path = path || "/";
          if (!routeLang) return path;
          return "/" + routeLang + (path.charAt(0) === "/" ? path : "/" + path);
        }

        var MODE_COLORS = {
          ai:        'var(--market-primary)',
          companies: '#1d6ef5',
          owners:    '#0ca678'
        };

        function modeFromTab(tab) {
          return tab && tab.getAttribute("data-search-mode") || "ai";
        }

        function tabByMode(mode) {
          for (var i = 0; i < tabs.length; i += 1) {
            if (modeFromTab(tabs[i]) === mode) return tabs[i];
          }
          return null;
        }

        function syncRoute(mode) {
          if (mode === "owners") {
            form.setAttribute("action", langUrl("/business-owner-shareholder-leads"));
            if (hidden) hidden.disabled = true;
          } else if (mode === "companies") {
            form.setAttribute("action", langUrl("/search"));
            if (hidden) {
              hidden.disabled = false;
              hidden.value = "companies";
            }
          } else {
            form.setAttribute("action", langUrl("/ai"));
            if (hidden) hidden.disabled = true;
          }
        }

        function selectMode(mode, refocusInput) {
          if (!tabByMode(mode)) mode = "ai";
          tabs.forEach(function (tab) {
            var on = modeFromTab(tab) === mode;
            tab.classList.toggle("is-active", on);
            tab.setAttribute("aria-selected", on ? "true" : "false");
            tab.setAttribute("tabindex", on ? "0" : "-1");
          });
          form.style.setProperty("--search-color", MODE_COLORS[mode] || MODE_COLORS.ai);
          var ph = copy.ph[mode] || copy.ph.ai;
          if (ph) input.setAttribute("placeholder", ph);
          if (hint) hint.textContent = copy.hint[mode] || copy.hint.ai;
          if (hidden) hidden.value = mode;
          syncRoute(mode);
          if (refocusInput) input.focus();
        }

        tabs.forEach(function (tab) {
          var mode = modeFromTab(tab);
          var textEl = tab.querySelector("[data-search-tab-text]");
          if (textEl && copy.tabs[mode]) textEl.textContent = copy.tabs[mode];
          tab.addEventListener("click", function () { selectMode(mode, true); });
          tab.addEventListener("keydown", function (e) {
            var key = e.key || "";
            if (key !== "ArrowLeft" && key !== "Left" && key !== "ArrowRight" && key !== "Right" && key !== "Home" && key !== "End") return;
            e.preventDefault();
            var idx = tabs.indexOf(tab);
            if (key === "Home") idx = 0;
            else if (key === "End") idx = tabs.length - 1;
            else idx += (key === "ArrowLeft" || key === "Left") ? -1 : 1;
            if (idx < 0) idx = tabs.length - 1;
            if (idx >= tabs.length) idx = 0;
            tabs[idx].focus();
            selectMode(modeFromTab(tabs[idx]), false);
          });
        });

        form.addEventListener("submit", function () {
          var active = form.querySelector(".market-search__tab.is-active");
          syncRoute(modeFromTab(active));
        });

        selectMode("ai", false);
      }());

      /* ---------- 6. 语言切换:下拉按钮(选后写 Cookie 并跳路径语言) ---------- */
      (function initLangSelect() {
        var wrap = header.querySelector("[data-lang-select]");
        if (!wrap) return;
        var toggle = wrap.querySelector("[data-lang-toggle]");
        var menu = wrap.querySelector("[data-lang-menu]");
        var opts = Array.prototype.slice.call(wrap.querySelectorAll("[data-lang]"));
        var flagEl = wrap.querySelector("[data-lang-flag]");
        var codeEl = wrap.querySelector("[data-lang-code]");
        if (!toggle || !menu || !opts.length) return;

        function norm(v) {
          v = (v == null ? "" : String(v)).trim().toLowerCase();
          if (v.indexOf("zh") === 0) return "zh";
          if (v.indexOf("th") === 0) return "th";
          if (v.indexOf("en") === 0) return "en";
          return "";
        }
        function pathLang() {
          var first = window.location.pathname.split("/").filter(Boolean)[0] || "";
          return norm(first);
        }
        function langPath(lang) {
          var parts = window.location.pathname.split("/").filter(Boolean);
          if (norm(parts[0])) parts.shift();
          var rest = parts.join("/");
          return "/" + lang + "/" + (rest ? rest : "");
        }
        function queryWithoutLang() {
          var params = new URLSearchParams(window.location.search);
          params.delete("lang");
          var s = params.toString();
          return s ? "?" + s : "";
        }
        function saveLang(lang) {
          document.cookie = "bizthai_lang=" + encodeURIComponent(lang) + "; Path=/; Max-Age=31536000; SameSite=Lax" + (window.location.protocol === "https:" ? "; Secure" : "");
        }
        function cookieLang() {
          var m = document.cookie.match(/(?:^|;\s*)bizthai_lang=([^;]+)/);
          return m ? norm(decodeURIComponent(m[1])) : "";
        }
        function queryLang() {
          return norm(new URLSearchParams(window.location.search).get("lang"));
        }
        // 与 theme.js 的 activeLocale() 保持同一优先级链:路径前缀 → cookie → document.documentElement.lang → ?lang= → 默认 en。
        var current = window.location.hostname === 'en.bizthai.com' ? 'en' : 'th';

        opts.forEach(function (li) {
          var on = li.getAttribute("data-lang") === current;
          li.classList.toggle("is-active", on);
          li.setAttribute("aria-selected", on ? "true" : "false");
          if (on) {
            if (flagEl) flagEl.textContent = li.getAttribute("data-flag") || flagEl.textContent;
            if (codeEl) codeEl.textContent = li.getAttribute("data-code") || codeEl.textContent;
          }
        });

        function isLangOpen() { return menu.classList.contains("is-open"); }
        function openLang() { menu.classList.add("is-open"); toggle.setAttribute("aria-expanded", "true"); }
        function closeLang() { menu.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
        function go(lang) {
          lang = norm(lang) || "en";
          saveLang(lang);
          // 始终留在当前 host,按语言前缀跳转(本地与线上路由一致,见 cms_sites.fallback_locales 的 zh 修复)。
          var host = lang === 'en' ? 'en.bizthai.com' : 'bizthai.com';
          var parts = window.location.pathname.split("/").filter(Boolean);
          if (norm(parts[0])) parts.shift();
          var rest = parts.join("/");
          var href = ('/' + rest) + queryWithoutLang();
          window.location.href = window.location.protocol + "//" + host + href + window.location.hash;
        }

        toggle.addEventListener("click", function (e) {
          e.preventDefault();
          if (isLangOpen()) closeLang(); else openLang();
        });
        opts.forEach(function (li) {
          li.addEventListener("click", function () { go(li.getAttribute("data-lang")); });
          li.addEventListener("mouseenter", function () {
            opts.forEach(function (o) { o.classList.remove("is-highlight"); });
            li.classList.add("is-highlight");
          });
        });
        document.addEventListener("click", function (e) {
          if (isLangOpen() && !wrap.contains(e.target)) closeLang();
        });
        document.addEventListener("keydown", function (e) {
          if (e.key === "Escape") closeLang();
        });
      }());

      /* 切回桌面端时复位抽屉与指示条 */
      function onMqChange() {
        if (!mqMobile.matches) {
          closeDrawer();
          resetIndicator(false);
        } else if (indicator) {
          indicator.style.opacity = "0";
        }
      }
      if (mqMobile.addEventListener) mqMobile.addEventListener("change", onMqChange);
      else if (mqMobile.addListener) mqMobile.addListener(onMqChange);

      /* ---------- 6.5 英雄区标语三语化(模板里是硬编码英文,无 wc-t/字典覆盖) ---------- */
      (function initHeroDesc() {
        var descEl = header.querySelector("[data-hero-desc]");
        if (!descEl) return;
        var BRAND = '<span class="bizthai-hero-desc-brand">BizThai.com</span>';
        var DESC = {
          en: "Come to " + BRAND + " and use AI to discover your next Thai partner.",
          zh: "来 " + BRAND + ",用 AI 发现你的下一个泰国合作伙伴。",
          th: "มาที่ " + BRAND + " และใช้ AI เพื่อค้นหาพันธมิตรไทยรายต่อไปของคุณ"
        };
        var lc = (function () {
          function norm(v) {
            v = (v == null ? "" : String(v)).trim().toLowerCase();
            if (v.indexOf("zh") === 0) return "zh";
            if (v.indexOf("th") === 0) return "th";
            if (v.indexOf("en") === 0) return "en";
            return "";
          }
          // 与全站一致:只认路径前缀 / html lang,不在英文 URL 上按 cookie 刷中文。
          var seg = norm(window.location.pathname.split("/").filter(Boolean)[0] || "");
          if (seg) return seg;
          return norm(document.documentElement.lang) || "en";
        }());
        descEl.innerHTML = DESC[lc] || DESC.en;
      }());

      /* ---------- 7. 英雄区企业计数器(老虎机) ---------- */
      (function initCompanyCounter() {
        var counterEl = header.querySelector("[data-company-counter]");
        if (!counterEl) return;
        var slotsEl = counterEl.querySelector("[data-counter-slots]");
        var preEl   = counterEl.querySelector("[data-counter-pre]");
        var postEl  = counterEl.querySelector("[data-counter-post]");
        var ariaEl  = counterEl.querySelector("[data-counter-aria]");
        if (!slotsEl) return;

        var LABELS = {
          zh: { pre: "当前已收录", post: "家企业" },
          th: { pre: "ลงทะเบียนแล้ว", post: "บริษัท" },
          en: { pre: "", post: " Companies Listed" }
        };
        // 语言判定与全站统一:路径前缀 → html lang。无前缀英文 URL 不读 cookie。
        var lc = (function () {
          function norm(v) {
            v = (v == null ? "" : String(v)).trim().toLowerCase();
            if (v.indexOf("zh") === 0) return "zh";
            if (v.indexOf("th") === 0) return "th";
            if (v.indexOf("en") === 0) return "en";
            return "";
          }
          var seg = norm(window.location.pathname.split("/").filter(Boolean)[0] || "");
          if (seg) return seg;
          return norm(document.documentElement.lang) || "en";
        }());
        var lbl = LABELS[lc] || LABELS.en;
        if (preEl)  preEl.textContent  = lbl.pre;
        if (postEl) postEl.textContent = lbl.post;

        function buildAndAnimate(total) {
          var str = String(total);
          var len = str.length;
          var html = "";

          for (var i = 0; i < len; i++) {
            var d = parseInt(str[i], 10);
            var fromRight = len - 1 - i;
            var strip = "";
            for (var rep = 0; rep < 4; rep++) {
              for (var dd = 0; dd < 10; dd++) {
                strip += '<span class="bizthai-counter-slot__digit">' + dd + "</span>";
              }
            }
            html += '<span class="bizthai-counter-slot" data-d="' + d + '"><span class="bizthai-counter-slot__strip">' + strip + "</span></span>";
            if (fromRight > 0 && fromRight % 3 === 0) {
              html += '<span class="bizthai-counter-sep" aria-hidden="true">,</span>';
            }
          }

          slotsEl.innerHTML = html;
          if (ariaEl) ariaEl.textContent = total.toLocaleString() + " " + lbl.post;

          window.requestAnimationFrame(function () {
            var slotEls = Array.prototype.slice.call(slotsEl.querySelectorAll(".bizthai-counter-slot"));
            slotEls.forEach(function (slot, idx) {
              var strip = slot.querySelector(".bizthai-counter-slot__strip");
              var digit = parseInt(slot.getAttribute("data-d"), 10);
              var h = slot.offsetHeight;
              if (!h) return;

              /* 初始停在正确数字(第3组 digit D=index 20+D),不要停在 0——否则中文首屏
                 会短暂闪出「0,000,000家企业」。再滚到第4组同数字完成老虎机动效。 */
              strip.style.transition = "none";
              strip.style.transform = "translateY(" + (-(20 + digit) * h) + "px)";
              void strip.offsetHeight; /* 强制 reflow */

              /* 延迟启动,目标:第4组 digit D(index=30+D) */
              (function (s, d, h, i) {
                setTimeout(function () {
                  s.style.transition = "transform " + (0.72 + i * 0.045) + "s cubic-bezier(0.19,1,0.22,1)";
                  s.style.transform = "translateY(" + (-(30 + d) * h) + "px)";
                }, 100 + i * 55);
              }(strip, digit, h, idx));
            });
          });
        }

        fetch("/api/site/v1/models/thaicompany/aggregate", {
          headers: { "Accept": "application/json" }
        }).then(function (r) {
          if (!r.ok) throw new Error("failed");
          return r.json();
        }).then(function (payload) {
          var groups = payload && payload.data && payload.data.groups;
          var total = groups && groups[0] && Number(groups[0].count);
          if (!total || total < 1) return;
          buildAndAnimate(total);
        }).catch(function () { /* 静默失败,保留占位符 */ });
      }());

    }());

/* ---------- header 脚本 3 ---------- */

    /* ===== 顶部快捷搜索:按钮 -> 全宽下拉搜索框 ===== */
    (function () {
      var header = document.querySelector(".bizthai-header");
      if (!header) return;
      var btn = header.querySelector("[data-quick-search-toggle]");
      var dropdown = header.querySelector("[data-quick-search-panel]");
      if (!btn || !dropdown || btn.dataset.toggleReady === "true") return;
      btn.dataset.toggleReady = "true";
      var input = dropdown.querySelector("[data-quick-search-input]");
      var collapse = header.querySelector("[data-mobile-panel]");
      var backdrop = header.querySelector("[data-mobile-backdrop]");
      var resPanel = header.querySelector("[data-resources-panel]");
      var resTrigger = header.querySelector("[data-resources-trigger]");
      var mq = window.matchMedia("(max-width: 860px)");

      function closeResources() {
        if (resPanel) resPanel.classList.remove("is-open");
        if (resTrigger) resTrigger.setAttribute("aria-expanded", "false");
      }
      function isOpen() { return dropdown.classList.contains("is-open"); }
      function open() {
        closeResources();
        dropdown.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        window.setTimeout(function () { try { if (input) input.focus(); } catch (e) {} }, 80);
      }
      function close() {
        dropdown.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
        if (mq.matches) {
          if (backdrop) backdrop.classList.remove("is-open");
          document.body.classList.remove("nav-open");
        }
      }

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        if (isOpen()) { close(); return; }
        if (mq.matches) {
          /* 移动端:收起抽屉,以全宽浮层展示 */
          e.stopPropagation();
          if (collapse) collapse.classList.remove("is-open");
          if (backdrop) backdrop.classList.add("is-open");
          document.body.classList.add("nav-open");
          window.setTimeout(open, 160);
          return;
        }
        open();
      });

      if (backdrop) backdrop.addEventListener("click", function () { if (isOpen()) close(); });

      document.addEventListener("click", function (e) {
        if (!isOpen()) return;
        if (dropdown.contains(e.target) || btn.contains(e.target)) return;
        close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isOpen()) {
          close();
          try { btn.focus(); } catch (err) {}
        }
      });
    }());

    /* ===== 信任与合规 超级菜单(已隐藏;恢复 HTML 触发器+面板后取消本段注释即可) =====
    (function () {
      var header = document.querySelector(".bizthai-header");
      if (!header) return;
      var trigger = header.querySelector("[data-resources-trigger]");
      var panel = header.querySelector("[data-resources-panel]");
      if (!trigger || !panel || trigger.dataset.ready === "true") return;
      trigger.dataset.ready = "true";
      var collapse = header.querySelector("[data-mobile-panel]");
      var backdrop = header.querySelector("[data-mobile-backdrop]");
      var mq = window.matchMedia("(max-width: 860px)");
      var closeTimer = null;

      function open() {
        if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = null; }
        var sd = header.querySelector("[data-quick-search-panel]");
        var st = header.querySelector("[data-quick-search-toggle]");
        if (sd) sd.classList.remove("is-open");
        if (st) st.setAttribute("aria-expanded", "false");
        panel.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
      function close() {
        panel.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        if (mq.matches) {
          if (backdrop) backdrop.classList.remove("is-open");
          document.body.classList.remove("nav-open");
        }
      }
      function closeSoon() {
        if (closeTimer) window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(close, 130);
      }
      function isOpen() { return panel.classList.contains("is-open"); }

      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        if (mq.matches) {
          e.stopPropagation();
          if (collapse) collapse.classList.remove("is-open");
          if (backdrop) backdrop.classList.add("is-open");
          document.body.classList.add("nav-open");
          window.setTimeout(open, 160);
          return;
        }
        if (isOpen()) close(); else open();
      });

      trigger.addEventListener("mouseenter", function () { if (!mq.matches) open(); });
      trigger.addEventListener("mouseleave", function () { if (!mq.matches) closeSoon(); });
      trigger.addEventListener("focus", function () { if (!mq.matches) open(); });
      panel.addEventListener("mouseenter", function () { if (!mq.matches) open(); });
      panel.addEventListener("mouseleave", function () { if (!mq.matches) closeSoon(); });
      panel.addEventListener("focusin", function () { if (!mq.matches) open(); });
      panel.addEventListener("focusout", function (e) {
        if (mq.matches) return;
        if (panel.contains(e.relatedTarget) || trigger.contains(e.relatedTarget)) return;
        closeSoon();
      });

      panel.addEventListener("click", function (e) {
        if (e.target.closest("a")) close();
      });

      if (backdrop) backdrop.addEventListener("click", function () { if (isOpen()) close(); });

      document.addEventListener("click", function (e) {
        if (isOpen() && !panel.contains(e.target) && !trigger.contains(e.target)) close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && isOpen()) { close(); try { trigger.focus(); } catch (err) {} }
      });
    }());
    ===== */
