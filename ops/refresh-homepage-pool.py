#!/usr/bin/env python3
"""
refresh-homepage-pool.py
定期任务:刷新首页 page-25.html 里 bz-tabs 的公司候选池
(19 个 TSIC 行业大类 + 10 个精选省份,各随机抽 8 家「运营中」公司)。

2026-07-03 重写:旧版依赖 page-25.html.src 里的 <wc-data ...sort="random"> 占位标签做
正则替换,但 .src 已经跟线上 page-25.html 脱节(线上后续做过扁平 URL 迁移、省份中文翻译
修复,.src 没跟着更新)——照旧版跑会把这些后续修复覆盖掉。新版直接对线上 page-25.html
做定向替换,只动 <div class="bz-cos">...</div> 这 29 个区块本身,不碰其余 HTML;
用固定顺序(与模板里 bz-row 出现顺序严格一致)position-map 到 industry/province term,
不再依赖 .src。写文件前校验区块数量,数量不对(说明模板结构变了)直接中止不写,
避免位置错位污染数据。

同时修了从 v1 遗留下来的坑,以及一个安全问题:
  - 库连接参数不再硬编码,运行时从 admin/.env 读(与 refresh_facts.sh 同一手法)——
    旧版硬编码密码明文存进这个脚本文件,而且库名写的是切换前冻结的旧库 dbdadmin_woocms,
    不是 v1→v2 切换后线上实际用的 dbdadmin_woocms_v2。
  - 只从「运营中」公司里抽样:jpstatcode='1' 或三语状态文本命中已知说法,口径与
    analytics/src/db.js 的 statusRankExpr 一致(含约 7 万条 jpstatcode 缺失但文本判定
    为运营中的历史记录,不能只看 jpstatcode)。
  - 抽样方式从 ORDER BY RANDOM() LIMIT N 改成随机 entry_id 种子 + 索引区间扫描:前者对
    曼谷这种大分类(约30万行)要排序整个匹配集,实测跑了11分钟还没完;后者用现成的
    (term_id, entry_id) 复合索引直接 seek,分钟级降到秒级,牺牲一点随机分布均匀度换来
    的速度提升在"首页展示用"这个场景下完全划算。
"""

import html as html_lib
import json
import os
import random
import re
import subprocess
import sys
import time

# ── Config ───────────────────────────────────────────────────────────────
# 不硬编码密码:运行时从线上 WooCMS 的 admin/.env 读(与 refresh_facts.sh 同一手法),
# 密码只在这一份 .env 里维护一次。
ADMIN_ENV_PATH = os.environ.get(
    "DBD_DB_ENV", "/www/wwwroot/bizthai/dbd-thai/admin/.env"
)


def load_admin_env(path):
    cfg = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    return cfg


_admin_cfg = load_admin_env(ADMIN_ENV_PATH)
DB_ENV = {
    **os.environ,
    "PGHOST": _admin_cfg.get("DB_HOST", "127.0.0.1"),
    "PGPORT": _admin_cfg.get("DB_PORT", "5432"),
    "PGUSER": _admin_cfg.get("DB_USER", ""),
    "PGPASSWORD": _admin_cfg.get("DB_PASSWORD", ""),
    "PGDATABASE": _admin_cfg.get("DB_NAME", ""),
    # 安全网:万一哪次查询计划又踩到没预料到的慢路径,30s 后自己断,不无限占连接。
    "PGOPTIONS": "-c statement_timeout=30000",
}

DEST = "/www/wwwroot/bizthai/dbd-thai/admin/data/themes/starter/templates/page-25.html"

POOL_SIZE = 8      # 页面实际只展示 8 家；不把隐藏的 292 家及链接塞进首屏 HTML
OVERSAMPLE = 80    # 过采样后按运营状态/jpnamee过滤，足够稳定选满 8 家

