#!/usr/bin/env bash
#
# Tests for the fleet uptime sweep — mostly for the two decisions that decide
# whether it can catch the outage it was written for.
#
# botsmann served 503 from /api/health while its HOMEPAGE served 200. So:
#
#   1. A 503 on the health route must read DOWN. If health_verdict ever softens
#      5xx into "absent" the sweep falls back to `/`, sees botsmann's 200, and
#      reports the fleet green through the exact outage that motivated it.
#   2. An app with no health route must read LIMITED, never UP. Eight apps have
#      no health route; calling their homepage check a pass would put a green
#      tick next to eight apps whose database could be on fire.
#
# Pure: no network, no box, no checkout.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/uptime-sweep.sh"
MANIFEST="$HERE/apps.conf"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }
eq() { [ "$1" = "$2" ] && ok "$3" || no "$3 (want '$1', got '$2')"; }

export UPTIME_SWEEP_LIB_ONLY=1
# shellcheck source=/dev/null
source "$SCRIPT"
unset UPTIME_SWEEP_LIB_ONLY

echo "health_verdict — what did /api/health tell us?"
eq up     "$(health_verdict 200)" "200 is the only pass"
eq down   "$(health_verdict 503)" "503 is DOWN — this is botsmann's exact code"
eq down   "$(health_verdict 500)" "500 is DOWN"
eq down   "$(health_verdict 000)" "000 (DNS/refused/timeout) is DOWN"
eq down   "$(health_verdict '')"  "an empty code is DOWN, not silently absent"
eq absent "$(health_verdict 404)" "404 means no health route — a question we cannot ask"
eq absent "$(health_verdict 308)" "a redirect handled it, so no health route here either"
eq absent "$(health_verdict 401)" "an auth-walled route is not a liveness signal"

echo
echo "root_verdict — the weaker fallback: does it serve anything?"
eq up   "$(root_verdict 200)" "200 serves"
eq up   "$(root_verdict 307)" "307 serves (petvity, vitareba redirect / to a locale)"
eq up   "$(root_verdict 308)" "308 serves (aoz-wohnen redirects to its canonical host)"
eq down "$(root_verdict 404)" "404 on / is DOWN"
eq down "$(root_verdict 502)" "502 on / is DOWN"
eq down "$(root_verdict 000)" "unreachable is DOWN"

echo
echo "normalize_code — a failed probe must read as a FAILURE"
# The bug this pins was live in the first draft and cost a false LIMITED on a
# real sweep: `curl || echo 000` emits "000000", which matched no verdict and
# degraded to `absent`.
eq 000 "$(normalize_code 000000)" "curl's double-000 on failure normalises to 000, not garbage"
eq 000 "$(normalize_code '')"     "empty output is 000"
eq 000 "$(normalize_code 'curl: (28) timeout')" "an error string is 000"
eq 200 "$(normalize_code 200)"    "a real code passes through"
eq 503 "$(normalize_code 503)"    "503 passes through"
eq down "$(health_verdict "$(normalize_code 000000)")" \
  "end to end: an unreachable app reads DOWN, never 'no health route'"

echo
echo "a service that is not a Next app gets its own health path"
# bridge is an SSE fan-out service: it answers /healthz and 404s on `/` by
# design. Probing it the standard way reported a HEALTHY service as DOWN — the
# failure mode that teaches people to mute the monitor.
extra_targets | grep -q "^bridge	bridge.orangecat.ch	/healthz$" \
  && ok "bridge is probed at /healthz, not /api/health" \
  || no "bridge must declare its own health path"
extra_targets | grep -q "^orangecat	orangecat.ch	/api/health$" \
  && ok "a target with no declared path defaults to /api/health" \
  || no "the default health path was not applied"

echo
echo "manifest_targets — who gets probed"
targets="$(manifest_targets "$MANIFEST")"
count="$(printf '%s\n' "$targets" | grep -c . || true)"
[ "$count" -ge 10 ] && ok "reads the real manifest ($count apps)" \
  || no "expected 10+ apps from the manifest, got $count"

