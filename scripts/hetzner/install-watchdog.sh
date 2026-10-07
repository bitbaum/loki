#!/usr/bin/env bash
# install-watchdog.sh — box-wide uptime + health watchdog for the bitbaum box.
#
# WHY separate from install-hetzner-crons.sh / install-backups.sh: this watches
# EVERY app on the box (Loki, OrangeCat + the apps.conf apps) and the
# Loki auth/email health signals, so it's box-wide infra and lives here
# next to sync-infra.sh / verify.sh / install-backups.sh.
#
# What it installs on the box (address SSOT: scripts/hetzner/_box-env.sh):
#   /opt/monitoring/watch.sh                  the check runner
#   /opt/monitoring/targets.conf              label|url|expected_code (seeded from apps.conf)
#   /etc/systemd/system/watchdog.{service,timer}   runs every 5 minutes
#   /opt/monitoring/state/                     per-target up/down state (transition detection)
#
# Alerting is transition-only (alerts on up→down and down→up, never every tick).
# It activates the moment /opt/monitoring/telegram.env exists with a bot token —
# until then it logs to the journal (journalctl -t watchdog). Same drop-in
# pattern as backups' restic.env.
#
# WHAT THIS CANNOT DO: it runs ON the box, so it cannot report the box being
# entirely down/unreachable. For that, set HEARTBEAT_URL in telegram.env to a
# dead-man's-switch (e.g. a free healthchecks.io ping) — the watchdog pings it
# each run, and that external service alerts if the pings stop. See the notes
# printed at the end.
#
# Idempotent — safe to re-run (re-seeds targets.conf from apps.conf each time).
# Usage: bash scripts/hetzner/install-watchdog.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
# sleeps_when_idle: a sleeping site is checked by its wake socket, not by a
# request — a request every 5 minutes would keep it awake forever.
. "$SCRIPT_DIR/lib.sh"
# The register beside this script is the release copy: main's last deployed
# apps.conf. When register-site.sh runs this (via sync-infra) it has just
# appended the new site to the DURABLE register and exports MANIFEST; reading
# the release copy here left every freshly registered site unmonitored until
# its row reached main and deployed (kaffeeklappe-sep11, 2026-09-11).
APPS_CONF="${MANIFEST:-$SCRIPT_DIR/apps.conf}"

# The operator's laptop reaches the box as root. The box itself does not:
# register-cd runs this (via sync-infra) inside loki-app as ubuntu, whose
# only key is the CI deploy key, so root@box answers "Permission denied" and
# a freshly registered site was left unmonitored — and, worse, registration
# reported failure after everything else had succeeded. ubuntu has passwordless
# sudo, so the same remote script runs there unchanged.
# remote <command-string>: one string, run by a root shell on the box. As
# separate words ("$@") the quoting is lost across ssh's argument join, and a
# redirect inside the command is applied by the LOGIN shell — as ubuntu, so
# `cat > /opt/monitoring/targets.conf` was "Permission denied" right after
# sudo had installed the watchdog fine (velokiosk-sep10, 2026-09-10).
if ssh -o BatchMode=yes -o ConnectTimeout=8 "$BOX_ROOT" true 2>/dev/null; then
  HOST="$BOX_ROOT"
  remote() { ssh -o BatchMode=yes "$HOST" "$*"; }
else
  HOST="$BOX_UBUNTU"
  echo "→ root is not reachable from here; installing as ubuntu via sudo"
  remote() {
    local cmd; cmd="sudo bash -c $(printf '%q' "$*")"
    if [ -r "${DEPLOY_KEY_PATH:-}" ]; then
      ssh -o BatchMode=yes -i "$DEPLOY_KEY_PATH" "$HOST" "$cmd"
    else
      ssh -o BatchMode=yes "$HOST" "$cmd"
    fi
  }
fi

# ── Build the target list (SSOT-derived) ────────────────────────────────────
# Loki health is first — a 503 there means the env guardrail found a
# fatal/error config issue, so this check doubles as a config-rot alarm.
TARGETS="loki-health|https://loki.orangecat.ch/api/health|200
loki|https://loki.orangecat.ch/sign-in|200
orangecat|https://orangecat.ch|200"

# Append every public domain from apps.conf (field 3, comma-sep, '-' = internal).
if [ -f "$APPS_CONF" ]; then
  while IFS='|' read -r name port domains rest; do
    case "$name" in ''|\#*) continue;; esac
    [ "$domains" = "-" ] && continue
    status=$(printf '%s' "$rest" | cut -d'|' -f6)
    if sleeps_when_idle "$port" "$domains" "$status"; then
      TARGETS="${TARGETS}
