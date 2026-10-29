"""sync 公共工具:.env 加载、日志、重试。零第三方依赖(仅 requests 在各 client 内用)。"""
import os
import sys
import time
import logging
import functools
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent / ".env"


def load_env(path: Path = ENV_PATH) -> None:
    """极简 .env 解析(无需 python-dotenv)。已存在的环境变量优先,不覆盖。"""
    if not path.exists():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        # systemd 以 EnvironmentFile 注入时,进程(www-data)可能无权读 .env;变量已在环境里
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip())


def env(key: str, default=None, required: bool = False) -> str:
    val = os.environ.get(key, default)
    if required and (val is None or val == ""):
        raise SystemExit(f"[config] 缺少必填环境变量 {key}(请在 sync/.env 中设置)")
    return val


def get_logger(name: str = "sync") -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        stream=sys.stdout,
    )
    return logging.getLogger(name)


def retry(times: int = 4, base: float = 1.0, exceptions=(Exception,)):
    """指数退避重试装饰器。"""
    def deco(fn):
        @functools.wraps(fn)
        def wrap(*args, **kwargs):
            last = None
            for i in range(times):
                try:
                    return fn(*args, **kwargs)
                except exceptions as exc:  # noqa: BLE001
                    last = exc
                    delay = base * (2 ** i)
                    logging.getLogger("sync").warning(
                        "%s 第%d/%d 次失败: %s;%.1fs 后重试", fn.__name__, i + 1, times, exc, delay
                    )
                    time.sleep(delay)
            raise last
        return wrap
    return deco


# 模块导入即加载 .env
load_env()
