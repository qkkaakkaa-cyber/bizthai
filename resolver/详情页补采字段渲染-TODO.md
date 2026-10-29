# 交接:DBD 补采 5 字段在详情页的渲染

> 来源:2026-07-03 会话核查(会话 32dc1ab5)。已确认字段进库但详情页未渲染,本文件供「详情页渲染」这个单独任务直接拿去实施。
> 涉及字段:`nameHists / capitalHists / jpNationCharts / basicFinCharts / extSecLic`

> **一期已完成(2026-07-03)**:`nameHists`/`capitalHists`/`extSecLic` 已按下文方案加到 `resolver/src/server.js`
> 的 `renderCompanySSR`(注入点①,追加进 profile 面板),未改任何主题模板文件。已用生产库当时仅有的 3 条
> 补采样本(`0105535131601`/`0413565000011`/`0503550004244`)经 en/th/zh 三语实测通过,无历史数据的公司
> 该段静默不渲染,无回归。`extSecLic` 因生产样本至今全是空数组,渲染逻辑走的是通用 key-value 兜底(未见
> 真实非空数据验证过实际字段名)。**二期(`jpNationCharts`/`basicFinCharts` 图表)未做**,仍按下文规划单独排期。

**现状**:`nameHists / capitalHists / jpNationCharts / basicFinCharts / extSecLic` 已经进库(存在公司 `meta_json` 顶层),但详情页**完全没在用**——模板 `single-thaicompany.html`、`theme.js`、`resolver` 全局 grep 这 5 个字段及其子键 **0 命中**。数据白进来了,前台看不到,需要加渲染。

**必须在 resolver SSR 加,不要在 WooCMS 模板加**:这 5 个字段是嵌套数组/对象,WooCMS 模板的 `<wc-data>/{{range}}` 对嵌套数组会被静默吞掉(和 `committees`、`financialStatements` 同一限制)。所以渲染逻辑放 `resolver/src/server.js` 的 `renderCompanySSR(meta, raw, lang, jpno, peers)`(约 819 行),和现有董事/财报面板完全同一手法。

**字段位置与形状**(注意:是 `meta` 顶层、驼峰键,**不在 `raw` 下、也没被小写化**):
- `meta.nameHists[]` — 曾用名史。元素:`{seqDesc/seqDescE, jpNewName/jpNewNameE, jpTypeCode, changeDate:[y,m,d], updateDate:[y,m,d]}`
- `meta.capitalHists[]` — 增减资史。元素:`{seqDesc/seqDescE, changeDate:[y,m,d], previousCapAmt, newCapAmt, incDecAmt, incDecFlag}`
- `meta.extSecLic[]` — 证券牌照(多数为空数组)
- `meta.jpNationCharts{}` — 并购/改制/股权国籍 + `customChart` 约 55 条曲线(`shareHistTHDps/shareHistOTDps` 泰籍/外籍持股、`roaDps/roeDps/netProfitDps` 等)
- `meta.basicFinCharts{}` — `rankingTH`(行业排名)、`finObjRatioDtos`(财务比率)、`avgRatioSize/avgRatioAllSize`(同规模/全体均值对标)、`fiscalYearSelected`,加同款 `customChart` 曲线

**直接复用现成 helper**(都在 `renderCompanySSR` 作用域内):`ssrDualDate(lang, [y,m,d])` 格式化日期数组、`ssrFmt(n)` 金额千分位、`ssrNum(v)`、`card(title, inner)`/`dl(label, val)` 拼卡片、`LBL(lang, key)` 取三语标签、`escHtml`。渲染数组时**按 lang 选 th/en**(`seqDescE`/`jpNewNameE` 是英文版),照抄 committees 那段(898–908 行)的写法即可。

**注入点**:面板在 `server.js:1096–1100` 用正则替换空 `<div data-panel="...">` 注入。两种加法二选一——① 简单:把新 HTML 追加进 `profile` 面板(像 `finHtml` 那样,1098 行);② 独立 tab:在 `single-thaicompany.html`(35–39 行那组 data-panel)加一个 `<div data-panel="history">`,再在 server.js 加一条对应的正则替换。

**务必处理的坑**:
1. **数据是增量铺开+稀疏的**:只有已补采的公司才有这些键,且很多 `customChart` 序列是 `null`(如样本 NORDIC 的 `basicFinCharts` 大半为空)。渲染前一律先判存在/非空(`if (Array.isArray(meta.nameHists) && meta.nameHists.length)`),空的整段不渲染——照抄 `finHtml` 用 `finItems.some(...)` 守卫的做法。未补采的公司自然不显示,不能报错。
2. **`<wc-t>` 新标签要手动补译**:新加的中文/泰文标签若走 `<wc-t>`,需在 `cms_ui_strings` 建 th/zh-CN 行,否则静默退英文(见 memory `bizthai-wc-t-translation`)。
3. **日期是 `[年,月,日]` 数组**,别当字符串,用 `ssrDualDate`。

