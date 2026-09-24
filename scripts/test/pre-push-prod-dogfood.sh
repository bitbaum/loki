#!/usr/bin/env bash
# Optional production UI dogfood on git push when SMOKE_PRIVATE_PIN is set.
#
#   git push                                  # auto when SMOKE_PRIVATE_PIN is in .env.local
#   SMOKE_PRIVATE_PIN=<pin> git push          # explicit override
#   DOGFOOD_LOKI_ON_PUSH=1 … git push         # force loki dogfood even when builder offline
#
# Requires AUTH_SECRET + HETZNER_IP (or LOKI_SESSION_TOKEN) for JWT mint.
# Skips silently when SMOKE_PRIVATE_PIN is unset so default pushes stay fast.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

load_repo_env() {
  local f="$1"
  if [ -f "$f" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$f"
    set +a
  fi
}

# Auto-enable when SMOKE_PRIVATE_PIN is in .env.local (no need to export on git push).
load_repo_env "$REPO_ROOT/.env.local"
load_repo_env "$REPO_ROOT/.env.hetzner.local"

if [ -z "${SMOKE_PRIVATE_PIN:-}" ]; then
  echo "→ prod dogfood: skipped (set SMOKE_PRIVATE_PIN to enable ui-flows + loki on push)"
  exit 0
fi

export BASE="${BASE:-https://loki.orangecat.ch}"
export SMOKE_PRIVATE_PIN
export HEADLESS=1

echo "→ prod dogfood: minting session ($BASE)"
TOKEN="$(npx tsx scripts/test/print-session-token.ts)"
export LOKI_SESSION_TOKEN="$TOKEN"

echo "→ test:authenticated-smoke"
npm run test:authenticated-smoke

echo "→ dogfood:ui-flows:ci"
node scripts/ui-flow-dogfood.mjs

RUN_LOKI=0
if [ "${DOGFOOD_LOKI_ON_PUSH:-${DOFOOD_LOKI_ON_PUSH:-}}" = "1" ]; then
  RUN_LOKI=1
else
  PRESENCE="$(curl -sf --max-time 20 \
    -H "Cookie: __Secure-authjs.session-token=$TOKEN" \
    "$BASE/api/builder/presence" 2>/dev/null || echo '{}')"
  if grep -qE '"runnerConnected":\s*true' <<<"$PRESENCE"; then
    RUN_LOKI=1
  fi
fi

if [ "$RUN_LOKI" = "1" ]; then
  echo "→ dogfood:loki:ci"
  node scripts/loki-dogfood.mjs
else
  echo "→ dogfood:loki:ci skipped (builder offline — export DOGFOOD_LOKI_ON_PUSH=1 to force)"
fi

echo "→ dogfood:machine (skips when no local Fleet Runner)"
node scripts/machine-dogfood.mjs
