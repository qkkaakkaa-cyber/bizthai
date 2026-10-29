# WooCMS 通用 Bug 反馈

> **状态:以下 4 条已由上游在 v1.0.60 全部修复,2026-06-22 在本机实测验证通过(原始报告基于 v1.0.59)。本文件保留作回归记录。**

> 面向 WooCMS 引擎本身的可复现技术问题,**与具体租户业务无关**,任何启用「多域名 + 多语言(i18n)」的 WooCMS 实例都会命中。
>
> - 版本:**WooCMS v1.0.59**(linux-amd64,自带 starter 文件主题)
> - 场景前提:在「后台 → 站点/域名」把多个域名绑定到不同 locale,例如
>   - `site-en.example` → `en`(**默认 locale**,`default_locale=en`)
>   - `site-th.example` → `th`
>   - `site-zh.example` → `zh-CN`
> - i18n 配置:`GET /api/admin/v1/i18n/config` → `{enabled:true, default_locale:"en", locales:["en","th","zh-CN"], source_locale:"th", auto_publish:true}`
> - 占位域名仅为说明,复现时换成任意两三个绑定不同 locale 的域名即可。

---

## Bug 1 —(高)多域名 hreflang:默认 locale 的 alternate 与 x-default 错误指向「当前域名」而非「默认 locale 所绑定的域名」

**影响**:每个非默认 locale 的域名都会在 `Link: rel="alternate"` 里把「默认 locale」与 `x-default` 指向自己,导致搜索引擎收到重复内容/错误规范化信号(每个语言站都自称是默认语言版),伤 SEO。

**复现**
1. 按上面前提绑定三域名(`site-en`=默认/en、`site-th`=th、`site-zh`=zh-CN)。
2. 分别访问首页并看响应头 `Link`(或 `<head>` 的 `<link rel="alternate" hreflang=...>`)。

**实际**
- 从 **默认域名** `site-en.example` 看 —— ✅ 正确:
  ```
  <https://site-en.example/>; hreflang="en"
  <https://site-th.example/>; hreflang="th"
  <https://site-zh.example/>; hreflang="zh-CN"
  <https://site-en.example/>; hreflang="x-default"
  ```
- 从 **非默认域名** `site-th.example` 看 —— ❌ 错误(en 与 x-default 指向了当前域名):
  ```
  <https://site-th.example/>; hreflang="en"        ← 应为 site-en.example
  <https://site-th.example/>; hreflang="th"        ← 正确
  <https://site-zh.example/>; hreflang="zh-CN"     ← 正确
  <https://site-th.example/>; hreflang="x-default" ← 应为 site-en.example
  ```
- 从 `site-zh.example` 看同理:`hreflang="en"` 与 `x-default` 错指 `site-zh.example`。

**期望**:无论从哪个域名访问,默认 locale 的 alternate 与 `x-default` 都应解析为「默认 locale 所绑定的域名」(此例 `site-en.example`)。非默认 locale 的 alternate 当前是对的——说明只是「默认 locale 的目标域名」解析用了当前请求 host,而没有按 locale→域名 绑定反查。

**修复方向**:构建 alternates 时,默认 locale / x-default 的 URL 应通过「locale → 绑定域名」反查表得到,而不是回退到当前请求 host。

---

## Bug 2 —(中)系统错误页(404/5xx)完全绕过 i18n:硬编码文案 + 固定 `<html lang>`,不随请求 locale/域名绑定变化

**影响**:任何域名上的 404/错误页都吐固定语言(实测为中文)且 `<html lang>` 固定,既不符合该域名绑定的 locale,文案也无法被翻译(没走 UI 串/i18n 层)。

**复现**
1. 把某域名绑定到非中文 locale(如 `site-th.example`→th 或 `site-en.example`→en)。
2. 请求一个不存在的路径,如 `GET https://site-th.example/__no_such_path__`。

