#!/usr/bin/env bash
# loki-app.sh — starts the Loki Next.js production server.
#
# Sources .env.local from the project root, then launches the standalone
# server. Intended to be called by the loki-app.service systemd unit.
#
# Usage: ./scripts/loki-app.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STANDALONE="$PROJECT_DIR/.next/standalone"

if [ ! -f "$STANDALONE/server.js" ]; then
  echo "[loki-app] ERROR: standalone build not found at $STANDALONE/server.js" >&2
  echo "[loki-app] Run: pnpm run build && pnpm run install-app" >&2
  exit 1
fi

# Load all vars from .env.local (set -a exports them to child processes).
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env.local"
  set +a
fi

# Defaults for production server — override in .env.local if needed.
export PORT="${PORT:-3000}"
# HOSTNAME is a bash builtin (set to the machine name, e.g. "bitbaum") and
# Next's standalone server reads it as the bind address. `unset` does NOT
# make that default to localhost — it makes Next fall back to ITS OWN
# default, which is 0.0.0.0 (every interface). Found 2026-08-29: this left
# loki reachable on all interfaces (mitigated only by ufw's
# default-deny, which happened to block the port anyway — not something to
# rely on). Every other app in the fleet already does this correctly via
# sync-infra.sh's `HOSTNAME=127.0.0.1`; loki just never matched its
# own convention because it launches itself outside that shared script.
export HOSTNAME=127.0.0.1
# NEXTAUTH_URL must match the local URL so auth callbacks work.
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://localhost:${PORT}}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-${AUTH_SECRET:-}}"
# Auth.js refuses a host it does not trust and answers /api/auth/session with
# 500 UntrustedHost. src/auth.ts compares this to the exact string "true".
# It serves on 127.0.0.1 behind a proxy, so the host is ours either way.
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
export NODE_ENV="production"

exec node "$STANDALONE/server.js"
