#!/usr/bin/env bash
# install-tenant-reconcile.sh — the root timer that keeps private builders in
# step with users.private_builder (reconcile-tenants.sh, every minute).
#
# Idempotent; re-run by every deploy (scripts/deploy-hetzner.sh, "box state"),
# so the timer exists from the merge that adds it, never from a command
# someone remembers to run.
#
# Usage: bash scripts/hetzner/install-tenant-reconcile.sh [user@host]
set -euo pipefail
. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"

ssh -o BatchMode=yes "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cat > /etc/systemd/system/loki-tenants.service <<'SVC'
[Unit]
Description=Loki: reconcile private builders with users.private_builder
After=network-online.target postgresql.service loki-app.service

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/loki/runner/scripts/reconcile-tenants.sh
SVC
cat > /etc/systemd/system/loki-tenants.timer <<'TIMER'
[Unit]
Description=Loki: reconcile private builders every minute

[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=10s
Persistent=true
Unit=loki-tenants.service

[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now loki-tenants.timer >/dev/null 2>&1
echo "✓ loki-tenants.timer installed:"
systemctl list-timers loki-tenants.timer --all --no-pager | grep -E 'loki-tenants|NEXT' || true
REMOTE
