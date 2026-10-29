# DBD 泰国企业数据 API — 调用文档

泰国企业工商信息查询接口(数据来源:DBD DataWarehouse+)。
含企业基本信息、董事/股东、股权结构、**多年财务报表**。

---

## 1. 基础信息

| 项目 | 说明 |
|------|------|
| **Base URL** | `https://dbd.mikalife.co.th/api` |
| 协议 | HTTPS |
| 请求方式 | `GET` |
| 返回格式 | JSON（`UTF-8`） |
| **鉴权** | **必填**,每个请求需带 API Key（见下） |
| 跨域 | 已开启 CORS（`Access-Control-Allow-Origin: *`），前端可直接调用 |
| 字符编码 | **非 ASCII 参数（泰文/中文）必须 URL 编码**，否则返回 `400` |

> 数据持续增量更新中,`/api/stats` 返回的 `total` 会随采集进度增长。

---

## 1.1 鉴权（API Key）

所有 `/api/*` 接口都需要 API Key。两种传法,二选一:

| 方式 | 示例 |
|------|------|
| **请求头(推荐)** | `X-API-Key: 你的密钥` |
| 查询参数 | `?api_key=你的密钥` |

```bash
# 请求头方式
curl -H "X-API-Key: 你的密钥" "https://dbd.mikalife.co.th/api/stats"

# 查询参数方式
curl "https://dbd.mikalife.co.th/api/stats?api_key=你的密钥"
```

> 密钥由数据方单独提供,请妥善保管,勿泄露/勿提交到前端公开代码。
> 缺失或错误时返回 `401 {"detail":"缺少或无效的 API Key…"}`。

---

## 2. 接口列表

### 2.1 统计概览 `GET /api/stats`

返回库内数据总量与分布。

```bash
curl -H "X-API-Key: 你的密钥" "https://dbd.mikalife.co.th/api/stats"
```

**响应:**
```json
{
  "total": 9950,
  "with_detail": 9950,
  "detail_files": 9950,
  "statuses": { "运营中 (ยังดำเนินกิจการอยู่)": 9950 },
  "types": { "有限责任公司 (บจ.)": 9950 }
}
```

| 字段 | 说明 |
|------|------|
| `total` | 企业总数 |
| `with_detail` | 已采集详情的企业数 |
| `statuses` / `types` | 按状态 / 类型的数量分布 |

---

### 2.2 企业列表 / 搜索 `GET /api/companies`

按关键词、状态、省份等筛选,分页返回。

**查询参数:**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `keyword` | string | - | 公司名称或注册号(模糊匹配,**需 URL 编码**) |
| `status` | string | - | 状态筛选(泰文,如 `ยังดำเนินกิจการอยู่`=运营中) |
| `jp_type` | string | - | 类型筛选(如 `บจ.`=有限公司) |
| `province` | string | - | 省份筛选(泰文) |
| `page` | int | 1 | 页码(从 1 开始) |
| `page_size` | int | 20 | 每页数量(1–200) |
| `sort_by` | string | `jpNo` | 排序字段(`jpNo` / `jpName` / `capAmt` …) |
| `sort_order` | string | `asc` | 排序方向(`asc` / `desc`) |

```bash
# 按名称关键词搜索(泰文需 URL 编码,推荐用 --data-urlencode)
curl -H "X-API-Key: 你的密钥" \
     -G "https://dbd.mikalife.co.th/api/companies" \
     --data-urlencode "keyword=กมล" \
     --data-urlencode "page=1" \
     --data-urlencode "page_size=20"
```

**响应:**
```json
{
  "total": 269,
  "page": 1,
  "page_size": 20,
  "total_pages": 14,
  "items": [
    {
      "jpNo": "0105490001045",
      "jpName": "กมลกิจ จำกัด",
      "jpNameE": null,
      "status": "ยังดำเนินกิจการอยู่",
      "statusZh": "运营中",
      "type": "บจ.",
      "typeZh": "有限责任公司",
      "regDate": null,
      "capAmt": null,
      "paidAmt": null,
      "province": "กรุงเทพมหานคร",
      "address": null,
      "email": null,
      "phoneNo": null,
      "has_detail": true
    }
  ]
}
```

> `items[].jpNo` 即企业唯一注册号,用它调用「企业详情」接口。
> `has_detail=true` 表示该企业已有完整详情(含财务)。

---

### 2.3 企业详情 `GET /api/companies/{jpNo}`

返回单个企业的完整档案。`{jpNo}` 为 13 位注册号。

```bash
curl -H "X-API-Key: 你的密钥" "https://dbd.mikalife.co.th/api/companies/0105556054443"
```

**响应结构(顶层):**
```json
{
  "jpNo": "0105556054443",
  "basic": { ... },                 // 基本信息 + 最新财务摘要
  "financialStatements": { ... },   // 多年财务报表
  "detail": { ... }                 // 董事、股东、股权、变更历史等原始明细
}
```

