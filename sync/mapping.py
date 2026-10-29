"""泰国 API 详情(envelope)→ 前端 DbdRawCompany + 后台可见的平铺字段。

实测泰国 /companies/{jpNo} 返回:{ jpNo, basic, financialStatements, detail }
其中 **detail 即 DbdRawCompany 形状**(profile 89字段含嵌套 + committees/财报等)。

meta 设计:
- **平铺 profile 全部字段到 meta 顶层,键用小写**——WooCMS 字段名会被小写化,
  后台按「小写字段名 ↔ meta 键」绑定显示,故 meta 键必须小写才能在后台编辑页显示。
- 另加少量中文/检索字段(statuszh/typezh/province... 小写)。
- meta.raw = 完整 DbdRawCompany(驼峰,不动)——前端详情页按嵌套路径渲染用它。
"""
import hashlib
import json
from pathlib import Path

SEED_DIR = Path(__file__).resolve().parent / "i18n_seed"

# businesstypedesc 仅 5 个固定值(DBD 商业大类),源数据英文缺失,这里补中/英。
BIZTYPE = {
    "บริการ": ("Service", "服务"),
    "ขายส่ง": ("Wholesale", "批发"),
    "ผลิต": ("Manufacturing", "制造"),
    "ขายปลีก": ("Retail", "零售"),
    "อื่นๆ": ("Others", "其他"),
}

# 法人类型(jptypedesc 泰文)-> (英文, 中文)。当前数据仅"有限公司",其余预置以备未来扩展。
COMPANYTYPE = {
    "บริษัทจำกัด": ("Company Limited", "有限公司"),
    "บริษัทมหาชนจำกัด": ("Public Company Limited", "大众有限公司"),
    "ห้างหุ้นส่วนจำกัด": ("Limited Partnership", "有限合伙"),
    "ห้างหุ้นส่วนสามัญนิติบุคคล": ("Registered Ordinary Partnership", "注册普通合伙"),
    "ห้างหุ้นส่วนสามัญ": ("Ordinary Partnership", "普通合伙"),
}


def load_zh_lookup() -> dict:
    """从 i18n_seed/ 构造 sync 注入用的中文映射(纯文件读,不连 DB)。
    - province: 府泰文名 -> 府中文名(77)
    - objective: TSIC objCode -> 经营目的中文(571)
    - geo: 县/分区官方码(ampurCode/tumbonCode,= seed slug 末尾码)-> 中文(由 translate_gaps.py 翻译产出)
    - objgrp: 行业大类泰文名(setupObjGrpDesc)-> 中文(industry_known 19 大类已有,经 lvl1 泰文名桥接)
    geo 未覆盖的县/分区仍英文兜底;objgrp 未命中仍英/泰兜底(见 inject_zh_fields)。
    """
    def _load(n):
        return json.load(open(SEED_DIR / n, encoding="utf-8"))
    def _load_optional(n):
        p = SEED_DIR / n
        return json.load(open(p, encoding="utf-8")) if p.exists() else {}
    prov_known = _load("province_known.json")
    province = {v["th"]: v["zh"] for v in prov_known.values() if v.get("th") and v.get("zh")}
    ind = _load("industry.seed.json")
    ind_zh = {r["term_id"]: r["zh"] for r in _load("industry_zh.json")}
    objective = {}
    for r in ind:
        if r.get("lvl") == 2:
            objective[r["slug"].rsplit("-", 1)[-1]] = ind_zh.get(r["term_id"])
    # 行业大类:lvl1 泰文名 -> slug(tsic-x) -> industry_known 中文
    ind_known = _load("industry_known.json")
    objgrp = {}
    for r in ind:
        if r.get("lvl") == 1 and r.get("th"):
            zh = (ind_known.get(r["slug"]) or {}).get("zh")
            if zh:
                objgrp[r["th"].strip()] = zh  # strip:公司数据偶有尾部空格
    # 县/分区:{官方码(str): 中文}
    geo = {str(k): v for k, v in (_load_optional("geo_zh.json") or {}).items() if v}
    # 经营范围自由文本:{md5(泰文): {en, zh}}
    keyin = _load_optional("keyin_i18n.json") or {}
    return {
        "province": province,
        "objective": {k: v for k, v in objective.items() if v},
        "geo": geo,
        "objgrp": objgrp,
        "keyin": keyin,
    }


