"""验证唯一未知点:公开站点接口会不会原样返回 meta / body。

写 1 条测试条目(meta+body 都填),再用公开接口读回,打印实际返回字段。
据此决定前端读 meta 还是 body。测试条目 slug=__spike_probe__,可随后删除。
"""
import json

from common import env, get_logger
from woocms import WooCMS

log = get_logger("spike")
MODEL = env("WOOCMS_MODEL", "thai_company")
SLUG = "spikeprobe000"


def main():
    woo = WooCMS().login()
    raw = {"profile": {"jpNo": SLUG, "jpName": "ทดสอบ บริษัท", "jpNameE": "SPIKE TEST CO."},
           "financialStatements": {"years": ["2566"], "annualData": {"2566": {"revenue": 123456}}}}
    payload = {
        "title": "SPIKE 测试公司",
        "slug": SLUG,
        "summary": "spike probe",
        "body": json.dumps(raw, ensure_ascii=False),
        "meta": {"jpNo": SLUG, "status_zh": "运营中", "province": "กรุงเทพมหานคร", "cap_amt": 1000000, "_probe": True},
        "status": "published",
    }
    id_map = woo.build_slug_id_map(MODEL)
    if SLUG in id_map:
        woo.update_entry(id_map[SLUG], payload)
        log.info("更新已存在的 spike 条目 id=%s", id_map[SLUG])
    else:
        eid = woo.create_entry(MODEL, payload)
        log.info("创建 spike 条目 id=%s", eid)

    code, j = woo.public_get(MODEL, SLUG)
    log.info("公开详情 GET -> HTTP %s", code)
    data = (j or {}).get("data") if isinstance(j, dict) else None
    if isinstance(data, dict):
        log.info("详情字段 keys: %s", list(data.keys()))
        log.info("含 meta? %s | meta=%s", "meta" in data, json.dumps(data.get("meta"), ensure_ascii=False)[:300])
        body_val = data.get("body") or data.get("content")
        log.info("含 body? %s | body 前120: %s", bool(body_val), str(body_val)[:120])
    else:
        log.warning("详情返回非预期: %s", json.dumps(j, ensure_ascii=False)[:300])

    code, j = woo.public_list(MODEL, keyword="SPIKE", limit=5)
    log.info("公开列表 GET -> HTTP %s", code)
    items = ((j or {}).get("data") or {}).get("items") if isinstance(j, dict) else None
    if items:
        log.info("列表项 keys: %s", list(items[0].keys()))
        log.info("列表项含 meta? %s", "meta" in items[0])


if __name__ == "__main__":
    main()
