# sync/ —— DBD Thai 数据同步(DBD DataWarehouse+ → 后端入库)

把 DBD DataWarehouse+ 企业数据,定时入库到本机 WooCMS 的自定义内容模型 `thaicompany`,前端再经 WooCMS 公开站点接口消费。

```
DBD DataWarehouse+ ──(本目录 ETL)──> WooCMS CPT(thaicompany, slug=jpNo)──> /api/site/v1/models/thaicompany/entries ──> 前端
```

## 文件

| 文件 | 作用 |
|------|------|
| `dbd.py` | DBD DataWarehouse+ 数据接口客户端(stats / 分页 companies / detail) |
| `woocms.py` | WooCMS 管理端客户端(login+CSRF、建模型/分类法/词条、条目 upsert) |
| `mapping.py` | 泰国详情 → 前端 `DbdRawCompany` 形状 + 列表展示字段 |
| `bootstrap.py` | 一次性幂等建模:模型 `thaicompany` + 分类法 `province`/`companytype` |
| `sync.py` | 主同步流程(全量/增量/upsert,状态落 `state.json`) |
| `i18n_worker.py` | 异步翻译 worker:消费 `i18n_queue/pending.jsonl`,批量补译,不阻塞导入 |
| `dbdadmin-sync.service` / `.timer` | systemd 定时(每日增量) |
| `dbdadmin-backfill.service` | 首灌常驻进程:只抓取/写入 WooCMS,缺译仅投递队列 |
| `dbdadmin-translate-worker.service` / `.timer` | 每 10 分钟消费缺译队列,独立调用翻译 API |

## 配置

```bash
cp .env.example .env && chmod 600 .env
# 填写 THAI_API_KEY(数据方提供)、WOOCMS_ADMIN_PASS(取自 admin/.env)
```

## 运行

```bash
python3 bootstrap.py            # 建模型/分类法(幂等,首次必跑)
python3 bootstrap_fields.py     # 建后台字段组(9 个选项卡 + 中文标签,幂等)
python3 sync.py --limit 5       # 冒烟:只入库前 5 家
python3 sync.py                 # 增量:新公司入库 + 详情按 SYNC_REFRESH_DAYS 轮转刷新
python3 sync.py --full          # 全量:每家重取详情
python3 sync.py --no-detail     # 仅列表字段快速铺底(不取详情)
python3 sync.py --backfill      # 首灌:持续导入未入库公司,不等待翻译
python3 i18n_worker.py          # 消费缺译队列,批量翻译
```

> 注:WooCMS 的 cookie 为 `Secure`,脚本直连 `http://127.0.0.1:8083` 时已在 `woocms.py`
> 内手动回传 cookie + CSRF(生产经 nginx HTTPS 的浏览器不受影响)。

## 导入与翻译解耦

- 导入进程永远不直接调用翻译 API。`sync.py` 发现 geo/keyin 缺译时,只向
  `i18n_queue/pending.jsonl` 追加 JSONL 任务,meta 先使用英/泰兜底。
- `dbdadmin-translate-worker.timer` 每 10 分钟触发 `i18n_worker.py`,独立消费队列、去重、
  批量调用 DeepSeek,并写回 `i18n_seed/*.json`。
- 每日 `dbdadmin-translate.service` 仍可做全库缺口扫描/存量回填,但首灌运行中会跳过大批量
  回填,避免影响 `dbdadmin-backfill.service` 吞吐。

## 定时部署(systemd)

```bash
# 目录与 .env 需 www-data 可读写(state.json 由服务写入)
sudo chown -R www-data:www-data /data/projects/dbd-thai/sync

sudo cp dbdadmin-sync.service dbdadmin-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start dbdadmin-sync.service     # 手动跑一次看日志
sudo journalctl -u dbdadmin-sync -f
sudo systemctl enable --now dbdadmin-sync.timer
systemctl list-timers dbdadmin-sync.timer
```

## 数据落点

- 模型 `thaicompany`:`title`=泰文名,`slug`=jpNo,`meta`={展示字段 + `meta.raw`=完整 DbdRawCompany},
  `term_ids`=[省份, 类型]。
- 公开读取:`GET /api/site/v1/models/thaicompany/entries[/{jpNo}]`(无需登录,返回 `meta`)。
