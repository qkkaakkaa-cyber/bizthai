# DBD Thai — 董事按证件号反查服务(directors sidecar)

独立轻量 Node(ESM,零依赖,node≥22)sidecar,**不改 WooCMS 二进制**。把每家公司
`meta_json.raw.committees[]` 里的董事记录,按证件号 `cmtNo` 建成倒排表,提供
「给一个证件号 → 此人名下所有公司」的反查能力。监听 `127.0.0.1:8085`,
nginx 用 `location ^~ /api/site/v1/directors/` 反代(同 analytics 的分流方式)。

## 为什么需要它

DBD 数据以公司为中心,`committees` 嵌在每家公司下。前端只能拿到「当前这家公司」的董事
记录,无法知道同一人还在别处挂名。反查必须建一个 `cmtNo → [公司列表]` 的倒排索引。

关联键是 **证件号 cmtNo**(泰籍=13 位身份证,外籍=护照号),**不是姓名**(同名不同人常见)。

## 接口

### `GET /api/site/v1/directors/{cmtNo}`

反查此人名下所有公司。查询参数:`?limit=`(默认 50,上限 500)、`?offset=`(默认 0)。

```jsonc
{
  "cmtNo": "3101400701531",
  "person": { "nameTh": "นาย ...", "nameEn": "KITTINAN ...", "ntCode": "TH" },
  "companies": [
    {
      "jpNo": "0105525043334",
      "companyNameTh": "บริษัท ... จำกัด",
      "companyNameEn": "... COMPANY LIMITED",
      "cmtTypeCode": "KC",            // 职位代码(KC=กรรมการ/董事)
      "cmtSeq": "1",
      "investAmt": null,             // DBD 多为空
      "investType": "",
      "updateDate": "2023-07-25",
      "companyStatus": "ยังดำเนินกิจการอยู่",
      "province": "กรุงเทพมหานคร"
    }
  ],
  "total": 3,                        // 该人任职公司总数(用于分页)
  "limit": 50,
  "offset": 0,
  "aggregatable": true
}
```

### `GET /api/site/v1/companies/{jpNo}/related`

公司视角:与该公司**共享董事**的其他公司。查询参数同上(`?limit=`、`?offset=`)。
按共享董事人数降序。**隐私:共享董事明细只回姓名 + 双方各自职位,绝不返回 cmtNo 等证件号。**
(实际控制人/股权穿透因 DBD 无股东与持股比例 —— `partners` 恒空、`investAmt` 几乎全空 —— 暂不做。)

```jsonc
{
  "jpNo": "0105476000061",
  "company": { "nameTh": "บุญรอดบริวเวอรี่ จำกัด", "nameEn": "...", "province": "...", "status": "..." },
  "total": 31,
  "limit": 50, "offset": 0,
  "related": [
    {
      "jpNo": "...",
      "companyNameTh": "...", "companyNameEn": "...",
      "province": "...", "companyStatus": "...",
      "sharedCount": 6,                     // 共享董事人数(排序键)
      "sharedDirectors": [
        { "nameTh": "นาย ...", "nameEn": "...", "positionInSource": "KC", "positionInRelated": "KC" }
      ]
    }
  ]
}
```

经 `director_index.jp_no` 索引取来源公司董事 → 经 `cmt_no` 关联到其他公司(cmt_no 仅用于
内部 JOIN,不出现在响应)。nginx 用 regex `~ ^/api/site/v1/companies/[^/]+/related$` 反代到本服务。

### `GET /api/site/v1/companies/{jpNo}/network?depth=&maxNodes=&minShared=`

公司视角:共享董事**关系子图**(替代前端逐层递归)。服务端 BFS 多级展开 + 全局去重 +
`maxNodes` 规模上限 + 按每条边共享董事数 `minShared` 剪枝。`edges` 含最终节点集内**任意两点**
的交叉边(非仅 BFS 树边)。隐私:`sharedDirectors` 只回姓名,**不含 cmtNo**。

参数(均有 clamp):`depth`(默认 2,1–4)、`maxNodes`(默认 60,1–300)、`minShared`(默认 1,1–50)。

```jsonc
{
  "jpNo": "0105476000061", "depth": 2, "maxNodes": 60, "minShared": 2,
  "truncated": false,                  // 是否因 maxNodes 截断(还有更多节点未展开)
  "nodes": [
    { "jpNo": "0105476000061", "nameTh": "บุญรอด...", "nameEn": "...", "province": "...", "status": "...", "degree": 0 }
    // degree = BFS 层级(源公司=0)
  ],
  "edges": [
    { "source": "0105476000061", "target": "0105528015153", "sharedCount": 3,
      "sharedDirectors": [ { "nameTh": "นาย ...", "nameEn": "..." } ] }
  ]
}
```

边界:无在册(有效)董事的公司 → 单根节点、无边;非法 jpNo → 400。

### `GET /api/site/v1/directors/health`

```jsonc
{ "ok": true, "index": { "builtAt": "...", "totalRows": 449153, "distinctPeople": 364354 } }
```

## 不可聚合的 cmtNo

DBD 源数据里约 **6.8%** 董事 `cmtNo` 为空,另有 `"1"`/`"00"`/`"fff"` 等占位垃圾值。
聚合这些 key 会把无关的人错并到一起(隐私+正确性 bug),故:

- 倒排索引只收 `^[A-Za-z0-9]{6,}$` 且非单字符重复的 `cmtNo`。
- 对不合规的 key,接口返回稳定的空结果 `{ aggregatable:false, companies:[], total:0 }`(非错误),
  **前端按来源公司 `jpNo+cmtSeq` 兜底展示**那一条即可。

## 倒排索引表

- 表:`woocms.director_index`(`cmt_no` 上建 btree),meta:`woocms.director_index_meta`。
- 构建:`ops/build_director_index.sql`(展开 committees + 反规范化公司字段)。采用
  **build-new + 原子 swap**:重建在 `director_index_build` 上进行(~100s,不锁 live 表),
  仅末尾极短事务 DROP 旧 + RENAME 新,读取几乎不停机。
- 刷新:systemd `dbdadmin-director-index.timer` 每小时跑 `ops/build_director_index.sh`
  (数据由外部入库进程持续写入,1 小时新鲜度足够)。

## 访问控制 / PII

`cmtNo` 是泰国身份证号。当前策略(与 analytics 一致):**公开、cmtNo 原样返回**
(DBD 源数据本身公开;调用方本就持有该 cmtNo,原样回传不构成新泄露)。如需收紧,可在
nginx 层加 auth 或在本服务加鉴权后再开放。

## 部署

```bash
# 1) 首次构建索引(也可由 timer 首跑)
ops/build_director_index.sh

# 2) sidecar
sudo cp deploy/dbddirectors.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dbddirectors

# 3) 索引刷新 timer
sudo cp deploy/dbdadmin-director-index.service deploy/dbdadmin-director-index.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dbdadmin-director-index.timer

# 4) nginx:把 deploy/nginx-directors.conf 的 location 插入 dbdweb.woocms.org 的
#    server{} 块(置于通用 /api/ 之前),然后 nginx -t && systemctl reload nginx
```

## 前端接线

路由从 `/director/:jpNo/:cmtSeq` 定位到来源董事、拿到 `cmtNo`,再调
`GET /api/site/v1/directors/{cmtNo}` 填「挂名公司列表」。若改 person-centric 干净 URL
`/director/:cmtNo`,空/不合规 cmtNo 的极少数人按 `aggregatable:false` 走兜底。
