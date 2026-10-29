"""DBD DataWarehouse+ 数据接口客户端。

Base: https://dbd.mikalife.co.th/api  鉴权: X-API-Key
接口: /stats、/companies(分页搜索)、/companies/{jpNo}(详情)
requests 自动对 params 做 URL 编码(泰文/中文关键词安全)。
"""
import time

import requests

from common import env, get_logger, retry

log = get_logger("dbd")


class DBDError(Exception):
    pass


class DBD:
    def __init__(self):
        self.base = env("THAI_API_BASE", "https://dbd.mikalife.co.th/api").rstrip("/")
        self.key = env("THAI_API_KEY", required=True)
        self.s = requests.Session()
        self.s.headers.update({"X-API-Key": self.key, "Accept": "application/json"})
        self.detail_sleep = float(env("SYNC_DETAIL_SLEEP", "0.15"))

    @retry(times=4, base=2.0)
    def stats(self) -> dict:
        r = self.s.get(f"{self.base}/stats", timeout=30)
        if r.status_code >= 400:
            raise DBDError(f"/stats -> {r.status_code}: {r.text[:160]}")
        return r.json()

    @retry(times=4, base=2.0)
    def list_page(self, page: int, page_size: int, **filters) -> dict:
        params = {"page": page, "page_size": page_size}
        params.update({k: v for k, v in filters.items() if v not in (None, "")})
        r = self.s.get(f"{self.base}/companies", params=params, timeout=60)
        if r.status_code >= 400:
            raise DBDError(f"/companies p{page} -> {r.status_code}: {r.text[:160]}")
        return r.json()

    def iter_companies(self, page_size: int = 200, **filters):
        """逐页产出列表项(含 jpNo / has_detail / 基本字段)。"""
        page = 1
        while True:
            data = self.list_page(page, page_size, **filters)
            items = data.get("items") or []
            for it in items:
                yield it
            total_pages = data.get("total_pages") or page
            if not items or page >= total_pages:
                break
            page += 1

    @retry(times=4, base=2.0)
    def detail(self, jp_no: str):
        """单家详情;404 返回 None。"""
        r = self.s.get(f"{self.base}/companies/{jp_no}", timeout=60)
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise DBDError(f"/companies/{jp_no} -> {r.status_code}: {r.text[:160]}")
        if self.detail_sleep:
            time.sleep(self.detail_sleep)
        return r.json()
