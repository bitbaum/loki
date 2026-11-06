#!/usr/bin/env bash
#
# Install / redeploy Loki fleet-knowledge RAG on the Hetzner box:
#   - Local fastembed server (OpenAI-compatible, :7997 loopback)
#   - EMBEDDINGS_* env on loki-app + runner
#   - Daily reindex timer (project profiles + dev-logs)
#
# Idempotent — safe to re-run after code changes or a box rebuild.
# Usage:  bash scripts/hetzner/install-fleet-rag.sh [user@host]
#
# See docs/architecture/fleet-knowledge-rag.md
set -euo pipefail

. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EMBED_DIR="/opt/loki/embed"
APP_ENV="/opt/loki/app/.env"
RUNNER_ENV="/opt/loki/runner/.env"
EMBED_URL="http://127.0.0.1:7997/v1"

echo "→ fleet-rag: sync embed server → ${HOST}:${EMBED_DIR}"
ssh "$HOST" "mkdir -p ${EMBED_DIR}"
rsync -a "${REPO_ROOT}/scripts/embed-server.py" "${HOST}:${EMBED_DIR}/server.py"

echo "→ fleet-rag: Python venv + fastembed"
ssh "$HOST" "bash -s" <<REMOTE
set -euo pipefail
EMBED_DIR="${EMBED_DIR}"
if [ ! -x "\${EMBED_DIR}/venv/bin/python" ]; then
  python3 -m venv "\${EMBED_DIR}/venv"
fi
"\${EMBED_DIR}/venv/bin/pip" install -q --upgrade pip fastembed onnxruntime 2>/dev/null || \
  "\${EMBED_DIR}/venv/bin/pip" install -q fastembed onnxruntime
REMOTE

echo "→ fleet-rag: systemd unit loki-embed"
ssh "$HOST" "cat > /etc/systemd/system/loki-embed.service" <<'UNIT'
[Unit]
Description=Loki local embeddings server (fastembed, OpenAI-compatible)
After=network-online.target
# Keep retrying past the default start-limit instead of locking to "failed".
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
WorkingDirectory=/opt/loki/embed
Environment=EMBED_MODEL=BAAI/bge-small-en-v1.5
Environment=EMBED_PORT=7997
# A shared box: when this process balloons, the kernel must reclaim or kill IT,
# not swap every app into Postgres timeouts (2026-11-06: 2GB, swap full, six
# other apps' crons failed). Steady state is ~320MB.
MemoryHigh=768M
MemoryMax=1G
ExecStart=/opt/loki/embed/venv/bin/python /opt/loki/embed/server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

echo "→ fleet-rag: EMBEDDINGS_* on app + runner env"
for envfile in "$APP_ENV" "$RUNNER_ENV"; do
  ssh "$HOST" "touch '${envfile}' && \
    (grep -q '^EMBEDDINGS_BASE_URL=' '${envfile}' || echo 'EMBEDDINGS_BASE_URL=${EMBED_URL}' >> '${envfile}') && \
    (grep -q '^EMBEDDINGS_MODEL=' '${envfile}' || echo 'EMBEDDINGS_MODEL=BAAI/bge-small-en-v1.5' >> '${envfile}') && \
    (grep -q '^EMBEDDINGS_DIM=' '${envfile}' || echo 'EMBEDDINGS_DIM=384' >> '${envfile}')"
done

echo "→ fleet-rag: daily reindex timer"
ssh "$HOST" "cat > /etc/systemd/system/loki-reindex.service" <<'SVC'
[Unit]
Description=Loki fleet-knowledge reindex (project profiles + dev-logs)
After=network-online.target loki-embed.service

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/loki/runner
Environment=HOME=/root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=LOKI_REPOS_DIR=/home/ubuntu/dev
EnvironmentFile=/opt/loki/runner/.env
ExecStart=/opt/loki/runner/node_modules/.bin/tsx scripts/reindex-knowledge.ts
TimeoutStartSec=900
SVC

ssh "$HOST" "cat > /etc/systemd/system/loki-reindex.timer" <<'TMR'
[Unit]
Description=Reindex fleet knowledge daily

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
TMR

echo "→ fleet-rag: start embed + enable reindex timer"
ssh "$HOST" "systemctl daemon-reload \
  && systemctl enable --now loki-embed.service \
  && systemctl restart loki-embed.service \
  && sleep 5 \
  && curl -sf http://127.0.0.1:7997/health >/dev/null \
  && systemctl enable --now loki-reindex.timer \
  && systemctl restart loki-app.service \
  && echo '✓ embed health OK'"

echo "→ fleet-rag: initial reindex (profiles + dev-logs)"
ssh "$HOST" "systemctl start loki-reindex.service && journalctl -u loki-reindex -n 5 --no-pager"

echo "✓ fleet-rag installed on ${HOST}"