${name}|wake:${name}|socket"
      continue
    fi
    IFS=',' read -ra DOMS <<< "$domains"
    for d in "${DOMS[@]}"; do
      [ -z "$d" ] && continue
      TARGETS="${TARGETS}
${name}|https://${d}|200"
    done
  done < "$APPS_CONF"
fi

echo "→ seeding $(printf '%s\n' "$TARGETS" | grep -c '|') monitoring targets"

# ── Install on the box ──────────────────────────────────────────────────────
remote 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /opt/monitoring/state

cat > /opt/monitoring/watch.sh <<'SH'
#!/usr/bin/env bash
# Box watchdog — checks each target in targets.conf, alerts on state TRANSITIONS
# only (not every tick). Alert channel: Telegram if /opt/monitoring/telegram.env
# provides a token, else the systemd journal (journalctl -t watchdog).
set -uo pipefail
MON=/opt/monitoring
STATE="$MON/state"
mkdir -p "$STATE"
# One delivery point for the whole box. This file used to carry its own byte-
# identical copy of alert(), which meant every property added to the shared one
# — the duplicate floor, ALERT_DRY_RUN, the journal-always guarantee — silently
# did not apply here. A second copy of a send path is how the fleet register
# check ended up able to page twice in sixty seconds with no state at all:
# nothing is wrong with the copy on the day it is made, and nothing updates it
# afterwards. lib-alert.sh is installed by install-host-alerts.sh; if it is
# somehow absent, fall back to the journal rather than going silent.
if [ -f "$MON/lib-alert.sh" ]; then
  . "$MON/lib-alert.sh"
else
  [ -f "$MON/telegram.env" ] && . "$MON/telegram.env" || true
  alert() { logger -t watchdog "$1 $2"; logger -t watchdog "ALERT lib-alert.sh missing — journal only"; }
fi

