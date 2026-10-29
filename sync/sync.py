"""主同步流程:泰国 API → WooCMS 入库(upsert)。

用法:
  python3 sync.py                  # 增量:新公司入库 + 详情按 SYNC_REFRESH_DAYS 轮转刷新
  python3 sync.py --limit 5        # 小批冒烟(只处理前 5 家)
  python3 sync.py --full           # 全量:每家都重取详情并更新
  python3 sync.py --no-detail      # 仅按列表字段入库(不取详情,快速铺底)
  python3 sync.py --backfill       # 首灌:持续节流导入所有未入库公司(并发取详情+串行写),
                                   # 跳过轮转刷新;补齐后由 dbdadmin-sync.timer 接管增量。

状态文件 sync/state.json 记录 {jpNo: 最近详情抓取日期},支持断点/轮转刷新。
"""
import argparse
import json
import os
import time
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

from common import env, get_logger
from dbd import DBD
from woocms import WooCMS
from mapping import to_raw, display_meta, short_summary, province_name, type_name, load_zh_lookup
from translate_gaps import make_queue_translator
import bootstrap

log = get_logger("sync")
MODEL = env("WOOCMS_MODEL", "thaicompany")
PAGE_SIZE = int(env("SYNC_PAGE_SIZE", "200"))
REFRESH_DAYS = int(env("SYNC_REFRESH_DAYS", "7"))
# 首灌(backfill)参数:并发取详情的 worker 数 + 每趟扫完后空转再扫的间隔(秒)
BACKFILL_WORKERS = int(env("SYNC_WORKERS", "4"))
BACKFILL_IDLE = int(env("SYNC_BACKFILL_IDLE", "1800"))
STATE_PATH = Path(__file__).resolve().parent / "state.json"
# 首灌成员集合(append-only,每行一个 jpNo):重启据此恢复去重,免全表扫描
IMPORTED_PATH = Path(__file__).resolve().parent / "imported.txt"


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            log.warning("state.json 解析失败,重置")
    return {"details": {}, "last_run": None}


