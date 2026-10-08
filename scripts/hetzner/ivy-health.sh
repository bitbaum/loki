#!/usr/bin/env bash
# ivy-health.sh — Loki's self-heal loop for the services Loki itself runs on.
#
# Installed by hand at /usr/local/bin/ivy-health.sh (ivy-health.timer, every
# 15 min, as root). It sits OUTSIDE Loki so it can restart a dead Loki and still
# reach George on Telegram directly.
#
#   scp scripts/hetzner/ivy-health.sh ubuntu@<box>:/tmp/ && \
#     ssh ubuntu@<box> 'sudo install -m 755 /tmp/ivy-health.sh /usr/local/bin/'
#
# History: born 2026-06-23 as the OpenClaw gateway's watchdog. FleetCrown became
# Loki and the OpenClaw gateway was retired, but this kept checking
# fleetcrown-app/-bridge and the gateway — units that no longer exist — so it
# paged "🔥⚠️ DEGRADED … (restart failed)" every 4h for things that were never
# coming back (2026-10-08). It now checks only what Loki runs today. Disk and
# memory pressure are host-check.sh's (install-host-alerts.sh); this only heals.
set -uo pipefail

# The bot token still lives in the old OpenClaw env file; it is the same bot.
ENV_FILE=/home/openclaw/.openclaw/.env
STATE_DIR=/var/lib/ivy-health; STATE_FILE="$STATE_DIR/state"; LOG="$STATE_DIR/health.log"
CHAT_ID=575014778
APP_PORT=4002                 # loki-app
SERVICES=(postgresql loki-app.service loki-bridge.service loki-box-runner.service)
DISK_WARN=88
REALERT_SECONDS=14400         # re-alert the same issue at most every 4h

mkdir -p "$STATE_DIR"
TELEGRAM_BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d "\"' ")

FAILS=(); HEALED=()
log(){ echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }
fail(){ FAILS+=("$1|$2"); log "FAIL $1: $2"; }
heal(){ HEALED+=("$1"); log "HEAL $1"; }
http_code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$1" 2>/dev/null; }

check_system_service(){            # $1 = unit; heal by restart
  systemctl is-active --quiet "$1" && return
  log "service $1 down — restarting"
  systemctl restart "$1" 2>/dev/null; sleep 4
  if systemctl is-active --quiet "$1"; then heal "restarted $1"; else fail "svc:$1" "$1 down (restart failed)"; fi
}

check_app_http(){
  [ "$(http_code "http://127.0.0.1:$APP_PORT/api/health")" = "200" ] || fail "loki-http" "Loki app not answering on :$APP_PORT/api/health"
}

check_disk(){                      # heal only; host-check.sh alerts on disk
  local pct; pct=$(df / | awk 'NR==2{print $5}' | tr -d %)
  [ "$pct" -lt "$DISK_WARN" ] && return
  log "disk ${pct}% — running safe cleanup"
  apt-get clean >/dev/null 2>&1
  journalctl --vacuum-size=50M >/dev/null 2>&1
  find /tmp -maxdepth 1 -type f -mtime +1 -delete 2>/dev/null
  local pct2; pct2=$(df / | awk 'NR==2{print $5}' | tr -d %)
  heal "disk cleanup ${pct}%→${pct2}%"
}

for s in "${SERVICES[@]}"; do check_system_service "$s"; done
check_app_http
check_disk

# ---------------- ALERT (de-duped) ----------------
send_tg(){ [ -n "$TELEGRAM_BOT_TOKEN" ] && curl -s --max-time 15 \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=$CHAT_ID" --data-urlencode "text=$1" >/dev/null 2>&1; }

now=$(date +%s)
prev_sig=$(sed -n '1p' "$STATE_FILE" 2>/dev/null || true)
prev_time=$(sed -n '2p' "$STATE_FILE" 2>/dev/null || echo 0); prev_time=${prev_time:-0}

if [ "${#FAILS[@]}" -gt 0 ]; then
  sig=$(printf '%s\n' "${FAILS[@]}" | cut -d'|' -f1 | sort | md5sum | cut -c1-12)
  if [ "$sig" != "$prev_sig" ] || [ $((now - prev_time)) -ge "$REALERT_SECONDS" ]; then
    msg="🔥⚠️ Loki self-check — DEGRADED"$'\n'
    for f in "${FAILS[@]}"; do msg+="• ${f#*|}"$'\n'; done
    if [ "${#HEALED[@]}" -gt 0 ]; then msg+=$'\n'"auto-fixed:"$'\n'; for h in "${HEALED[@]}"; do msg+="• $h"$'\n'; done; fi
    send_tg "$msg"
  fi
  printf '%s\n%s\n' "$sig" "$now" > "$STATE_FILE"
else
  if [ -n "$prev_sig" ] && [ "$prev_sig" != "ALLOK" ]; then
    m="🔥✅ Loki self-check — RECOVERED, all systems green."
    [ "${#HEALED[@]}" -gt 0 ] && { m+=$'\n'"fixed:"$'\n'; for h in "${HEALED[@]}"; do m+="• $h"$'\n'; done; }
    send_tg "$m"
  elif [ "${#HEALED[@]}" -gt 0 ]; then
    m="🔥 Loki auto-fixed:"$'\n'; for h in "${HEALED[@]}"; do m+="• $h"$'\n'; done
    send_tg "$m"
  fi
  printf 'ALLOK\n%s\n' "$now" > "$STATE_FILE"
fi
log "run done fails=${#FAILS[@]} healed=${#HEALED[@]}"
exit 0