# The outage that motivated all of this must be in the probe set.
grep -q "^botsmann	botsmann.orangecat.ch	/api/health$" <<<"$targets" \
  && ok "botsmann is probed — the app whose 503 nobody saw" \
  || no "botsmann is missing from the probe set"

# Internal-only apps have no URL to probe; probing '-' would page forever.
grep -qv -- '	-	' <<<"$targets" \
  && ok "no target has '-' as its domain" \
  || no "an internal-only app leaked into the probe set"

# A comma list is one app, not two.
grep -q "^sink	sinktattoo.com	/api/health$" <<<"$targets" \
  && ok "a comma-separated domain list probes only the first (sink)" \
  || no "sink should probe sinktattoo.com, not the www alias too"

echo
echo "coverage is reported, never implied"
# Against a FIXTURE, not the live manifest: today no app is internal-only or
# archived, so asserting on apps.conf would assert on nothing and quietly pass
# forever. The exclusion logic still has to be right for the day one appears.
FIXTURE="$(mktemp)"
trap 'rm -f "$FIXTURE"' EXIT
cat > "$FIXTURE" <<'FIX'
# a comment line, and a blank line, both ignored

live-app|4100|live.example.com|/repo|.|db|bitbaum|product|live|-|-|-
internal|4101|-|/repo|.|db|bitbaum|infra|live|-|-|-
gone|4102|gone.example.com|/repo|.|db|bitbaum|product|archived|-|-|-
theirs|4103|theirs.example.com|/repo|.|db|Client|client-app|handed-over|-|-|-
FIX

fx_targets="$(manifest_targets "$FIXTURE")"
eq "live-app	live.example.com	/api/health" "$fx_targets" "only the live public app is probed"

fx_skipped="$(manifest_skipped "$FIXTURE")"
grep -q "^internal	internal-only" <<<"$fx_skipped" \
  && ok "an internal-only app is named as not probed, not silently dropped" \
  || no "internal-only app missing from the skip report"
grep -q "^gone	status=archived" <<<"$fx_skipped" \
  && ok "an archived app is named as not probed" \
  || no "archived app missing from the skip report"
grep -q "^theirs	status=handed-over" <<<"$fx_skipped" \
  && ok "a handed-over app is named as not probed" \
  || no "handed-over app missing from the skip report"

echo
echo "the EXTRA_TARGETS hand-list is built to die"
# apps.conf documents these four as deliberately absent. The day someone
# registers one, this test fails and forces the duplicate out of the script —
# so the hand-list cannot quietly outlive the reason it exists.
dupes=""
while IFS=$'\t' read -r name _domain; do
  [ -n "$name" ] || continue
  if grep -q "^${name}	" <<<"$targets"; then
    dupes="${dupes}${name} "
  fi
done <<<"$(extra_targets)"
[ -z "$dupes" ] \
  && ok "no EXTRA target duplicates a manifest app" \
  || no "now in apps.conf — delete from EXTRA_TARGETS: $dupes"

# And they must actually be covered, or the three apps apps.conf excludes stay
# exactly as unwatched as they were before this script existed. Asserted BY
# NAME rather than by counting: the list now holds two categories, and a count
# would go green if one of the three were swapped for something else entirely.
for svc in bridge loki orangecat; do
  extra_targets | grep -q "^${svc}	" \
    && ok "$svc is covered — apps.conf documents it as deliberately absent" \
    || no "$svc is in no manifest and now in no hand-list either"
done

echo
echo "url_path / url_host — reading a Location header"
eq /api/health "$(url_path https://aoz.orangecat.ch/api/health)" "a plain path"
eq /api/health "$(url_path 'https://h/api/health?x=1')"          "the query is not part of the path"
eq /api/health "$(url_path https://h/api/health/)"               "a trailing slash is not a different route"
eq /login      "$(url_path 'https://petvity.orangecat.ch/login?returnTo=%2Fapi%2Fhealth')" \
                                                                 "the auth wall's path is /login, whatever its query smuggles"
eq /           "$(url_path https://h)"                           "no path at all reads as /"
eq aoz.orangecat.ch "$(url_host https://aoz.orangecat.ch/api/health)" "the host, for saying where we ended up"

