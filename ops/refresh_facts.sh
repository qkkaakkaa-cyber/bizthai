#!/usr/bin/env bash
# 刷新分析物化视图 woocms.thaicompany_facts(从 meta_json 重抽标量列)。
# WooCMS 的 jsonb 全库聚合在 76 万行 × 11KB meta_json 上每条 ~140s 且 planner 不计 detoast、
# 不走索引;故 analytics 改为直查这张精简视图(聚合毫秒级)。视图需周期性刷新以纳入新同步的公司。
# CONCURRENTLY:刷新期间不阻塞 analytics 的读(需 unique 索引 idx_tcf_entry,已建)。
# 用法:DBD_DB_ENV=.../admin/.env ops/refresh_facts.sh(本机等非默认部署用);
# 不传时默认线上路径,行为与之前一致。
set -euo pipefail
ADMIN_ENV_PATH="${DBD_DB_ENV:-/data/projects/dbd-thai/admin/.env}"
getenv() { grep -E "^$1=" "$ADMIN_ENV_PATH" | head -1 | cut -d= -f2-; }
export PGPASSWORD="$(getenv DB_PASSWORD)"
DB_HOST="$(getenv DB_HOST)"; DB_PORT="$(getenv DB_PORT)"
DB_USER="$(getenv DB_USER)"; DB_NAME="$(getenv DB_NAME)"

exec psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q \
  -c "REFRESH MATERIALIZED VIEW CONCURRENTLY woocms.thaicompany_facts;" \
  -c "ANALYZE woocms.thaicompany_facts;"