# inject_zh_fields 写入/更新的字段集合(供 backfill_zh.py 只 patch 这些键,不动 raw 等其他键)
ZH_FIELDS = [
    "provincezh", "ampurdesczh", "tumbondesczh", "businesstypedesce", "businesstypedesczh",
    "setupobjdesczh", "setupobjgrpdesczh", "addresszh", "companytypee", "companytypezh",
    "setupobjnamekeyine", "setupobjnamekeyinzh", "submitobjnamekeyine", "submitobjnamekeyinzh",
]


def inject_zh_fields(meta: dict, zl: dict | None = None, translate=None) -> dict:
    """把三语扁平中文字段注入 meta(中文优先,缺则英/泰兜底)。**只读 meta 已有字段,不取 DBD**——
    故 display_meta(增量)与 backfill_zh.py(存量)共用此一处逻辑。前端 client.ts 按 lang 选字段。

    translate:可选回调 fn(kind, key, th, en)->中文|None。入库时(sync)传入它,使"种子里还没有的
    新县/分区"在入库当下即时调后台 DeepSeek 翻译并写回种子缓存,新公司带着中文入库(translate-on-miss);
    backfill/纯查表场景传 None,缺则英/泰兜底。
    """
    zl = zl or {}
    geo = zl.setdefault("geo", {}) if isinstance(zl, dict) else {}

    def geo_zh(code, th, en):
        code = str(code or "")
        if not code:
            return None
        z = geo.get(code)
        if z:
            return z
        if translate:
            z = translate("geo", code, th, en)
            if z:
                geo[code] = z  # 本进程内缓存,后续同码直接命中
                return z
        return None

    prov_th = meta.get("province")
    meta["provincezh"] = (zl.get("province") or {}).get(prov_th) or meta.get("provincee") or prov_th
    meta["ampurdesczh"] = geo_zh(meta.get("ampurcode"), meta.get("ampurdesc"), meta.get("ampurdesce")) \
        or meta.get("ampurdesce") or meta.get("ampurdesc")
    meta["tumbondesczh"] = geo_zh(meta.get("tumboncode"), meta.get("tumbondesc"), meta.get("tumbondesce")) \
        or meta.get("tumbondesce") or meta.get("tumbondesc")
    bt_en, bt_zh = BIZTYPE.get(meta.get("businesstypedesc"), (None, None))
    if bt_en:
        meta["businesstypedesce"] = bt_en
    meta["businesstypedesczh"] = bt_zh or meta.get("businesstypedesc")
    objcode = str(meta.get("setupobjcode") or "")
    meta["setupobjdesczh"] = (zl.get("objective") or {}).get(objcode) or meta.get("setupobjdesce") or meta.get("setupobjdesc")
    grp_th = meta.get("setupobjgrpdesc")
    meta["setupobjgrpdesczh"] = (zl.get("objgrp") or {}).get((grp_th or "").strip()) or meta.get("setupobjgrpdesce") or grp_th
    meta["addresszh"] = _address_zh(meta)
    # 经营范围自由文本(setupObjNameKeyin/submitObjNameKeyin):保留泰文,新增英/中(按文本去重缓存)
    keyin_cache = zl.get("keyin") or {}

    def _keyin(src_key):
        text = (meta.get(src_key) or "").strip()
        if not text:
            return "", ""
        h = hashlib.md5(text.encode("utf-8")).hexdigest()
        pair = keyin_cache.get(h)
        if not pair and translate:
            pair = translate("keyin", h, text, None)
            if isinstance(pair, dict):
                keyin_cache[h] = pair
        if isinstance(pair, dict):
            return pair.get("en") or "", pair.get("zh") or ""
        return "", ""

    meta["setupobjnamekeyine"], meta["setupobjnamekeyinzh"] = _keyin("setupobjnamekeyin")
    meta["submitobjnamekeyine"], meta["submitobjnamekeyinzh"] = _keyin("submitobjnamekeyin")
    ctype_th = meta.get("jptypedesc")
    ct_en, ct_zh = COMPANYTYPE.get(ctype_th, (None, None))
    meta["companytypee"] = meta.get("jptypedesce") or ct_en or ctype_th or meta.get("type")
    meta["companytypezh"] = ct_zh or meta.get("typezh") or ctype_th
    return meta


