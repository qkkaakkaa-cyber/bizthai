# DBD Thai 商业环境分析聚合服务

独立的轻量 sidecar 服务。**不修改 WooCMS**,而是通过 WooCMS 站点接口读取已入库的 DBD DataWarehouse+ 数据,预聚合 + 缓存,
按 [`web/docs/business-analysis-api.md`](../web/docs/business-analysis-api.md) 对外暴露 `/api/site/v1/analytics/business/*`。

## 为什么是独立服务

后端 WooCMS 是无源码的 Go 单二进制,无法新增自定义聚合接口;且其列表接口强制返回笨重的 `meta.raw`、
不支持字段投影/排序/聚合。本服务在其之上做聚合,前端只管展示。

## 数据口径(两类,响应里逐字段标注 `basis`)

后端已提供:① 字段投影/排除 raw、② meta 排序、③ 通用聚合端点(group-by+sum/avg/count)、④ terms 顶层过滤。
因此**绝大多数字段已是全量精确**:

| 口径 | 覆盖字段 | 计算方式 |
| --- | --- | --- |
| `accurate` | 企业总量、注册资本汇总/均值、各府(**计数+资本**)、外资组成、行业大类、状态分布、高资本榜、最新榜 | 聚合端点 `/aggregate` + 分类法 `total` + 全库 `sort` |
| `sampled` | **仅** 各年度新增趋势 | 投影大样本(`exclude raw`,`SAMPLE_SIZE` 默认 1200) |

> 年度是唯一抽样口径:`/aggregate` 的 `group_by` 有 200 组上限、且不支持日期区间过滤,
> 故按年用投影大样本估算趋势形态(已排除 raw,成本低)。其余指标均为全量精确。

## 运行

```bash
cd analytics
cp .env.example .env      # 按需改端口/样本量/刷新周期
npm run gen:data          # (可选)从 web 权威源重新生成 府/行业/国家 三语映射
npm start                 # node src/server.js,监听 127.0.0.1:8084
```

健康检查:`curl http://127.0.0.1:8084/api/site/v1/analytics/health`

## 部署(本机多租户约定)

- systemd:`deploy/dbdanalytics.service`(User=www-data,Restart=always,回环 8084)。
- nginx:`deploy/nginx-analytics.conf`,把 `/api/site/v1/analytics/` 反代到 8084,其余接口仍由 WooCMS 提供。

## 缓存与刷新

- 全局快照进程内常驻,每 `REFRESH_MS`(默认 1h)后台重算 —— 总量持续增长,刷新即跟进。
- 按 `provinceSlug` 的快照按需计算,带 `PROVINCE_TTL_MS`(默认 30min)TTL。

## 上游若能增强(可显著提升精度/降成本)

当前 `sampled` 字段的根因是 WooCMS 列表接口的两个限制。若 CMS 作者愿意出**通用能力**:

1. **字段投影 / 排除 raw**(如 `?fields=capamt,regdate,jpstatcode` 或 `?exclude=raw`):
   列表立刻变轻,本服务可低成本**全量扫描**,所有 `sampled` 字段转为精确。**最小、最高性价比。**
2. **通用聚合端点**(对模型 meta 字段做 group-by + count/sum/avg,支持分类法过滤):
   则资本汇总、年度、状态全部精确,本服务几乎可省。

二者皆为通用、可复用、惠及所有租户的特性。
