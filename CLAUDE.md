# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

DBD Thai 是一个面向泰国市场的企业信息查询项目(数据来源统一标注为 DBD DataWarehouse+)。三段式数据流:

**抓取(独立泰国 VPS)→ 后端统一处理(admin/WooCMS)→ WooCMS 服务端模板渲染(starter 主题)→ 前台展示(bizthai.com)**

> **架构现状(2026-06-21):前端已从「前后端分离」改为「WooCMS 模板渲染」。**
> 现在前台由 WooCMS 用 `starter` 主题在服务端直接渲染(物理路径 `admin/data/themes/starter/`),与后台同域 `bizthai.com`。
> `web/` 已改为占位警告目录。旧 React SPA 已归档到 `_archive/react-web-deprecated-20260629/`,仅可作为历史 UI 参考 —— **不要再改 `web/` 或归档 React 项目做线上功能**。新前端工作一律改 starter 主题模板。详见下文「前端」两节与记忆 `web-template-rendering`。
>
> **补充(2026-07-01):详情类 `.html` 页面(公司详情、董事个人页等)不是单靠 WooCMS 模板渲染的。** `single-thaicompany.html` 等模板里 business/profile/directors/contact 这几块只是空 `<div data-panel="...">`——WooCMS 自带的 `<wc-data>/<wc-out>/<wc-html>` 标签**不支持**在单条目详情页里对 `meta.raw.committees`(董事数组)、`financialStatements`(多年财务)这类嵌套数组做循环展开(实测 `{{range}}` 会被静默吞掉,不生效)。这几块真正的服务端渲染是 `resolver`(见下文「slug 映射机制」)在请求时读 `meta.raw` 拼 HTML 正则塞回空 div 做到的;**resolver 不在请求路径里,这几块就会退化成纯客户端 `theme.js` fetch 渲染,爬虫抓不到**。
>
> **补充(2026-07-02):生产已完成一轮 blue-green(v1→v2)基础设施切换。** 本仓库(`/www/wwwroot/bizthai/dbd-thai/`)是当前存活的 v2;旧 v1(工作目录 `/data/projects/dbd-thai/`,systemd 服务名不带 `-v2` 后缀)已停机,磁盘上仅作为回滚保留。后端监听端口整体从 8083/8084/8085/8186 段(v1)迁移到 9183/9184/9185/9186/9187 段(v2),公网入口也从 `dbdadmin.woocms.org` 换成了 `bizthai.com`(+ `www.`/`th.`/`cn.` 子域)与 `www2.bizthai.com`。下文若看到 `dbdadmin.woocms.org`、80xx/81xx 端口、或不带 `-v2` 的服务名,均为 v1 时代的历史记录,**不是当前生产状态**——准确信息见「部署架构」「后端(admin/)」两节。

## 目录结构

- `admin/` — **后端 / 管理端 + 前台**(WooCMS),部署域名 `bizthai.com`(见下文「部署架构」的 v1→v2 说明)。同一个 WooCMS 既是管理控制台(`/admin`),也是**当前的前台**:用 `admin/data/themes/starter/` 主题在服务端渲染公开站(`/`、`/companies`、`/company/{jpNo}`、`/search` …)。
- `web/` — **【占位警告目录,勿改】**。旧前端 React/Vite SPA 已移动到 `_archive/react-web-deprecated-20260629/`,仅供历史 UI 参考。线上前台只改 `admin/data/themes/starter/`。
- `_archive/react-web-deprecated-20260629/` — **【已弃用】旧前端 / 用户端**(前后端分离方案)。Vite + React 18 + TypeScript + Tailwind 的 SPA。不要作为线上源码修改。
- `logs/` — nginx 访问与错误日志(`dbdadmin.*` / `dbdweb.*`),按域名分别记录。

## 部署架构

本机是托管多个 WooCMS 实例的多租户服务器,nginx 按域名分发。**当前生产跑的是 v2**(blue-green 切换于 2026-07-02 完成,详见上文架构现状补充):