def _street_segment(meta: dict) -> str:
    """门牌/路名段:英文地址含数字时用英文(更国际化),否则用泰文(总完整;英文常为 HEAD OFFICE 占位)。"""
    ae = str(meta.get("addresse") or "")
    if any(c.isdigit() for c in ae):
        return ae
    return str(meta.get("address") or ae)


def _address_zh(meta: dict) -> str:
    """中文地址:只取门牌路名段,不拼分区/县/府/邮编。
    resolver(renderCompanySSR)和 theme.js 展示地址时都会把 province/district/subdistrict
    另外单独拼成 region、再接在这个值后面一次;这里如果也塞同样的文字会导致地址栏位重复两次。
    """
    return _street_segment(meta)


def to_raw(envelope: dict) -> dict:
    """整个 detail 即前端要的 DbdRawCompany;财报缺失时回退顶层 financialStatements。"""
    inner = dict((envelope or {}).get("detail") or {})
    if not inner.get("financialStatements"):
        inner["financialStatements"] = (envelope or {}).get("financialStatements") or {}
    return inner


def _profile_of(envelope: dict) -> dict:
    return ((envelope or {}).get("detail") or {}).get("profile") or {}


# 嵌套对象 -> 展开为独立子字段:parent -> [(子键, 平铺字段名)]。平铺字段名小写后即 meta 键。
NESTED_FLATTEN = {
    "jpType": [("jpTypeAbbr", "jpTypeAbbr"), ("jpTypeDesc", "jpTypeDesc"), ("jpTypeDescE", "jpTypeDescE")],
    "jpStatus": [("jpStatDesc", "jpStatDesc"), ("jpStatDescE", "jpStatDescE"), ("jpStatDetail", "jpStatDetail")],
    "locationAmpur": [("ampurDesc", "ampurDesc"), ("ampurDescE", "ampurDescE")],
    "locationTumbon": [("tumbonDesc", "tumbonDesc"), ("tumbonDescE", "tumbonDescE")],
    "setupObjType": [("objDesc", "setupObjDesc"), ("objDescE", "setupObjDescE"),
                     ("objGrpDesc", "setupObjGrpDesc"), ("objGrpDescE", "setupObjGrpDescE")],
    "submitObjType": [("objDesc", "submitObjDesc"), ("objDescE", "submitObjDescE"),
                      ("objGrpDesc", "submitObjGrpDesc"), ("objGrpDescE", "submitObjGrpDescE")],
}
# 这些嵌套对象数据已由 computed(中文/检索)覆盖或无价值,不单独存原始 JSON
SKIP_NESTED = {"businessType", "locationProvince", "jpConsent", "websites"}


def _serialize(v):
    """供后台文本/数字字段显示:日期数组→YYYY-MM-DD;嵌套对象/数组→JSON 字符串;标量原样。"""
    if isinstance(v, list) and len(v) == 3 and all(isinstance(x, int) for x in v):
        return f"{v[0]}-{v[1]:02d}-{v[2]:02d}"
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


