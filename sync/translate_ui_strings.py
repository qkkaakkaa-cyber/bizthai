"""把 starter 主题模板里缺翻译的 UI 串(<wc-t>/{{ t }})用 DeepSeek 翻成 zh-CN+th,
注入 theme.js 的 STARTER_UI_I18N 字典。解决"切换语言后 UI chrome 仍是英文 → 三语混合"。

- 数据源:scratchpad/missing_ui.json(由提取脚本生成的缺失串列表)
- 复用 sync/.env 的 DEEPSEEK_API_KEY;批量 JSON 模式;幂等可续跑(已翻的写入 cache 文件)
- 最后合并进现有字典并重写 theme.js 里 STARTER_UI_I18N = {...};
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

SYNC = Path(__file__).resolve().parent
THEME_JS = SYNC.parent / "admin/data/themes/starter/assets/theme.js"
SCR = Path("/private/tmp/claude-501/-Users-mikalife-Desktop-bizthai/00bd8768-ad5b-4171-a361-3f8a125a7a0e/scratchpad")
MISSING = SCR / "missing_ui.json"
CACHE = SCR / "ui_trans_cache.json"   # {en: {"zh-CN":.., "th":..}}

def deepseek_key():
    for line in (SYNC / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("DEEPSEEK_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("缺 DEEPSEEK_API_KEY")

KEY = deepseek_key()
URL = "https://api.deepseek.com/chat/completions"

SYS = ("You are a professional UI localizer for BizThai, a Thai company-search / business-intelligence "
       "website. Translate each English UI string into Simplified Chinese (zh) and Thai (th). "
       "Keep translations concise, natural and consistent with web UI conventions. Preserve placeholders, "
       "brand names (BizThai, DBD DataWarehouse+), numbers and punctuation. "
       'Return ONLY JSON: {"items":[{"en":"<original>","zh":"<chinese>","th":"<thai>"}, ...]} '
       "with one object per input string, same order.")

def call(batch):
    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": SYS},
                     {"role": "user", "content": json.dumps({"strings": batch}, ensure_ascii=False)}],
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }
    for attempt in range(5):
        try:
            r = requests.post(URL, headers={"Authorization": f"Bearer {KEY}",
                              "Content-Type": "application/json"}, json=payload, timeout=180)
            if r.status_code >= 400:
                raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
            data = json.loads(r.json()["choices"][0]["message"]["content"])
            return data.get("items") or []
        except Exception as e:  # noqa: BLE001
            wait = [2, 5, 10, 20, 40][attempt]
            print(f"  批失败({e}); {wait}s 重试", flush=True)
            time.sleep(wait)
    return []

def main():
    missing = json.load(open(MISSING, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8")) if CACHE.exists() else {}
    todo = [s for s in missing if s not in cache]
    print(f"缺 {len(missing)};已缓存 {len(cache)};待翻 {len(todo)}", flush=True)

    BATCH = 25
    t0 = time.time()
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        items = call(chunk)
        got = {it["en"]: {"zh-CN": it.get("zh", ""), "th": it.get("th", "")}
               for it in items if it.get("en")}
        # 兜底:模型漏某条则按顺序补
        for j, s in enumerate(chunk):
            if s not in got:
                if j < len(items) and isinstance(items[j], dict):
                    got[s] = {"zh-CN": items[j].get("zh", ""), "th": items[j].get("th", "")}
        cache.update(got)
        json.dump(cache, open(CACHE, "w"), ensure_ascii=False)
        done = min(i + BATCH, len(todo))
        print(f"  {done}/{len(todo)} ({done/(time.time()-t0):.1f}/s)", flush=True)
    print(f"翻译完成,缓存 {len(cache)} 条", flush=True)

    # ---- 注入 theme.js ----
    js = THEME_JS.read_text(encoding="utf-8")
    m = re.search(r'(STARTER_UI_I18N\s*=\s*)(\{.*?\})(;)', js, re.S)
    cur = json.loads(m.group(2))
    added = 0
    for en, tr in cache.items():
        if en not in cur and (tr.get("zh-CN") or tr.get("th")):
            cur[en] = {k: v for k, v in tr.items() if v}
            added += 1
    new_literal = json.dumps(cur, ensure_ascii=False)
    js2 = js[:m.start()] + m.group(1) + new_literal + m.group(3) + js[m.end():]
    THEME_JS.write_text(js2, encoding="utf-8")
    print(f"注入 theme.js:字典 {len(cur)} 条(新增 {added})", flush=True)

if __name__ == "__main__":
    main()