**实际**:返回内置错误页(模板 `web/templates/shared/error.tmpl`),且恒为:
```html
<html lang="zh-CN">
  ... <h1>404</h1>
  <p class="...">页面不存在</p>
  <a href="/">返回首页</a> ...
```
无论请求域名绑定的是 th 还是 en,`<html lang>` 与可见文案都不变(硬编码中文)。

**期望**
- `<html lang>` 取该请求解析出的 locale(与正常页面一致)。
- 错误页可见文案(`页面不存在`/`返回首页`/`Error` 等)走 i18n / UI 串层,可被翻译并按 locale 输出;无译文时回退默认 locale 文案,而非永远中文。

**修复方向**:`shared/error.tmpl` 渲染时注入已解析 locale,并将其中的硬编码串纳入 `i18n.UIString` 体系(与 `{{ t }}`/`<wc-t>` 同源)。

---

## Bug 3 —(中)未匹配路由的 404 不使用「当前主题模板层级里的 `404.html`」,而是直接渲染引擎内置错误页

**影响**:主题在模板层级里提供了 `templates/404.html`,但实际未匹配路由的 404 始终走引擎内置 `shared/error.tmpl`,主题无法自定义/本地化自己的 404 页;与「主题模板层级」文档约定不一致。

**复现**
1. 在当前启用主题里给 `templates/404.html` 放一个明显可辨认的标记(如自定义 class / 文案 / `<wc-t>` 标记)。
2. 请求一个不存在的路径。

**实际**:返回引擎内置错误页,主题的 `404.html` 内容完全不出现(对照:同主题的 `front-page.html` 等磁盘改动是即时生效的,可见并非缓存问题,而是该路由根本不走主题 404 模板)。

**期望**:若当前主题提供 `404.html`,未匹配路由的 404 应渲染该主题模板(享受主题样式、`<wc-t>`/`{{ t }}` 多语言、wc-* 数据标签),与文档化的模板层级一致;主题未提供时再回退内置错误页。

> 注:Bug 2 与 Bug 3 相关但独立——Bug 2 是「内置错误页本身不国际化」,Bug 3 是「压根没用主题的 404 模板」。修了 Bug 3,主题可自行解决错误页多语言;但内置错误页(主题未覆盖时)仍应按 Bug 2 国际化。

---

## Bug 4 —(低)部分 Admin API 在「方法不允许 / 请求不合法」时返回 HTML 错误页,而非统一 JSON 错误信封

**影响**:正常端点返回 `{"success":false,"error":{"code","message"}}`,但少数错误路径返回整页 HTML(`<!doctype html>...405...`),导致只解析 JSON 的 API 客户端在这些路径上崩。

**复现 / 实际**(以 `i18n/ui-strings` 为例,正确写法是 `PUT`)
- `POST /api/admin/v1/i18n/ui-strings` → 返回 **HTML 的 405 页**(而非 JSON)。
- `DELETE /api/admin/v1/i18n/ui-strings`(带 body,而非 `/{id}`)→ 返回 **HTML 页**。
- 对照:`PUT /i18n/ui-strings`、`GET /i18n/ui-strings?locale=th`、`DELETE /i18n/ui-strings/{id}` 均返回规范 JSON 信封。

**期望**:`/api/**` 下所有响应(含 405 Method Not Allowed、400、404 等)统一返回 JSON 错误信封,`Content-Type: application/json`。

**修复方向**:为 API 路由组挂统一的 `NoMethod`/`NoRoute`/错误中间件,输出标准 JSON 信封。

---

## Bug 5 —(高)`<wc-data source="cpt:thaicompany">` 与其 REST 接口的 `sort` 参数对 CPT 内容是 no-op,任何取值渲染顺序完全不变

**版本**:WooCMS **v1.0.43**(与上面 4 条基于 v1.0.59/已在 v1.0.60 修复的报告无关,未在 v1.0.43 复测那 4 条是否回归;本条是本次单独发现的新问题)。

**影响**:自定义内容类型(CPT,此处为 `thaicompany`,约 195 万行)的列表排序完全不可控——无论模板 `sort` 属性还是 REST 查询参数传什么值,返回顺序都不变,导致任何"按业务字段排序"的需求(例如把状态异常的记录排到后面)在核心层面完全做不到,只能绕过核心直连数据库实现。

