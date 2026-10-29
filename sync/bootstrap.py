"""一次性幂等建模:在 WooCMS 中创建 thai_company 模型 + province/company_type 分类法。

用法: python3 bootstrap.py
建好后 WooCMS 自动暴露公开接口:
  GET /api/site/v1/models/thai_company/entries[/{slug}]
"""
from common import env, get_logger
from woocms import WooCMS

log = get_logger("bootstrap")

MODEL = env("WOOCMS_MODEL", "thai_company")


def main():
    woo = WooCMS().login()
    woo.ensure_model(MODEL, label="泰国企业")
    woo.ensure_taxonomy("province", "府/省份", model_codes=[MODEL], hierarchical=False)
    woo.ensure_taxonomy("companytype", "企业类型", model_codes=[MODEL], hierarchical=False)
    log.info("bootstrap 完成。公开接口: %s/api/site/v1/models/%s/entries", woo.base, MODEL)


if __name__ == "__main__":
    main()
