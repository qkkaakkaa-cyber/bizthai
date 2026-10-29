"""为 thaicompany 模型创建「按类别分选项卡」的字段组,字段用中文标签。

WooCMS 选项卡机制:每个字段组 layout="tab" 渲染为一个选项卡(组标题=选项卡名)。
字段名会被小写化,按「小写字段名 ↔ meta 键」绑定显示(入库 meta 已平铺为小写键)。

用法: python3 bootstrap_fields.py   (幂等:先删旧组再建)
"""
from common import env, get_logger
from dbd import DBD
from woocms import WooCMS
from mapping import NESTED_FLATTEN, SKIP_NESTED

log = get_logger("bootstrap_fields")
MODEL = env("WOOCMS_MODEL", "thaicompany")

# 选项卡(字段组)分类:(组code, 选项卡标题, [字段键])。字段键用 profile 原始驼峰键。
# 三语策略:泰文留在原语义选项卡(基本/地址/行业);英文集中到 dbden、中文集中到 dbdzh。
# 语言中性字段(各种 code/日期/数字/标志)随泰文留在概念选项卡。
CATEGORIES = [
    ("dbdbasic", "基本信息", [
        "jpNo", "jpName", "jpSearchName", "jpNameOld", "jpOldNo",
        "jpTypeAbbr", "jpTypeDesc", "jpTypeCode",
        "jpStatDesc", "jpStatDetail", "jpStatCode",
        "jpAge", "regDate", "statChangeDate", "closeDate", "acDate", "updateDate", "rowNo",
        "status", "type", "finYear", "hasDetail",
    ]),
    ("dbdcapital", "资本 / 股本", [
        "capAmt", "paidAmt", "shareQty", "shareVol", "memberQty", "comQty",
    ]),
    ("dbdcontact", "联系方式", [
        "phoneNo", "faxNo", "email", "webSite1", "webSite2", "webSite3", "webSite4",
    ]),
    ("dbdaddr", "地址与区域", [
        "address", "zipCode", "pvCode", "province",
        "ampurDesc", "ampurCode",
        "tumbonDesc", "tumbonCode", "mainNatCode",
    ]),
    ("dbdbiz", "行业与经营", [
        "businessTypeCode", "businessTypeDesc", "businessSizeCode", "businessSizeCodeLfy",
        "setupObjDesc", "setupObjGrpDesc", "setupObjCode", "setupObjNameKeyin",
        "submitObjDesc", "submitObjGrpDesc", "submitObjCode", "submitObjNameKeyin",
        "submitFinYear", "fiscalYear", "fiscalYearRpt", "ofCode",
    ]),
    ("dbden", "English", [  # 英文字段集中:点此选项卡只看英文
        "jpNameE", "jpNameOldE", "jpTypeDescE", "jpStatDescE",
        "provinceE", "ampurDescE", "tumbonDescE", "addressE",
        "businessTypeDescE", "companyTypeE",
        "setupObjDescE", "setupObjGrpDescE", "submitObjDescE", "submitObjGrpDescE",
    ]),
    ("dbdzh", "中文", [  # 中文字段集中:点此选项卡只看中文
        "statusZh", "typeZh", "companyTypeZh",
        "provinceZh", "ampurDescZh", "tumbonDescZh", "addressZh",
        "businessTypeDescZh", "setupObjDescZh",
    ]),
    ("dbdfin", "财务摘要", [
        "totalIncome", "totalIncomeLfy", "totalIncomePctGrowth",
        "totalAsset", "totalAssetPctGrowth", "totalEquity",
        "netProfit", "netProfitPctGrowth", "fixAsset", "smlFromRevenueLfy",
    ]),
    ("dbdratio", "财务比率", [
        "grossProfitMargin", "netProfitMargin", "operatingProfitMargin",
        "currentRatio", "debtToAsset", "debtToEquity",
        "returnOnAsset", "returnOnEquity", "totalAssetToEquity",
        "totalAssetTurnover", "inventoryTurnover", "accountReceivableTurnover", "costToIncome",
    ]),
    ("dbdflags", "资质 / 标志", [
        "cacFlag", "dbdERegFlag", "directSaleFlag", "elFlag", "eximFlag",
        "frnLicenseFlag", "middayFlag", "packHouseFlag", "rdVatFlag",
    ]),
    ("dbdfinreport", "财务报表", ["finreport"]),
]