**复现**
1. 站点任意一个用 `<wc-data source="cpt:thaicompany" ...>` 渲染列表的模板,把 `sort="id_desc"` 改成 `sort="id_asc"`,保存(磁盘即时生效,无需重启/重建)。
2. 刷新页面,对比改动前后返回的记录顺序。
3. 或直接对比 REST 接口:
   ```
   GET /api/site/v1/models/thaicompany/entries?limit=5&sort=id_asc
   GET /api/site/v1/models/thaicompany/entries?limit=5&sort=id_desc
   GET /api/site/v1/models/thaicompany/entries?limit=5&sort=published_at_desc
   GET /api/site/v1/models/thaicompany/entries?limit=5&sort=totally_bogus_xyz_desc
   GET /api/site/v1/models/thaicompany/entries?limit=5&sort=jpstatcode_asc   # 自定义 meta 字段,非核心列
   ```

**实际**:以上五种请求(模板 `id_asc` vs `id_desc`,以及 REST 的四种 `sort` 取值,含一个刻意编造的不存在字段名)返回**完全相同**的记录集合与顺序——包括两个本应是相反顺序的合法值(`id_asc`/`id_desc`)。说明 `sort` 参数在 CPT 列表查询路径上未被解析/应用,无论传核心真实列名、编造的字段名、还是 `meta_json` 内的自定义字段名,结果都一样(即该参数当前对 CPT 源整体是 no-op,而非"仅不支持 meta 字段排序")。

**期望**:`sort` 参数(模板属性与 REST 查询参数)应至少对核心真实列(`id`/`published_at`/`created_at`/`updated_at` 等)按声明方向生效;若要支持按 CPT 的 `meta_json` 自定义字段排序,需额外文档化其取值语法与索引/性能约束。

**已用规避方案(记录供参考,非上游要求)**:本项目对 `thaicompany` 的排序需求(状态优先、按资本/注册时间排名等)全部改为绕过 WooCMS 核心,由 `analytics` 边车直连 Postgres 实现(`analytics/src/db.js` 的 `browseCompanies()`/`rankCompaniesByProvince()`/`crossCompanies()` 等),前端改为请求 `/api/site/v1/analytics/...` 而非 WooCMS 的 `/api/site/v1/models/thaicompany/entries`。这与本仓库另一处"WooCMS 不支持多 taxonomy AND 查询"的规避手法(见 `crossCompanies` 注释)是同一模式。SSR 模板里的 `sort="id_desc"` 属性未删除(反正是 no-op),仅作为无 JS 环境下的静态兜底占位。

**✅ 2026-07-01 升级验证(v1.0.68→v1.0.69)已修复**:`GET .../entries?limit=2&sort=id_asc` 与 `...&sort=id_desc` 现返回不同记录集合(如 `0105000002180...` vs `0503516000339...`),确认 `sort` 参数已生效,未发现回归。

---

## Bug 6 —(高)核心表 `cms_content_entries` 落地时被打上 `autovacuum_enabled=false`,百万级 CPT 规模下必然膨胀致列表页拖垮

**版本**:WooCMS **v1.0.43**,数据库 PostgreSQL 17。与 Bug 5 同批次(本次单独发现的新问题,未验证是否存在于 v1.0.59/v1.0.60)。

**影响**:`cms_content_entries` 是承载所有 CPT(含 `thaicompany`)内容的核心表。该表的 `reloptions` 里被显式设置了 `autovacuum_enabled=false`——排查了本仓库所有 `.sql`/`.py`/`.sh`/`.md`,没有任何项目自己的迁移或运维脚本设置过这个选项,同 schema 下其余表(`cms_content_entry_terms`/`cms_permalink_routes`/`thaicompany_facts` 等)均正常走 autovacuum,唯独这张表被单独关闭,判断是 WooCMS 自身迁移/建表 DDL 带的默认值(每次启动自动应用迁移,见 CLAUDE.md)。对于博客级小规模内容或许无感,但 CPT 一旦到百万行规模、且有持续的批量 UPDATE/DELETE(去重、字段回填、翻译回填等运营常规操作),死元组只进不出,最终会显著拖慢所有基于该表的 SSR 查询(尤其是 COUNT 与分页列表)。