**建议分两期做**:
- **一期(简单、价值高、纯 SSR 表格)**:`nameHists`(曾用名时间线)+ `capitalHists`(增减资时间线)+ `extSecLic`(牌照表)。三张表,复用 committees 写法,半天能上。
- **二期(需要图表库)**:`jpNationCharts`/`basicFinCharts` 的 `customChart` 那 ~55 条曲线 + 排名/比率对标。这块是图表导向,要引入前端图表方案(theme.js 客户端 canvas/svg 或服务端 sparkline)+ 设计,且要优雅处理大量 null 序列,工作量明显更大,单独排。

改完记得 `chown www-data` + `systemctl restart dbdresolver-v2`(resolver 有 5 分钟内存缓存,重启即时清)。

---

**二期已完成(2026-07-03,同日两轮会话:32dc1ab5 规划 → 3b788d63 开工被中断 → 本轮 c3150b7f 续做完工)**:

- **新增两个独立 tab**(不再塞进 profile 面板):`changes`(变更记录,用户当时的原话是"增加一个公司变更记录的tab")+ `analytics`(分析,即本文档的二期图表)。四个文件都改了:`resolver/src/server.js`(SSR_LBL + `SSR_ANALYTICS_GROUPS` 55 指标 9 组目录 + `ssrGenericRecords`/`ssrSparkline`/`ssrChartLatest`/`ssrMetricCard`/`ssrAnalyticsGroup` helper + `renderCompanySSR` 拼 `changesHtml`/`analyticsHtml` + 两个新 `data-panel` 正则注入点)、`admin/data/themes/starter/templates/single-thaicompany.html`(加两个空 `data-panel` div)、`assets/theme.js`(`TABS` 数组加两个 tab 按钮 + 对应 `LABELS`)、`assets/style.css`(`.biz-spark-wrap` 一条规则)。
- `changesHtml` = 原 `nameHistHtml`/`capHistHtml`(从 profile 面板挪出)+ 新增的 `mergerFroms`/`mergerTos`/`transformFroms`/`transformTos`(并购/改制记录,挂在 `meta.jpNationCharts` 下,用 `ssrGenericRecords` 通用 key-value 兜底渲染,**生产现存样本这四个字段全是空数组,字段名/形状未经真实非空数据验证**,和 `extSecLic` 一样的坑,等哪天出现非空样本再核实)。`extSecLic`/`secLicHtml` 保留在 profile 面板(它是牌照不是变更记录)。
- **关键简化决策,偏离了本文档原计划的"客户端图表库"路线**:`analyticsHtml` 全部走**服务端内联 SVG 折线图**(`ssrSparkline`,纯 `<polyline>`,无 JS 依赖),**没有**在 theme.js 加对应的客户端图表渲染函数(`chartPoints`/`anaChart` 之类)。原因:①这两个 tab 的数据请求时已经在手,SSR 现算现出比走客户端二次 fetch 简单;②和本仓库 CLAUDE.md 反复强调的"客户端 JS-only 渲染爬虫抓不到"原则一致,纯 SSR 对 SEO 更好;③已验证 `theme.js` 的 `render(entry)` 函数会对 `profile`/`business`/`directors`/`contact`/`network` 做客户端二次渲染覆盖 SSR 内容(会员态/图数据等原因),但**没有**引用 `changes`/`analytics` 这两个新 panel,所以 SSR 内容原样保留不会被覆盖,不需要写客户端渲染函数——只在 `TABS` 数组里加了 tab 按钮条目(否则用户点不到,因为 tab 按钮本身是纯客户端 `renderTabs()` 生成的,SSR 模板里 `data-detail-tabs` 是空的)。
- `jpNationCharts.customChart` 和 `basicFinCharts.customChart` 是**同一套 55 个 key 的 schema**(实测两边 key 完全一致),只是populate 的子集不同(股权国籍类在 jpNationCharts,财务比率类在 basicFinCharts),渲染时两边同 key 取并集(先出现非空数组的一侧为准)。
- 三语(en/th/zh)+ 3 个已知补采样本(`0105535131601`/`0413565000011`/`0503550004244`)+ 1 个普通公司(`0103525004141`,验证空状态优雅降级)已 curl 实测通过。`0503550004244` 是唯一同时有 `basicFinCharts` 非空数据的样本(`currentRatioDps`/`debtToEquityDps`/`netProfitDps` 三条),其余两个样本 `basicFinCharts.customChart` 全空,只有 `jpNationCharts` 的 `shareHistTHDps`/`shareHistOTDps` 有数据——55 个指标里生产目前只实测验证过这 5 个真实非空。
- **仍未做,留给下次**:`rankingTH`(行业排名)、`avgRatioSize`/`avgRatioAllSize`(同规模/全体均值对标)——生产现存样本这三个字段全是 `null`,字段形状同样未经真实数据验证,没有贸然猜测渲染。等生产有更多补采数据、这些字段出现非空样本时再单独排期核实。