| 目录 | 角色 | 监听(v2,当前) | systemd(v2,当前) |
|------|------|------|------|
| `admin/` | 后端 / 管理端 **+ 前台(模板渲染)**(WooCMS) | `127.0.0.1:9183` | `dbdadmin-woocms-v2.service` |
| `resolver/` | 公司详情 SSR / slug 解析 / SEO sitemap | `127.0.0.1:9186` | `dbdresolver-v2.service` |
| `analytics/` | 商业环境分析 sidecar | `127.0.0.1:9184` | `dbdanalytics-v2.service` |
| `directors/` | 董事按证件号反查 sidecar | `127.0.0.1:9185` | `dbddirectors-v2.service` |
| `ai/` | AI 对话助手 sidecar | `127.0.0.1:9187` | `dbdai-v2.service` |
| `web/` | **【占位警告目录】**旧 React SPA 已移走 | 不部署 | — |
| `_archive/react-web-deprecated-20260629/` | **【已弃用】**旧前端(React SPA,静态历史代码) | 不作为线上前台修改入口 | — |

公网入口是 `bizthai.com`(+ `www.`/`th.`/`cn.` 子域)与 `www2.bizthai.com`,nginx 配置在 `/www/server/panel/vhost/nginx/bizthai.com.conf` / `www2.bizthai.com.conf`。上表 5 个后端服务已全部在这两个 vhost 里反代到位(`/api/site/v1/analytics|directors|ai/` 各有独立 location + 限流 zone,`*.html`/`/companies`/`/t/` 等按「缓存机制」节的表分流),不需要再额外补路由。

`dbdadmin.woocms.org` 是 v1 时代留下的域名,DNS 仍经 Cloudflare 代理,但本机 nginx 已经没有任何 vhost 匹配这个域名(全量 grep `/www/server/panel/vhost/nginx/` 无 `woocms.org` 命中)——它是否还指向本机、Cloudflare 侧是否还转发到这里,需要人工去 Cloudflare 后台核实,**不要再假设它是当前入口**。

旧版 v1(工作目录 `/data/projects/dbd-thai/`,即 `DEPLOYMENT.md` 里描述的部署包目标路径;服务名不带 `-v2` 后缀,端口在 8083/8084/8085/8186 段)当前处于停机状态(对应 `systemctl status` 应显示 `inactive`/`dead`),磁盘上仍保留,是 blue-green 的回滚备份,不是活跃副本,不要在这个路径下改代码。

排查线上问题时,优先查看 `logs/` 下对应域名的 nginx access / error 日志,应用日志见下文「后端(admin/)」节。

## 前台(当前:WooCMS 模板渲染 / starter 主题)

**这是当前在用的前台。** 由 WooCMS 在服务端用 `starter` 主题渲染,与后台同域 `bizthai.com`。数据层(thaicompany CPT + 三语 meta + sync 管线 + sidecar)与原前后端分离方案完全一致,只是展示层从 React SPA 换成了服务端模板。

### 主题文件(`admin/data/themes/starter/`,属主 `www-data`)

- `theme.json` — 主题清单(`code: starter`,`supports.wcData/slots`,声明全站必载的 `style.min.css` + `chrome.min.css` + `chrome.min.js` + `theme.min.js`)。
- `templates/` — 按 WooCMS 模板层级命名:`front-page.html`(首页)、`index.html`、`single-thaicompany.html`(企业详情 `/company/{jpNo}`)、`search.html`、`archive-post.html`、`single-post.html`、`404.html`、`page.html` 及 `page-1..10.html`(独立页面)。
- `partials/` — `header.html` / `footer.html`(被各模板用 `<wc-slot>` 引入)。
- `assets/` — `style.css` + `theme.js`(客户端增强:语言切换、featured 列表三语切换)、`chrome.css`/`chrome.js`(header+footer 的样式与脚本),以及只在单个模板里 `<link>`/`<script defer>` 引用的页面级资源 `home.*`(首页)、`search.*`、`ai-chat.*`(page-18)、`page-25.*`、`microsite.*`。

### 静态资源构建(2026-07-27 起)

