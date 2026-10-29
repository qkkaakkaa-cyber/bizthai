# BizThai 部署文档（一体化打包：代码 + 密钥配置 + 数据库全量导出）

> ⚠️⚠️ **这个包本身就是一份高敏感文件** —— 内含全部生产密钥（数据库密码、`SESSION_SECRET`、DeepSeek key 等）和全库真实数据（含董事个人身份证号/护照号/持股信息）。按你的要求：**密钥未轮换，原样打包**；数据库**全量导出**；由你自己 SSH 传输，本文档不涉及传输目的地。
>
> 处理这份包时请遵守：
> - 只在你信任的终端上操作，不要经过任何第三方中转/云盘。
> - 传输用 `scp`/`rsync over ssh`（本身已加密），不要用明文协议。
> - 服务器上落地后立刻 `chmod 600`，用完（确认服务已起来、数据已核对）就删除，不要长期留在服务器的可访问路径上。
> - 本地这份用完也建议删掉或移到加密卷里，不要留在 `~/Desktop` 这种容易被同步/截屏/误分享的位置。

---

## 0. 包里有什么

```
dbd-thai-full-deploy-<时间戳>.tar   ← 外层不二次压缩(pg_dump 已自带压缩,再压一遍收益很小、还费时间)
├── dbd-thai/                       ← 全部源码 + 真实 .env（已按裸机生产值调整，密钥数值未变）
├── dbdadmin_woocms.dump            ← pg_dump 自定义格式全量导出(42GB 原始库 → 压缩后见下方实际体积)
├── roles.sql                       ← 数据库角色定义(dbd_readonly / dbdadmin_woocms / woocms，含密码哈希)
└── DEPLOYMENT.md                   ← 就是本文件
```

**这一轮本地改动清单**（先心里有数）：

| 类别 | 改动 |
|---|---|
| 数据库 | 新建只读角色 `dbd_readonly`；`thaicompany_views` 建表移出请求路径；`idx_thaicompany_nameslug` 索引固化——**这些已经在 `dbdadmin_woocms.dump` 里了，还原数据库时会一起还原，不需要单独再跑一遍脚本** |
| 代码 | `analytics/src/db.js` 省份分析查询重写（改走 `thaicompany_facts` + 合并单条SQL + disableNestloop），曼谷类大府查询从超时失败→6-7秒 |
| 代码 | `resolver`+`biz.js`：`/companies`、行业分类页加服务端翻页（`?page=N`）——**需要 nginx 补一条路由**（见第 5 节） |
| 代码 | `header.html`：修复中文/泰文页行业下拉产生 `/industry-.html` 死链 |
| 代码 | resolver/analytics/directors 连接池加固、resolveSlug 权限过滤、hreflang+canonical 修正 |
| 代码 | directors 加限流+登录门槛（证件号反查）、ai 的 `/report-pdf`+`/poster` 加登录门槛 |
| 配置 | `admin/.env`：`HTTP_ADDR`/`DB_HOST`/`REDIS_ADDR` 已从 docker 值改成 `127.0.0.1`，`COOKIE_SECURE` 改 `true`（密钥数值不变） |
| 配置 | `resolver`/`analytics`/`directors` 的 `.env` 已显式写入只读账号 `dbd_readonly`（不再依赖运行时环境变量覆盖，裸机部署也会生效） |
| 配置 | 补 3 个 systemd timer（facts刷新/首页池刷新/区域关联）+ logrotate |

---

## 1. 传输

```bash
# 本机(你自己执行,目的地由你决定)
scp dbd-thai-full-deploy-*.tar youruser@<你的服务器>:/tmp/
ssh youruser@<你的服务器>
chmod 600 /tmp/dbd-thai-full-deploy-*.tar   # 落地立刻收权限
```

---

## 2. 服务器上解包

```bash
cd /tmp
tar -xf dbd-thai-full-deploy-*.tar
ls   # 应看到 dbd-thai/ dbdadmin_woocms.dump roles.sql DEPLOYMENT.md
chmod 600 dbdadmin_woocms.dump roles.sql   # 这两个文件含真实数据/密钥,单独收紧权限
```

若目标服务器**已经在跑**一份旧的 `/data/projects/dbd-thai/`：
```bash
sudo systemctl stop dbdadmin-woocms dbdresolver dbdanalytics dbddirectors dbdai
sudo mv /data/projects/dbd-thai /data/projects/dbd-thai.bak.$(date +%Y%m%d%H%M%S)   # 整目录备份,回滚用
```

```bash
sudo mkdir -p /data/projects
sudo mv /tmp/dbd-thai /data/projects/dbd-thai
sudo chown -R www-data:www-data /data/projects/dbd-thai
sudo chmod 600 /data/projects/dbd-thai/*/.env /data/projects/dbd-thai/admin/.env
```

---

## 3. 数据库还原（全新导入，不是增量迁移）