# 固定顺序:必须跟模板里 bz-tabs 两个 panel 内 bz-row 的出现顺序逐一对应
# (19 个行业 tsic-a..t 缺 o,然后 10 个省份 Bangkok..Phuket)。
TERMS = [
    "industry:tsic-a", "industry:tsic-b", "industry:tsic-c", "industry:tsic-d",
    "industry:tsic-e", "industry:tsic-f", "industry:tsic-g", "industry:tsic-h",
    "industry:tsic-i", "industry:tsic-j", "industry:tsic-k", "industry:tsic-l",
    "industry:tsic-m", "industry:tsic-n", "industry:tsic-p", "industry:tsic-q",
    "industry:tsic-r", "industry:tsic-s", "industry:tsic-t",
    "province:provf9f6448bf9",   # Bangkok
    "province:provb87bb14243",   # Chonburi
    "province:provdd56d1d575",   # Rayong
    "province:prov48827ea6d4",   # Samut Prakan
    "province:prov47594a90e1",   # Nonthaburi
    "province:prov85dd91fc2d",   # Pathum Thani
    "province:provcc1d3f07cf",   # Ayutthaya (Phra Nakhon Si Ayutthaya)
    "province:prov938e63ce50",   # Chiang Mai
    "province:prov7cd0c08ad9",   # Nakhon Ratchasima
    "province:prov8d2440a16f",   # Phuket
]

# 「运营中」判定,口径与 analytics/src/db.js 的 statusRankExpr 一致。用 f. 前缀,配合
# thaicompany_facts 视图(见 RESIDUAL_SQL 的说明)。
OPERATING_FILTER = (
    "(f.jpstatcode = '1' OR "
    "COALESCE(NULLIF(f.statuszh,''), NULLIF(f.jpstatdesce,''), "
    "NULLIF(f.jpstatdesc,'')) IN ('运营中', 'ยังดำเนินกิจการอยู่', 'Operating'))"
)

BZ_COS_RE = re.compile(r'<div class="bz-cos">.*?</div>', re.DOTALL)


# ── DB helpers ────────────────────────────────────────────────────────────

