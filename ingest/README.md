# ingest —— BizThai/DBD 增量同步接收端

对端(独立服务器上的 DBD 同步程序)按需 push 数据的**唯一特权写入口**。Node.js sidecar,
挂 nginx 后、`pg.Pool` 直写 `woocms.cms_content_entries.meta_json`(与 `sync/direct_import.py`、
`sync/backfill_zh.py` 同手法)。与公开读 sidecar(directors/resolver/analytics/ai)物理隔离。

发给对端的接口契约见 `对接确认回执.md`。

## 接口
- `POST /api/internal/dbd/thaicompany/manifest/query` —— 推送前比对
- `POST /api/internal/dbd/thaicompany/upsert-batch` —— 完整企业 upsert(`mode=upsert_if_newer`)
- `POST /api/internal/dbd/thaicompany/patch-fields-batch` —— 5 字段补采合并(`mode=merge_patch_fields`)
- `GET  /api/internal/dbd/sync/batches/{batch_id}` —— 批次核对
- `GET  /api/internal/dbd/health` —— 健康(不鉴权)

## 结构
- `src/config.js` —— 端口/token/限额/常量;DB 凭据继承 `../admin/.env`
- `src/db.js` —— 全部 SQL:manifest / upsert(含关联 term)/ patch / 批次幂等与审计
- `src/server.js` —— HTTP 层:Bearer 鉴权 + 路由 + body 大小限制 + dry_run
- `deploy/schema.sql` —— 2 张日志表 `dbd_sync_batches` / `dbd_sync_batch_items`
- `deploy/dbdingest-v2.service` —— systemd 单元(v2 路径,User=www-data)
- `deploy/nginx-ingest.conf` —— nginx location(IP 白名单 + 不缓存)

## 部署(需 root / 逐步核对,不自动改线上)
```bash
cd /www/wwwroot/bizthai/dbd-thai/ingest
npm install                                   # 装 pg

# 1) 建日志表(core 大表零改动)
psql "$DSN" -f deploy/schema.sql

# 2) 配 .env(权限 600):生成 token 并填入,PORT=9188
cp .env.example .env && chmod 600 .env
openssl rand -hex 32                           # 生成 SYNC_TOKEN 填进 .env,并带外发给对端

# 3) systemd
sudo cp deploy/dbdingest-v2.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dbdingest-v2
sudo systemctl status dbdingest-v2

# 4) nginx:把 deploy/nginx-ingest.conf 的内容并入
#    /www/server/panel/vhost/nginx/bizthai.com.conf(必要时 www2.bizthai.com.conf)的 server{} 块,
#    置于通用 /api/ location 之前;把 <SYNC_SERVER_IP> 换成对端出口 IP。
sudo /www/server/nginx/sbin/nginx -t && sudo /www/server/nginx/sbin/nginx -s reload
```

## 冒烟自测(本地,测试端口)
```bash
PORT=9198 BIND_HOST=127.0.0.1 SYNC_TOKEN=test node src/server.js &
curl -s localhost:9198/api/internal/dbd/health
# dry_run(不落库):
curl -s -X POST 'localhost:9198/api/internal/dbd/thaicompany/patch-fields-batch?dry_run=true' \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer test' \
  -d '{"items":[{"jpno":"0635562000495","fields":{"nameHists":[]}}]}'
```

## ⚠️ 关联运维缺口(上线前一并核实)
`ops/deploy/dbdadmin-facts-refresh.{service,timer}` 仍指向 v1 路径 `/data/projects/dbd-thai`、
`After=` 是 v1 服务名 —— v2 下大概率没在跑。**新 upsert 的公司在 facts 物化视图刷新前不进
列表/analytics/部分搜索**(补采 patch 字段只在详情页读,不受影响)。与已知"首页公司池冻结/
无 cron 调度"同类问题,建议一并修 v2 路径并启用 timer。

## 安全约定(遵守本仓 CLAUDE.md「数据库安全约定」)
每条写都以 `slug`(=jpno)唯一键定位;每批 `SET statement_timeout`;批量 500~2000;支持 dry_run。
未配置 token = 拒绝一切写(fail-closed)。
