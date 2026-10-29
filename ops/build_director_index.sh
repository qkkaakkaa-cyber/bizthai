#!/bin/bash
# 董事反查倒排索引 全量重建 — 由 systemd timer 周期调用。
# 从 admin/.env 读取 DB 凭据,执行 build_director_index.sql(build-new + 原子 swap)。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_ENV_PATH="${DBD_DB_ENV:-$ROOT_DIR/admin/.env}"
SQL="$ROOT_DIR/ops/build_director_index.sql"

getenv() { grep -E "^$1=" "$ADMIN_ENV_PATH" | head -1 | cut -d= -f2-; }

export PGPASSWORD="$(getenv DB_PASSWORD)"
DB_HOST="$(getenv DB_HOST)"; DB_PORT="$(getenv DB_PORT)"
DB_USER="$(getenv DB_USER)"; DB_NAME="$(getenv DB_NAME)"

exec psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q -f "$SQL"
