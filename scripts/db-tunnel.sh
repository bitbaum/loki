#!/usr/bin/env bash
# Open an SSH tunnel to the box's Postgres and print the URL to use through it.
#
# Why: prod Postgres listens on 127.0.0.1 on the box and the port is firewalled,
# so anything running off-box (a sandboxed agent, a CI runner, a laptop on a
# different network) cannot reach it. That is correct security and it also
# blocked the responsive audit from minting a session token — the audit could
# not run anywhere except a machine with a direct route.
#
# Usage:
#   eval "$(bash scripts/db-tunnel.sh)"      # exports AUDIT_DATABASE_URL
#   npm run audit:responsive
#   bash scripts/db-tunnel.sh --close        # tear the tunnel down
#
# Read-only by intent: this exists so tooling can READ a user row to mint a
# session. Do not point migrations through it.
set -euo pipefail

. "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/hetzner/_box-env.sh"   # SSOT: BOX_UBUNTU
BOX="${HETZNER_SSH:-$BOX_UBUNTU}"
LOCAL_PORT="${TUNNEL_PORT:-15432}"

if [ "${1:-}" = "--close" ]; then
  pkill -f "ssh.*-L ${LOCAL_PORT}:127.0.0.1:5432" 2>/dev/null || true
  echo "tunnel on :${LOCAL_PORT} closed" >&2
  exit 0
fi

# Idempotent: reuse a live tunnel rather than stacking forwards.
if ! (exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null; then
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -f -N \
      -L "${LOCAL_PORT}:127.0.0.1:5432" "$BOX" \
    || { echo "ERROR: could not open tunnel to $BOX" >&2; exit 1; }
  sleep 1
fi

# Rewrite the box's own DATABASE_URL to point through the tunnel. Read from the
# box rather than duplicated here so the credential lives in exactly one place.
# Keep exactly ONE level of quoting on the remote side — fetch the raw line and
# strip the assignment and any surrounding quotes locally. Nesting quote styles
# through ssh is how this broke the first time.
BOX_LINE="$(ssh -o BatchMode=yes "$BOX" "sudo grep -h '^DATABASE_URL=' /opt/loki/app/.env | head -1")"
BOX_URL="${BOX_LINE#DATABASE_URL=}"
BOX_URL="${BOX_URL%\"}"; BOX_URL="${BOX_URL#\"}"
BOX_URL="${BOX_URL%\'}"; BOX_URL="${BOX_URL#\'}"
BOX_URL="$(printf '%s' "$BOX_URL" | tr -d '[:space:]')"
[ -n "$BOX_URL" ] || { echo "ERROR: no DATABASE_URL found on $BOX" >&2; exit 1; }

# sslmode is dropped with the query string: the hop is already encrypted by SSH,
# and the box's Postgres does not serve TLS on its loopback listener.
LOCAL_URL="$(printf '%s' "$BOX_URL" | sed -E "s|@[^/]+/|@127.0.0.1:${LOCAL_PORT}/|; s|\?.*$||")"

echo "export AUDIT_DATABASE_URL='${LOCAL_URL}'"
echo "tunnel ready on 127.0.0.1:${LOCAL_PORT}" >&2