def psql_json(sql, preamble=""):
    # 走 stdin 而不是 -c 参数:大分类(曼谷)一次要传上万个 entry_id 字面量,拼进命令行
    # 参数会撞系统 ARG_MAX(实测 16783 个 id 直接报 "Argument list too long")。
    # -v ON_ERROR_STOP=1 必须加:默认 psql 遇到 SQL 报错(比如 statement_timeout 取消)
    # 不会返回非零退出码,check=True 抓不到,会把"查询失败→空结果"悄悄当成"合法的0条"
    # 写进产出文件——这是实测踩过的坑,不是假设性加固。
    wrapped = f"{preamble}SELECT json_agg(r) FROM ({sql}) r"
    result = subprocess.run(
        ["psql", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1"],
        input=wrapped,
        env=DB_ENV, capture_output=True, text=True, check=True,
        timeout=10,
    )
    raw = result.stdout.strip()
    if not raw or raw in ("\\N", ""):
        return []
    # 带 preamble(如 "SET enable_seqscan = off; ")时,psql 即使 --tuples-only 也会先吐一行
    # 独立的 "SET" 命令确认(实测确认,不是文档行为),混进要解析的 JSON 前面。json_agg
    # 的输出本身必以 '[' 或 '{' 开头,从这里往后切,把前面的命令回执丢掉。
    start = min((i for i in (raw.find("["), raw.find("{")) if i != -1), default=0)
    return json.loads(raw[start:]) or []


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def fetch_term_ids(terms):
    conditions = " OR ".join(
        f"(tx.slug = '{tax}' AND t.slug = '{slug}')"
        for tax, slug in (t.split(":", 1) for t in terms)
    )
    rows = psql_json(f"""
        SELECT tx.slug || ':' || t.slug AS term_key, t.id AS term_id
        FROM woocms.cms_custom_terms t
        JOIN woocms.cms_custom_taxonomies tx ON tx.id = t.taxonomy_id
        WHERE {conditions}
    """)
    return {r["term_key"]: r["term_id"] for r in rows}


# 用 thaicompany_facts(物化视图)水合,不用 cms_content_entries 原表:实测同样 600 行
# 候选,走 e.meta_json->>'x' 现取要 ~8 秒(11KB/行的 JSONB 要反复 detoast+解析 8 个字段),
# 换成 facts 视图的现成标量列只要 ~0.4 秒,20 倍差距——这不是索引/查询计划问题,是
# JSONB 提取本身的开销,只能靠不重复现取来解决。facts 视图定义已经是
# status='published' AND deleted_at IS NULL,不用再重复这两个条件。
RESIDUAL_SQL = f"""f.jpnamee IS NOT NULL AND f.jpnamee <> ''
              AND {OPERATING_FILTER}"""


def fetch_all_entry_ids(term_id_map):
    # 只按 term_id 取全部 entry_id,不带 ORDER BY/范围条件——没有其它索引能"顺便"满足
    # 排序,planner 没有歧义可选,老老实实用 (term_id, entry_id) 复合索引做 index-only
    # scan。这是关键:之前 WHERE term_id=X AND entry_id>=seed ORDER BY entry_id 这种写法,
    # planner 对曼谷这种大 term 的选择率严重低估(误判成"预计1行"),转而选了主键
    # (entry_id, term_id) 索引"顺便"满足排序,代价是要扫经过的所有公司(不管哪个 term)
    # 筛 term_id,实测卡满 statement_timeout。改成先拿全量 id 在 Python 里随机抽,
    # 换掉容易被 planner 猜错的排序型查询。
    ids = ", ".join(str(v) for v in term_id_map.values())
    rows = psql_json(f"""
        SELECT term_id, array_agg(entry_id) AS ids
        FROM woocms.cms_content_entry_terms
        WHERE term_id IN ({ids})
        GROUP BY term_id
    """)
    id_to_term = {v: k for k, v in term_id_map.items()}
    out = {}
    for r in rows:
        term = id_to_term.get(r["term_id"])
        if term:
            out[term] = r["ids"] or []
    return out


def fetch_pools(term_id_map):
    print("Fetching all entry_ids per term (single index-only scan, no ORDER BY)...")
    all_ids = fetch_all_entry_ids(term_id_map)

    rnd = random.Random()
    sampled = {}       # term -> [entry_id, ...]  (candidate ids, unhydrated,最多 OVERSAMPLE 个)
    for term, ids in all_ids.items():
        sampled[term] = ids if len(ids) <= OVERSAMPLE else rnd.sample(ids, OVERSAMPLE)

    if not any(sampled.values()):
        return {term: [] for term in term_id_map}

    # 每个分类单独一次 psql 调用(29 次):试过合并成一次大请求(不管是一个大 IN、分批,
    # 还是 UNION ALL 拼 29 个子查询),都偶发被 planner 判成"整体太复杂"绕开索引、撞
    # statement_timeout——量级小的单次查询之前实测稳定在毫秒到1秒内,29 次顺序调用的
    # 总耗时远比之前几次"聪明"但不稳定的合并写法要低且可预测,不再折腾。
    print(f"Hydrating {sum(len(v) for v in sampled.values())} sampled companies ({len(sampled)} 次单独查询)...")
    pools = {term: [] for term in term_id_map}
    for term, ids in sampled.items():
        if not ids:
            continue
        t0 = time.monotonic()
        id_list = ", ".join(str(i) for i in ids)
        rows = psql_json(f"""
            SELECT f.entry_id, f.slug,
                   COALESCE(f.jpnamee, '') AS jpnamee,
                   COALESCE(f.jpname,  '') AS jpname,
                   COALESCE(f.jpnamezh,'') AS jpnamezh,
                   COALESCE(f.capamt::text, '') AS capamt
            FROM woocms.thaicompany_facts f
            WHERE f.entry_id IN ({id_list})
              AND {RESIDUAL_SQL}
        """)
        pools[term] = rows[:POOL_SIZE]
        print(f"  {term:<28} {len(ids):>4} ids -> {len(rows):>4} rows  ({time.monotonic()-t0:.2f}s)", flush=True)
    return pools


# ── HTML rendering ────────────────────────────────────────────────────────

def esc(s):
    return html_lib.escape(str(s) if s else "", quote=True)


def company_href(row):
    """Prefer English-name slug URL (SEO); fall back to cms slug / jpno."""
    import re as _re
    en = (row.get("jpnamee") or "").strip()
    slug = _re.sub(r"[^a-z0-9]+", "-", en.lower()).strip("-") if en else ""
    if not slug:
        slug = str(row.get("slug") or "").strip()
    return slug

def render_company(row):
    return (
        f'<a class="bz-co" href="/{esc(company_href(row))}.html" data-en-name="{esc(row["jpnamee"])}">'
        f'<span class="bz-co__nm" '
        f'data-en="{esc(row["jpnamee"])}" '
        f'data-th="{esc(row["jpname"])}" '
        f'data-zh="{esc(row["jpnamezh"])}">'
        f'{esc(row["jpnamee"])}</span>'
        f'<span class="bz-co__cap" data-cap="{esc(row["capamt"])}">{esc(row["capamt"])}</span>'
        f'</a>'
    )


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    if not os.path.exists(DEST):
        print(f"ERROR: 目标文件不存在: {DEST}", file=sys.stderr)
        sys.exit(1)

    with open(DEST, encoding="utf-8") as f:
        content = f.read()

    blocks = BZ_COS_RE.findall(content)
    if len(blocks) != len(TERMS):
        print(
            f"ERROR: 页面里找到 {len(blocks)} 个 .bz-cos 区块,预期 {len(TERMS)} 个——"
            f"模板结构可能变了,位置对应关系不可信,中止,不写文件。",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Fetching term IDs for {len(TERMS)} terms...")
    term_id_map = fetch_term_ids(TERMS)
    missing = [t for t in TERMS if t not in term_id_map]
    if missing:
        print(f"ERROR: 数据库里找不到这些 term,中止: {missing}", file=sys.stderr)
        sys.exit(1)

    pools = fetch_pools(term_id_map)
    empty_terms = []
    for term in TERMS:
        n = len(pools.get(term, []))
        flag = "  <-- 池子偏小,检查一下" if n < 8 else ""
        print(f"  {term:<28} {n:>4} companies{flag}")
        if n == 0:
            empty_terms.append(term)

    # 兜底:任何一个分类查出 0 条都不正常(最小的 tsic-t 全库也有 27 家),大概率是查询
    # 出问题(比如又踩到某个 silent-fail)而不是真的没数据——中止,不能把空池子写上线。
    # 这条防线是 2026-07-03 真实吃过一次亏之后加的:一次全字段超时被 psql 悄悄吞掉,
    # 29 个分类全写成 0 条上线了才发现。
    if empty_terms:
        print(
            f"ERROR: 这些分类查出 0 条,不正常,中止,不写文件: {empty_terms}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("\nGenerating page-25.html (只替换 .bz-cos 区块)...")
    term_iter = iter(TERMS)

    def replace_block(_m):
        term = next(term_iter)
        rows = pools.get(term, [])
        inner = "".join(render_company(r) for r in rows)
        return f'<div class="bz-cos">{inner}</div>'

    new_content = BZ_COS_RE.sub(replace_block, content)

    # 校验:除了 29 个 .bz-cos 区块,其余内容必须逐字节不变
    shell_before = BZ_COS_RE.sub('[POOL]', content)
    shell_after = BZ_COS_RE.sub('[POOL]', new_content)
    if shell_before != shell_after:
        print("ERROR: 除公司池外的内容发生了变化,中止,不写文件(这不应该发生)。", file=sys.stderr)
        sys.exit(1)

    tmp_path = DEST + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    os.chmod(tmp_path, 0o654)
    try:
        import pwd, grp
        uid = pwd.getpwnam("www-data").pw_uid
        gid = grp.getgrnam("www-data").gr_gid
        os.chown(tmp_path, uid, gid)
    except Exception as e:
        print(f"WARN: chown 失败: {e}", file=sys.stderr)
    os.replace(tmp_path, DEST)  # 同文件系统内原子替换

    print(f"Done → {DEST}")


if __name__ == "__main__":
    main()
