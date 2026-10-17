#!/usr/bin/env bash
#
# Open a preview the way its owner does and say what is there. Runs ON the box.
#
#   preview-check-on-box.sh <host>     e.g. center-com.orangecat.ch
#
# The owner's session is minted where the data is (print-session-token.ts, as
# the operator — the same leg preview-create-on-box.sh uses), and the DEPLOYED
# app hands out the preview's access cookie for it (GET /api/previews/<slug>/cookie):
# nothing here depends on how far behind main the box's checkout is. Neither
# the session nor the cookie is printed. What is printed: the status of the
# site, of the before-and-after tour, how many rows the tour has, and whether
# the first "before" and "after" pictures come back as images — the whole
# flow, seen from the owner's side, in six lines. Exit 0 when the site and the
# tour open; 3 no checkout; 4 no session or cookie; 5 something did not open.
set -uo pipefail

HOST="${1:?host}"
BOX_LOKI="${BOX_LOKI:-/home/ubuntu/dev/loki}"
ENVF="${BOX_LOKI_ENV:-/opt/loki/app/.env}"
BASE="${LOKI_BASE_URL:-https://loki.orangecat.ch}"
SLUG="${HOST%%.*}"

set -a; . "$ENVF"; set +a
cd "$BOX_LOKI" || { echo "no Loki checkout at $BOX_LOKI"; exit 3; }

token=$(BASE="$BASE" npx tsx scripts/test/print-session-token.ts 2>/dev/null | tr -d '\n')
[ -n "$token" ] || { echo "could not mint a session on the box"; exit 4; }

# The cookie is read out of the answer and never printed; on a refusal only the
# status and the app's error sentence are shown, never the body — a body could
# carry the cookie, and this log is public.
reply=$(mktemp); trap 'rm -f "$reply"' EXIT
http=$(curl -sS -o "$reply" -w '%{http_code}' -m 60 "$BASE/api/previews/$SLUG/cookie" \
  -H "Cookie: __Secure-authjs.session-token=$token" 2>/dev/null || echo 000)
cookie=$(python3 - "$reply" <<'PY'
import json, sys
try:
    c = json.load(open(sys.argv[1]))["cookie"]
    print(c["name"] + "=" + c["value"])
except Exception:
    pass
PY
)
if [ -z "$cookie" ]; then
  why=$(python3 - "$reply" <<'PY'
import json, sys
try:
    print(str(json.load(open(sys.argv[1])).get("error", ""))[:200])
except Exception:
    pass
PY
)
  echo "the app did not hand out the cookie: HTTP $http ${why:+— $why}"
  exit 4
fi

tour=$(mktemp); trap 'rm -f "$tour" "$reply"' EXIT
# ask <url> [file] — status and type; for a picture that could not be taken, the reason the app gives.
ask() {
  local hdr; hdr=$(mktemp)
  local out; out=$(curl -sS -D "$hdr" -o "${2:-/dev/null}" -w '%{http_code} %{content_type}' -m 90 -H "Cookie: $cookie" "$1" 2>/dev/null || echo "000")
  local why; why=$(grep -i '^x-loki-picture-reason:' "$hdr" | tr -d '\r' | cut -d' ' -f2-)
  rm -f "$hdr"
  echo "$out${why:+ ($why)}"
}

site=$(ask "https://$HOST/")
echo "site:        https://$HOST/ → $site"
page=$(ask "https://$HOST/_loki/before-after" "$tour")
rows=$(grep -o '_loki/picture?side=before' "$tour" | wc -l | tr -d ' ')
echo "tour:        https://$HOST/_loki/before-after → $page, $rows rows"
built=$(grep -q "still being built" "$tour" && echo "not yet" || echo "yes")
echo "built:       $built"
# What the tour says, in the build's own words: the headline and the first rows.
grep -oE '<header class="top">.*' "$tour" | grep -oE '<p>[^<]*</p>' | head -1 | sed -E 's/<[^>]+>//g; s/^/headline:    /'
grep -oE '<h2>[^<]*</h2>' "$tour" | head -4 | sed -E 's/<[^>]+>//g; s/^/row:         /'
if [ "$rows" != "0" ]; then
  echo "before #0:   $(ask "https://$HOST/_loki/picture?side=before&i=0")"
  echo "after #0:    $(ask "https://$HOST/_loki/picture?side=after&i=0")"
fi
case "$site $page" in
  200*200*) exit 0 ;;
  *) exit 5 ;;
esac
