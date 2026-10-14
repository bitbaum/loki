#!/usr/bin/env bash
#
# Install the stranded-work watch: a timer that notices when a cloud dispatch
# left work on the box that nobody can see.
#
# The operating contract (box-agent-claude.md) tells agents to commit, push, and
# open a PR. This is the half that does not depend on an agent following it. The
# failure being caught is silent by construction — the operator never opens this
# filesystem — so without a watch, lost work is discovered only by not existing.
#
# Reuses /opt/monitoring/lib-alert.sh (Telegram + journal, alert_transition fires
# only on a state flip). Detection logic lives in agent-work-check.sh, a real
# file with a real test (test-agent-work-watch.sh) rather than a heredoc — the
# host-alerts payloads had to be re-extracted by their test to be checkable, and
# once burned is enough.
#
# Idempotent: re-run to update the checker or the schedule.
#
# Usage:  bash scripts/hetzner/install-agent-work-watch.sh [user@host]
set -euo pipefail

. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
MON=/opt/monitoring
SRC="$(dirname "$0")/agent-work-check.sh"

[ -f "$SRC" ] || { echo "✗ missing $SRC" >&2; exit 1; }

echo "→ agent-work-watch: installing checker"
scp -q "$SRC" "$HOST:$MON/agent-work-check.sh"
ssh "$HOST" "chmod 0755 $MON/agent-work-check.sh"

echo "→ agent-work-watch: writing unit + timer"
ssh "$HOST" "cat > /etc/systemd/system/loki-agent-work.service" <<'UNIT'
[Unit]
Description=Loki: report agent work stranded on the box
After=network-online.target

[Service]
Type=oneshot
# Runs as root so it can read every checkout under the runner's home; it only
# ever reads git state and sends an alert. It must never mutate a repo — an
# automated commit/push of work nobody has reviewed is a worse outcome than the
# work sitting still, and it would race a live agent mid-edit.
ExecStart=/opt/monitoring/agent-work-check.sh
UNIT

ssh "$HOST" "cat > /etc/systemd/system/loki-agent-work.timer" <<'TIMER'
[Unit]
Description=Loki: stranded-agent-work sweep (hourly)

[Timer]
# Hourly, not per-minute: stranded work is not an emergency, and a chatty
# channel is an ignored channel. alert_transition already collapses repeats.
OnCalendar=hourly
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
TIMER

echo "→ agent-work-watch: enabling"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now loki-agent-work.timer && systemctl list-timers loki-agent-work --no-pager | tail -2"

echo "→ agent-work-watch: first run (report only, no alerts)"
ssh "$HOST" "$MON/agent-work-check.sh --report"

echo "✓ agent-work-watch installed. Manual check: ssh $HOST $MON/agent-work-check.sh --report"
