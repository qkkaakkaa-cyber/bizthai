"""存量回填三语扁平中文字段 + i18n 块,复用 mapping.inject_zh_fields(单一事实源),不重取 DBD。

用途:种子(geo_zh/industry_zh/...)或 mapping 接线更新后,把已入库的 6.5 万家公司的
中文字段(ampurdesczh/tumbondesczh/setupobjgrpdesczh/addresszh/... 见 mapping.ZH_FIELDS)
和 meta.i18n 重算并回写。**只 patch 这些键(meta_json || patch),保留 raw 与其他字段。**

幂等:重复跑覆盖同名键。增量(新入库)由 sync.py 的 display_meta 自动产出,无需此脚本。
用法:
  python3 backfill_zh.py --limit 5   # 冒烟
  python3 backfill_zh.py             # 全量
"""
import argparse
import csv
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import mapping

ENV_PATH = os.environ.get("DBD_DB_ENV", str(Path(__file__).resolve().parents[1] / "admin" / ".env"))
PATCH_PATH = f"/tmp/zh_patch.{os.getpid()}.csv"  # 唯一名:避免 root/www-data 跑残留文件的权限冲突
WHERE = "content_model_id=2 AND deleted_at IS NULL"


def db_env() -> dict:
    cfg = {}
    for line in Path(ENV_PATH).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DB_") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k] = v
    return cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="只处理前 N 条(冒烟用)")
    args = ap.parse_args()

    csv.field_size_limit(16 * 1024 * 1024)
    zl = mapping.load_zh_lookup()
    db = db_env()
    psql = ["psql", "-q", "-h", db["DB_HOST"], "-p", db.get("DB_PORT", "5432"),
            "-U", db["DB_USER"], "-d", db["DB_NAME"]]
    penv = {**os.environ, "PGPASSWORD": db["DB_PASSWORD"]}

    limit_sql = f" LIMIT {args.limit}" if args.limit else ""
    export_sql = (f"COPY (SELECT id, meta_json - 'raw' FROM woocms.cms_content_entries "
                  f"WHERE {WHERE} ORDER BY id{limit_sql}) TO STDOUT WITH (FORMAT csv)")

    print(f"[1/3] 导出 meta(去 raw)… limit={args.limit or 'ALL'}", flush=True)
    r = subprocess.run(psql + ["-c", export_sql], env=penv, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"导出失败: {r.stderr[:800]}")

    print("[2/3] 重算 zh 字段 + i18n(复用 mapping.inject_zh_fields)…", flush=True)
    n = 0
    with open(PATCH_PATH, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for row in csv.reader(io.StringIO(r.stdout)):
            if len(row) < 2:
                continue
            eid, meta_txt = row[0], row[1]
            try:
                meta = json.loads(meta_txt)
            except json.JSONDecodeError:
                continue
            mapping.inject_zh_fields(meta, zl)
            patch = {k: meta.get(k) for k in mapping.ZH_FIELDS}
            patch["i18n"] = mapping.build_i18n_block(meta)
            w.writerow([eid, json.dumps(patch, ensure_ascii=False)])
            n += 1
    print(f"      生成 {n} 条 patch -> {PATCH_PATH}", flush=True)
    if n == 0:
        sys.exit("无可回填数据")

    print("[3/3] 批量回写(meta_json || patch,保留 raw)…", flush=True)
    update_sql = f"""\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _zh_patch(id bigint, patch jsonb);
\\copy _zh_patch FROM '{PATCH_PATH}' WITH (FORMAT csv)
UPDATE woocms.cms_content_entries e
   SET meta_json = e.meta_json || p.patch
  FROM _zh_patch p WHERE e.id = p.id;
SELECT 'patched=' || count(*) FROM _zh_patch;
COMMIT;
"""
    r2 = subprocess.run(psql + ["-v", "ON_ERROR_STOP=1"], input=update_sql, env=penv,
                        capture_output=True, text=True)
    if r2.returncode != 0:
        sys.exit(f"回写失败: {r2.stderr[:800]}")
    print(r2.stdout.strip() or "(ok)")
    print("完成。")


if __name__ == "__main__":
    main()
