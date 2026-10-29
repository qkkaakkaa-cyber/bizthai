#!/bin/bash
# 泰国企业 区域+业务分类 自动关联 — 由 systemd timer 周期调用。
# 从 admin/.env 读取 DB 凭据,执行幂等关联 SQL。
set -euo pipefail
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ADMIN_DIR="${DBD_ADMIN_DIR:-$ROOT_DIR/admin}"
SQL="${DBD_ASSOCIATE_SQL:-$ROOT_DIR/ops/associate_regions.sql}"

getenv() { grep -E "^$1=" "$ADMIN_DIR/.env" | head -1 | cut -d= -f2-; }

export PGPASSWORD="$(getenv DB_PASSWORD)"
DB_HOST="$(getenv DB_HOST)"; DB_PORT="$(getenv DB_PORT)"
DB_USER="$(getenv DB_USER)"; DB_NAME="$(getenv DB_NAME)"

exec psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q -f "$SQL"
