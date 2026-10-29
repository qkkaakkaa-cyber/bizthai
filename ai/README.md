# dbd-ai —— AI 对话助手 sidecar

DeepSeek 工具调用(function calling)Agent。用户用自然语言探索泰国企业,模型自主调用「工具」拿真实数据再组织成回答(三语),**零编造**。与 analytics/directors/resolver 同构(原生 Node HTTP、零依赖、ESM、Node≥22)。

## 架构

```
浏览器 /ai 聊天页
   │  POST /api/site/v1/ai/chat (SSE)
   ▼
ai sidecar (8087) ── DeepSeek /chat/completions(工具调用循环,流式)
   │  每个「工具」= 内部 fetch:
   ├─ WooCMS 8083  /models/thaicompany/entries[/{jpno}]、/auth/me
   ├─ analytics 8084  /business、/business/companies、/business/foreign、/regions
   └─ directors 8085  /companies/{jpno}/related、/directors/search、/by-nationality
```

本服务**不碰数据库**,只是编排层。

## 工具清单

`search_companies`(关键词/府/排序)· `get_company`(单条:财务/董事/经营)· `company_relations`(共享董事关联)· `lookup_person`(按人/证件号反查)· `market_snapshot`(市场/府聚合)· `rank_companies`(资本/最新榜)· `foreign_companies`(外资组成/按国别)。

## SSE 事件

`meta`(额度)→ `status`(工具检索中)→ `cards`(公司卡,增量去重)→ `delta`(答案 token)→ `done` / `error` / `gate`(匿名超额需登录)。

## 门控

匿名按 `ai_anon` cookie/IP 计数,达 `AI_TRIAL_LIMIT`(默认 5)即发 `gate`;登录会员(WooCMS `/auth/me` 命中)按 uid,额度 `AI_MEMBER_DAILY_LIMIT`(默认 60)。计数为进程内内存窗口。

## 配置

复制 `.env.example` 为 `.env`(www-data:600),填 `DEEPSEEK_API_KEY`(同 `sync/.env` 那把官方 key —— 本服务跑 www-data 读不到 root:600 的 sync/.env,故需复制一份)。模型 `deepseek-v4-flash`。

## 本地运行 / 部署

```bash
# 本地
node src/server.js
curl -s localhost:8087/api/site/v1/ai/health

# 部署(需授权)
sudo cp deploy/dbdai.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dbdai
# nginx:把 deploy/nginx-ai.conf 的 location 加进 dbdadmin.woocms.org 的 server{}(置于通用 /api/ 之前)
sudo nginx -t && sudo systemctl reload nginx
```

> SSE 必须 `proxy_buffering off` + 长 `proxy_read_timeout`(见 nginx-ai.conf),否则前端收不到增量。

## 联调验证(2026-06-24)

`deepseek-v4-flash` 已确认支持 function calling + 流式;实测「曼谷资本最大的公司」→ search_companies→get_company→流式对比表,有据可查。