**复现 / 实际**(2026-07-01,~195万行规模,约25万行当天有 UPDATE 回填英文名 + 去重 DELETE):
```sql
SELECT reloptions FROM pg_class WHERE relname='cms_content_entries';
-- {autovacuum_enabled=false}

SELECT n_live_tup, n_dead_tup, autovacuum_count FROM pg_stat_user_tables WHERE relname='cms_content_entries';
-- n_live_tup=1950756  n_dead_tup=2207929(死元组比活元组还多,113.2%)  autovacuum_count=0
```
`pg_total_relation_size` 显示该表 **42GB**,而核心表本身(`pg_relation_size`)只有 1.5GB——差值主要是从未回收的 TOAST(`meta_json` 字段)死元组。连带效应:`/companies`(`page-10.html`,3 处 `<wc-data source="cpt:thaicompany" field="_count">` / `limit=24 offset=0` SSR 查询)整页耗时实测稳定在 **8.9~9.7 秒**,而同样有 SSR 数据源、但不查这张表的首页只要 0.28 秒,详情页(`single-thaicompany.html`)不到 0.1 秒——问题精确定位在这张表的膨胀,而非全站性能。

**已处理(本机,2026-07-01)**:
```sql
ALTER TABLE woocms.cms_content_entries SET (autovacuum_enabled = true);
VACUUM (ANALYZE, VERBOSE) woocms.cms_content_entries;  -- 耗时 2分48秒,不锁表、不改数据
```
清理后死元组归零,`/companies` 整页 SSR 降到 **1.1~2.1 秒**(约 9 倍提速)。注意常规 `VACUUM` 不会把磁盘空间还给操作系统(42GB 物理体积不会立即缩小,只是把空间标成"可复用"),真要收回磁盘需要 `VACUUM FULL` 或 `pg_repack`(需排他锁或双倍磁盘空间,建议低峰期单独排期,今天未做)。

**期望**:WooCMS 自身建表 DDL 不应给核心内容表关闭 autovacuum;至少应在文档/发行说明里提示大规模 CPT 部署需要手动检查并开启。

**待办**:线上服务器(`dbdadmin.woocms.org`)大概率有同样的表设置和更严重的死元组积压(写入量更大、运行更久),需要在线上单独执行同样两条命令——本机与线上是完全独立的两个 Postgres 实例,这次修复只覆盖了本机 Colima 环境。

**✅ 2026-07-01 升级验证(v1.0.68→v1.0.69)已修复**:新迁移 `000122_content_entries_autovacuum.up.sql` 显式 `ALTER TABLE ... SET (autovacuum_enabled=true, toast.autovacuum_enabled=true, autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05)`,升级后 `SELECT reloptions FROM pg_class WHERE relname='cms_content_entries'` 确认已生效,比本项目当时的手动修复更进一步(额外调低了大表的 vacuum 触发阈值 + 单独打开了 TOAST 表的 autovacuum)。

---

## Bug 7 —(高)REST `entries?taxonomy=&term=` 与 `<wc-data>` 的 taxonomy 筛选只支持单个 taxonomy+term 组合,CPT 无法原生做多维度 AND 筛选

**版本**:WooCMS v1.0.43,与 Bug 5/6 同批次发现。

**影响**:`thaicompany` 挂了 `province`/`industry`/`capital` 三个 taxonomy,业务上的常见需求是"府=X 且 行业=Y 且 资本来源=Z"这种多维度联合筛选(标准的 faceted search 形态)。但 `GET /api/site/v1/models/{cpt}/entries?taxonomy=X&term=Y` 与模板 `<wc-data source="cpt:{code}" taxonomy="X" term="Y">` 的筛选参数设计上只接受**一对** taxonomy+term——多传几对(如 `&taxonomy=province&term=X&taxonomy=industry&term=Y`)不会按 AND 生效,只会取到某一对,另一维度被静默忽略。任何多 facet 筛选 UI 在 WooCMS 原生层面都做不到,必须绕过核心直连数据库自建交集查询。

