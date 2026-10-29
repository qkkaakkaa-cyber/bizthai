#!/usr/bin/env bash
# DBD 三语翻译实时监控。用法:bash /data/projects/dbd-thai/sync/monitor_i18n.sh
# Ctrl-C 退出。
cd /data/projects/dbd-thai/sync || exit 1

KEYIN_TARGET=${KEYIN_TARGET:-213514}   # keyin 去重待翻总数(估)
GEO_TARGET=8492                        # 县930+分区7485+府77

cnt_json() { python3 -c "import json,os;p='$1';print(len(json.load(open(p))) if os.path.exists(p) else 0)" 2>/dev/null || echo 0; }
bar() { # $1=cur $2=tot
  local w=30 f=$(( $1*w/($2>0?$2:1) )); ((f>w))&&f=w
  printf '['; printf '%0.s#' $(seq 1 $f) 2>/dev/null; printf '%0.s.' $(seq 1 $((w-f))) 2>/dev/null; printf ']'
}

prev=0; prev_t=$(date +%s)
while true; do
  keyin=$(cnt_json i18n_seed/keyin_i18n.json)
  geo=$(cnt_json i18n_seed/geo_zh.json)
  now=$(date +%s); dt=$((now-prev_t)); ((dt<=0))&&dt=1
  rate=$(( (keyin-prev)*60/dt ))            # 条/分钟
  remain=$((KEYIN_TARGET-keyin)); ((remain<0))&&remain=0
  eta="—"; ((rate>0)) && eta="$(( remain/rate )) 分钟(约 $(( remain/rate/60 )) 小时)"
  svc=$(systemctl is-active dbdadmin-translate.service 2>/dev/null || echo "?")
  bf=$(systemctl is-active dbdadmin-backfill.service 2>/dev/null || echo "?")

  clear
  echo "════════ DBD 三语翻译实时监控  $(date '+%Y-%m-%d %H:%M:%S') ════════"
  printf "keyin 经营范围  %6d / %d  %3d%%  %s\n" "$keyin" "$KEYIN_TARGET" "$(( keyin*100/KEYIN_TARGET ))" "$(bar "$keyin" "$KEYIN_TARGET")"
  printf "geo  县/分区     %6d / %d  %3d%%  %s\n" "$geo" "$GEO_TARGET" "$(( geo*100/GEO_TARGET ))" "$(bar "$geo" "$GEO_TARGET")"
  echo "----------------------------------------------------------------"
  printf "速率: ~%d 条/分钟    预计剩余: %s\n" "$rate" "$eta"
  printf "翻译服务 dbdadmin-translate: %s    首灌 dbdadmin-backfill: %s\n" "$svc" "$bf"
  echo "--- 最近日志 ---"
  journalctl -u dbdadmin-translate.service -n 3 --no-pager 2>/dev/null | sed -E 's/.*\[translate_gaps\] //; s/.*\[i18n_cron\] //' | tail -3
  prev=$keyin; prev_t=$now
  sleep 10
done
