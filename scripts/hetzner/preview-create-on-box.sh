#!/usr/bin/env bash
#
# Ask the LIVE Loki to create a prospect preview, as the operator. Runs ON the box.
#
#   preview-create-on-box.sh <address> <name> [about]
#
# Production Loki's database is loopback-only, so a session has to be minted
# where the data is (the same pattern as provision-widget-on-box.sh and
# loki-e2e-check.sh). The request then goes to the deployed app's own
# POST /api/previews, so what runs is exactly what a click in "Build a preview"
# runs, on the code that is actually deployed (the box checkout is often behind).
#
# No access code travels through here: this is run from a public repo's
# Actions, whose logs anyone can read. The code is set in the app.
#
# Exit: 0 created or already there, 3 no checkout, 4 no session, 5 refused.
set -uo pipefail

ADDRESS="${1:?address}"; NAME="${2:?name}"; ABOUT="${3:-}"
BOX_LOKI="${BOX_LOKI:-/home/ubuntu/dev/loki}"
ENVF="${BOX_LOKI_ENV:-/opt/loki/app/.env}"

set -a; . "$ENVF"; set +a
cd "$BOX_LOKI" || { echo "no Loki checkout at $BOX_LOKI"; exit 3; }

token=$(BASE=https://loki.orangecat.ch npx tsx scripts/test/print-session-token.ts 2>/dev/null | tr -d '\n')
[ -n "$token" ] || { echo "could not mint a session on the box"; exit 4; }

body=$(ADDRESS="$ADDRESS" NAME="$NAME" ABOUT="$ABOUT" python3 -c '
import json, os
raw = {"name": os.environ["NAME"], "address": os.environ["ADDRESS"], "about": os.environ["ABOUT"]}
print(json.dumps({k: v for k, v in raw.items() if v}))')

out=$(mktemp); trap 'rm -f "$out"' EXIT
http=$(curl -sS -o "$out" -w '%{http_code}' -m 150 -X POST https://loki.orangecat.ch/api/previews \
  -H 'Content-Type: application/json' \
  -H "Cookie: __Secure-authjs.session-token=$token" --data "$body")
echo "HTTP $http"
head -c 700 "$out"; echo
case "$http" in
  201) exit 0 ;;
  409) echo "already there: $ADDRESS"; exit 0 ;;
  *)   exit 5 ;;
esac