⚠️ 这一步会**创建/覆盖**目标数据库，如果服务器上已经有一个同名的正式数据库在跑，**千万不要对着它直接还原**——务必先确认目标库是空的/是你打算废弃重建的那个，否则会覆盖生产现有数据。不确定就先 `pg_dump` 备份一下服务器现有库再继续。

```bash
# 1) 还原角色定义(需要 CREATEROLE 权限的账号,通常是 postgres 超级用户)
psql -U postgres -f /tmp/roles.sql

# 2) 建空库,属主设为 dbdadmin_woocms(与 dump 里记录的属主一致,后续还原不会有属主报错)
createdb -U postgres -O dbdadmin_woocms dbdadmin_woocms

# 3) 还原数据(用 postgres 超级用户还原最省心;-j 4 并行加速,按服务器核数调整;这一步含索引重建,
#    194 万行大表的索引重建比数据导入本身更慢,请耐心等待,不要中途 Ctrl+C)
pg_restore -U postgres -d dbdadmin_woocms -j 4 --verbose /tmp/dbdadmin_woocms.dump 2>&1 | tee /tmp/pg_restore.log
```

**这次导出已经包含**（还原后自动到位，不需要额外跑 `ops/*.sql`）：
- `idx_thaicompany_nameslug` 索引
- `dbd_readonly` 角色在全部表上的 SELECT 授权 + `ALTER DEFAULT PRIVILEGES`（未来新表自动继承）
- `thaicompany_views` 浏览量计数表
- `thaicompany_facts` 物化视图（连带当前已刷新的数据）
- WooCMS 自己的 migrations 记录表（WooCMS 启动时会自动跳过已应用的迁移，不会重复执行）

**还原后验证**：
```sql
SELECT count(*) FROM woocms.cms_content_entries WHERE content_model_id=2;  -- 应接近 195万
SELECT indexname FROM pg_indexes WHERE indexname='idx_thaicompany_nameslug'; -- 应有一行
SELECT rolname FROM pg_roles WHERE rolname='dbd_readonly';                  -- 应有一行
```

---

## 4. 依赖安装

```bash
cd /data/projects/dbd-thai
for svc in resolver analytics directors ai; do
  (cd $svc && sudo -u www-data npm ci --omit=dev --no-audit --no-fund)
done
```

**Node 版本**：4 个服务 `package.json` 都要求 `>=22`，确认 `node --version`。

**ai 服务**（如果服务器还没装）：
```bash
sudo apt-get install -y chromium font-noto-cjk fonts-noto-cjk fonts-noto-color-emoji
# 泰文字体包名视发行版而定(如 fonts-thai-tlwg),请按实际系统核实
which chromium || which chromium-browser   # 确认路径,核对 ai/.env 的 PUPPETEER_EXECUTABLE_PATH 是否匹配
```

---

## 5. systemd 服务

```bash
# 已有 5 个主服务(如果是全新服务器,先装:见各自 deploy/*.service)
sudo cp resolver/deploy/dbdresolver.service /etc/systemd/system/
sudo cp analytics/deploy/dbdanalytics.service /etc/systemd/system/
sudo cp directors/deploy/dbddirectors.service /etc/systemd/system/
sudo cp directors/deploy/dbdadmin-director-index.service /etc/systemd/system/
sudo cp directors/deploy/dbdadmin-director-index.timer /etc/systemd/system/
sudo cp ai/deploy/dbdai.service /etc/systemd/system/
# WooCMS 主服务 unit 本仓库没有,沿用服务器现有的 dbdadmin-woocms.service

# 本轮新增的 3 个定时任务(务必装,这是审计发现"缺失但一直没人补"的调度)
sudo cp ops/deploy/dbdadmin-facts-refresh.service /etc/systemd/system/
sudo cp ops/deploy/dbdadmin-facts-refresh.timer /etc/systemd/system/
sudo cp ops/deploy/dbdadmin-homepage-pool.service /etc/systemd/system/
sudo cp ops/deploy/dbdadmin-homepage-pool.timer /etc/systemd/system/
sudo cp ops/deploy/dbdadmin-associate-regions.service /etc/systemd/system/
sudo cp ops/deploy/dbdadmin-associate-regions.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now dbdadmin-woocms dbdresolver dbdanalytics dbddirectors dbdai
sudo systemctl enable --now dbdadmin-director-index.timer dbdadmin-facts-refresh.timer dbdadmin-homepage-pool.timer dbdadmin-associate-regions.timer
sudo systemctl status dbdadmin-woocms dbdresolver dbdanalytics dbddirectors dbdai --no-pager
sudo systemctl list-timers | grep dbdadmin
```

**启动顺序**：PostgreSQL（已还原好数据）→ `dbdadmin-woocms`（migrations 自动跳过已应用的）→ `dbdresolver`/`dbdanalytics`/`dbddirectors`（互相独立）→ `dbdai` → nginx reload。

