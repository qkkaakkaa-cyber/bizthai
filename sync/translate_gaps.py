"""扫描 i18n_seed/ 的中文缺口,直连 DeepSeek 官方 API 批量翻译,写回权威种子(幂等)。

设计:**只翻"去重后的唯一值"**(县930/分区7485/新经营目的),不逐家翻几十万公司——
翻好的中文落进种子字典,sync.display_meta / backfill_zh.py 再套用到所有公司。

通道:直连 DeepSeek 官方 API(OpenAI 兼容 /chat/completions,JSON 模式),密钥在 sync/.env
的 DEEPSEEK_API_KEY。绕开后台网关(后台网关曾对批量请求返回空 result)。

目标(--target):
  - geo       : province.seed.json 的县(lvl2)/分区(lvl3) -> geo_zh.json {官方码: 中文}
  - objective : industry.seed.json 的经营目的(lvl2)未覆盖项 -> 追加 industry_zh.json
  - all       : 两者(默认)
行业大类(19)中文已在 industry_known.json,无需翻译(见 mapping.load_zh_lookup 的 objgrp)。

幂等/可恢复:已在输出种子里的键跳过;每批翻完即原子写回,中断可续跑。
用法:
  python3 translate_gaps.py --target geo --limit 60 --dry-run   # 冒烟:看选哪些、不调 API
  python3 translate_gaps.py --target geo --limit 120            # 小批真翻
  python3 translate_gaps.py                                     # 全量补齐(geo+objective)
"""
import argparse
import json
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path

import requests

from common import env, get_logger

log = get_logger("translate_gaps")
SEED = Path(__file__).resolve().parent / "i18n_seed"
DEEPSEEK_URL = env("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
DEEPSEEK_MODEL = env("DEEPSEEK_MODEL", "deepseek-chat")
_BACKOFF = [2, 5, 10, 20, 40]   # 偶发 429/超时的退避
_COOLDOWN = 20                  # 一批耗尽重试仍失败后,跳过前的冷却
_MAX_FAILS = 20                 # 连续这么多批失败即收尾退出(下次续跑)

QUEUE_DIR = Path(__file__).resolve().parent / "i18n_queue"
QUEUE_PATH = QUEUE_DIR / "pending.jsonl"
QUEUE_LOCK = QUEUE_DIR / ".pending.lock"
DB_ENV_PATH = Path(os.environ.get("DBD_DB_ENV", Path(__file__).resolve().parents[1] / "admin" / ".env"))


def _load(name, default):
    p = SEED / name
    if not p.exists():
        return default
    return json.load(open(p, encoding="utf-8"))


def _atomic_write(name, obj):
    # 唯一临时名(pid+tid+计数),避免并发写入者(bulk 线程池 + 入库即翻)抢同一 .tmp 导致 os.replace 崩
    import threading
    p = SEED / name
    tmp = SEED / f".{name}.{os.getpid()}.{threading.get_ident()}.tmp"
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=0), encoding="utf-8")
    os.replace(tmp, p)


@contextmanager
def _queue_lock():
    import fcntl
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_LOCK, "a", encoding="utf-8") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def enqueue_gap(kind: str, key, th, en=None) -> bool:
    """把缺译项投递到本地 JSONL 队列,不调用外部 API。

    导入进程只做这一件轻量 I/O,翻译和大 JSON 合并交给独立 worker。
    """
    kind = str(kind or "").strip()
    if kind not in ("geo", "keyin"):
        return False
    key = str(key or "").strip()
    th = str(th or "").strip()
    en = str(en or "").strip()
    if not key or not (th or en):
        return False
    rec = {
        "kind": kind,
        "key": key,
        "th": th,
        "en": en,
        "queued_at": int(time.time()),
    }
    line = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
    with _queue_lock():
        with open(QUEUE_PATH, "a", encoding="utf-8") as f:
            f.write(line)
    return True