**复现**
1. 任意一个挂了 ≥2 个 taxonomy 的 CPT。
2. 请求 `GET /api/site/v1/models/{cpt}/entries?taxonomy=province&term=X&taxonomy=industry&term=Y`。
3. 对比返回结果:未同时按两个维度过滤,只有其中一对生效(通常是解析到的最后一对覆盖前面的)。

**期望**:提供原生的多 taxonomy 联合筛选语法(例如 REST 支持数组形式 `taxonomy[]=province&term[]=X&taxonomy[]=industry&term[]=Y`,或组合过滤字符串;模板层面 `<wc-data>` 支持多组 `taxonomy`/`term` 属性对),各维度间按 AND 语义组合,并在百万行规模下走 `entry_terms` 交集查询(如 `INTERSECT`)而非笛卡尔积展开。

**修复方向**:参考本项目已验证的规避实现思路——每个 taxonomy+term 先各自解析出字面量 `term_id`(而非把 slug 过滤混进主查询的 JOIN 条件——本项目实测过,后一种写法对大类目如占全库 40% 的曼谷府会导致 Postgres 选择率估算严重失准、误选逐行回表的执行计划,曾一度让请求挂起 15 秒以上不返回),各自查出 entry_id 集合后 `INTERSECT` 求交集;交集结果量大时(如两个大类目交叉)还需要注意让规划器改用批量 join 而非逐行回表,否则同样会退化成性能陷阱。

**已用规避方案(记录供参考,非上游要求)**:本项目 `analytics` 边车(`analytics/src/db.js` 的 `browseCompanies()`)直连 Postgres,对每个 taxonomy+term 各自解析出 entry_id 集合后 `INTERSECT` 求交集,完全绕开 WooCMS 核心的 CPT 查询接口。

**❌ 2026-07-01 升级验证(v1.0.68→v1.0.69):上游反馈称已修复,但实测未生效,仍是原样的单维度行为**——上游描述的修复方案是"REST 支持重复传参 `?taxonomy=province&term=X&taxonomy=industry&term=Y`,各自解析字面量 term_id 后生成 EXISTS 子句按 AND 拼接",并新增了迁移 `000124_entry_terms_term_id_index.up.sql`(`(term_id, entry_id)` 索引)专门为这个场景兜底性能。但实测：

```
GET .../entries?taxonomy=province&term=prov169ab44eed&taxonomy=industry&term=tsic-g   → total=5414 (=纯 province 单独筛选的数量,industry 被忽略)
GET .../entries?taxonomy=industry&term=tsic-g&taxonomy=province&term=prov169ab44eed   → total=251488 (=纯 industry 单独筛选的数量,province 被忽略)
GET .../entries?taxonomy=province&term=provf9f6448bf9&taxonomy=totally_bogus_xyz&term=nonexistent → total=777094 (与不传第二组参数时完全一致)
```

三次测试(province+industry 两种顺序、province+一个刻意编造的第二维度)结果一致:**只有查询字符串里第一次出现的 `taxonomy`/`term` 组合生效,后面所有组合被完全忽略**(不是"选择率估算错误导致结果偏少",是第二组参数根本没被解析,传合法值和传编造的假值效果完全一样)。为新迁移 000124 建的索引目前应该处于从未被用到的状态。本项目已有的 `analytics` 边车规避方案不受影响(自建 `INTERSECT`,不依赖 WooCMS 这个接口),不影响 `/companies` 页面当前功能,但这条反馈需要回给上游:**声称的修复没有在实际二进制里生效,需要上游复查这次发布实际打进去的代码分支是否正确**。

---

## Bug 8 —(中)CPT 关键词搜索(`entries?keyword=`)在百万行规模下是无索引全表 ILIKE 扫描,人工加装 trigram 索引也不会被使用