LABELS = {
    # 基本信息
    "jpNo": "注册号", "jpName": "泰文名称", "jpNameE": "英文名称", "jpSearchName": "检索名称",
    "jpNameOld": "旧泰文名称", "jpNameOldE": "旧英文名称", "jpOldNo": "旧注册号",
    "jpTypeAbbr": "企业类型简称", "jpTypeDesc": "企业类型(泰文)", "jpTypeDescE": "企业类型(英文)", "jpTypeCode": "企业类型代码",
    "jpStatDesc": "经营状态(泰文)", "jpStatDescE": "经营状态(英文)", "jpStatDetail": "状态说明", "jpStatCode": "经营状态代码",
    "jpAge": "成立年数",
    "regDate": "注册日期", "statChangeDate": "状态变更日期", "closeDate": "注销日期",
    "acDate": "会计结算日(MMDD)", "updateDate": "数据更新日期", "rowNo": "行号(内部)",
    # 中文/三语对照/检索
    "statusZh": "经营状态(中文)", "typeZh": "企业类型(中文)", "province": "府/省份(泰文)",
    "provinceE": "府/省份(英文)", "provinceZh": "府/省份(中文)", "businessTypeDesc": "业务类型(泰文)",
    "businessTypeDescE": "业务类型(英文)", "businessTypeDescZh": "业务类型(中文)",
    "companyTypeE": "企业类型(英文)", "companyTypeZh": "企业类型(中文)",
    "status": "经营状态(原始)", "type": "企业类型(原始)", "hasDetail": "有详情(检索)", "finYear": "最新财年",
    # 资本
    "capAmt": "注册资本", "paidAmt": "实缴资本", "shareQty": "股份数量", "shareVol": "每股面值",
    "memberQty": "股东/成员数", "comQty": "分支机构数",
    # 联系方式
    "phoneNo": "电话", "faxNo": "传真", "email": "邮箱",
    "webSite1": "网站1", "webSite2": "网站2", "webSite3": "网站3", "webSite4": "网站4", "websites": "网站列表",
    # 地址与区域
    "address": "地址(泰文)", "addressE": "地址(英文)", "addressZh": "地址(中文)", "zipCode": "邮编",
    "pvCode": "府/省份代码", "ampurDesc": "县/区(泰文)", "ampurDescE": "县/区(英文)", "ampurDescZh": "县/区(中文)", "ampurCode": "县/区代码",
    "tumbonDesc": "分区(泰文)", "tumbonDescE": "分区(英文)", "tumbonDescZh": "分区(中文)", "tumbonCode": "分区代码", "mainNatCode": "主要国籍代码",
    # 行业与经营
    "businessTypeCode": "业务类型代码", "businessSizeCode": "企业规模代码",
    "businessSizeCodeLfy": "企业规模代码(上年)",
    "setupObjDesc": "设立经营范围(泰)", "setupObjDescE": "设立经营范围(英)", "setupObjDescZh": "设立经营范围(中)",
    "setupObjGrpDesc": "设立范围分类(泰)", "setupObjGrpDescE": "设立范围分类(英)",
    "setupObjCode": "设立目标代码", "setupObjNameKeyin": "设立目的(录入)",
    "submitObjDesc": "申报经营范围(泰)", "submitObjDescE": "申报经营范围(英)",
    "submitObjGrpDesc": "申报范围分类(泰)", "submitObjGrpDescE": "申报范围分类(英)",
    "submitObjCode": "申报目标代码", "submitObjNameKeyin": "申报经营范围(录入)", "submitFinYear": "申报财年",
    "fiscalYear": "财年", "fiscalYearRpt": "财报年度", "ofCode": "办事处代码",
    # 财务摘要
    "totalIncome": "总收入", "totalIncomeLfy": "总收入(上年)", "totalIncomePctGrowth": "总收入同比%",
    "totalAsset": "总资产", "totalAssetPctGrowth": "总资产同比%", "totalEquity": "净资产",
    "netProfit": "净利润", "netProfitPctGrowth": "净利润同比%", "fixAsset": "固定资产",
    "smlFromRevenueLfy": "上年营收规模",
    # 财务比率
    "grossProfitMargin": "毛利率", "netProfitMargin": "净利率", "operatingProfitMargin": "营业利润率",
    "currentRatio": "流动比率", "debtToAsset": "资产负债比", "debtToEquity": "产权比率",
    "returnOnAsset": "资产回报率 ROA", "returnOnEquity": "净资产回报率 ROE",
    "totalAssetToEquity": "权益乘数", "totalAssetTurnover": "总资产周转率",
    "inventoryTurnover": "存货周转率", "accountReceivableTurnover": "应收账款周转率", "costToIncome": "成本收入比",
    # 资质/标志
    "cacFlag": "反腐败认证 CAC", "dbdERegFlag": "DBD 电子注册", "directSaleFlag": "直销标志",
    "elFlag": "电子签名标志", "eximFlag": "进出口标志", "frnLicenseFlag": "外资经营许可",
    "middayFlag": "午间标志", "packHouseFlag": "包装厂标志", "rdVatFlag": "增值税注册",
    # 财务报表
    "finreport": "逐年财报(只读)",
}