def save_state(state: dict):
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    # 原子写:临时文件 + rename。只要目录可写,即便 state.json 属主不同(root↔www-data)也能更新。
    tmp = STATE_PATH.with_name(STATE_PATH.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def _is_stale(state: dict, jp_no: str) -> bool:
    last = (state.get("details") or {}).get(jp_no)
    if not last:
        return True
    try:
        d = datetime.fromisoformat(last).date()
    except Exception:  # noqa: BLE001
        return True
    return (datetime.now(timezone.utc).date() - d) >= timedelta(days=REFRESH_DAYS)


def run(limit=None, full=False, no_detail=False):
    bootstrap.main()  # 幂等确保模型/分类法存在
    dbd = DBD()
    woo = WooCMS().login()

    st = dbd.stats()
    log.info("数据源 total=%s with_detail=%s", st.get("total"), st.get("with_detail"))

    id_map = woo.build_slug_id_map(MODEL)
    state = load_state()
    zh_lookup = load_zh_lookup()  # 府泰文名→中文、objCode→经营目的中文(从 i18n_seed 读)
    translate = make_queue_translator()  # 导入只投递缺译任务,不等待翻译 API

    n = created = updated = skipped = 0
    for item in dbd.iter_companies(page_size=PAGE_SIZE):
        if limit and n >= limit:
            break
        jp_no = str(item.get("jpNo") or "").strip()
        if not jp_no:
            continue
        n += 1
        exists = jp_no in id_map

        want_detail = (not no_detail) and bool(item.get("has_detail")) and (
            full or not exists or _is_stale(state, jp_no)
        )
        # 已存在且本轮不取详情、且非全量 -> 跳过,避免用稀疏列表数据覆盖已有完整 meta
        if exists and not want_detail and not full:
            skipped += 1
            continue
        detail = dbd.detail(jp_no) if want_detail else None

        meta = display_meta(jp_no, detail, item, zh_lookup, translate)
        meta["raw"] = to_raw(detail) if detail else {"profile": item}

        prov_id = woo.ensure_term("province", province_name(meta), "prov")
        type_id = woo.ensure_term("companytype", type_name(meta), "ctype")
        term_ids = [t for t in (prov_id, type_id) if t]

        # 只有拿到英文名(jpnamee,来自详情/富集)才公开;否则建为 draft 隐藏,
        # 待后续富集补上英文名再由本流程更新为 published(详见隐藏门控约定)。
        # draft 条目 published_at 保持 NULL,WooCMS 定时发布任务不会把它翻回 published。
        published = bool((meta.get("jpnamee") or "").strip())

        payload = {
            "title": meta.get("jpname") or jp_no,
            "slug": jp_no,
            "summary": short_summary(meta),
            "meta": meta,
            "term_ids": term_ids,
            "status": "published" if published else "draft",
        }
        if prov_id:
            payload["primary_term_id"] = prov_id

        if exists:
            woo.update_entry(id_map[jp_no], payload)
            updated += 1
        else:
            id_map[jp_no] = woo.create_entry(MODEL, payload)
            created += 1

        if detail:
            state.setdefault("details", {})[jp_no] = _today()

        if n % 100 == 0:
            save_state(state)
            log.info("进度 %d(新建 %d / 更新 %d)", n, created, updated)

    save_state(state)
    log.info("完成:处理 %d,新建 %d,更新 %d,跳过 %d", n, created, updated, skipped)


# ----------------------------------------------------------------------------
# 首灌(backfill):并发取详情 + 串行写入,持续把所有未入库公司导进来。
# 设计:只有「取详情」这一步并发(慢在跨境 GET);WooCMS 写入与共享状态全在主线程,
# 避开 requests.Session / _term_cache / id_map 的线程竞争。
# ----------------------------------------------------------------------------
_tl = threading.local()


def _fetch_detail(item):
    """worker 线程:用线程私有的 DBD 客户端取详情;无 has_detail 则不取(返回 None)。"""
    if not item.get("has_detail"):
        return None
    cli = getattr(_tl, "dbd", None)
    if cli is None:
        cli = _tl.dbd = DBD()
    jp_no = str(item.get("jpNo") or "").strip()
    return cli.detail(jp_no) if jp_no else None


def _imap_bounded(fn, items, workers):
    """有界并发 map:最多 workers 个 fn 在途,按提交顺序产出 (item, fn(item))。
    控制在途数量 = 安全阀值,既限制对上游/本机的并发压力,又让取详情与写入重叠。"""
    with ThreadPoolExecutor(max_workers=workers) as ex:
        q = deque()
        it = iter(items)
        for _ in range(workers):
            try:
                x = next(it)
            except StopIteration:
                break
            q.append((x, ex.submit(fn, x)))
        while q:
            x, fut = q.popleft()
            yield x, fut.result()
            try:
                nx = next(it)
            except StopIteration:
                continue
            q.append((nx, ex.submit(fn, nx)))


def _load_imported() -> set | None:
    """读取已入库成员集合(每行一个 jpNo)。文件不存在返回 None(触发一次性全量构建)。"""
    if not IMPORTED_PATH.exists():
        return None
    out = set()
    with IMPORTED_PATH.open(encoding="utf-8") as f:
        for line in f:
            jp = line.strip()
            if jp:
                out.add(jp)
    return out


def _write_entry(woo, state, seen, imp_file, zh_lookup, item, detail, translate=None):
    """主线程:组装 meta + 词条 + 建条目;成员落 seen 集合并 append 到 imported.txt。"""
    jp_no = str(item.get("jpNo") or "").strip()
    meta = display_meta(jp_no, detail, item, zh_lookup, translate)
    meta["raw"] = to_raw(detail) if detail else {"profile": item}

    prov_id = woo.ensure_term("province", province_name(meta), "prov")
    type_id = woo.ensure_term("companytype", type_name(meta), "ctype")
    term_ids = [t for t in (prov_id, type_id) if t]

    # 同 run():无英文名(jpnamee)的条目建为 draft 隐藏,有英文名才 published。
    published = bool((meta.get("jpnamee") or "").strip())

    payload = {
        "title": meta.get("jpname") or jp_no,
        "slug": jp_no,
        "summary": short_summary(meta),
        "meta": meta,
        "term_ids": term_ids,
        "status": "published" if published else "draft",
    }
    if prov_id:
        payload["primary_term_id"] = prov_id

    woo.create_entry(MODEL, payload)
    seen.add(jp_no)
    imp_file.write(jp_no + "\n")  # append-only 进度标记,重启即从此恢复成员集合
    if detail:
        state.setdefault("details", {})[jp_no] = _today()


def run_backfill():
    """持续首灌:循环扫描列表,把所有尚未入库的公司导进来(只建新、不轮转刷新)。
    一趟扫完后空转 BACKFILL_IDLE 秒再扫,以拾取上游持续新增的公司。
    作为 Restart=always 的常驻服务运行;补齐后人工切回每日增量 timer。

    成员去重靠 imported.txt(append-only):重启顺序读文件即恢复,O(n),避免每次启动
    对 WooCMS 做 ~430ms/页 的全表扫描(65k≈4.7min、140 万≈100min)。"""
    bootstrap.main()  # 幂等确保模型/分类法存在
    woo = WooCMS().login()
    state = load_state()
    zh_lookup = load_zh_lookup()
    # 首灌量大时不能逐家公司现场翻译:
    # 缺口只投递到本地队列,由独立翻译 worker 去重批量处理。
    translate = make_queue_translator()

    seen = _load_imported()
    if seen is None:
        log.warning("imported.txt 缺失,首次全量构建成员集合(一次性全表扫描,之后重启直接读文件)")
        id_map = woo.build_slug_id_map(MODEL)
        seen = set(id_map.keys()) | set((state.get("details") or {}).keys())
        IMPORTED_PATH.write_text("".join(jp + "\n" for jp in sorted(seen)), encoding="utf-8")
        log.info("成员集合已落盘 imported.txt:%d 条", len(seen))
    else:
        seen |= set((state.get("details") or {}).keys())  # 防御:并入 state 已知详情
    log.info("首灌启动:并发=%d 空转间隔=%ds 已知成员=%d", BACKFILL_WORKERS, BACKFILL_IDLE, len(seen))

    imp_file = IMPORTED_PATH.open("a", encoding="utf-8")
    try:
        while True:
            dbd = DBD()
            st = dbd.stats()
            target = st.get("total") or 0
            log.info("本趟开始:上游 total=%s with_detail=%s 已知成员=%d",
                     st.get("total"), st.get("with_detail"), len(seen))

            def _pending():
                for it in dbd.iter_companies(page_size=PAGE_SIZE):
                    jp_no = str(it.get("jpNo") or "").strip()
                    if jp_no and jp_no not in seen:  # 只导未入库的,已有一律跳过
                        yield it

            created = 0
            for item, detail in _imap_bounded(_fetch_detail, _pending(), BACKFILL_WORKERS):
                jp_no = str(item.get("jpNo") or "").strip()
                if jp_no in seen:  # 并发窗口内可能已被同趟建过,二次保险
                    continue
                try:
                    _write_entry(woo, state, seen, imp_file, zh_lookup, item, detail, translate)
                except Exception as exc:  # noqa: BLE001
                    log.warning("写入 %s 失败,跳过本条: %s", jp_no, exc)
                    continue
                created += 1
                if created % 100 == 0:
                    imp_file.flush()
                    if created % 2000 == 0:  # state.json 较大,降低重写频率
                        save_state(state)
                    cov = (len(seen) / target * 100) if target else 0
                    log.info("本趟新建 %d | 成员 %d/%s (%.2f%%) 详情 %d",
                             created, len(seen), target, cov, len(state.get("details") or {}))

            imp_file.flush()
            save_state(state)
            cov = (len(seen) / target * 100) if target else 0
            log.info("本趟完成:新建 %d,成员 %d/%s (%.2f%%);空转 %ds 后再扫",
                     created, len(seen), target, cov, BACKFILL_IDLE)
            time.sleep(BACKFILL_IDLE)
    finally:
        imp_file.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="只处理前 N 家(冒烟用)")
    ap.add_argument("--full", action="store_true", help="全量重取详情")
    ap.add_argument("--no-detail", action="store_true", help="不取详情,仅列表字段铺底")
    ap.add_argument("--backfill", action="store_true", help="首灌:持续并发导入所有未入库公司")
    args = ap.parse_args()
    if args.backfill:
        run_backfill()
    else:
        run(limit=args.limit, full=args.full, no_detail=args.no_detail)
