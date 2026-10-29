"""把 i18n_seed/ 下的三语种子组装并生成幂等 SQL,落入 woocms.cms_term_translations。

数据来源(均在 sync/i18n_seed/):
  - province.seed.json / industry.seed.json / capital.seed.json —— 由 export_term_en.sql 生成的骨架
      (th=主表泰文;县/分区·经营目的 en=企业 meta 聚合·slug 兜底;capital zh=主表中文)
  - province_known.json / industry_known.json —— 从 web taxonomy.ts 提取的府77/大类19 已知中英
  - industry_zh.json —— 经营目的 571 中文(翻译产出)
  - capital_then.json —— capital 203 泰文+英文国名(翻译产出)

组装规则(每 term 落 3 行 locale: th / en / zh-CN;slug 沿用主表 slug):
  - province 府(lvl1):th=种子, en/zh=province_known
  - province 县/分区(lvl2/3):th=种子, en=种子, zh-CN=en(用户定:县/分区中文用英文兜底)
  - industry 大类(lvl1):th=种子, en/zh=industry_known
  - industry 经营目的(lvl2):th=种子, en=种子(8 条空→slug 兜底), zh-CN=industry_zh
  - capital(顶层+国家):th/en=capital_then, zh-CN=种子(主表中文)
  companytype(tax 2)不在此处——随阶段5重构后单独落库。

用法:
  python3 seed_translations.py            # 仅生成 i18n_seed/_translations.sql
  psql ... -f i18n_seed/_translations.sql # 由 ops/seed_translations.sh 执行
"""
import json
import re
from pathlib import Path

SEED = Path(__file__).resolve().parent / "i18n_seed"
SITE_ID = 1
LOCALES_OUT = SEED / "_translations.sql"
BATCH = 1000


def load(name):
    return json.load(open(SEED / name, encoding="utf-8"))


def slug_en_fallback(slug: str) -> str:
    """slug 去末段官方码、'-'转空格、句首大写,作为英文兜底。"""
    base = re.sub(r"-[^-]*$", "", slug).replace("-", " ").strip()
    return base[:1].upper() + base[1:] if base else slug


def load_optional(name, default):
    p = SEED / name
    return json.load(open(p, encoding="utf-8")) if p.exists() else default


def build_rows():
    prov = load("province.seed.json")
    prov_known = load("province_known.json")
    geo_zh = {str(k): v for k, v in load_optional("geo_zh.json", {}).items() if v}  # 官方码 -> 县/分区中文
    ind = load("industry.seed.json")
    ind_known = load("industry_known.json")
    ind_zh = {r["term_id"]: r["zh"] for r in load("industry_zh.json")}
    cap = load("capital.seed.json")
    cap_then = {r["term_id"]: r for r in load("capital_then.json")}

    rows = []  # (taxonomy_id, term_id, locale, name, slug)

    # province (taxonomy_id=1)
    for r in prov:
        tid, slug, th = r["term_id"], r["slug"], r["th"]
        if r["lvl"] == 1:
            k = prov_known.get(slug, {})
            en = k.get("en") or th
            zh = k.get("zh") or th
        else:
            en = r["en"] or slug_en_fallback(slug)
            zh = geo_zh.get(slug.rsplit("-", 1)[-1]) or en  # 县/分区:geo_zh 中文,缺则英文兜底
        rows += [(1, tid, "th", th, slug), (1, tid, "en", en, slug), (1, tid, "zh-CN", zh, slug)]

    # industry (taxonomy_id=3)
    for r in ind:
        tid, slug, th = r["term_id"], r["slug"], r["th"]
        if r["lvl"] == 1:
            k = ind_known.get(slug, {})
            en = k.get("en") or th
            zh = k.get("zh") or th
        else:
            en = r["en"] or slug_en_fallback(slug)
            zh = ind_zh.get(tid) or en
        rows += [(3, tid, "th", th, slug), (3, tid, "en", en, slug), (3, tid, "zh-CN", zh, slug)]

    # capital (taxonomy_id=4)
    for r in cap:
        tid, slug, zh = r["term_id"], r["slug"], r["zh"]
        t = cap_then.get(tid, {})
        th = t.get("th") or zh
        en = t.get("en") or zh
        rows += [(4, tid, "th", th, slug), (4, tid, "en", en, slug), (4, tid, "zh-CN", zh, slug)]

    return rows


def esc(s) -> str:
    return str(s).replace("'", "''")


def gen_sql(rows) -> str:
    def val(tax, tid, loc, name, slug):
        return f"({SITE_ID},{tax},{tid},'{loc}','{esc(name)}','{esc(slug)}','published',now())"

    stmts = []
    for i in range(0, len(rows), BATCH):
        vals = ",".join(val(*r) for r in rows[i:i + BATCH])
        stmts.append(
            "INSERT INTO woocms.cms_term_translations"
            "(site_id,taxonomy_id,term_id,locale,name,slug,status,updated_at) VALUES "
            f"{vals} ON CONFLICT (term_id,locale) DO UPDATE SET "
            "name=EXCLUDED.name,slug=EXCLUDED.slug,status='published',updated_at=now();"
        )
    return "BEGIN;\n" + "\n".join(stmts) + "\nCOMMIT;\n"


def main():
    rows = build_rows()
    # 自检:每 term 恰好 3 行;locale 齐全
    terms = {(t, tid) for t, tid, *_ in rows}
    assert len(rows) == len(terms) * 3, f"行数 {len(rows)} 不等于 term*3 ({len(terms)*3})"
    blanks = [r for r in rows if not str(r[3]).strip()]
    assert not blanks, f"存在空 name: {blanks[:3]}"
    sql = gen_sql(rows)
    LOCALES_OUT.write_text(sql, encoding="utf-8")
    by_tax = {}
    for t, *_ in rows:
        by_tax[t] = by_tax.get(t, 0) + 1
    print(f"terms={len(terms)} rows={len(rows)} sql_bytes={len(sql)}")
    print("按分类法(行数/3=term数):", {f"tax{t}": n // 3 for t, n in sorted(by_tax.items())})
    print(f"已写 {LOCALES_OUT}")


if __name__ == "__main__":
    main()