echo
echo "is_redirect"
is_redirect 308 && ok "308 is a redirect"     || no "308 should be a redirect"
is_redirect 307 && ok "307 is a redirect"     || no "307 should be a redirect"
is_redirect 200 && no "200 is not a redirect" || ok "200 is not a redirect"
is_redirect 404 && no "404 is not a redirect" || ok "404 is not a redirect"

echo
echo "same_path_redirect — a host move, or an auth wall wearing the same code?"
same_path_redirect /api/health https://aoz.orangecat.ch/api/health \
  && ok "aoz-wohnen -> aoz keeps the path: follow it, the health route is real" \
  || no "a canonical-host redirect must be followed"
same_path_redirect /api/health 'https://petvity.orangecat.ch/login?returnTo=%2Fapi%2Fhealth' \
  && no "petvity's auth wall must NOT be followed — 200 from a login page is a false green" \
  || ok "an auth wall is not a health route, however inviting its 200 looks"
same_path_redirect /api/health https://h/api/health/ \
  && ok "a trailing slash is the same route" || no "trailing slash should match"
same_path_redirect /api/health https://h/en/api/health \
  && no "a locale prefix is a different route" || ok "a locale prefix is not the same route"
same_path_redirect /api/health "" \
  && no "no Location means nothing to follow" || ok "an empty Location is not a redirect target"

echo
echo "annushka — served, has a process, and can never be in apps.conf"
extra_targets | grep -q "^annushka	annushka.orangecat.ch	/api/health$" \
  && ok "annushka is watched: its static pages serve on while its api dies" \
  || no "annushka should be in EXTRA_TARGETS"

echo "HEALTH_PATHS — apps that answer somewhere other than /api/health"
eq /api/healthz "$(health_path_for petvity)" "petvity's real check; /api/health is its pet health-RECORDS api, behind auth"
eq /healthz     "$(health_path_for bridge)"  "bridge is an SSE service, not a Next app"
eq /api/health  "$(health_path_for kivvi)"   "an app that follows the convention needs no entry"
eq /api/health  "$(health_path_for '')"      "an empty name falls back to the default rather than emptying the URL"

# Both target builders must consult the table. manifest_targets passed it to awk
# as a file-argument assignment, which awk applies only when it REACHES that
# argument — long after BEGIN built the lookup. bridge (hand-listed, -v) worked;
# petvity (manifest) silently kept /api/health and stayed blind. Syntax was
# fine and the sweep still ran; only the emitted path was wrong.
manifest_targets "$MANIFEST" | grep -q "^petvity	petvity.orangecat.ch	/api/healthz$" \
  && ok "a MANIFEST app picks up its declared path" \
  || no "manifest_targets ignored HEALTH_PATHS — check awk gets it via -v, not a file-arg assignment"
extra_targets | grep -q "^bridge	bridge.orangecat.ch	/healthz$" \
  && ok "a HAND-LISTED app picks up its declared path" \
  || no "extra_targets ignored HEALTH_PATHS"

echo
echo "cert_verdict — a broken renewal is silent until every site goes dark"
eq ok       "$(cert_verdict 88)" "88 days: Caddy is renewing normally"
eq ok       "$(cert_verdict 21)" "21 days is still ok — Caddy renews at 30, so it has had nine days of tries"
eq warn     "$(cert_verdict 20)" "20 days: renewal should have happened by now"
eq warn     "$(cert_verdict 7)"  "7 days: still a working week to fix it"
eq critical "$(cert_verdict 6)"  "under a week is an outage with a date on it"
eq critical "$(cert_verdict 0)"  "expires today"
eq critical "$(cert_verdict -3)" "already expired reads critical, not as a huge number"
eq critical "$(cert_verdict '')" "unreadable is CRITICAL — 'could not check' must never share an outcome with 'fine'"
eq critical "$(cert_verdict 'x')" "garbage is critical too, for the same reason"

echo
if [ "$FAIL" -gt 0 ]; then
  echo "FAILED: $FAIL failed, $PASS passed"
  exit 1
fi
echo "OK: $PASS passed"
