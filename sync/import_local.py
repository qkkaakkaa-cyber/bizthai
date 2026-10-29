"""本地采集数据导入器(并发版):读 data/companies/{jpNo}.json → 复用 mapping/woocms 写入 WooCMS。

与 sync.py 区别:数据源是本地 JSON(DbdRawCompany/detail 形状),不连泰国 API。
- 本地文件即 detail,包成 envelope={detail, basic:{}, financialStatements} 再喂 display_meta。
- 去重:--db-slugs(已入库 jpNo)+ --progress-file(本次已导入),命中即跳过 → 可断点续跑。
- 并发:--workers 个线程,各持独立 WooCMS 会话并发写;translate=None(缺译交 i18n_worker)。
- zh_lookup 在 translate=None 时只读,可跨线程共享。

用法:
  python3 import_local.py --dir <companies目录> --db-slugs <已入库slug> --workers 8 [--limit N]
"""
import argparse
import json
import os
import queue
import threading
import time

from common import env, get_logger
from woocms import WooCMS
from mapping import (
    display_meta, to_raw, short_summary, province_name, type_name, load_zh_lookup,
)

log = get_logger("import_local")
MODEL = env("WOOCMS_MODEL", "thaicompany")

_SENTINEL = None


def build_envelope(local: dict, jpno: str) -> dict:
    return {
        "jpNo": jpno,
        "basic": {},
        "detail": local,
        "financialStatements": local.get("financialStatements") or {},
    }


def load_seen(db_slugs: str, progress_file: str) -> set:
    seen = set()
    for path in (db_slugs, progress_file):
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    s = line.strip()
                    if s:
                        seen.add(s)
    return seen


class Stats:
    def __init__(self):
        self.created = 0
        self.err = 0
        self.lock = threading.Lock()


def make_payload(jpno: str, path: str, zh):
    local = json.load(open(path, encoding="utf-8"))
    prof = local.get("profile") or {}
    jp = str(prof.get("jpNo") or jpno).strip() or jpno
    envelope = build_envelope(local, jp)
    meta = display_meta(jp, envelope, {"has_detail": True}, zh, translate=None)
    meta["raw"] = to_raw(envelope)
    return jp, meta


def worker(wid, q, zh, stats, prog, prog_lock):
    woo = WooCMS().login()
    while True:
        item = q.get()
        if item is _SENTINEL:
            q.task_done()
            return
        jpno, path = item
        try:
            jp, meta = make_payload(jpno, path, zh)
            prov_id = woo.ensure_term("province", province_name(meta), "prov")
            type_id = woo.ensure_term("companytype", type_name(meta), "ctype")
            term_ids = [t for t in (prov_id, type_id) if t]
            published = bool((meta.get("jpnamee") or "").strip())
            payload = {
                "title": meta.get("jpname") or jp,
                "slug": jp,
                "summary": short_summary(meta),
                "meta": meta,
                "term_ids": term_ids,
                "status": "published" if published else "draft",
            }
            if prov_id:
                payload["primary_term_id"] = prov_id
            woo.create_entry(MODEL, payload)
            with prog_lock:
                prog.write(jp + "\n")
            with stats.lock:
                stats.created += 1
        except Exception as exc:  # noqa: BLE001
            with stats.lock:
                stats.err += 1
                if stats.err <= 20 or stats.err % 200 == 0:
                    log.warning("导入 %s 失败: %s", jpno, exc)
        finally:
            q.task_done()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--db-slugs", required=True)
    ap.add_argument("--progress-file", default="import_local_done.txt")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    seen = load_seen(args.db_slugs, args.progress_file)
    log.info("去重基线 %d 家;并发 workers=%d", len(seen), args.workers)

    zh = load_zh_lookup()
    stats = Stats()
    prog = open(args.progress_file, "a", encoding="utf-8")
    prog_lock = threading.Lock()
    q: queue.Queue = queue.Queue(maxsize=args.workers * 200)

    threads = [
        threading.Thread(target=worker, args=(i, q, zh, stats, prog, prog_lock), daemon=True)
        for i in range(args.workers)
    ]
    for t in threads:
        t.start()

    # 进度打印线程
    stop = threading.Event()
    t0 = time.time()

    def reporter():
        last = 0
        while not stop.wait(15):
            with stats.lock:
                c, e = stats.created, stats.err
            rate = c / (time.time() - t0) if c else 0
            inst = (c - last) / 15
            last = c
            log.info("已导入 %d (错误 %d) | 均速 %.1f/s 瞬时 %.1f/s | 队列 %d", c, e, rate, inst, q.qsize())
            prog.flush()

    rep = threading.Thread(target=reporter, daemon=True)
    rep.start()

    enq = 0
    for ent in os.scandir(args.dir):
        if not ent.name.endswith(".json"):
            continue
        jpno = ent.name[:-5]
        if jpno in seen:
            continue
        if args.limit and enq >= args.limit:
            break
        q.put((jpno, ent.path))
        enq += 1

    for _ in threads:
        q.put(_SENTINEL)
    for t in threads:
        t.join()
    stop.set()

    prog.flush()
    prog.close()
    dt = time.time() - t0
    rate = stats.created / dt if stats.created else 0
    log.info("完成:新导入 %d,错误 %d,入队 %d,用时 %.0f 分,均速 %.1f/s",
             stats.created, stats.err, enq, dt / 60, rate)


if __name__ == "__main__":
    main()
