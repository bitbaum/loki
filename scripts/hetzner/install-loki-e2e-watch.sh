#!/usr/bin/env bash
#
# Install the Loki end-to-end check on the box: it asks the live site, as the
# operator, whether Loki knows the fleet, publishes the map and (when the
# builder is authenticated) closes the dispatch loop. See loki-e2e-check.sh and
# scripts/test/loki-loop-e2e.ts.
#
# ON DEMAND ONLY — no timer (2026-09-25). Its first leg is a real Loki chat
# turn and its dispatch leg a real run, so on a six-hourly clock it spent the
# box's free AI tier four times a day with nobody asking: it was nearly all of
# Loki's own chat spend. This installer therefore REMOVES the old timer and
# only copies the checker. Run it when you want the answer:
#   ssh root@<box> /opt/monitoring/loki-e2e-check.sh --report
#
# The checker runs from /opt/loki/runner, which install-box-runner.sh keeps in
# sync with the repo (src/, scripts/, node_modules), so re-run that first when
# the test itself changed.
#
# Idempotent. Usage:  bash scripts/hetzner/install-loki-e2e-watch.sh [user@host]
set -euo pipefail
. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
MON=/opt/monitoring
SRC="$(dirname "$0")/loki-e2e-check.sh"
[ -f "$SRC" ] || { echo "✗ missing $SRC" >&2; exit 1; }

echo "→ loki-e2e-watch: installing checker"
scp -q "$SRC" "$HOST:$MON/loki-e2e-check.sh"
ssh "$HOST" "chmod 0755 $MON/loki-e2e-check.sh"

echo "→ loki-e2e-watch: writing the unit (no timer) and removing any old timer"
ssh "$HOST" "cat > /etc/systemd/system/loki-e2e.service" <<'UNIT'
[Unit]
Description=Loki: end-to-end check of the live site as the operator (on demand)
After=network-online.target loki-app.service
[Service]
Type=oneshot
# Root: reads the app env to mint a session and the monitoring state dir.
ExecStart=/opt/monitoring/loki-e2e-check.sh
TimeoutStartSec=1800
UNIT
ssh "$HOST" "systemctl disable --now loki-e2e.timer 2>/dev/null || true; rm -f /etc/systemd/system/loki-e2e.timer; systemctl daemon-reload"
echo "✓ loki-e2e installed, on demand. Run: ssh $HOST $MON/loki-e2e-check.sh --report"