# ---- 三语版本块(meta.i18n):把已平铺的扁平字段按 th/en/zh 归并成「每语言一套」----
# (概念键, th 源, en 源, zh 源);源可为元组=多个备选键(取第一个非空)。值复用 display_meta 已算好的扁平字段。
I18N_SPEC = [
    ("name",          "jpname",                  "jpnamee",           "jpname"),
    ("province",      "province",                "provincee",         "provincezh"),
    ("district",      "ampurdesc",               "ampurdesce",        "ampurdesczh"),
    ("subdistrict",   "tumbondesc",              "tumbondesce",       "tumbondesczh"),
    ("address",       "address",                 "addresse",          "addresszh"),
    ("industryGroup", "businesstypedesc",        "businesstypedesce", "businesstypedesczh"),
    ("objective",     "setupobjdesc",            "setupobjdesce",     "setupobjdesczh"),
    ("companyType",   "jptypedesc",              "companytypee",      "companytypezh"),
    ("status",        ("jpstatdesc", "status"),  "jpstatdesce",       "statuszh"),
]


def _mget(meta: dict, keys) -> str:
    """取第一个非空字段值(支持单键或多备选键元组),统一为字符串。"""
    for k in (keys if isinstance(keys, tuple) else (keys,)):
        v = meta.get(k)
        if v not in (None, ""):
            return str(v)
    return ""


def build_i18n_block(meta: dict) -> dict:
    """从已平铺的三语扁平字段,组装「按语言分版本」的 i18n 块:{th:{...}, en:{...}, zh:{...}},
    每版本含同一组展示概念(I18N_SPEC)。缺失回退到该概念任一非空值(复刻前端 client.ts 的 lt() 兜底),
    故每版本都完整、可被前端直接取用;维持中文兜底现状(不补译)。
    **只读现成扁平字段、不重取 DBD**——故增量(display_meta)与存量回填(backfill_i18n.py)共用此一处逻辑。
    """
    out = {"th": {}, "en": {}, "zh": {}}
    for concept, kth, ken, kzh in I18N_SPEC:
        th, en, zh = _mget(meta, kth), _mget(meta, ken), _mget(meta, kzh)
        fallback = th or en or zh
        out["th"][concept] = th or fallback
        out["en"][concept] = en or fallback
        out["zh"][concept] = zh or fallback
    return out


def display_meta(jp_no: str, envelope: dict | None, list_item: dict | None,
                 zh_lookup: dict | None = None, translate=None) -> dict:
    """构建 meta:profile 全字段平铺(小写键)+ 中文/检索字段。raw 由 sync 另行写入。"""
    basic = (envelope or {}).get("basic") or {}
    prof = _profile_of(envelope)
    li = list_item or {}
    src = prof if prof else li

    # 1) profile(或列表项)字段平铺(键小写、值序列化);嵌套对象展开为子字段
    meta = {}
    for k, v in src.items():
        if k in NESTED_FLATTEN or k in SKIP_NESTED:
            continue
        meta[str(k).lower()] = _serialize(v)
    for parent, subs in NESTED_FLATTEN.items():
        obj = src.get(parent)
        if isinstance(obj, dict):
            for subkey, fname in subs:
                meta[fname.lower()] = _serialize(obj.get(subkey))

    # 2) 中文/检索字段(profile 里没有的,来自 basic/列表项)
    def pick(*keys):
        for s in (basic, li, prof):
            for k in keys:
                val = s.get(k)
                if val not in (None, ""):
                    return val
        return None

    def nested(path):
        o = prof
        for k in path.split("."):
            o = o.get(k) if isinstance(o, dict) else None
        return o

    meta.update({
        "jpno": jp_no,
        "status": pick("status"),
        "statuszh": pick("statusZh"),
        "type": pick("type"),
        "typezh": pick("typeZh"),
        "province": pick("province") or nested("locationProvince.pvDesc"),
        "provincee": pick("provinceE") or nested("locationProvince.pvDescE"),
        "businesstypedesc": pick("businessTypeDesc") or nested("businessType.businessTypeDesc"),
        "businesstypedesce": nested("businessType.businessTypeDescE"),
        "finyear": (basic.get("finance") or {}).get("fiscalYear"),
        "hasdetail": bool(li.get("has_detail")) if "has_detail" in (li or {}) else bool(prof),
    })
    meta["finreport"] = finance_report_text(envelope)

    # ---- 三语扁平字段(中文优先,缺则英/泰兜底);前端 client.ts 按 lang 选字段 ----
    inject_zh_fields(meta, zh_lookup, translate)

    # 按语言分版本的三语块:前端按 i18n[lang] 一次取一套(扁平字段保留作底层兼容)
    meta["i18n"] = build_i18n_block(meta)
    return meta