check() {  # label url   (targets.conf 3rd field is ignored — redirects are followed)
  local label="$1" url="$2"
  local sf="$STATE/$(printf '%s' "$label" | tr -c 'a-zA-Z0-9' '_')"
  local code
  # A site that sleeps when idle is UP while systemd holds its port for it;
  # probing it over HTTP would wake it every tick and it would never sleep.
  if [ "${url#wake:}" != "$url" ]; then
    if systemctl is-active --quiet "${url#wake:}-wake.socket"; then code=200; else code=000; fi
    url="${url#wake:} wake socket"
  else
  # Follow redirects (-L): a 3xx root (locale/trailing-slash) is the server
  # responding, not an outage. UP on a 2xx/3xx final status; DOWN on unreachable
  # (000) or a 4xx/5xx error — incl. loki /api/health returning 503 when
  # the env guardrail finds a config issue.
  # UP only on a proven 2xx/3xx. curl prints "000" itself when it fails, and
  # the old `|| echo 000` appended a SECOND one: a timeout read "000000",
  # which is neither "000" nor a number, so the site counted as UP. A hung app
  # behind Caddy (502 after 20s, past curl's 15s) was therefore never paged:
  # loki.orangecat.ch was down ~06:00-07:53 on 2026-10-01 with no alert.
  code=$(curl -sL -o /dev/null -m 15 -w "%{http_code}" "$url" 2>/dev/null) || true
  code=${code:0:3}; [[ "$code" =~ ^[0-9]{3}$ ]] || code=000
  fi
  local now="down"; { [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; } && now="up"
  local prev="up"; [ -f "$sf" ] && prev=$(cat "$sf")
  if [ "$now" != "$prev" ]; then
    if [ "$now" = "down" ]; then
      alert "🔴" "DOWN: ${label} (${url}) → HTTP ${code}"
    else
      alert "✅" "RECOVERED: ${label} (${url})"
    fi
    printf '%s' "$now" > "$sf"
  fi
}

while IFS='|' read -r label url want; do
  case "$label" in ''|\#*) continue;; esac
  check "$label" "$url"
done < "$MON/targets.conf"

# Dead-man's-switch: ping an external heartbeat so box-death is caught off-box.
if [ -n "${HEARTBEAT_URL:-}" ]; then
  curl -fsS -m 10 "$HEARTBEAT_URL" -o /dev/null || logger -t watchdog "heartbeat ping failed"
fi
SH
chmod +x /opt/monitoring/watch.sh

cat > /etc/systemd/system/watchdog.service <<'SVC'
[Unit]
Description=Box uptime/health watchdog
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/monitoring/watch.sh
SVC

cat > /etc/systemd/system/watchdog.timer <<'TIMER'
[Unit]
Description=Run the box watchdog every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true
Unit=watchdog.service

[Install]
WantedBy=timers.target
TIMER

# Alert delivery — inherit the bot loki/openclaw ALREADY use on this box,
# so alerting is delivery-active by default instead of shipping a dead template
# that stays journal-only for months (which is exactly what happened until
# 2026-07-22). Only when no active token exists (here OR in loki's env) do
# we fall back to the commented template + the LOUD warning below.
if ! grep -qE '^TELEGRAM_BOT_TOKEN=.+' /opt/monitoring/telegram.env 2>/dev/null; then
  FC_ENV=/opt/loki/app/.env
  fc_tok=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$FC_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'"' | tr -d '\r')
  fc_chat=$(grep -m1 '^APP_TELEGRAM_CHAT_ID=' "$FC_ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'"' | tr -d '\r')
  if [ -n "$fc_tok" ] && [ -n "$fc_chat" ]; then
    { echo "# Inherited from loki's bot (same box) so delivery is active by default."
      echo "TELEGRAM_BOT_TOKEN=$fc_tok"
      echo "TELEGRAM_CHAT_ID=$fc_chat"; } > /opt/monitoring/telegram.env
    chmod 600 /opt/monitoring/telegram.env
    echo "[watchdog] inherited loki's Telegram bot — alert delivery ACTIVE"
  else
    cat > /opt/monitoring/telegram.env <<'ENVT'
# Drop your bot token + chat id here to activate Telegram alerts.
# TELEGRAM_BOT_TOKEN=123456:ABC...
# TELEGRAM_CHAT_ID=987654321
# Optional dead-man's-switch (catches box-death off-box), e.g. healthchecks.io:
# HEARTBEAT_URL=https://hc-ping.com/your-uuid
ENVT
    chmod 600 /opt/monitoring/telegram.env
  fi
fi

systemctl daemon-reload
systemctl enable --now watchdog.timer >/dev/null 2>&1
echo "✓ watchdog.timer installed:"
systemctl list-timers watchdog.timer --no-pager | grep -E 'watchdog|NEXT' || true
REMOTE

# Ship the freshly-built target list (the heredoc above is static; targets are
# data, written separately so a re-run refreshes them from apps.conf).
printf '%s\n' "$TARGETS" | remote 'cat > /opt/monitoring/targets.conf'
echo "✓ wrote /opt/monitoring/targets.conf"

# Prime state + show the first read (currently-down targets alert on next tick).
remote '/opt/monitoring/watch.sh; echo "→ first watchdog pass done (journalctl -t watchdog for any alerts)"'

# LOUD if delivery is dark. All the detection in the world is worthless if the
# alerts reach nobody: telegram.env shipped as a commented template and stayed
# that way for months — every alert went to the journal, which no one tails at
# 04:00. Surface it every run until a real token is present.
if remote 'grep -qE "^TELEGRAM_BOT_TOKEN=.+" /opt/monitoring/telegram.env 2>/dev/null'; then
  echo "✓ Telegram delivery ACTIVE (token present)."
else
  cat <<'DARK'

⚠️  ⚠️  ⚠️  ALERTS ARE JOURNAL-ONLY — YOU WILL NOT BE NOTIFIED  ⚠️  ⚠️  ⚠️
   /opt/monitoring/telegram.env has no active TELEGRAM_BOT_TOKEN, so every
   watchdog / OnFailure / host-check alert is written to the journal and
   delivered to NOBODY. The detection is real; the delivery is dark.
DARK
fi

cat <<'NOTE'

── To activate alerts ─────────────────────────────────────────────────────────
1. Create a Telegram bot: message @BotFather → /newbot → copy the token.
2. Get your chat id: message your new bot once, then open
     https://api.telegram.org/bot<TOKEN>/getUpdates  and read chat.id
3. On the box: edit /opt/monitoring/telegram.env with TELEGRAM_BOT_TOKEN +
   TELEGRAM_CHAT_ID (and optionally HEARTBEAT_URL for box-death detection).
Until then, alerts are written to the journal: journalctl -t watchdog -f
NOTE
