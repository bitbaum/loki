#!/usr/bin/env bash
#
# Install / redeploy the headless Loki box-runner (P1).
#
# The box-runner is the desktop Fleet Runner's core (poller + pusher + bridge +
# owned PTYs) running as a systemd service on the box — no Electron, always-on,
# survives web-app deploys. It deletes the "laptop must be on" dependency:
# dispatches execute server-side in Loki-owned PTYs.
# See docs/architecture/box-owned-pty-executor.md.
#
# Idempotent: re-run to push code changes + restart. Mints the runner token only
# if one isn't already present.
#
# Usage:  bash scripts/hetzner/install-box-runner.sh [user@host]
set -euo pipefail

. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
RUNNER_DIR="/opt/loki/runner"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Runner Unix owner — set LOKI_RUNNER_OWNER=fcrunner after the migration
# (migrate-box-runner-to-fcrunner.sh). Defaults to ubuntu (no change until then).
RUNNER_OWNER="${LOKI_RUNNER_OWNER:-ubuntu}"
RUNNER_UHOME="$([ "$RUNNER_OWNER" = fcrunner ] && echo /home/fcrunner || echo /home/ubuntu)"

echo "→ box-runner: syncing source into ${HOST}:${RUNNER_DIR} (node_modules untouched)"
rsync -az --no-perms --omit-dir-times "${REPO_ROOT}/src/"        "${HOST}:${RUNNER_DIR}/src/"
rsync -az --no-perms --omit-dir-times "${REPO_ROOT}/desktop/src/" "${HOST}:${RUNNER_DIR}/desktop/src/"
rsync -az --no-perms --omit-dir-times "${REPO_ROOT}/home/"       "${HOST}:${RUNNER_DIR}/home/"
rsync -az --no-perms --omit-dir-times "${REPO_ROOT}/scripts/"    "${HOST}:${RUNNER_DIR}/scripts/"
rsync -a "${REPO_ROOT}/tsconfig.json" "${HOST}:${RUNNER_DIR}/tsconfig.json"
ssh "$HOST" "chown -R $RUNNER_OWNER:$RUNNER_OWNER ${RUNNER_DIR}/src ${RUNNER_DIR}/desktop ${RUNNER_DIR}/home ${RUNNER_DIR}/scripts ${RUNNER_DIR}/tsconfig.json"

echo "→ box-runner: minting runner token if absent"
ssh "$HOST" "sudo -u $RUNNER_OWNER -H bash -c '
  TF=$RUNNER_UHOME/.config/loki/fleet-runner-token
  if [ -s \"\$TF\" ]; then echo \"   token present, skipping mint\"; else
    cd ${RUNNER_DIR} && set -a && . ./.env && set +a && node_modules/.bin/tsx scripts/mint-box-runner-token.ts
  fi
'"

# The agents this runner spawns work in trees the operator never opens. Without
# a standing contract they have no reason to push, and unpushed work on this box
# is simply lost. Applied here so a freshly installed runner is never executing
# dispatches without it.
echo "→ box-runner: applying agent operating contract"
bash "$(dirname "$0")/apply-box-agent-contract.sh" "$HOST"

echo "→ box-runner: writing systemd unit"
ssh "$HOST" "cat > /etc/systemd/system/loki-box-runner.service" <<'UNIT'
[Unit]
Description=Loki box-runner (headless Fleet Runner — drains pending_commands, owns agent PTYs)
After=network-online.target loki-app.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/loki/runner
# Blast-radius containment: hide co-tenant app secrets, backups, and the box SSH
# keys from the runner AND every agent PTY it spawns (kernel-enforced). The
# runner only needs its own dir + fresh clones under /home/ubuntu/dev + the
# claude CLI in /home/ubuntu/.local — never another /opt/<app>. Keep in sync with
# scripts/hetzner/harden-box-runner.sh (which applies this to an existing box).
NoNewPrivileges=true
PrivateTmp=true
InaccessiblePaths=-/home/ubuntu/.ssh -/opt/orangecat -/opt/kivvi -/opt/botsmann -/opt/datacat-api -/opt/datacat-web -/opt/petvity -/opt/printcraft -/opt/reparaturbonus-zh -/opt/revamp-info -/opt/evig -/opt/sbb-fundbuero -/opt/solon -/opt/surf-your-life -/opt/vitareba -/opt/aoz-wohnen -/opt/supabase -/opt/backups -/opt/monitoring -/opt/_appcron
EnvironmentFile=/opt/loki/runner/.env
Environment=HOME=/home/ubuntu
Environment=PATH=/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=LOKI_BOX_PREPARE=true
Environment=LOKI_RUNNER_PRESENCE_CHANNEL=cloud
Environment=LOKI_RUNNER_UNATTENDED=true
Environment=LOKI_WEB_URL=https://loki.orangecat.ch
ExecStart=/opt/loki/runner/node_modules/.bin/tsx scripts/box-runner.ts
Restart=always
RestartSec=5
# One OOM-killed child must not take every agent with it. systemd's default
# (OOMPolicy=stop) stops the WHOLE unit when the kernel OOM-kills any process
# in it. 2026-09-25 10:53: the box ran out of RAM during a heidi deploy, the
# kernel killed one chrome-headless an agent was screenshotting with, and the
# unit went down with every agent session in it (Skif, 13 minutes into a
# brief). With continue, the victim dies and the agents keep working.
OOMPolicy=continue

[Install]
WantedBy=multi-user.target
UNIT

echo "→ box-runner: (re)start"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now loki-box-runner.service && systemctl restart loki-box-runner.service && sleep 4 && systemctl is-active loki-box-runner.service"

echo "✓ box-runner installed. Logs: ssh ${HOST} journalctl -u loki-box-runner -f"