模板里不再写内联 `<style>`/`<script>`——样式脚本一律放 `assets/` 下的源文件,由 `ops/theme-build/build.js`(esbuild)压缩成 `*.min.css`/`*.min.js`,页面引用的是产物。

**`dbdtheme-build.service` 常驻监听 `assets/`,源文件一存盘 1.5 秒后自动重建,正常情况下不需要手动做任何事。**

```bash
systemctl status dbdtheme-build          # 看守护是否在跑
journalctl -u dbdtheme-build -n 30       # 看最近几次重建/失败原因
node ops/theme-build/build.js            # 手动构建(守护挂了、或想立刻确认)
node ops/theme-build/build.js --check    # 只看体积,不落盘
node ops/theme-build/build.js --revert   # 引用改回未压缩源文件(应急回退)
```

- **只改源文件**(`style.css`/`theme.js`/`chrome.*`/`home.*`…),`*.min.*` 是生成物,直接改会被下次构建覆盖。
- 版本号取产物内容 hash 并自动写回 `theme.json` 与模板,不用再手工 bump `?v=`,也不会再出现 Cloudflare 拿着旧文件不放的问题。
- 源文件语法错误时构建失败退出,产物与引用保持原样,线上不受影响;错误行号看 journal。
- 改完想确认是否已生效:`grep -o 'style.min.css?v=[a-z0-9]*' admin/data/themes/starter/theme.json` 看 hash 有没有变。
- **注释不会进线上「查看源代码」**:CSS/JS 由 esbuild 剥除全部注释;每次构建还会清掉 `templates/`、`partials/` 里的 `<!-- -->`(含中文说明与整段注释掉的功能)。需要暂时下线、以后还要恢复的 HTML 片段放 `partials/_disabled/`,不要用注释包着留在模板里。

### 模板语法(WooCMS 自定义标签 + Go-template 取值)

- `<wc-slot name="header|footer">` — 注入 partials。
- `<wc-data source="cpt:thaicompany" limit="20" offset="0" sort="id_desc"> …循环体… <wc-empty>空态</wc-empty></wc-data>` — 列表循环;循环体内用 `{{ .slug }}`、`{{ .title }}`、`{{ .meta.<字段> }}`、`{{ .meta.i18n.th.name }}` 取当前条目值。`source` 也可是 `taxonomy:province`;`field="_count"` 取总数(如 `<wc-data source="cpt:thaicompany" field="_count">`)。
- `<wc-out path="title|meta_desc">` — 输出当前详情上下文字段(HTML 转义)。
- `<wc-html path="entry_body_html|content_html">` — 原样输出 HTML(不转义)。

### 多语言(沿用三语 meta,见 `trilingual-i18n`)

- locale 由 URL 决定:路径前缀 `/zh/`、`/th/`、`/en/`(默认 `/` = en),或 `?lang=zh|th|en`;header 里 `[data-language-switch]` 的 `<select>` 切换走 `?lang=`。
- 服务端先渲染默认语言;`theme.js` 客户端再按 `activeLocale()` 用节点上的 `data-name-th/en/zh` 等属性 + `meta.i18n.{th,en,zh}` 块替换展示文本。模板直接消费 `meta.i18n` 三语块和 `xxxzh` 扁平字段(`provincezh`/`setupobjdesczh` 等)。

### 页面模板映射（page-N.html ↔ URL ↔ 用途）

> **规则**：WooCMS 优先匹配 `page-{id}.html`，再找 `page.html`。用户说"改首页/companies/详情页…"时，直接查这张表，不要猜。

