#!/usr/bin/env bash
# The box watchdog must call a site DOWN when it is down.
#
# 2026-10-01: loki.orangecat.ch was down ~06:00-07:53 (next-server alive, port
# not listening; Caddy answered 502 after 20s) and nobody was paged. curl's 15s
# timeout fired first; curl prints "000" itself on failure and the fallback
# `|| echo 000` appended another, so the status was "000000" — neither "000"
# nor a number — and check() kept the site UP. This runs the SHIPPED check()
# (extracted from install-watchdog.sh) against a fake curl.
# Run: bash scripts/hetzner/test-watchdog-check.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
no() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

body="$(sed -n "/^cat > \/opt\/monitoring\/watch.sh <<'SH'$/,/^SH$/p" "$HERE/install-watchdog.sh" | sed '1d;$d')"
fn="$(awk '/^check\(\) \{/{f=1} f{print} f&&/^}$/{exit}' <<<"$body")"
[ -n "$fn" ] && ok "check() extracted from the shipped watch.sh" || { no "could not extract check()"; exit 1; }

STATE="$TMP/state"; mkdir -p "$STATE"
ALERTS="$TMP/alerts"; : > "$ALERTS"
alert() { echo "$1 $2" >> "$ALERTS"; }
# Fake curl: prints what the real one would for the scenario in $SCENARIO.
curl() {
  case "$SCENARIO" in
    timeout) printf '000'; return 28 ;;   # -m 15 fired: real curl prints 000 AND fails
    refused) printf '000'; return 7 ;;
    bad502)  printf '502'; return 0 ;;
    ok200)   printf '200'; return 0 ;;
    redirect) printf '301'; return 0 ;;
    garbage) printf 'xyz'; return 0 ;;
  esac
}
eval "$fn"

run() { SCENARIO="$1"; rm -f "$STATE"/*; : > "$ALERTS"; check "site" "https://site.example/"; cat "$STATE/site" 2>/dev/null || echo up; }

[ "$(run timeout)" = down ] && grep -q "DOWN: site" "$ALERTS" \
  && ok "a timeout (hung app behind a slow proxy) is DOWN and pages" \
  || no "a timeout reads as UP — the 2026-10-01 outage, silent again"
[ "$(run refused)" = down ] && ok "connection refused is DOWN" || no "connection refused reads as UP"
[ "$(run bad502)" = down ] && ok "a 502 is DOWN" || no "a 502 reads as UP"
[ "$(run garbage)" = down ] && ok "an unreadable status is DOWN, not UP" || no "an unreadable status reads as UP"
[ "$(run ok200)" = up ] && [ ! -s "$ALERTS" ] && ok "a 200 is UP, quietly" || no "a 200 was not UP"
[ "$(run redirect)" = up ] && ok "a redirect is the server answering: UP" || no "a 3xx read as DOWN"

# Recovery pages once, too.
SCENARIO=timeout; rm -f "$STATE"/*; : > "$ALERTS"; check site u; SCENARIO=ok200; check site u
grep -q "RECOVERED: site" "$ALERTS" && ok "coming back up says RECOVERED" || no "no RECOVERED after the outage"

for f in scripts/deploy-hetzner.sh .github/workflows/selfhost-deploy.yml scripts/hetzner/install-watchdog.sh; do
  grep -q 'http_code}.*|| echo 000' "$HERE/../../$f" \
    && no "$f still appends a second 000 to curl's own" \
    || ok "$f takes curl's own status"
done

printf 'watchdog-check: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
