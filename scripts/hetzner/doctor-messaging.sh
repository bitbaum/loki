#!/usr/bin/env bash
# READ-ONLY diagnosis of everything that is supposed to tell the operator
# something happened: feedback arriving, Telegram, Web Push, and the OpenClaw
# gateway that carries WhatsApp/Telegram chat in and out.
#
# WHY THIS EXISTS. On 2026-10-15 a report left on Petvity from another phone
# could not be found, and no Telegram, push or WhatsApp message arrived for it.
# Every one of those facts lives on the box (the loki database, the app env,
# the gateway process) and a sandboxed agent session cannot reach any of it —
# so the question "is it the ingest, the notifier, the bot, or the gateway?"
# was being answered by guessing. This answers it by looking.
#
# Run from GitHub Actions: .github/workflows/box-doctor.yml (the same SSH setup
# as openclaw-media.yml). It is piped to `bash -s` on the box as root.
#
# THE RULES THIS FILE HOLDS TO, because the repo is PUBLIC and run logs are
# readable by anyone:
#   - it changes nothing: SELECTs, `systemctl is-active`, `ss`, `journalctl`,
#     read-only CLI status calls. The one outward action is a single Telegram
#     test message to the operator's own chat, and only when asked for.
#   - it never prints a secret. Tokens are read inside this script and used,
#     never echoed; every line of output passes through red(), which masks
#     long digit runs (phone numbers, chat ids) and token-shaped strings.
#   - it never prints what a person wrote: no feedback text, no action titles,
#     no message bodies — counts, times, sources, statuses and sizes only.
#
# Usage (on the box): bash doctor-messaging.sh [hours=72] [send_test=0|1]
set -u
SINCE="${1:-72}"
SEND_TEST="${2:-0}"
ENVF=/opt/loki/app/.env

red() {
  sed -E 's/[0-9]{7,}/<n>/g; s/[A-Za-z0-9_-]{24,}/<redacted>/g' | cut -c1-220
}
hr() { printf '\n=== %s ===\n' "$1"; }
psqlq() {
  sudo -u postgres psql -d loki -X -A -F ' | ' -P footer=off -c "$1" 2>&1 | red
}
envhas() {
  grep -qsE "^(export )?($1)=.+" "$ENVF" 2>/dev/null && echo yes || echo "NO"
}
envval() {
  grep -m1 -oP "^(export )?($1)=\K.*" "$ENVF" 2>/dev/null | tr -d '"\r'
}

echo "doctor-messaging: window ${SINCE}h, now $(TZ=Europe/Zurich date '+%Y-%m-%d %H:%M %Z')"

hr "1. App and timers"
echo "loki-app: $(systemctl is-active loki-app 2>&1)"
systemctl list-timers --no-pager 2>/dev/null | grep -E 'loki-|NEXT' | awk '{print $1,$2,$3,$NF}' | head -12 | red

hr "2. Did the feedback arrive? (site_feedback, last ${SINCE}h — no text printed)"
psqlq "select to_char(f.created_at at time zone 'Europe/Zurich','MM-DD HH24:MI') as at_zurich,
  coalesce(e.name,'?') as project, coalesce(f.source,'visitor') as source, f.status,
  f.duplicate_count as dup, length(f.suggestion) as chars, coalesce(f.scope,'') as scope,
  (f.screenshots is not null) as has_pics
  from site_feedback f left join entities e on e.id = f.project_id
  where f.created_at > now() - interval '${SINCE} hours'
  order by f.created_at desc limit 40"

hr "3. Widget tokens for Petvity — status, allowed origins, last time any page booted it"
psqlq "select e.name, t.status, left(coalesce(t.origins::text,'any origin'),70) as origins,
  to_char(t.last_seen_at at time zone 'Europe/Zurich','MM-DD HH24:MI') as last_seen,
  left(coalesce(t.last_seen_origin,''),60) as last_origin
  from widget_tokens t join entities e on e.id = t.project_id
  where e.name ilike '%petvity%'"

hr "4. Did the notifier run, and what did it say? (debug_logs, last ${SINCE}h)"
psqlq "select to_char(created_at at time zone 'Europe/Zurich','MM-DD HH24:MI') as at_zurich,
  level, source, left(message,150) as message
  from debug_logs
  where created_at > now() - interval '${SINCE} hours'
    and (source like 'feedback/notify%' or source like 'crons/check-feedback%'
         or source like 'api/feedback%' or source like 'feedback/auto%')
  order by created_at desc limit 25"
echo "-- new_feedback alerts raised in the window:"
psqlq "select count(*) as alerts, count(*) filter (where dismissed) as dismissed
  from alerts where type = 'new_feedback' and created_at > now() - interval '${SINCE} hours'"

hr "5. Channel configuration (yes/NO only — values never printed)"
echo "TELEGRAM_BOT_TOKEN set:                      $(envhas 'TELEGRAM_BOT_TOKEN')"
echo "chat id set (APP_/LOKI_/COCKPIT_TELEGRAM_CHAT_ID): $(envhas '(APP|LOKI|COCKPIT)_TELEGRAM_CHAT_ID')"
echo "bare TELEGRAM_CHAT_ID set (configures NOTHING):    $(envhas 'TELEGRAM_CHAT_ID')"
echo "VAPID_PUBLIC_KEY / PRIVATE / SUBJECT:        $(envhas 'VAPID_PUBLIC_KEY') / $(envhas 'VAPID_PRIVATE_KEY') / $(envhas 'VAPID_SUBJECT')"
echo "-- push subscriptions (devices that would get a Web Push):"
psqlq "select count(*) as devices, max(to_char(created_at at time zone 'Europe/Zurich','MM-DD HH24:MI')) as newest from push_subscriptions"

