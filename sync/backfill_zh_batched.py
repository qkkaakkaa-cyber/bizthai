"""存量三语回填(分片版,适配 195 万级):复用 mapping.inject_zh_fields + build_i18n_block,
按 id 分片处理(每片内存有界,避免一次性载入全量 meta)。只 patch zh 扁平字段 + i18n 块,
用 meta_json || patch 合并(raw 与其他字段完整保留)。幂等可重复跑。

用法:DBD_DB_ENV=.../.env.localdb python3 backfill_zh_batched.py [--chunk 100000]
"""
import argparse
import csv
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import mapping

ENV_PATH = os.environ.get("DBD_DB_ENV", str(Path(__file__).resolve().parents[1] / "admin" / ".env"))


def db_env():
    cfg = {}
    for line in Path(ENV_PATH).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DB_") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k] = v
    return cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunk", type=int, default=100000)
    args = ap.parse_args()

    csv.field_size_limit(64 * 1024 * 1024)
    zl = mapping.load_zh_lookup()
    print(f"种子加载: province/objective/geo/keyin(keyin={len(zl.get('keyin') or {})})", flush=True)

    db = db_env()
    base = ["psql", "-q", "-h", db["DB_HOST"], "-p", db.get("DB_PORT", "5432"),
            "-U", db["DB_USER"], "-d", db["DB_NAME"]]
    penv = {**os.environ, "PGPASSWORD": db.get("DB_PASSWORD", "")}

    def psql(sql, stdin=None):
        args_ = base + (["-v", "ON_ERROR_STOP=1"] if stdin else ["-tAc", sql])
        r = subprocess.run(args_, input=stdin, env=penv, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"psql 失败: {r.stderr[:600]}")
        return r.stdout

    lo = int(psql("SELECT coalesce(min(id),0) FROM woocms.cms_content_entries WHERE content_model_id=2").strip() or 0)
    hi = int(psql("SELECT coalesce(max(id),0) FROM woocms.cms_content_entries WHERE content_model_id=2").strip() or 0)
    print(f"id 范围 [{lo}, {hi}], chunk={args.chunk}", flush=True)

    patched = 0
    t0 = time.time()
    cur = lo
    while cur <= hi:
        end = cur + args.chunk
        # 1) 导出该片 (id, meta-raw)
        export = (f"\\copy (SELECT id, meta_json - 'raw' FROM woocms.cms_content_entries "
                  f"WHERE content_model_id=2 AND deleted_at IS NULL AND id >= {cur} AND id < {end}) "
                  f"TO STDOUT WITH (FORMAT csv)")
        out = subprocess.run(base + ["-v", "ON_ERROR_STOP=1"], input=export, env=penv,
                             capture_output=True, text=True)
        if out.returncode != 0:
            sys.exit(f"导出失败: {out.stderr[:600]}")

        # 2) 重算 zh + i18n → patch CSV(写临时文件,避免 STDIN 内联换行问题)
        patch_path = f"/tmp/zhp.{os.getpid()}.csv"
        n = 0
        with open(patch_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for row in csv.reader(io.StringIO(out.stdout)):
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
                w.writerow([eid, json.dumps(patch, ensure_ascii=False).replace("\x00", "")])
                n += 1

        if n:
            # 3) 该片批量回写(temp + meta_json || patch)
            upd = ("BEGIN;\n"
                   "CREATE TEMP TABLE _zhp(id bigint, patch jsonb) ON COMMIT DROP;\n"
                   f"\\copy _zhp FROM '{patch_path}' WITH (FORMAT csv)\n"
                   "UPDATE woocms.cms_content_entries e SET meta_json = e.meta_json || p.patch "
                   "FROM _zhp p WHERE e.id = p.id;\n"
                   "COMMIT;\n")
            r = subprocess.run(base + ["-v", "ON_ERROR_STOP=1"], input=upd, env=penv,
                               capture_output=True, text=True)
            if r.returncode != 0:
                sys.exit(f"回写失败(片 {cur}-{end}): {r.stderr[:600]}")
            patched += n

        rate = patched / (time.time() - t0) if patched else 0
        print(f"  片 [{cur},{end}) 回填 {n} | 累计 {patched} | {rate:.0f}/s", flush=True)
        cur = end

    print(f"完成:回填 {patched} 条,用时 {(time.time()-t0)/60:.1f} 分", flush=True)


if __name__ == "__main__":
    main()
