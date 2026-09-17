#!/usr/bin/env bash
#
# Does Loki work as intended? Asked on a clock, from the box, as the operator.
#
# Runs scripts/test/loki-loop-e2e.ts against the live site with a session
# minted from the app's own env, and alerts on the state FLIP. The dispatch
# leg (a real run that must come back into its thread) is included only when
# the builder-auth probe last said ok — a dead builder is already its own alert,
# and a second timeout every six hours would only add noise on top of it.
#
# --report prints the verdicts and exits 0 without touching alert state.
set -uo pipefail   # NOT -e: a failing check must still produce a verdict
MON="${MON:-/opt/monitoring}"
RUNNER_DIR="${RUNNER_DIR:-/opt/loki/runner}"
APP_ENV="${APP_ENV:-/opt/loki/app/.env}"
REPORT_ONLY=0
[ "${1:-}" = "--report" ] && REPORT_ONLY=1
[ "$REPORT_ONLY" = 0 ] && . "$MON/lib-alert.sh"

DBURL=$(grep -oE '^DATABASE_URL="?[^" ]*' "$APP_ENV" | sed -E 's/^DATABASE_URL="?//')
SECRET=$(grep -oE '^AUTH_SECRET="?[^" ]*' "$APP_ENV" | sed -E 's/^AUTH_SECRET="?//')
cd "$RUNNER_DIR" || { echo "no runner dir"; exit 0; }

token=$(env DATABASE_URL="$DBURL" AUTH_SECRET="$SECRET" BASE=https://loki.orangecat.ch \
  node_modules/.bin/tsx scripts/test/print-session-token.ts 2>/dev/null | tr -d '\n')
if [ -z "$token" ]; then
  msg="loki e2e could not mint a session on the box"
  if [ "$REPORT_ONLY" = 1 ]; then echo "down: $msg"; else alert_transition loki_e2e bad "🔌" "$msg" "loki e2e"; fi
  exit 0
fi

dispatch=""
[ "$(cat "$MON/state/host_builder_auth" 2>/dev/null)" = "ok" ] && dispatch="--dispatch"

out=$(env LOKI_SESSION_TOKEN="$token" BASE=https://loki.orangecat.ch E2E_DISPATCH_MINUTES=35 \
  node_modules/.bin/tsx scripts/test/loki-loop-e2e.ts $dispatch 2>&1); code=$?
summary=$(printf '%s\n' "$out" | tail -1 | cut -c1-300)
fails=$(printf '%s\n' "$out" | grep -E '^FAIL' | cut -c7-90 | paste -sd ';' -)

if [ "$REPORT_ONLY" = 1 ]; then
  printf '%s\n' "$out"
  exit 0
fi
if [ "$code" -eq 0 ]; then
  alert_transition loki_e2e ok "✅" "loki e2e: $summary${dispatch:+ (with dispatch)}"
else
  alert_transition loki_e2e bad "🧪" "loki e2e FAILED: $summary — $fails" "loki e2e"
fi
exit 0
