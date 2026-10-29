"""异步翻译 worker:消费导入进程投递的缺译队列,批量翻译并写回种子。

导入进程只向 i18n_queue/pending.jsonl 追加缺口,不调用翻译 API。
本 worker 独立运行,可由 systemd timer 周期触发;首灌仍在跑时只补种子缓存,
不执行大批量 DB 回填,避免影响首灌吞吐。
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import backfill_zh
import seed_translations
import translate_gaps
from common import get_logger

log = get_logger("i18n_worker")


def _read_queue_file(path: Path) -> dict[str, dict]:
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = rec.get("kind")
            key = str(rec.get("key") or "").strip()
            if kind not in ("geo", "keyin") or not key:
                continue
            out[f"{kind}:{key}"] = rec
    return out


def _drain_queue(dry_run=False) -> tuple[dict[str, dict], Path | None]:
    """读取队列并去重;非 dry-run 时原子挪到 processing 文件。

    processing 文件在整轮翻译成功后才删除;若 worker 异常,会恢复回 pending,
    避免取走任务后翻译 API 崩溃导致缺口丢失。
    """
    q = translate_gaps.QUEUE_PATH
    with translate_gaps._queue_lock():
        if not q.exists() or q.stat().st_size == 0:
            return {}, None
        if dry_run:
            return _read_queue_file(q), None
        processing = q.with_name(f"processing.{os.getpid()}.{int(time.time())}.jsonl")
        os.replace(q, processing)

    return _read_queue_file(processing), processing


def _restore_processing(processing: Path | None):
    if not processing or not processing.exists():
        return
    with translate_gaps._queue_lock():
        if translate_gaps.QUEUE_PATH.exists():
            with open(translate_gaps.QUEUE_PATH, "ab") as dst, open(processing, "rb") as src:
                dst.write(src.read())
            processing.unlink()
        else:
            os.replace(processing, translate_gaps.QUEUE_PATH)


def _finish_processing(processing: Path | None):
    if not processing:
        return
    try:
        processing.unlink()
    except FileNotFoundError:
        pass


def _service_active(name: str) -> bool:
    r = subprocess.run(["systemctl", "is-active", "--quiet", name], capture_output=True)
    return r.returncode == 0


def _push_term_translations():
    seed_translations.main()
    db = backfill_zh.db_env()
    psql = ["psql", "-q", "-h", db["DB_HOST"], "-p", db.get("DB_PORT", "5432"),
            "-U", db["DB_USER"], "-d", db["DB_NAME"], "-v", "ON_ERROR_STOP=1",
            "-f", str(seed_translations.LOCALES_OUT)]
    penv = {**os.environ, "PGPASSWORD": db["DB_PASSWORD"]}
    r = subprocess.run(psql, env=penv, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"term 译名落库失败: {r.stderr[:600]}")
    log.info("term 译名已落库 cms_term_translations")


def _run_backfill():
    sys.argv = ["backfill_zh.py"]
    backfill_zh.main()


def _translate_queued(records: dict[str, dict], limit=None, dry_run=False) -> int:
    geo = {}
    keyin = {}
    done_geo = {str(k) for k in translate_gaps._load("geo_zh.json", {})}
    done_keyin = set(translate_gaps._load(translate_gaps.KEYIN_SEED, {}))

    for rec in records.values():
        kind = rec.get("kind")
        key = str(rec.get("key") or "").strip()
        if kind == "geo" and key not in done_geo:
            src = translate_gaps._src_text(rec.get("th"), rec.get("en"))
            if src:
                geo[key] = src
        elif kind == "keyin" and key not in done_keyin:
            text = str(rec.get("th") or "").strip()
            if len(text) >= 4 and any(c.isalpha() for c in text):
                keyin[key] = text

    if limit:
        geo = {k: geo[k] for k in list(geo)[:limit]}
        keyin = {k: keyin[k] for k in list(keyin)[:limit]}

    calls = 0
    if geo:
        calls += translate_gaps.run_geo(geo, batch=60, sleep=0.5, dry=dry_run)
    if keyin:
        calls += translate_gaps.run_keyin(keyin, batch=40, sleep=0, dry=dry_run)
    return calls


def run(limit=None, include_db_scan=False, backfill=False, dry_run=False) -> int:
    records, processing = _drain_queue(dry_run=dry_run)
    log.info("队列取出缺口 %d 条", len(records))

    try:
        calls = _translate_queued(records, limit=limit, dry_run=dry_run)
        if include_db_scan:
            calls += translate_gaps.fill_gaps(target="all", limit=limit, dry_run=dry_run)
    except Exception:
        _restore_processing(processing)
        raise

    if dry_run:
        return calls

    if calls <= 0:
        _finish_processing(processing)
        log.info("无新增翻译,结束。")
        return 0

    _push_term_translations()
    _finish_processing(processing)
    if backfill:
        if _service_active("dbdadmin-backfill.service"):
            log.info("首灌仍在运行,跳过存量回填;待首灌完成后再跑 backfill。")
        else:
            _run_backfill()
    else:
        log.info("本次只更新翻译种子和 term 译名,不执行存量回填。")
    return calls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="最多处理 N 个队列缺口(调试用)")
    ap.add_argument("--include-db-scan", action="store_true", help="同时扫描数据库里的历史缺口")
    ap.add_argument("--backfill", action="store_true", help="翻译成功后回填存量 meta;首灌运行时自动跳过")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(limit=args.limit, include_db_scan=args.include_db_scan, backfill=args.backfill, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
