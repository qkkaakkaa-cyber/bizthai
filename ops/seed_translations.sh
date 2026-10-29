#!/usr/bin/env bash
# 落库 woocms.cms_term_translations —— province / industry / capital 三语(th/en/zh-CN)。
# 幂等可重跑(ON CONFLICT)。只写译文旁表,不动主表 name/slug，不影响区域/业务/资本关联。
# 译文种子在 sync/i18n_seed/(已纳入版本);改种子后重跑此脚本即可生效。
# 骨架(*.seed.json)如需再生见 sync/i18n_seed/README.md。
# companytype(tax 2)译文随阶段5重构后单独处理,不在此脚本。
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . admin/.env; set +a
PG() { PGPASSWORD="${DB_PASSWORD:-$DATABASE_PASSWORD}" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-dbdadmin_woocms}" -d "${DB_NAME:-dbdadmin_woocms}" "$@"; }

python3 sync/seed_translations.py
PG -q -f sync/i18n_seed/_translations.sql
echo "== 落库后按 locale 计数 =="
PG -c "SELECT locale,count(*) FROM woocms.cms_term_translations GROUP BY locale ORDER BY locale;"