| 模板文件 | URL / 路由 | 页面用途 |
|---|---|---|
| `page-25.html` | `/`（首页） | BizThai 首页 ⭐ |
| `page-10.html` | `/companies` | All Thai Companies 列表 |
| `single-thaicompany.html` | `/company/{jpNo}` | 企业详情页 |
| `search.html` | `/search` | 搜索结果页 |
| `page-18.html` | `/ai` | BizThai AI |
| `page-16.html` | `/account` | Member center（会员中心） |
| `page-12.html` | `/login` | Sign in（登录） |
| `page-13.html` | `/register` | Create account（注册） |
| `page-14.html` | `/forgot-password` | Reset your password |
| `page-15.html` | `/reset-password` | Set a new password |
| `page-17.html` | `/verify-email` | Verify email |
| `page-1.html` | `/business-reports` | Business Reports |
| `page-2.html` | `/business-company-lookup` | Company Lookup |
| `page-3.html` | `/business-regional-ranking` | Regional Ranking |
| `page-4.html` | `/business-foreign-capital` | Foreign Capital |
| `page-5.html` | `/business-new-registrations` | New Registrations |
| `page-6.html` | `/business-industry-overview` | Industry Investment Overview |
| `page-7.html` | `/business-regional-investment-map` | Regional Investment Map |
| `page-8.html` | `/business-owner-shareholder-leads` | Owner And Shareholder Leads |
| `page-9.html` | `/business-regional-rankings-summary` | Regional Rankings Summary |
| `page-11.html` | `/regional-rankings` | Regional Rankings |
| `page-20.html` | `/about` | About BizThai |
| `page-21.html` | `/contact` | Contact us |
| `page-22.html` | `/privacy-policy` | Privacy Policy |
| `page-23.html` | `/terms` | Terms of Service |
| `page-24.html` | `/accessibility` | Accessibility |
| `page-29.html` | `/about-our-data` | About Our Data |
| `page-30.html` | `/disclaimer` | Disclaimer |
| `page-31.html` | `/business-data-usage-policy` | Business Data Usage Policy |
| `page-32.html` | `/editorial-data-integrity-policy` | Editorial & Data Integrity Policy |
| `page-33.html` | `/copyright-policy` | Copyright Policy |
| `page-34.html` | `/data-sources-policy` | Data Sources Policy |
| `page-35.html` | `/data-correction-removal-policy` | Data Correction & Removal Policy |
| `page-36.html` | `/business-verification-policy` | Business Verification Policy |
| `page-37.html` | `/sitemap` | HTML Sitemap（内容由 resolver 注入,见下文「SEO sitemap」节） |
| `partials/header.html` | 全站 | 导航 header（被所有模板 `<wc-slot name="header">` 引入） |
| `partials/footer.html` | 全站 | 页脚 footer |
| `front-page.html` | — | ⚠️ 不生效（被 page-25.html 覆盖），勿改 |
| `index.html` | — | ⚠️ 不生效（同上），勿改 |
| `taxonomy-industry-*.html` | `/industry/{slug}` | 行业 taxonomy 页（自动生成，通常不手改） |

> `page-19.html`、`page-26~28.html` 对应的 `cms_pages.id` 不存在(历史留空,不是遗漏)。新增页面走
> `cms_pages` INSERT(参照已有行结构;`cms_permalink_routes` 对 `page`/`cpt_term` 类型存的路径是历史遗留、
> 从未接入真实路由,不能当作真实 URL 来源,见下文「SEO sitemap」节的踩坑记录)+ 对应 `page-{新id}.html`。

### 编辑方式

- 模板/资源经**后台主题编辑器**管理(`/admin` 下,API `/api/admin/v1/themes/starter/files/...`);文件同时落在磁盘 `admin/data/themes/starter/`(属主 `www-data`,直接编辑磁盘也生效,WooCMS 即时渲染,无需 build)。
- 已通线上路由:`/`、`/companies`、`/company/{jpNo}`、`/search`、`/business-*`(商业分析,9 个子页)、`/regional-rankings`。**此条已于 2026-07-02 核实修正**:此前本节记录这几个路由 404/搭建中,但实测 `cms_pages` 均为 `published`、nginx 已代理到 resolver、`curl` 返回 200,且 `resolver/src/biz.js`(777 行)已完整实现省级排行表 + 资本/数量图表 + 省→县三级下钻,由 `analytics` 的 `/business/*` 系列接口供数据(见「数据层」外的 analytics 端点说明)。**仍未实现(当前 404)**:`/owners`、`/login` 等(未重新核实,沿用原记录)。

