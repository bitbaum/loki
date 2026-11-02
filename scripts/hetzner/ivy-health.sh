#!/usr/bin/env bash
# ivy-health.sh — Loki's self-heal loop for the services Loki itself runs on.
#
# Installed at /usr/local/bin/ivy-health.sh (ivy-health.timer, every 15 min, as
# root) by .github/workflows/install-box-alerts.yml whenever it changes on main. It sits OUTSIDE Loki so it can restart a dead Loki and still
# reach George on Telegram directly.
#
#   scp scripts/hetzner/ivy-health.sh ubuntu@<box>:/tmp/ && \
#     ssh ubuntu@<box> 'sudo install -m 755 /tmp/ivy-health.sh /usr/local/bin/'
#
# History: born 2026-06-23 as the OpenClaw gateway's watchdog. The product was
# renamed Loki and the gateway retired, but this kept checking the pre-rename
# app/bridge units and the gateway — units that no longer exist — so it
# paged "🔥⚠️ DEGRADED … (restart failed)" every 4h for things that were never
# coming back (2026-10-08). It now checks only what Loki runs today. Disk and
# memory pressure are host-check.sh's (install-host-alerts.sh); this only heals.
set -uo pipefail

# The bot token still lives in the old OpenClaw env file; it is the same bot.
ENV_FILE=/home/openclaw/.openclaw/.env
STATE_DIR=/var/lib/ivy-health; STATE_FILE="$STATE_DIR/state"; LOG="$STATE_DIR/health.log"
# The chat id is the box's one Telegram target (install-watchdog.sh writes it
# from Loki's APP_TELEGRAM_CHAT_ID); the old literal stays only as a fallback.
CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' /opt/monitoring/telegram.env 2>/dev/null | cut -d= -f2- | tr -d "\"' ")
CHAT_ID=${CHAT_ID:-575014778}
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
# Only DEGRADED reaches the phone, and only with its fix on a button: Loki is
# down AND a restart did not bring it back, so the one thing to do is redeploy
# it — the Deploy workflow, one tap to "Run workflow". "Auto-fixed" and
# "recovered" need nothing from anyone; they go to the journal, and to Loki's
# /system list through lib-alert when it is installed (2026-11-02: the owner
# asked for nothing on Telegram he cannot act on in one tap).
DEPLOY_URL="${DEPLOY_URL:-https://github.com/bitbaum/loki/actions/workflows/deploy.yml}"
BOX_DOCTOR_URL="${BOX_DOCTOR_URL:-https://github.com/bitbaum/loki/actions/workflows/box-doctor.yml}"
# Silent 22:00–07:00 Zurich: it still arrives, it does not wake anyone.
night(){ local h; h=$(TZ=Europe/Zurich date +%H); h=${h#0}; [ "${h:-0}" -ge 22 ] || [ "${h:-0}" -lt 7 ]; }
send_tg(){  # $1 text, $2 button label, $3 button url
  [ -n "$TELEGRAM_BOT_TOKEN" ] && curl -s --max-time 15 \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=$CHAT_ID" --data-urlencode "text=$1" \
  --data-urlencode "disable_notification=$(night && echo true || echo false)" \
  --data-urlencode "reply_markup={\"inline_keyboard\":[[{\"text\":\"$2\",\"url\":\"$3\"}]]}" \
  >/dev/null 2>&1; }
to_list(){
  logger -t ivy-health "$1"
  if [ -r /opt/monitoring/lib-alert.sh ]; then ( MON=/opt/monitoring; . /opt/monitoring/lib-alert.sh; _alert_deliver "$1" ) >/dev/null 2>&1 || true; fi
}

now=$(date +%s)
prev_sig=$(sed -n '1p' "$STATE_FILE" 2>/dev/null || true)
prev_time=$(sed -n '2p' "$STATE_FILE" 2>/dev/null || echo 0); prev_time=${prev_time:-0}

if [ "${#FAILS[@]}" -gt 0 ]; then
  sig=$(printf '%s\n' "${FAILS[@]}" | cut -d'|' -f1 | sort | md5sum | cut -c1-12)
  if [ "$sig" != "$prev_sig" ] || [ $((now - prev_time)) -ge "$REALERT_SECONDS" ]; then
    # Say what broke, and offer the fix that fits it: a redeploy brings back
    # Loki's own app, not Postgres or the box; for those, Box doctor shows why.
    msg="Restarting did not bring these back:"$'\n'
    for f in "${FAILS[@]}"; do msg+="• ${f#*|}"$'\n'; done
    if grep -Eq '^(loki-http|svc:loki-app)' <<<"$(printf '%s\n' "${FAILS[@]}")"; then
      send_tg "$msg" "Redeploy Loki" "$DEPLOY_URL"
    else
      send_tg "$msg" "Run Box doctor" "$BOX_DOCTOR_URL"
    fi
  fi
  printf '%s\n%s\n' "$sig" "$now" > "$STATE_FILE"
else
  if [ -n "$prev_sig" ] && [ "$prev_sig" != "ALLOK" ]; then
    to_list "🔥✅ Loki self-check — RECOVERED${HEALED[*]:+: ${HEALED[*]}}"
  elif [ "${#HEALED[@]}" -gt 0 ]; then
    to_list "🔥 Loki auto-fixed: ${HEALED[*]}"
  fi
  printf 'ALLOK\n%s\n' "$now" > "$STATE_FILE"
fi
log "run done fails=${#FAILS[@]} healed=${#HEALED[@]}"
exit 0