**`basic` 主要字段:**

| 字段 | 说明 |
|------|------|
| `jpName` / `jpNameE` | 公司泰文名 / 英文名 |
| `status` / `statusZh` | 经营状态(泰文 / 中文) |
| `type` / `typeZh` | 企业类型(泰文 / 中文) |
| `regDate` / `jpAge` | 注册日期 / 成立年数 |
| `capAmt` / `paidAmt` | 注册资本 / 实缴资本(泰铢) |
| `address` / `addressE` | 地址(泰文 / 英文) |
| `province` / `zipCode` | 省份 / 邮编 |
| `businessType` | 行业分类(`businessTypeCode` / `businessTypeDesc`) |
| `phoneNo` / `email` / `webSite1` | 联系方式 |
| `finance` | 最新一期财务摘要(见下) |

**`basic.finance` 财务摘要字段:**

| 字段 | 说明 |
|------|------|
| `fiscalYear` | 财年(佛历) |
| `totalIncome` | 总收入 |
| `netProfit` | 净利润 |
| `totalAsset` / `totalEquity` | 总资产 / 净资产 |
| `grossProfitMargin` / `netProfitMargin` | 毛利率 / 净利率 |
| `returnOnAsset` / `returnOnEquity` | 资产回报率 ROA / 净资产回报率 ROE |
| `currentRatio` / `debtToEquity` | 流动比率 / 资产负债率 |

**`financialStatements` 多年报表:**
```json
{
  "years": ["2566","2565","2564","2563","2562"],   // 佛历年份(减 543 = 公历)
  "annualData": {
    "2566": {
      "fiscalYear": "2566",
      "assets": 9118194,            // 总资产
      "currentassets": ...,         // 流动资产
      "currentliabilities": ...,    // 流动负债
      "revenue": 1693386,           // 营业收入
      "costsofsaleofgoodorservice": ..., // 营业成本
      "administrativeexpense": ...,      // 管理费用
      "profitloss": -97527,         // 净利润/亏损
      "currentRatio": ...,          // 流动比率
      "debtToEquity": ...,          // 资产负债率
      "accountReceivableTurnover": ...,  // 应收账款周转率
      "...": "每年含数十项财务科目及同比(...Ly=去年值, ...Pc=同比%)"
    }
  }
}
```

> 年份为**佛历**,转公历减 543(例:2566 = 2023)。字段后缀 `Ly` = 上年值,`Pc` = 同比百分比。

**`detail` 明细子项:**

| 字段 | 说明 |
|------|------|
| `committees` | 董事会成员(姓名、出资额、国籍等) |
| `signCommittees` | 签字授权人 |
| `partners` | 合伙人/股东 |
| `jpNations` | 股权国籍分布(`nationality` / `sharePctVol` 占比) |
| `capitalHists` | 注册资本变更历史 |
| `nameHists` | 名称变更历史 |

---

## 3. 错误码

| HTTP | 含义 | 说明 |
|------|------|------|
| `200` | 成功 | - |
| `400` | 请求错误 | 多为**参数未 URL 编码**(泰文/中文直接拼进 URL) |
| `401` | 未授权 | **缺少或错误的 API Key**(见 1.1) |
| `404` | 未找到 | `jpNo` 不存在,返回 `{"detail":"公司 xxx 未找到"}` |

---

## 4. 调用示例

**JavaScript (fetch):**
```javascript
const API_KEY = '你的密钥';
const headers = { 'X-API-Key': API_KEY };

// 搜索
const r = await fetch(
  'https://dbd.mikalife.co.th/api/companies?' +
  new URLSearchParams({ keyword: 'กมล', page: 1, page_size: 20 }),
  { headers }
);
const data = await r.json();

// 详情
const detail = await (
  await fetch('https://dbd.mikalife.co.th/api/companies/0105556054443', { headers })
).json();
```

**Python (requests):**
```python
import requests
BASE = "https://dbd.mikalife.co.th/api"
HEADERS = {"X-API-Key": "你的密钥"}

# 搜索(requests 自动 URL 编码 params)
r = requests.get(f"{BASE}/companies", params={"keyword": "กมล", "page_size": 20}, headers=HEADERS)
print(r.json()["total"])

# 详情
d = requests.get(f"{BASE}/companies/0105556054443", headers=HEADERS).json()
print(d["basic"]["jpName"], d["financialStatements"]["years"])
```

---

## 5. 注意事项

1. **URL 编码**:任何泰文/中文参数必须编码。用 `requests`(Python)、`URLSearchParams`(JS)、`curl --data-urlencode` 可自动处理。
2. **分页上限**:`page_size` 最大 `200`。大批量拉取请按 `page` 翻页。
3. **财年为佛历**:公历 = 佛历 − 543。
4. **数据增量更新**:总量持续增长,建议定期重新拉取列表。
5. 接口经 Cloudflare CDN,已设置不缓存(`Cache-Control: no-store`),返回均为实时数据。