def _parse_json(s: str) -> dict:
    s = (s or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*", "", s).strip().rstrip("`").strip()
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i:
        s = s[i:j + 1]
    return json.loads(s)


def _src_text(th, en) -> str:
    th, en = (th or "").strip(), (en or "").strip()
    if th and en and en.lower() not in th.lower():
        return f"{th}｜{en}"
    return th or en


def _ai_once(items: dict, kind: str, prompt: str = None):
    """直连 DeepSeek;成功返回 dict,空/解析失败/429 返回 None,其他硬错误抛异常。"""
    key = env("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("缺 DEEPSEEK_API_KEY(写在 sync/.env)")
    if prompt is None:
        prompt = (f"把下面 JSON 各值({kind})翻成简体中文,用通用音译或惯用译名,"
                  "key 保持不变、只翻译值,只返回纯 JSON 对象。")
    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "你是专业本地化翻译,只输出 JSON 对象。"},
            {"role": "user", "content": prompt + "\n" + json.dumps(items, ensure_ascii=False)},
        ],
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    r = requests.post(DEEPSEEK_URL, headers={"Authorization": f"Bearer {key}"}, json=body, timeout=180)
    if r.status_code == 429:
        return None  # 限流 -> 退避重试
    if r.status_code != 200:
        raise RuntimeError(f"deepseek http {r.status_code}: {r.text[:200]}")
    content = ((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not content.strip():
        return None
    try:
        out = _parse_json(content)
    except (json.JSONDecodeError, ValueError):
        return None
    return out if isinstance(out, dict) and out else None


def ai_translate(items: dict, kind: str, retries: int = 4, prompt: str = None):
    """带退避重试;持续失败返回 None(调用方据此跳过/收尾,种子已幂等落盘)。"""
    for attempt in range(retries + 1):
        try:
            out = _ai_once(items, kind, prompt)
        except requests.RequestException as e:
            log.warning("  请求异常:%s", repr(e)[:120])
            out = None
        if out:
            return out
        if attempt < retries:
            time.sleep(_BACKOFF[min(attempt, len(_BACKOFF) - 1)])
    return None


# ---- keyin:公司自填经营范围自由文本(保留泰文,新增英/中)----
import hashlib  # noqa: E402

KEYIN_SEED = "keyin_i18n.json"   # {md5(泰文): {"en":英文, "zh":简体中文}}
_KEYIN_PROMPT = ("下面 JSON 各值是泰国企业自填的经营范围泰文文本。把每个值翻成英文和简体中文,"
                 "key 保持不变,每个 value 改为对象 {\"en\":英文译文, \"zh\":简体中文译文}。"
                 "只返回纯 JSON 对象。")


def keyin_hash(text: str) -> str:
    return hashlib.md5((text or "").strip().encode("utf-8")).hexdigest()


_KEYIN_LOCK = SEED / ".keyin_i18n.lock"


def merge_keyin(new_pairs: dict) -> int:
    """跨进程安全地把 new_pairs({hash:{en,zh}})合并进 keyin_i18n.json:flock 串行 + 重读+并集+原子写。
    入库即翻(多个 sync 进程)与批量 run_keyin/定时器并发写时,互不覆盖(只增不删=并集安全)。"""
    import fcntl
    if not new_pairs:
        return 0
    with open(_KEYIN_LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            disk = _load(KEYIN_SEED, {})
            disk.update(new_pairs)
            _atomic_write(KEYIN_SEED, disk)
            return len(disk)
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def ai_keyin(items: dict, retries: int = 4):
    """items={hash: 泰文};返回 {hash: {en,zh}}。"""
    return ai_translate(items, "经营范围", retries=retries, prompt=_KEYIN_PROMPT)


# ---- geo:县/分区 ----
def collect_geo_gaps() -> dict:
    """{官方码: 源文本} —— province.seed lvl2/3 中 geo_zh.json 尚未覆盖的。"""
    prov = _load("province.seed.json", [])
    done = {str(k) for k in _load("geo_zh.json", {})}
    gaps = {}
    for r in prov:
        if r.get("lvl") not in (2, 3):
            continue
        code = r["slug"].rsplit("-", 1)[-1]
        if code in done or code in gaps:
            continue
        gaps[code] = _src_text(r.get("th"), r.get("en"))
    return gaps


def collect_geo_gaps_db() -> dict:
    """{官方码: 源文本} —— 公司 meta 实际用到、但 geo_zh 尚未覆盖的县/分区码。
    覆盖 province.seed 缺失的码(DBD 数据偶有种子没有的行政区码)。需 DB 只读。"""
    import csv
    import io
    import subprocess
    db = {}
    for line in open(DB_ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if line.startswith("DB_") and "=" in line:
            k, v = line.split("=", 1)
            db[k] = v
    sql = ("SET search_path TO woocms; COPY ("
           "SELECT DISTINCT meta_json->>'ampurcode', meta_json->>'ampurdesc', meta_json->>'ampurdesce' "
           "FROM cms_content_entries WHERE meta_json->>'ampurcode' ~ '^[0-9]+$' "
           "UNION "
           "SELECT DISTINCT meta_json->>'tumboncode', meta_json->>'tumbondesc', meta_json->>'tumbondesce' "
           "FROM cms_content_entries WHERE meta_json->>'tumboncode' ~ '^[0-9]+$'"
           ") TO STDOUT WITH (FORMAT csv)")
    r = subprocess.run(
        ["psql", "-h", db["DB_HOST"], "-p", db.get("DB_PORT", "5432"),
         "-U", db["DB_USER"], "-d", db["DB_NAME"], "-tAc", sql],
        env={**os.environ, "PGPASSWORD": db["DB_PASSWORD"]}, capture_output=True, text=True)
    if r.returncode != 0:
        log.warning("collect_geo_gaps_db 失败:%s", r.stderr[:200])
        return {}
    done = {str(k) for k in _load("geo_zh.json", {})}
    gaps = {}
    for row in csv.reader(io.StringIO(r.stdout)):
        if not row or not row[0].isdigit():
            continue
        code = row[0]
        if code in done or code in gaps:
            continue
        gaps[code] = _src_text(row[1] if len(row) > 1 else "", row[2] if len(row) > 2 else "")
    return gaps


def run_geo(gaps, batch, sleep, dry):
    geo = {str(k): v for k, v in _load("geo_zh.json", {}).items()}
    keys = list(gaps)
    log.info("geo 待翻 %d 条(已覆盖 %d)", len(keys), len(geo))
    if dry:
        for k in keys[:10]:
            log.info("  样本 %s = %s", k, gaps[k])
        return 0
    target = len(geo) + len(keys)
    calls, fails = 0, 0
    for i in range(0, len(keys), batch):
        chunk = {k: gaps[k] for k in keys[i:i + batch]}
        out = ai_translate(chunk, "泰国行政区地名,县/分区")
        if out is None:
            fails += 1
            if fails >= _MAX_FAILS:
                log.warning("  连续 %d 批失败,本次收尾(已落 %d,下次续跑)", fails, len(geo))
                break
            log.warning("  本批失败,冷却 %ds 后跳过续翻(下次补;已落 %d)", _COOLDOWN, len(geo))
            time.sleep(_COOLDOWN)
            continue
        fails = 0
        for k in chunk:
            zh = str(out.get(k, "")).strip()
            if zh:
                geo[k] = zh
        _atomic_write("geo_zh.json", geo)
        calls += 1
        if calls % 10 == 0:
            log.info("  geo 进度:%d/%d", len(geo), target)
        if sleep:
            time.sleep(sleep)
    log.info("  geo 本次结束:%d/%d", len(geo), target)
    return calls


# ---- objective:经营目的 ----
def collect_obj_gaps() -> dict:
    """{term_id: (slug, 源文本)} —— industry.seed lvl2 中 industry_zh.json 尚未覆盖的。"""
    ind = _load("industry.seed.json", [])
    done = {r["term_id"] for r in _load("industry_zh.json", [])}
    gaps = {}
    for r in ind:
        if r.get("lvl") != 2 or r["term_id"] in done:
            continue
        gaps[r["term_id"]] = (r["slug"], _src_text(r.get("th"), r.get("en")))
    return gaps


def run_obj(gaps, batch, sleep, dry):
    rows = _load("industry_zh.json", [])
    have = {r["term_id"] for r in rows}
    keys = list(gaps)
    log.info("objective 待翻 %d 条(已覆盖 %d)", len(keys), len(have))
    if dry:
        for tid in keys[:10]:
            log.info("  样本 %s = %s", tid, gaps[tid][1])
        return 0
    calls, fails = 0, 0
    for i in range(0, len(keys), batch):
        chunk_ids = keys[i:i + batch]
        chunk = {str(tid): gaps[tid][1] for tid in chunk_ids}
        out = ai_translate(chunk, "泰国企业经营范围/行业目的")
        if out is None:
            fails += 1
            if fails >= _MAX_FAILS:
                log.warning("  obj 连续 %d 批失败,本次收尾(已落 %d,下次续跑)", fails, len(rows))
                break
            log.warning("  obj 本批失败,冷却 %ds 后跳过续翻", _COOLDOWN)
            time.sleep(_COOLDOWN)
            continue
        fails = 0
        for tid in chunk_ids:
            zh = str(out.get(str(tid), "")).strip()
            if zh and tid not in have:
                rows.append({"term_id": tid, "slug": gaps[tid][0], "zh": zh})
                have.add(tid)
        _atomic_write("industry_zh.json", rows)
        calls += 1
        log.info("  obj 批 %d:累计 %d", calls, len(rows))
        if sleep:
            time.sleep(sleep)
    return calls


def make_live_translator(keyin=True):
    """返回 fn(kind, key, th, en)->译文|None,供 sync 入库时"缺译即翻"(translate-on-miss),
    缺则即时翻译并写回对应种子缓存,新公司带着译文入库。失败返回 None(回落英/泰),不阻塞入库:
    - kind="geo"  : 县/分区,返回中文 str,缓存 geo_zh.json
    - kind="keyin": 经营范围自由文本,返回 {"en","zh"} dict,缓存 keyin_i18n.json
    keyin=False:首灌海量导入时关掉 keyin inline(避免逐家调用),只查缓存,由批量 run_keyin 去重翻。"""
    def tr(kind, key, th, en):
        if kind == "keyin" and not keyin:
            return None
        if kind == "geo":
            src = _src_text(th, en)
            if not src:
                return None
            out = ai_translate({"x": src}, "泰国行政区地名,县/分区", retries=3)
            zh = str((out or {}).get("x", "")).strip() if out else ""
            if not zh:
                return None
            d = {str(k): v for k, v in _load("geo_zh.json", {}).items()}
            d[str(key)] = zh
            _atomic_write("geo_zh.json", d)
            return zh
        if kind == "keyin":
            src = (th or "").strip()
            if not src:
                return None
            out = ai_keyin({"x": src}, retries=3)
            v = (out or {}).get("x") if isinstance(out, dict) else None
            if not isinstance(v, dict) or not (v.get("zh") or v.get("en")):
                return None
            pair = {"en": str(v.get("en") or "").strip(), "zh": str(v.get("zh") or "").strip()}
            merge_keyin({str(key): pair})  # 跨进程安全合并写
            return pair
        return None
    return tr


def make_queue_translator(queue_geo=True, queue_keyin=True):
    """返回 sync 可用的异步翻译投递器。

    它的签名与 make_live_translator 一致,但永远返回 None:入库立即使用英/泰兜底,
    缺口写入 i18n_queue/pending.jsonl,由 i18n_worker.py 专门处理。
    """
    seen = set()

    def tr(kind, key, th, en):
        if kind == "geo" and not queue_geo:
            return None
        if kind == "keyin" and not queue_keyin:
            return None
        marker = (str(kind), str(key))
        if marker in seen:
            return None
        seen.add(marker)
        enqueue_gap(kind, key, th, en)
        return None

    return tr


# ---- keyin 批量:从 DB 取去重经营范围文本翻译 ----
def collect_keyin_gaps_db() -> dict:
    """{md5: 泰文} —— 公司 meta 中去重的 setupobjnamekeyin/submitobjnamekeyin,且 keyin_i18n 未覆盖。需 DB 只读。"""
    import csv
    import io
    import subprocess
    db = {}
    for line in open(DB_ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if line.startswith("DB_") and "=" in line:
            k, v = line.split("=", 1)
            db[k] = v
    sql = ("COPY ("
           "SELECT DISTINCT meta_json->>'setupobjnamekeyin' FROM woocms.cms_content_entries WHERE coalesce(meta_json->>'setupobjnamekeyin','')<>'' "
           "UNION SELECT DISTINCT meta_json->>'submitobjnamekeyin' FROM woocms.cms_content_entries WHERE coalesce(meta_json->>'submitobjnamekeyin','')<>''"
           ") TO STDOUT WITH (FORMAT csv)")
    r = subprocess.run(
        ["psql", "-h", db["DB_HOST"], "-p", db.get("DB_PORT", "5432"),
         "-U", db["DB_USER"], "-d", db["DB_NAME"], "-tAc", sql],
        env={**os.environ, "PGPASSWORD": db["DB_PASSWORD"]}, capture_output=True, text=True)
    if r.returncode != 0:
        log.warning("collect_keyin_gaps_db 失败:%s", r.stderr[:200])
        return {}
    done = set(_load(KEYIN_SEED, {}))
    gaps = {}
    for row in csv.reader(io.StringIO(r.stdout)):
        if not row:
            continue
        text = row[0].strip()
        # 过滤过短/无意义(纯标点/单字符)的 keyin
        if len(text) < 4 or not any(c.isalpha() for c in text):
            continue
        h = keyin_hash(text)
        if h in done or h in gaps:
            continue
        gaps[h] = text
    return gaps


def run_keyin(gaps, batch, sleep, dry, workers=int(os.environ.get("KEYIN_WORKERS", "8"))):
    """并发翻译(21万级,串行太慢):线程池并发调 DeepSeek,缓存加锁、周期落盘。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    keys = list(gaps)
    base = len(_load(KEYIN_SEED, {}))
    log.info("keyin 待翻 %d 条(已覆盖 %d,并发 %d)", len(keys), base, workers)
    if dry:
        for h in keys[:5]:
            log.info("  样本 %s", gaps[h][:60])
        return 0
    chunks = [keys[i:i + batch] for i in range(0, len(keys), batch)]
    lock = threading.Lock()
    pending = {}
    st = {"calls": 0, "fails": 0, "done": 0}

    def work(chunk):
        out = ai_keyin({h: gaps[h] for h in chunk})
        with lock:
            if not isinstance(out, dict) or not out:
                st["fails"] += 1
                return
            for h in chunk:
                v = out.get(h)
                if isinstance(v, dict) and (v.get("zh") or v.get("en")):
                    pending[h] = {"en": str(v.get("en") or "").strip(), "zh": str(v.get("zh") or "").strip()}
                    st["done"] += 1
            st["calls"] += 1
            if st["calls"] % 20 == 0:
                merge_keyin(pending)  # 增量并集落盘(与入库即翻互不覆盖)
                pending.clear()
                log.info("  keyin 进度:已译 %d / 待 %d(批 %d,失败 %d)", st["done"], len(keys), st["calls"], st["fails"])

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, chunks))
    merge_keyin(pending)
    log.info("  keyin 完成:本次已译 %d(批 %d,失败 %d)", st["done"], st["calls"], st["fails"])
    return st["calls"]


def fill_gaps(target="all", limit=None, batch=60, sleep=0.5, dry_run=False) -> int:
    """扫缺口→翻译→写回种子。返回成功的 API 批次数(0=无新增/全失败)。供 main 与定时器复用。"""
    def cap(d):
        return {k: d[k] for k in list(d)[:limit]} if (limit and len(d) > limit) else d

    total = 0
    if target in ("geo", "all"):
        geo_gaps = collect_geo_gaps()
        geo_gaps.update(collect_geo_gaps_db())  # 并入公司实际用到、种子缺失的码
        total += run_geo(cap(geo_gaps), batch, sleep, dry_run)
    if target in ("objective", "all"):
        total += run_obj(cap(collect_obj_gaps()), max(30, batch // 2), sleep, dry_run)
    if target in ("keyin", "all"):
        total += run_keyin(cap(collect_keyin_gaps_db()), 40, 0, dry_run)
    log.info("完成。API 成功批次=%d%s", total, "(dry-run)" if dry_run else "")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["geo", "objective", "keyin", "all"], default="all")
    ap.add_argument("--limit", type=int, default=None, help="每个 target 最多翻 N 个唯一值(冒烟用)")
    ap.add_argument("--batch", type=int, default=60, help="每次 API 调用翻多少个值")
    ap.add_argument("--sleep", type=float, default=0.5, help="批间睡眠秒")
    ap.add_argument("--dry-run", action="store_true", help="只统计/看样本,不调 API")
    args = ap.parse_args()
    fill_gaps(args.target, args.limit, args.batch, args.sleep, args.dry_run)


if __name__ == "__main__":
    main()
