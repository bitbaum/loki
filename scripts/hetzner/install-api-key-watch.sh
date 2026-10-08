#!/usr/bin/env bash
#
# Install the API-key watch: an hourly check that every AI vendor key in every
# app's env file is still ACCEPTED by its vendor.
#
# Why it exists: on 2026-10-08 orangecat's Groq key had been revoked for days —
# voice input failed outright, the Cat's chat quietly answered from other
# vendors — and nothing paged, because the only watcher read failure LOGS and
# had muted that link weeks earlier. Its first run then found a SECOND dead key
# (evig) nobody knew about. This asks the vendors directly, needs no traffic,
# and spends no tokens (metadata endpoints only).
#
# Reuses /opt/monitoring/lib-alert.sh (alert_transition: Telegram on a state
# flip only — one page per dead key, one recovery when it is replaced).
# Detection lives in api-key-check.sh, tested by test-api-key-check.sh.
#
# Idempotent: re-run to update the checker or the schedule.
#
# Usage:  bash scripts/hetzner/install-api-key-watch.sh [user@host]
set -euo pipefail

. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
MON=/opt/monitoring
SRC="$(dirname "$0")/api-key-check.sh"

[ -f "$SRC" ] || { echo "✗ missing $SRC" >&2; exit 1; }

echo "→ api-key-watch: installing checker"
scp -q "$SRC" "$HOST:$MON/api-key-check.sh"
ssh "$HOST" "chmod 0755 $MON/api-key-check.sh"

echo "→ api-key-watch: writing unit + timer"
ssh "$HOST" "cat > /etc/systemd/system/loki-api-key.service" <<'UNIT'
[Unit]
Description=Loki: is every AI vendor key on the box still accepted?
After=network-online.target

[Service]
Type=oneshot
# Root so it can read every app's env file (they are 0600). It only reads and
# alerts: it never edits a key. Which key replaces a dead one depends on who
# owns the app (apps.conf `owner`) — a decision, not a reflex.
ExecStart=/opt/monitoring/api-key-check.sh
UNIT

ssh "$HOST" "cat > /etc/systemd/system/loki-api-key.timer" <<'TIMER'
[Unit]
Description=Loki: API key liveness (hourly)

[Timer]
# Hourly: a dead key breaks things outright (the mic) or silently (a fallback
# chain), so it should be news within the hour, not within the week. Each run
# is a handful of free metadata requests, one per DISTINCT key.
OnCalendar=hourly
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
TIMER

echo "→ api-key-watch: enabling"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now loki-api-key.timer && systemctl list-timers loki-api-key --no-pager | tail -2"

echo "→ api-key-watch: first run (report only, no alerts)"
ssh "$HOST" "$MON/api-key-check.sh --report"

echo "✓ api-key-watch installed. Manual check: ssh $HOST $MON/api-key-check.sh --report"