hr "6. Telegram Bot API, live (secrets stay inside this script)"
TOKEN="$(envval 'TELEGRAM_BOT_TOKEN')"
CHAT="$(envval '(APP|LOKI|COCKPIT)_TELEGRAM_CHAT_ID')"
if [ -z "$TOKEN" ]; then
  echo "no bot token in $ENVF — Loki cannot send Telegram at all"
else
  tg() { curl -s -m 12 "https://api.telegram.org/bot${TOKEN}/$1" "${@:2}" 2>/dev/null; }
  tg getMe | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("getMe: no JSON back (network or token problem)"); sys.exit()
r = d.get("result") or {}
print("getMe: ok=%s bot=@%s %s" % (d.get("ok"), r.get("username"), d.get("description") or ""))'
  tg getWebhookInfo | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("webhook: no JSON back"); sys.exit()
r = d.get("result") or {}
print("webhook url set: %s | pending updates: %s | last error: %s" % (
    bool(r.get("url")), r.get("pending_update_count"), (r.get("last_error_message") or "none")[:100]))'
  if [ "$SEND_TEST" = "1" ]; then
    if [ -z "$CHAT" ]; then
      echo "test message: SKIPPED — no chat id configured (this is why feedback never reached Telegram, if the token is fine)"
    else
      tg sendMessage --data-urlencode "chat_id=${CHAT}" \
        --data-urlencode "text=Loki check: Telegram delivery works from the box. (Sent by the messaging doctor, once.)" \
        | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("test message: no JSON back"); sys.exit()
print("test message: ok=%s %s" % (d.get("ok"), (d.get("description") or "")[:100]))'
    fi
  fi
fi

hr "7. OpenClaw gateway (carries WhatsApp and the Telegram chat)"
echo "units mentioning openclaw/ivy: $(grep -lsE 'openclaw|ivy' /etc/systemd/system/*.service /lib/systemd/system/*.service 2>/dev/null | xargs -rn1 basename | tr '\n' ' ')"
echo "gateway processes: $(pgrep -u openclaw -af 'gateway' 2>/dev/null | wc -l)"
pgrep -u openclaw -af 'gateway' 2>/dev/null | cut -c1-120 | head -3 | red
echo "listening (openclaw's node): $(ss -ltnp 2>/dev/null | grep -E 'users:\(\("(node|openclaw)' | awk '{print $4}' | tr '\n' ' ')"
echo "HTTP on :18789 -> $(curl -s -o /dev/null -m 4 -w '%{http_code}' http://127.0.0.1:18789/ 2>/dev/null || echo none)"
uid="$(id -u openclaw 2>/dev/null || echo 0)"
echo "openclaw user systemd manager running: $([ -S "/run/user/$uid/bus" ] && echo yes || echo NO)"

echo "-- error-shaped gateway log lines, last ${SINCE}h (digits masked, cut to 220 chars):"
journalctl _UID="$uid" --since "${SINCE} hours ago" --no-pager -q 2>/dev/null \
  | grep -iE 'logged ?out|loggedOut|401|disconnect|connection (closed|lost)|restart required|conflict|ECONN|ETIMEDOUT|ENOTFOUND|qr|pairing|unauthor|forbidden|fatal|crash|exit code' \
  | red | tail -25
echo "-- gateway restarts in the window: $(journalctl _UID="$uid" --since "${SINCE} hours ago" --no-pager -q 2>/dev/null | grep -ciE 'starting|started|listening on' )"

echo "-- newest conversation/session files under the openclaw home (time, size, masked path):"
find /home/openclaw/.openclaw -type f \( -name '*.jsonl' -o -name 'creds.json' \) -printf '%TY-%Tm-%Td %TH:%TM %s %P\n' 2>/dev/null | sort -r | head -8 | red
echo "-- WhatsApp auth state (newest file time only):"
find /home/openclaw/.openclaw -ipath '*whatsapp*' -type f -printf '%TY-%Tm-%Td %TH:%TM\n' 2>/dev/null | sort -r | head -2

echo "-- the CLI's own channel status (as the openclaw user; masked):"
printf '%s\n' \
  '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1 || true' \
  'command -v openclaw >/dev/null 2>&1 || for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.npm-global/bin "$HOME"/.local/bin /usr/local/bin; do [ -x "$d/openclaw" ] && PATH="$d:$PATH" && break; done' \
  'command -v openclaw >/dev/null 2>&1 || { echo "no openclaw CLI on PATH for the openclaw user"; exit 0; }' \
  'for c in "channels status" "gateway status" "status"; do echo "\$ openclaw $c"; timeout 25 openclaw $c 2>&1 | head -30; done' \
  | sudo -iu openclaw env XDG_RUNTIME_DIR="/run/user/${uid}" bash -ls 2>&1 | red

hr "8. Did chat -> Loki ever work lately? (actions Loki queued, newest first — no titles)"
psqlq "select to_char(created_at at time zone 'Europe/Zurich','MM-DD HH24:MI') as at_zurich, type, status
  from actions order by created_at desc limit 8"

hr "11. How does the gateway send a message? (CLI help — public documentation text only)"
printf '%s\n' \
  '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1 || true' \
  'command -v openclaw >/dev/null 2>&1 || for d in "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/openclaw" ] && PATH="$d:$PATH" && break; done' \
  'timeout 25 openclaw message send --help 2>&1 | head -45' \
  | sudo -iu openclaw env XDG_RUNTIME_DIR="/run/user/${uid}" bash -ls 2>&1 | cut -c1-200

echo
echo "doctor-messaging: done (nothing was changed$([ "$SEND_TEST" = "1" ] && echo ", except one Telegram test message"))."
