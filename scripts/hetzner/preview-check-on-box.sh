#!/usr/bin/env bash
#
# Open a preview the way its owner does and say what is there. Runs ON the box.
#
#   preview-check-on-box.sh <host>     e.g. center-com.orangecat.ch
#
# The access cookie is minted where the code lives (print-preview-cookie.ts,
# as the operator) and never printed. What is printed: the status of the site,
# of the before-and-after tour, how many rows the tour has, and whether the
# first "before" and "after" pictures come back as images — the whole flow,
# seen from the owner's side, in six lines. Exit 0 when the site and the tour
# open; 3 no checkout; 4 no cookie; 5 something did not open.
set -uo pipefail

HOST="${1:?host}"
BOX_LOKI="${BOX_LOKI:-/home/ubuntu/dev/loki}"
ENVF="${BOX_LOKI_ENV:-/opt/loki/app/.env}"

set -a; . "$ENVF"; set +a
cd "$BOX_LOKI" || { echo "no Loki checkout at $BOX_LOKI"; exit 3; }

# The caller ships the minting script into .tmp/ (git-ignored): the box's
# checkout is often behind main and may not have it yet. The checkout's own
# copy is the fallback for a run by hand on the box.
mint=".tmp/print-preview-cookie.ts"
[ -f "$mint" ] || mint="scripts/test/print-preview-cookie.ts"
cookie=$(npx tsx "$mint" 2>/dev/null | tr -d '\n')
[ -n "$cookie" ] || { echo "could not mint the access cookie on the box"; exit 4; }

tour=$(mktemp); trap 'rm -f "$tour"' EXIT
ask() { curl -sS -o "${2:-/dev/null}" -w '%{http_code} %{content_type}' -m 90 -H "Cookie: $cookie" "$1" 2>/dev/null || echo "000"; }

site=$(ask "https://$HOST/")
echo "site:        https://$HOST/ → $site"
page=$(ask "https://$HOST/_loki/before-after" "$tour")
rows=$(grep -o '_loki/picture?side=before' "$tour" | wc -l | tr -d ' ')
echo "tour:        https://$HOST/_loki/before-after → $page, $rows rows"
built=$(grep -q "still being built" "$tour" && echo "not yet" || echo "yes")
echo "built:       $built"
if [ "$rows" != "0" ]; then
  echo "before #0:   $(ask "https://$HOST/_loki/picture?side=before&i=0")"
  echo "after #0:    $(ask "https://$HOST/_loki/picture?side=after&i=0")"
fi
case "$site $page" in
  200*200*) exit 0 ;;
  *) exit 5 ;;
esac