# 后台「财务报表」只读文本:逐年关键科目表
_FIN_SECTIONS = [
    ("财务状况表(单位:泰铢)", [
        ("应收账款净额", "traderreceivables"), ("存货", "inventories"), ("流动资产", "currentassets"),
        ("土地建筑设备", "propertyplantandequipment"), ("非流动资产", "noncurrentassets"), ("总资产", "assets"),
        ("流动负债", "currentliabilities"), ("非流动负债", "noncurrentliabilities"), ("总负债", "liabilities"),
        ("股东权益", "equity"), ("总负债和股东权益", "liabilitiesandequity"),
    ]),
    ("损益表(单位:泰铢)", [
        ("营业收入", "revenue"), ("销售成本", "costsofsaleofgoodorservice"), ("毛利", "grossprofit"),
        ("销售及服务费用", "sellingandserviceexpense"), ("管理费用", "administrativeexpense"),
        ("税前利润", "plbeforeincometaxexpense"), ("净利润", "profitloss"),
    ]),
    ("财务比率", [
        ("流动比率", "currentRatio"), ("产权比率", "debtToEquity"), ("毛利率%", "grossProfitMargin"),
        ("净利率%", "netProfitMargin"), ("ROA%", "returnOnAsset"), ("ROE%", "returnOnEquity"),
        ("每股收益", "earningPerShare"),
    ]),
]


def finance_report_text(envelope: dict) -> str:
    """逐年财报只读文本(供后台「财务报表」选项卡核对)。"""
    fs = ((envelope or {}).get("detail") or {}).get("financialStatements") \
        or (envelope or {}).get("financialStatements") or {}
    annual = fs.get("annualData") or {}
    years = [y for y in (fs.get("years") or sorted(annual)) if annual.get(y)]
    years = sorted(years, key=lambda y: str(y))
    if not years:
        return ""
    out = [f"财年(佛历): {' / '.join(years)}", ""]
    for title, rows in _FIN_SECTIONS:
        out.append(f"【{title}】")
        for label, field in rows:
            vals = []
            for y in years:
                v = (annual.get(y) or {}).get(field)
                vals.append(f"{v:,.2f}" if isinstance(v, (int, float)) else "-")
            out.append(f"  {label}: " + " / ".join(vals))
        out.append("")
    return "\n".join(out).strip()


def short_summary(meta: dict) -> str:
    # summary 兼作可搜索文本:英文名/注册号塞进来(泰文名已在 title)
    parts = [meta.get("jpnamee"), meta.get("jpno"),
             meta.get("statuszh") or meta.get("status"), meta.get("province")]
    cap = meta.get("capamt")
    if cap:
        parts.append(f"ทุน {cap}")
    return " · ".join(str(p) for p in parts if p)[:255]


def province_name(meta: dict):
    return meta.get("province")


def type_name(meta: dict):
    # companytype term 名:优先 DBD 法人类型泰文名(jptypedesc,稳定粒度),兜底笼统中文/类型。
    # sync.ensure_term 据此建 term(slug=ctype+md5);与 ops/rebuild_companytype.sql 同口径。
    return meta.get("jptypedesc") or meta.get("typezh") or meta.get("type")