### SEO sitemap(2026-07-01 新增)

**WooCMS 原生 `/sitemap.xml` 不能用**:实测硬编码只出前 5000 条(全站发布公司 194.7 万家,覆盖不到
0.3%),公司链接还是走 `/c/thaicompany/{jpNo}` 通用 CPT 路由(不经过 resolver 的 SSR 注入,
business/profile/directors/contact 面板全是空 div,`canonical` 自我指向该野路径)——等于给搜索引擎提交
一堆重复空壳页。闭源二进制改不了,只能在 nginx 层把 `/sitemap.xml`、`/sitemap-*.xml`、`/robots.txt`、
`/sitemap` 分流到 resolver,原生端点被永久遮蔽(路由见 `ops/nginx.local.conf`)。

- **实现位置**:`resolver/src/sitemap.js`(生成逻辑)+ `resolver/src/db.js`(`countPublishedCompanies`/
  `fetchCompanyPage`/`fetchAllPages`/`fetchTaxonomyRoutes` 等查询)+ `resolver/src/industry.js`
  (`allProvinces()`)+ `resolver/src/server.js`(路由分发 + `/sitemap` 落地页的壳注入)。
- **结构**:`/sitemap.xml` 索引 → `/sitemap-pages.xml`(全部静态页,带 zh/th hreflang)+
  `/sitemap-taxonomy.xml`(industry/capital/companytype 分类页 + 77 个顶层府,共约 878 条,单文件)+
  `/sitemap-posts.xml`(cms_posts;当前 0 篇,总数 >0 时才会被索引引用,避免指向空文件)+
  `/sitemap-companies-{N}.xml`(每份 5 万条,当前 ~39 份,OFFSET 分页,末页实测约 2.8s,一次性/低频
  生成可接受,未做缓存)。`/sitemap`(page-37.html)是人读 HTML 版,不会真把 194 万公司字面列出来
  (不符合 SEO 规范也不现实),而是页面+分类导航(省/行业/资本来源/企业类型)+ 指向公司目录和
  XML sitemap 的入口。
- **URL 来源踩坑(每类都要实测验证过 200,不能假设 `cms_permalink_routes` 就是真实路由)**:
  - 公司(`entity_type=cpt_entry`):`cms_permalink_routes.path` 就是真实 flat URL,可直接用。
  - 静态页(`entity_type=page`):`cms_permalink_routes` 存的是历史遗留的 `{slug}.html` 形态,
    **从未被真实路由使用**(真实 URL 是 `/{slug}`,无 `.html`);必须改用 `cms_pages.slug` 直接拼。
  - province 分类:`cms_permalink_routes` 存的是 `/province-prov<hash>.html`,实测 **404 死链**
    (疑似批量迁移脚本的副产物)。真实友好 URL 是 `/{engslug}.html`(与 `resolveProvinceFlat` 同源,
    数据来自 analytics `/regions`),且**只有 77 个顶层府本身可用**——province 分类下 8415 个县/乡级
    子项没有独立可用 URL,已排除。
  - industry/capital/companytype:`cms_permalink_routes` 的 flat URL 顶层+子类都实测 200,可直接用。
- **production 现状不明,需要人工核实**:改动全在本地 `ops/nginx.local.conf` + `resolver/src/*.js` +
  数据库(新增 `cms_pages` id=37 及配套 `cms_page_seo`/`cms_permalink_routes` 行),不会自动同步到线上,
  流程同本文件其它「本地环境特有改动」条目——线上需要在对应 nginx 配置补同样的转发规则,并确认线上
  Postgres 也执行了同一批 SQL(或改走后台页面管理界面重新建一次这个页面)。

## 公司详情页：slug 映射机制