# 计算字段固定为文本
COMPUTED = {"statusZh", "typeZh", "province", "provinceE", "provinceZh",
            "businessTypeDesc", "businessTypeDescE", "businessTypeDescZh",
            "companyTypeE", "companyTypeZh", "addressZh", "ampurDescZh", "tumbonDescZh",
            "setupObjDescZh", "status", "type", "hasDetail", "finYear"}
# 长文本字段用多行
TEXTAREA_FIELDS = {
    "jpStatDetail", "setupObjNameKeyin", "submitObjNameKeyin",
    "setupObjDesc", "setupObjDescZh", "submitObjDesc", "setupObjGrpDesc", "submitObjGrpDesc",
    "addressZh", "finreport",
}


def infer_type(values):
    for v in values:
        if v is None:
            continue
        if isinstance(v, bool):
            return "text"
        if isinstance(v, (int, float)):
            return "number"
        if isinstance(v, dict):
            return "textarea"
        if isinstance(v, list):
            if len(v) == 3 and all(isinstance(x, int) for x in v):
                return "text"
            return "textarea"
        return "text"
    return "text"


def collect_types(dbd: DBD, sample=8) -> dict:
    fields: dict[str, list] = {}
    seen = 0
    for it in dbd.iter_companies(page_size=200):
        if not it.get("has_detail"):
            continue
        prof = ((dbd.detail(it["jpNo"]) or {}).get("detail") or {}).get("profile") or {}
        if not prof:
            continue
        for k, v in prof.items():
            fields.setdefault(k, []).append(v)
        seen += 1
        if seen >= sample:
            break
    return {k: infer_type(vs) for k, vs in fields.items()}


def field_type(key: str, types: dict) -> str:
    if key in TEXTAREA_FIELDS:
        return "textarea"
    if key in COMPUTED:
        return "text"
    return types.get(key, "text")


def replace_group(woo: WooCMS, code, title, keys, types, sort_order):
    woo._raw("DELETE", f"/api/admin/v1/cpt/field-groups/{code}")
    defs = [{"name": k, "label": LABELS.get(k, k), "type": field_type(k, types), "sort_order": i}
            for i, k in enumerate(keys)]
    body = {"code": code, "title": title, "model_code": MODEL, "status": "active",
            "description": "", "sort_order": sort_order, "layout": "tab",
            "locations": [], "rule_json": {}, "field_defs": defs}
    r = woo._raw("POST", "/api/admin/v1/cpt/field-groups", json=body)
    if r.status_code >= 400:
        raise SystemExit(f"创建字段组 {code} 失败 {r.status_code}: {r.text[:300]}")
    log.info("选项卡「%s」(%s) 字段数 %d", title, code, len(defs))


def main():
    woo = WooCMS().login()
    dbd = DBD()
    # 删除旧的非分类组
    for old in ("dbdprofile", "dbdmeta", "dbdcore", "dbdother"):
        woo._raw("DELETE", f"/api/admin/v1/cpt/field-groups/{old}")

    log.info("抓样本归纳字段类型…")
    types = collect_types(dbd)

    # 校验:profile 顶层字段中,既未被选项卡覆盖、也不在嵌套展开/跳过名单的,归入「其他」
    covered = {k for _, _, ks in CATEGORIES for k in ks}
    handled = set(NESTED_FLATTEN) | SKIP_NESTED
    leftover = [k for k in types if k not in covered and k not in handled]
    cats = list(CATEGORIES)
    if leftover:
        cats.append(("dbdother", "其他字段", leftover))
        log.warning("未分类字段归入「其他」: %s", leftover)

    for i, (code, title, keys) in enumerate(cats):
        replace_group(woo, code, title, keys, types, i + 1)
    log.info("完成:共 %d 个选项卡,中文标签。", len(cats))


if __name__ == "__main__":
    main()
