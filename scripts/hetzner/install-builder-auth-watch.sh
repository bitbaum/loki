#!/usr/bin/env bash
#
# Install the builder-auth watch: a daily probe that runs Claude Code with
# the box-runner's own token and alerts when the answer is "no".
#
# Why: the token belongs to whichever Claude account minted it. When the
# operator changes accounts (2026-09-14), the box keeps the old token, every
# dispatch hangs on "Your organization has disabled Claude subscription
# access", and nothing says so until a run times out an hour later — and then
# it says "timeout", not "auth". See builder-auth-check.sh.
#
# Reuses /opt/monitoring/lib-alert.sh (alert on the state flip only).
# Idempotent: re-run to update the checker or the schedule.
#
# Usage:  bash scripts/hetzner/install-builder-auth-watch.sh [user@host]
set -euo pipefail
. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
MON=/opt/monitoring
SRC="$(dirname "$0")/builder-auth-check.sh"
[ -f "$SRC" ] || { echo "✗ missing $SRC" >&2; exit 1; }

echo "→ builder-auth-watch: installing checker"
scp -q "$SRC" "$HOST:$MON/builder-auth-check.sh"
ssh "$HOST" "chmod 0755 $MON/builder-auth-check.sh"

echo "→ builder-auth-watch: writing unit + timer"
ssh "$HOST" "cat > /etc/systemd/system/loki-builder-auth.service" <<'UNIT'
[Unit]
Description=Loki: probe that the box builder's Claude Code token still works
After=network-online.target
[Service]
Type=oneshot
# Root: reads the runner's env (root-owned) and the monitoring state dir.
# It only ever asks one question and alerts; it never edits the token.
ExecStart=/opt/monitoring/builder-auth-check.sh
UNIT
ssh "$HOST" "cat > /etc/systemd/system/loki-builder-auth.timer" <<'TIMER'
[Unit]
Description=Loki: builder-auth probe (daily)
[Timer]
# Daily, before the working day (2026-09-25; was hourly). Each probe is a real
# model call on the operator's Claude sign-in, and 24 a day is spend for
# nothing: the builder takes ~2 dispatches a day, and an account change is a
# once-a-month event that a morning check catches before the day's work.
OnCalendar=*-*-* 06:00:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
TIMER

echo "→ builder-auth-watch: enabling"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now loki-builder-auth.timer && systemctl list-timers loki-builder-auth --no-pager | tail -2"
echo "→ builder-auth-watch: first run (report only, no alerts)"
ssh "$HOST" "$MON/builder-auth-check.sh --report"
echo "✓ builder-auth-watch installed. Manual check: ssh $HOST $MON/builder-auth-check.sh --report"