> **状态说明(2026-07-01)**:扁平 URL 迁移(`ops/migrate_flat_company_routes.sql`)后，WooCMS 自己也能通过原生 `cms_permalink_routes` 表解析 `/{slug}.html`，一度让人以为 resolver 可以退役、生产 nginx 曾一度绕开它直连 WooCMS——**但这会导致 business/profile/directors/contact 面板变回空 `<div>`,只能靠客户端 `theme.js` fetch 渲染,爬虫抓不到**(resolver 除了解析 slug,更重要的职责是把 `meta.raw` 拼成 HTML 正则塞回这些空 div,WooCMS 模板引擎自己做不到这件事,见上文架构现状补充)。当前本地 docker 环境已把 resolver 重新接回请求路径(`docker-compose.yml` 新增 `resolver` 服务 + `ops/nginx.local.conf` 把 `location ~ \.html$` 指向它);**生产环境的 nginx 是否也已指向 resolver、`dbdresolver` 服务是否在跑,需要人工在服务器上核实并按下面的配置对齐**,本仓库这份是本地检出,改动不会自动同步到线上。

URL 形如 `https://bizthai.com/gunkul-wind-development-51-company-limited.html`，由三层完成：

### 1. nginx → resolver(9186)

nginx 把所有 `*.html` 请求反代到 **resolver(Node, `127.0.0.1:9186`)**（`location ~ \.html$`）。**绝不能**绕过 resolver 直接打 9183(WooCMS),否则不仅英文名 slug 公司 SSR 缺失,business/profile/directors/contact 面板也会变回空 div。本地 docker 环境的等价写法见 `docker-compose.yml` 的 `resolver` 服务与 `ops/nginx.local.conf`(本地端口沿用旧编号 8183/8186,生产是 9183/9186,见「部署架构」的 v1→v2 说明)。

### 2. resolver 解析 slug → jpNo（`resolver/src/server.js`）

```
URL slug 解析优先级（resolveJpNo 函数）:
  ① 纯数字（≥6位）        → 直接用作 jpNo，零查询
  ② 尾部数字（旧 <name>-<jpNo> 形态）→ 取尾部数字作 jpNo（向后兼容）
  ③ 纯英文名 slug         → 走数据库函数索引反查（~1ms）
```

英文名 slug 公式（DB + theme.js + resolver 三处必须严格一致）：
```sql
trim(both '-' from regexp_replace(lower(meta_json->>'jpnamee'), '[^a-z0-9]+', '-', 'g'))
```
即：取 `jpnamee` 字段 → 全小写 → 连续非 `[a-z0-9]` 替换为 `-` → 去首尾 `-`。

数据库索引：**`idx_thaicompany_nameslug`**（在 `woocms.cms_content_entries` 上的函数索引），`/api/site/v1/resolver/health` 可检查索引是否存在。

### 3. resolver 内存缓存（`resolver/src/server.js`）

- slug→jpNo 结果缓存在进程内 `Map`
- TTL：**5 分钟**（`cacheTtlMs=300000`）
- 最大条目：**5000**（超出时全量清除）
- 重启 resolver（`systemctl restart dbdresolver`）可立即清缓存

### slug 解析失败排查

1. `curl http://127.0.0.1:9186/api/site/v1/resolver/health` — 看 `ok` + `cacheSize`
2. 确认 `jpnamee` 字段非空（无 jpnamee 的 stub 公司用 jpNo 当 slug，走路径①）
3. 确认 `idx_thaicompany_nameslug` 索引存在（health 接口里有 `index` 字段）

## 缓存机制

### nginx 页面缓存（`bizthai_page` zone）

配置文件：`/www/server/panel/vhost/nginx/bizthai.com.conf`

| 路由 | 缓存 TTL | 目标 |
|------|----------|------|
| `= /`（首页） | **10 分钟** | 9183（WooCMS） |
| `= /companies` | **10 分钟** | 9186（resolver,2026-07-02 由 WooCMS 改走 resolver,否则 `?page=N` 翻页不生效,见 `DEPLOYMENT.md` 6.1） |
| `~ ^/t/`（taxonomy 分类页） | **30 分钟** | 9183 |
| `~ \.html$`（公司详情等） | **不缓存** | 9186（resolver） |
| 其余 `/` | **不缓存** | 9183 |