---

## 6. nginx 配置（本轮新增路由规则，合并进生产 vhost）

生产 nginx 配置本身不在这个包里（通常在 `/www/server/panel/vhost/nginx/bizthai.com.conf` 一类路径），需要你直接在服务器上编辑。本地参考实现在 `ops/nginx.local.conf`，**这次要新增/核对**：

**6.1** `/companies` 路由到 resolver（否则 `?page=N` 翻页不生效，但首页本身仍能用旧的 WooCMS 直出）：把 `companies` 加进现有 `business-*` 那条正则 location（含 `/zh`、`/th` 前缀变体）。

**6.2** 安全响应头（先 `curl -sI https://<你的域名>/` 看现有响应头，WooCMS 原生已经带一部分，别重复加）。

**6.3** 限流（AI/董事反查接口，具体 zone/burst 参考 `ops/nginx.local.conf`）。

**6.4** `/admin` 后台建议加 IP 白名单，本仓库做不了，需要你在生产直接配。

```bash
sudo nginx -t && sudo nginx -s reload
```

---

## 7. logrotate

```bash
sudo cp ops/deploy/dbd-thai.logrotate /etc/logrotate.d/dbd-thai
sudo logrotate -d /etc/logrotate.d/dbd-thai   # dry-run 检查规则
```

---

## 8. 上线冒烟测试（每项都要过）

```bash
DOMAIN=https://<你的域名>

curl -sI $DOMAIN/ | head -1
curl -s $DOMAIN/api/site/v1/resolver/health      # {"ok":true,"index":"idx_thaicompany_nameslug",...}
curl -s $DOMAIN/api/site/v1/analytics/health     # {"ok":true,"ready":true,...}
curl -s $DOMAIN/api/site/v1/directors/health     # {"ok":true,"index":{...}}
curl -s $DOMAIN/api/site/v1/ai/health            # {"ok":true,"hasKey":true,...}

# 公司详情页 SSR 面板非空壳(最关键)
curl -s $DOMAIN/<挑一个真实英文名slug>.html | grep 'data-panel="business"'

# sitemap/robots
curl -s $DOMAIN/robots.txt | grep -i sitemap
curl -s $DOMAIN/sitemap.xml | head -5

# 本轮新功能
curl -sI "$DOMAIN/companies?page=2" | head -1                 # 200
curl -sI "$DOMAIN/zh/industry-manufacturing.html" | head -1   # 200(header.html 修复验证)

# 只读角色权限边界(服务器本地测,不要暴露公网)
psql -U dbd_readonly -d dbdadmin_woocms -c "SELECT 1;"                                          # 应成功
psql -U dbd_readonly -d dbdadmin_woocms -c "UPDATE woocms.cms_content_entries SET title=title WHERE id=1;"  # 应报 permission denied

# 董事PII接口鉴权
curl -s "$DOMAIN/api/site/v1/directors/search?q=abc123&mode=id" -w "\n%{http_code}\n"   # 期望 401
```

失败先看日志：`journalctl -u <服务名> -n 50` 或 `logs/<服务名>.app-error.log`。

---

## 9. 回滚

```bash
sudo systemctl stop dbdadmin-woocms dbdresolver dbdanalytics dbddirectors dbdai
sudo rm -rf /data/projects/dbd-thai
sudo mv /data/projects/dbd-thai.bak.<时间戳> /data/projects/dbd-thai
sudo systemctl daemon-reload && sudo systemctl start dbdadmin-woocms dbdresolver dbdanalytics dbddirectors dbdai
```
数据库如果还原前已备份旧库，可用同样方式 `pg_restore` 换回去；如果是全新库直接丢弃即可（`dropdb dbdadmin_woocms`）。

---

## 10. 上线后例行运维

- **facts 刷新**：每日 05:00。**首页浏览池**：每周日 04:00。**区域关联**：每日 04:30。**董事索引**：每小时。——四个 timer 都要确认在跑（`systemctl list-timers`）。
- **日志轮转**：确认 logrotate 生效，`logs/` 目录不会无限增长。
- **数据库备份**：本包是"一次性搬家快照"，**不是**日常备份方案——上线后请单独建立生产自己的定期 `pg_dump`/`pg_basebackup` 策略，不要以为这次导出就是长期备份。
- **jpno 去重**：`ops/dedup_thaicompany.sql` 会做真实 DELETE，执行前请仔细看一遍脚本逻辑，选低峰期手动执行，本次没有自动处理。
- **`sync` ETL 管线**：确认 `sync/.env` 里的 `THAI_API_KEY`（抓取数据源）仍然有效，`sync.py` 的定时任务（每日 03:30）继续跑，数据库还原不影响这条已有调度。

---

*本文档随 `dbd-thai-full-deploy-<时间戳>.tar` 一起产出。传输目的地、传输方式由你自己决定和执行。*
