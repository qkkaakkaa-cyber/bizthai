"""直连 Postgres 批量导入采集数据(execute_values),绕过 WooCMS HTTP API —— 比 HTTP 快百倍。

数据流:本地 JSON → mapping.display_meta 构建 meta_json(多进程并行) → 批量 INSERT cms_content_entries
       → 入库后用集合化 SQL 关联 province/companytype terms(缺失的 term 先补建)。

与 WooCMS 建条目等价的最小足迹:entries 行 + 2 个 entry_terms(府/类型)。
不建 version/permalink_route(旧 dump 条目本就 routes=0,/company/{slug} 动态解析,站点正常)。

用法:
  python3 direct_import.py --dir <companies目录> --db-slugs <已入库slug> --workers 6 [--limit N]
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from multiprocessing import Pool

import psycopg2
import psycopg2.extras

import mapping

SITE_ID = 1
MODEL_ID = 2          # thaicompany
AUTHOR_ID = 1
TAX_PROVINCE = 1
TAX_COMPANYTYPE = 2

_zh = None


def _init():
    global _zh
    _zh = mapping.load_zh_lookup()


def transform(arg):
    jpno, path = arg
    try:
        local = json.load(open(path, encoding="utf-8"))
        prof = local.get("profile") or {}
        jp = str(prof.get("jpNo") or jpno).strip() or jpno
        envelope = {"jpNo": jp, "basic": {}, "detail": local,
                    "financialStatements": local.get("financialStatements") or {}}
        meta = mapping.display_meta(jp, envelope, {"has_detail": True}, _zh, translate=None)
        meta["raw"] = mapping.to_raw(envelope)
        # PostgreSQL 的 text/jsonb 不接受 NUL();采集数据偶有脏 NUL,统一剥除
        title = (meta.get("jpname") or jp).replace("\x00", "")
        summary = mapping.short_summary(meta).replace("\x00", "")
        metajson = json.dumps(meta, ensure_ascii=False).replace("\x00", "")
        published = bool((meta.get("jpnamee") or "").strip())
        return (jp, title, summary, "published" if published else "draft",
                published, metajson)
    except Exception as e:  # noqa: BLE001
        return ("__ERR__", str(e)[:120], path, False, False, "")


INSERT_SQL = """INSERT INTO woocms.cms_content_entries
 (site_id, content_model_id, title, slug, summary, body, status, published_at,
  author_id, meta_json, created_at, updated_at, access_mode, required_capability)
 VALUES %s
 ON CONFLICT (site_id, content_model_id, slug) DO NOTHING"""
TEMPLATE = "(%s,%s,%s,%s,%s,'',%s,%s,%s,%s::jsonb,%s,%s,'public','')"


def link_terms(cur, base_id):
    """入库后集合化关联 terms:先补建缺失的 府/类型 term,再插 entry_terms。"""
    for tax, key, prefix, is_primary in (
        (TAX_PROVINCE, "province", "prov", True),
        (TAX_COMPANYTYPE, "jptypedesc", "ctype", False),
    ):
        # 1) 补建缺失 term(slug=prefix+md5(name)[:10],与 woocms._slugify 同口径)
        cur.execute(f"""
            INSERT INTO woocms.cms_custom_terms
              (site_id, taxonomy_id, name, slug, sort_order, status, created_at, updated_at)
            SELECT DISTINCT %s, %s, e.meta_json->>%s,
                   '{prefix}'||substr(md5(e.meta_json->>%s),1,10), 0, 'active', now(), now()
            FROM woocms.cms_content_entries e
            WHERE e.id > %s AND e.content_model_id = %s
              AND coalesce(e.meta_json->>%s,'') <> ''
              AND NOT EXISTS (SELECT 1 FROM woocms.cms_custom_terms t
                              WHERE t.taxonomy_id = %s AND t.name = e.meta_json->>%s)
            ON CONFLICT DO NOTHING
        """, (SITE_ID, tax, key, key, base_id, MODEL_ID, key, tax, key))
        # 2) 关联 entry_terms
        cur.execute(f"""
            INSERT INTO woocms.cms_content_entry_terms
              (site_id, entry_id, taxonomy_id, term_id, is_primary, created_at)
            SELECT e.site_id, e.id, %s, t.id, %s, now()
            FROM woocms.cms_content_entries e
            JOIN woocms.cms_custom_terms t
              ON t.taxonomy_id = %s AND t.name = e.meta_json->>%s
            WHERE e.id > %s AND e.content_model_id = %s
            ON CONFLICT DO NOTHING
        """, (tax, is_primary, tax, key, base_id, MODEL_ID))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--db-slugs", required=True)
    ap.add_argument("--dsn", default="host=127.0.0.1 port=5432 dbname=dbdadmin_woocms user=mikalife")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--batch", type=int, default=2000)
    ap.add_argument("--slice", type=int, default=10000, help="每片大小(限制在途内存)")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    seen = set()
    with open(args.db_slugs, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if s:
                seen.add(s)
    print(f"去重基线 {len(seen)} 家", flush=True)

    work = []
    for e in os.scandir(args.dir):
        if not e.name.endswith(".json"):
            continue
        jp = e.name[:-5]
        if jp in seen:
            continue
        work.append((jp, e.path))
        if args.limit and len(work) >= args.limit:
            break
    print(f"待导入 {len(work)} 家;workers={args.workers} batch={args.batch}", flush=True)

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("SELECT coalesce(max(id),0) FROM woocms.cms_content_entries")
    base_id = cur.fetchone()[0]
    conn.commit()
    print(f"base entry id = {base_id}", flush=True)

    now = datetime.now(timezone.utc)
    t0 = time.time()
    done = err = 0
    batch = []

    def flush():
        nonlocal err
        try:
            psycopg2.extras.execute_values(cur, INSERT_SQL, batch, template=TEMPLATE, page_size=500)
            conn.commit()
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            print(f"  批量失败,逐行重试跳过坏行: {str(exc)[:80]}", flush=True)
            for row in batch:
                try:
                    psycopg2.extras.execute_values(cur, INSERT_SQL, [row], template=TEMPLATE, page_size=1)
                    conn.commit()
                except Exception:  # noqa: BLE001
                    conn.rollback()
                    err += 1

    # 分片处理:pool.map 每片阻塞返回,在途结果最多一片 → 内存有界(避免生产快于消费而堆爆)
    with Pool(args.workers, initializer=_init) as pool:
        for i in range(0, len(work), args.slice):
            chunk = work[i:i + args.slice]
            for r in pool.map(transform, chunk, chunksize=100):
                if r[0] == "__ERR__":
                    err += 1
                    if err <= 10:
                        print("  转换失败:", r[1], r[2], flush=True)
                    continue
                jp, title, summary, status, published, metajson = r
                batch.append((SITE_ID, MODEL_ID, title, jp, summary, status,
                              now if published else None, AUTHOR_ID, metajson, now, now))
                if len(batch) >= args.batch:
                    flush()
                    done += len(batch)
                    batch = []
            rate = done / (time.time() - t0) if done else 0
            print(f"已入库 {done}/{len(work)} (错误 {err}) | {rate:.0f}/s", flush=True)
        if batch:
            flush()
            done += len(batch)

    print(f"entries 入库完成:{done} 家,错误 {err},用时 {(time.time()-t0)/60:.1f} 分", flush=True)

    print("关联 province/companytype terms ...", flush=True)
    tl = time.time()
    link_terms(cur, base_id)
    conn.commit()
    print(f"terms 关联完成,用时 {(time.time()-tl)/60:.1f} 分", flush=True)

    cur.close()
    conn.close()
    print("全部完成。", flush=True)


if __name__ == "__main__":
    main()