**版本**:WooCMS v1.0.43,与 Bug 5/6/7 同批次发现。

**影响**:对 `thaicompany`(约195万行)按公司名关键词搜索,响应耗时在 **3~12 秒**区间(2026-07-01 实测:核心表膨胀修复前约 11.6 秒,修复后约 3.2~6.2 秒,取决于具体关键词),且无法通过加索引改善,对"按名称/内容检索"是核心场景的部署是严重限制。

**复现**
1. 给检索字段(如 `meta_json->>'jpnamee'`)手动创建 GIN trigram 索引(`CREATE INDEX ... USING gin (col gin_trgm_ops)`,需 `pg_trgm` 扩展)。
2. 记录 `pg_stat_user_indexes.idx_scan`,发起 10 次真实关键词搜索(中英文各若干次)后再次读取该计数。
3. 用 `EXPLAIN (ANALYZE)` 单独验证索引本身是否可用(去掉分页 `LIMIT`、单独测 `COUNT(*)` 是否走 `Bitmap Index Scan`)。

**实际**:索引创建后,`idx_scan` 计数在 10 次真实搜索请求前后**没有变化**(仍是 0);但去掉 `LIMIT` 单独测 `COUNT(*)` 确实会走 `Bitmap Index Scan`,证明索引本身有效。说明 WooCMS 内部为 `keyword` 参数生成的实际 SQL(闭源二进制,无法直接查看)在其"取少量结果 + `LIMIT` 分页"的查询形态下,规划器判定顺序扫描比走索引更省,导致该索引形同虚设,加了也白加——不是索引配置错误,是当前查询形态让索引优化路线对 WooCMS 生效不了。

**期望**:`keyword` 检索路径应能利用文本索引(trigram/全文检索等)完成大表关键词过滤,而不是无论是否有索引都退化为全表顺序扫描;建议提供官方的全文检索最佳实践,或调整内部查询构造方式(如避免让 planner 因为 `LIMIT` 存在而低估索引路径收益)以确保部署方手动创建的索引能被实际用上。

**已用规避方案(记录供参考,非上游要求)**:本项目暂未绕过这个限制自建同等效果的关键词检索——与 taxonomy 筛选不同(taxonomy 可以直连 `entry_terms` 表自建交集,见 Bug 7),关键词全文检索若要自建需要另起一套独立搜索索引/服务,超出当前项目投入,仍在用 WooCMS 原生 `keyword` 参数,接受其在大表上较慢的现状。

**✅ 2026-07-01 升级验证(v1.0.68→v1.0.69)已修复**:新迁移 `000123_content_entries_keyword_trgm.up.sql` 建了 `pg_trgm` 扩展 + `title`/`summary`/`body` 三列 GIN trigram 索引。实测:①冷门/生僻关键词(如公司名片段)从修复前 3~6 秒降到 **24~460 毫秒**;②`EXPLAIN ANALYZE` 确认真实走 `Bitmap Index Scan` 用到了新索引。**踩坑记录**:第一次验证时随手拿了泰文"จำกัด"(相当于英文的"Limited/Co.,Ltd.")当测试关键词,结果还是 ~2.7~3 秒,一度以为没修复——查证后发现这词在本数据集里覆盖率接近 100%(几乎每家"有限公司"名字里都有),属于选择率太低、任何索引都帮不上的退化场景(规划器此时正确选择整表扫描,不是 bug),换一个真实场景下会用的公司名片段关键词重测才看到修复效果。以后验证类似问题要注意别拿数据集里的高频"停用词"当测试样本。
- Bug 1/2/3 都源于「多域名 + i18n」场景,建议合并在该模块一并回归。
- 以上均在 v1.0.59 复现;若上游已在更新版修复,可据此核对回归用例。
- i18n 核心机制(`{{ t "原文" }}` / `<wc-t>原文</wc-t>` 服务端按 locale 解析、剥标记+转义、无译文回退原文、`/api/admin/v1/i18n/ui-strings` 增删查改)实测工作正常、零标记泄漏——本反馈仅针对其周边的 SEO/错误页/API 一致性短板。