**绕过缓存条件**：请求携带 `woocms_session` 或 `wc_session` cookie（已登录用户）、POST 请求。

`proxy_cache_background_update on`：缓存过期时先返回旧内容，后台异步刷新，不阻塞用户。

**刷新缓存**：nginx 无 purge 模块，等 TTL 自然过期，或 `nginx -s reload`（**不**清除磁盘缓存）。如需立即清，**只删目录内容，绝对不能删目录本身**：

```bash
# ✅ 正确：只清内容，保留目录
rm -rf /tmp/nginx_cache/bizthai/*

# ❌ 错误：删掉整个目录会让 nginx 无法写缓存 → 所有子站 502
# rm -rf /tmp/nginx_cache/bizthai/
```

**教训（2026-06-27）**：`rm -rf /tmp/nginx_cache/bizthai/` 删掉整个缓存根目录后，nginx 运行中不会自动重建它，写缓存时 `mkdir` 报"No such file or directory"，加上 `proxy_cache_lock on`，后续请求拿不到锁直接返回 502，导致 bizthai.com / cn.bizthai.com / th.bizthai.com 全部宕机。恢复方法：`mkdir -p /tmp/nginx_cache/bizthai && /www/server/nginx/sbin/nginx -s reload`。

### resolver 内存缓存

见上文「slug 映射机制 → 内存缓存」节。TTL 5 分钟，重启清空。

## 前端(web/)——【占位警告目录,勿改】

> `web/` 现在只保留 `README.md` 占位,用于提醒不要误改。前后端分离时期的 React SPA 已归档到 `_archive/react-web-deprecated-20260629/`。**不要再在 `web/` 或归档 React 项目上做线上功能开发**;旧项目记录的 UI/交互仅可作为新 starter 模板的历史参考。涉及的 WooCMS 会员/认领 API、sidecar 接口契约仍然有效(见对应记忆)。

- 旧项目位置:`_archive/react-web-deprecated-20260629/`。
- 旧技术栈:Vite + React 18 + TS + Tailwind。
- 设计规范:旧项目内 `design-layout-spec.md` 与 `docs/` 可作为历史参考,但线上前台实现必须改 `admin/data/themes/starter/`。

## 后端(admin/)

后端 / 管理端为 **WooCMS**(Go 单二进制 CMS,v1.0.43),发行包 `woocms-v1.0.43-linux-amd64.tar.gz` 已扁平部署在 `admin/` 目录,部署域名 `bizthai.com`。

### 部署形态(本机为多租户 WooCMS 服务器;当前是 v2,2026-07-02 blue-green 切换后)

