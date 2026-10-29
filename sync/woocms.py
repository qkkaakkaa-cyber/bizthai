"""WooCMS 管理端 API 客户端。

要点:WooCMS 的 woocms_csrf / woocms_session 都是 Secure cookie(.env COOKIE_SECURE=true)。
脚本直连 http://127.0.0.1:8083 是明文,requests 默认不在 http 上回传 Secure cookie,
因此这里**手动管理 Cookie 头**(从 jar 读出所有 cookie 显式发送),并对写操作带 X-CSRF-Token
(双提交:header 取当前 woocms_csrf cookie 值)。
"""
import hashlib

import requests

from common import env, get_logger, retry

log = get_logger("woocms")


class WooError(Exception):
    pass


def _slugify(prefix: str, name: str) -> str:
    """泰文/中文名无法直接做 URL slug,用稳定 hash 生成(纯字母数字,避免 code/slug 校验拒绝分隔符)。展示名用 term.name。"""
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}{h}"


class WooCMS:
    def __init__(self):
        self.base = env("WOOCMS_BASE", "http://127.0.0.1:8083").rstrip("/")
        self.user = env("WOOCMS_ADMIN_USER", required=True)
        self.pw = env("WOOCMS_ADMIN_PASS", required=True)
        self.s = requests.Session()
        self.s.headers["Accept"] = "application/json"
        self.csrf = None
        self._term_cache: dict[str, dict[str, int]] = {}  # tax_code -> {slug: id}

    # ---------- 底层 ----------
    def _cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self.s.cookies)

    def _raw(self, method: str, path: str, *, json=None, params=None) -> requests.Response:
        headers = {}
        ck = self._cookie_header()
        if ck:
            headers["Cookie"] = ck  # 显式回传(含 Secure cookie)
        if method != "GET":
            tok = self.s.cookies.get("woocms_csrf") or self.csrf
            if tok:
                headers["X-CSRF-Token"] = tok
        return self.s.request(method, self.base + path, json=json, params=params, headers=headers, timeout=60)

    def _ensure_csrf(self):
        r = self._raw("GET", "/api/admin/v1/csrf")
        r.raise_for_status()
        self.csrf = (r.json().get("data") or {}).get("csrf_token")

    @retry(times=4, base=1.5)
    def login(self):
        self._ensure_csrf()
        r = self._raw("POST", "/api/admin/v1/login",
                      json={"username": self.user, "login": self.user, "password": self.pw})
        if r.status_code >= 400:
            raise WooError(f"登录失败 {r.status_code}: {r.text[:200]}")
        self._ensure_csrf()  # 登录后 cookie 轮转,刷新
        log.info("WooCMS 登录成功 (%s)", self.base)
        return self

    @retry(times=4, base=1.5)
    def api(self, method: str, path: str, *, json=None, params=None):
        r = self._raw(method, path, json=json, params=params)
        if r.status_code in (401, 403) and method != "GET":
            log.warning("%s %s -> %s,重登后重试", method, path, r.status_code)
            self.login()
            r = self._raw(method, path, json=json, params=params)
        if r.status_code >= 400:
            raise WooError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        try:
            return r.json()
        except Exception:  # noqa: BLE001
            return {}

    @staticmethod
    def _items(data):
        """统一取 list:兼容 data={items:[...]} 或 data=[...]。"""
        if isinstance(data, dict):
            return data.get("items") or []
        if isinstance(data, list):
            return data
        return []

    # ---------- 建模 ----------
    def ensure_model(self, code: str, label: str, **extra):
        data = self.api("GET", "/api/admin/v1/cpt/models").get("data")
        if any(it.get("code") == code for it in self._items(data)):
            log.info("模型 %s 已存在,跳过", code)
            return
        body = {
            "code": code, "slug": code, "label": label, "status": "active",
            "public": True, "has_archive": True,
            "supports": ["title", "summary", "body"],
            "permalink_pattern": "/company/{slug}",
            "list_columns": [],
        }
        body.update(extra)
        self.api("POST", "/api/admin/v1/cpt/models", json=body)
        log.info("已创建模型 %s", code)

    def ensure_taxonomy(self, code: str, label: str, model_codes, hierarchical: bool = False):
        data = self.api("GET", "/api/admin/v1/cpt/taxonomies").get("data")
        if any(it.get("code") == code for it in self._items(data)):
            log.info("分类法 %s 已存在,跳过", code)
            return
        body = {"code": code, "slug": code, "label": label, "status": "active",
                "hierarchical": hierarchical, "model_codes": list(model_codes)}
        self.api("POST", "/api/admin/v1/cpt/taxonomies", json=body)
        log.info("已创建分类法 %s", code)

    def _fetch_all_terms(self, tax_code: str) -> dict[str, int]:
        """分页拉取全部 terms,返回 {slug: id}。"""
        out: dict[str, int] = {}
        offset = 0
        while True:
            data = self.api("GET", f"/api/admin/v1/cpt/taxonomies/{tax_code}/terms",
                            params={"limit": 200, "offset": offset}).get("data")
            items = self._items(data)
            if not items:
                break
            for it in items:
                if it.get("slug"):
                    out[it["slug"]] = it.get("id")
            offset += len(items)
            total = data.get("total") if isinstance(data, dict) else None
            if total is not None and offset >= total:
                break
        return out

    def _load_terms(self, tax_code: str):
        if tax_code in self._term_cache:
            return
        self._term_cache[tax_code] = self._fetch_all_terms(tax_code)

    def ensure_term(self, tax_code: str, name: str, slug_prefix: str) -> int | None:
        """查或建词条,返回 term id。name 为泰文展示名,slug 为稳定 hash。"""
        if not name:
            return None
        self._load_terms(tax_code)
        slug = _slugify(slug_prefix, name)
        cache = self._term_cache[tax_code]
        if slug in cache:
            return cache[slug]
        try:
            res = self.api("POST", f"/api/admin/v1/cpt/taxonomies/{tax_code}/terms",
                           json={"name": name, "slug": slug, "status": "active"})
            tid = (res.get("data") or {}).get("id")
            cache[slug] = tid
            return tid
        except WooError as e:
            if "duplicate slug" in str(e):
                # 首次加载时分页遗漏了该 term,重拉一次再查
                self._term_cache[tax_code] = self._fetch_all_terms(tax_code)
                return self._term_cache[tax_code].get(slug)
            raise

    # ---------- 条目 ----------
    def build_slug_id_map(self, model: str) -> dict[str, int]:
        """分页拉全部条目,建 {slug(jpNo): id} 映射,用于 upsert。"""
        out: dict[str, int] = {}
        offset = 0
        while True:
            data = self.api("GET", f"/api/admin/v1/cpt/models/{model}/entries",
                            params={"limit": 100, "offset": offset}).get("data") or {}
            items = self._items(data)
            if not items:
                break
            for it in items:
                if it.get("slug"):
                    out[it["slug"]] = it.get("id")
            # 按实际返回条数步进:服务端每页可能有上限(实测约 20),固定步长会漏读
            offset += len(items)
            total = data.get("total") if isinstance(data, dict) else None
            if total is not None and offset >= total:
                break
        log.info("模型 %s 现有条目 %d 条", model, len(out))
        return out

    def create_entry(self, model: str, payload: dict) -> int:
        res = self.api("POST", f"/api/admin/v1/cpt/models/{model}/entries", json=payload)
        return (res.get("data") or {}).get("id")

    def update_entry(self, entry_id: int, payload: dict):
        return self.api("PUT", f"/api/admin/v1/cpt/entries/{entry_id}", json=payload)

    # ---------- 公开站点接口(无需登录,供验证) ----------
    def public_list(self, model: str, **params):
        r = requests.get(f"{self.base}/api/site/v1/models/{model}/entries", params=params, timeout=30)
        return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else None)

    def public_get(self, model: str, slug: str):
        r = requests.get(f"{self.base}/api/site/v1/models/{model}/entries/{slug}", timeout=30)
        return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else None)