- **工作目录**:`/www/wwwroot/bizthai/dbd-thai/admin/`(本仓库,即当前会话所在路径;二进制 `woocms` + `web/`(WooCMS 自带静态资源/控制台) + `migrations/` + `data/` + `.env`)。**前台主题在 `admin/data/themes/starter/`**(见上文「前台」节)。旧 v1 工作目录 `/data/projects/dbd-thai/admin/`(`DEPLOYMENT.md` 描述的部署包目标路径)仍在磁盘但已停机,只是回滚备份,不要在那边改代码。
- **监听**:`127.0.0.1:9183`(每个 WooCMS 租户占一个回环端口;v1 时代用的是 8083,该端口现已被本机另一个租户 `woohouse.mikalife.co.th` 占用——v2 换到 91xx 段就是为了避让端口冲突)。
- **systemd 服务**:`dbdadmin-woocms-v2.service`(`User=www-data`,`Restart=always`)。日志写到 `logs/dbdadmin.app.log` 与 `dbdadmin.app-error.log`(路径未变)。旧 `dbdadmin-woocms.service`(不带 `-v2`)仍在但 `inactive`。
- **数据库**:PostgreSQL 角色/库均为 `dbdadmin_woocms`,`DB_SCHEMA=woocms`(本机命名规约:`<前缀>_woocms`)。
- **nginx**:公网走 `bizthai.com`(+ `www.`/`th.`/`cn.` 子域)与 `www2.bizthai.com` 两个 vhost,`proxy_pass` 到 `127.0.0.1:9183`(配置见 `/www/server/panel/vhost/nginx/bizthai.com.conf` / `www2.bizthai.com.conf`)。`dbdadmin.woocms.org` 是 v1 遗留域名,本机 nginx 已无对应 vhost,不要再假设它能用(详见上文「部署架构」)。
- **入口**:公开前台 `https://bizthai.com/`(starter 主题服务端渲染);管理控制台 SPA 在同域 **`/admin`**(注意不是 `/console`,`/console/` 会 301 到失效的 `/console`)。`DEPLOYMENT.md` 建议给 `/admin` 加 IP 白名单,尚未确认生产是否已配置。
- 数据库迁移在**每次启动时自动应用**(无需手动 migrate);`.env` 权限 600,含 DB/SESSION/管理员密码,不要提交。
- 远程更新:**2026-07-08 起已禁用**。WooCMS 源码已拉取到本机独立仓库 `/www/wwwroot/bizthai/woocms-dev/`(二次开发/fork,不再依赖上游二进制),`.env` 的 `UPDATE_SERVER_URL/UPDATE_TOKEN/UPDATE_CHANNEL` 已移除(updater 服务该变量为空即 no-op),后台「系统设置 → 系统更新」不会再检测/拉取 dev.woocms.org 的官方更新。本地改动的构建部署走 `woocms-dev/scripts/deploy-to-bizthai.sh`。
- `LICENSE_KEY` 留空 = AI 功能关闭;填入授权密钥后开通。

### 常用运维命令

- `systemctl status dbdadmin-woocms-v2` / `restart` / `journalctl -u dbdadmin-woocms-v2`(**注意 `-v2` 后缀**;不带后缀的是已停机的 v1)
- 查应用日志:`logs/dbdadmin.app.log`
- 改 `.env` 后需 `systemctl restart dbdadmin-woocms-v2` 生效。

## 数据层 / 抓取器(独立泰国 VPS)

数据抓取器(Python:**Playwright 抓取器** + **FastAPI 数据 API**,从 [DBD DataWarehouse+](https://datawarehouse.dbd.go.th) 采集泰国企业信息)**不在本机运行**,部署在独立的泰国 VPS 上。

- 原因:DBD 站点有 **Incapsula/Imperva** 防护,会对**数据中心 IP 段硬拦截**(直接返回 403 拦截页,连真实浏览器都过不了 —— 本机机房 IP 实测被拦)。需用住宅 IP 或泰国本地 VPS 才能抓取。
- 抓取产出的数据(`base.json` / `companies/{jpNo}.json` 等,以公司注册号 jpNo 为键)经其 FastAPI 接口(`/api/stats`、`/api/companies`、`/api/companies/{jpNo}`)提供给本机后端 WooCMS 消费。
- 本机**不保留**抓取器代码与数据(此前临时部署已移除)。

## 工作语言与思维立场

- **全程使用中文**:所有回复、分析、代码注释、方案说明均以中文输出;思考时也从中文/中文用户视角出发考虑内容。

## 数据库安全约定（重要）

- **禁止贸然读写大表**:当前 thaicompany 等核心表达到百万级记录,对大表执行无限制 SELECT / UPDATE / DELETE 会导致系统卡死。
- 操作前必须加 `LIMIT`、精确 `WHERE` 或只查 `COUNT(*)` 确认规模;确认有索引支撑后再执行。
- 在后台 `/admin` 或 API 端执行批量操作前,先评估影响行数。

## 约定

- 后端代码放 `admin/`;**前台(前端)工作改 `admin/data/themes/starter/` 主题模板**,不再改 `web/`。
- **`web/` 是占位警告目录,不要在其中做功能开发**。旧 React SPA 在 `_archive/react-web-deprecated-20260629/`,只可参考,不要作为线上源码修改。
- 各组件压缩包(`*.zip` / `*.tar.gz`)、`node_modules/`、`dist/` 为打包/依赖/产物,不应作为源码改动对象。
