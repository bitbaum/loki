#!/usr/bin/env bash
#
# Is every app on the box actually serving — or only the one we happen to watch?
#
# botsmann answered HTTP 503 from /api/health for weeks and nobody knew. Not
# because the check failed: because there was no check. Nineteen services run on
# bitbaum and the fleet's only uptime monitor probes orangecat.ch. One app was
# watched; the other eighteen were a hope.
#
# So this reads apps.conf — the SAME manifest deploy.sh and sync-infra.sh read —
# and probes everything registered there. Registering an app for deployment is
# what enrols it in monitoring. There is deliberately no second list to keep in
# step, because a hand-maintained copy of "what is deployed" is how the gap that
# hid botsmann opens again.
#
# WHAT WE PROBE, AND WHY IT IS NOT THE HOMEPAGE
#
# botsmann's homepage returned 200 the entire time it was broken — Next renders
# the marketing pages from disk with no database in the path. Only /api/health
# touched Postgres, and only /api/health knew. A monitor pointed at `/` would
# have gone green through the whole outage and told us the fleet was fine.
#
# Hence: probe /api/health, and treat 5xx as DOWN. An app with no health route
# can only be asked "do you serve anything at all", which is a weaker question —
# so it is reported as LIMITED, never as a pass. That distinction is the point.
# Twelve targets answer a health route; the rest are monitored with one hand
# tied, and saying so is what keeps the number honest (see
# scripts/ci/shared-inventory.sh, which ratchets that health-route count).
#
# THREE of those twelve were counted among "the rest" until 2026-08-28, and none
# of them was ever broken — the sweep was asking the wrong URL and believing the
# answer. aoz-wohnen answers on the canonical host it redirects to;
# petvity answers at /api/healthz, while the /api/health we asked for is its pet
# health-RECORDS api sitting behind auth. Each looked exactly like an app with
# no health route, which is the one shape this script must never get wrong.
#
# Runs off-box on GitHub's infrastructure, so it still reports when bitbaum is
# dead — which is exactly when an on-box check tells you nothing.
#
# Usage:
#   uptime-sweep.sh              # report every app
#   uptime-sweep.sh --check      # exit 1 if any app is DOWN
#   uptime-sweep.sh --json       # machine-readable, for the alerting workflow
#   uptime-sweep.sh --certs      # TLS expiry for the same targets; exit 1 if any
#                                # is critical. Daily, not every 15 minutes — a
#                                # certificate does not change between sweeps.
#
# Env: UPTIME_TRIES (default 3), UPTIME_TIMEOUT secs (default 15),
#      UPTIME_SLEEP secs between tries (default 5), MANIFEST (default apps.conf)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${MANIFEST:-$HERE/apps.conf}"
TRIES="${UPTIME_TRIES:-3}"
TIMEOUT="${UPTIME_TIMEOUT:-15}"
SLEEP="${UPTIME_SLEEP:-5}"

# The fleet convention, and what shared-inventory.sh ratchets a count of.
DEFAULT_HEALTH_PATH=/api/health

# ── The three apps.conf documents as deliberately absent ──────────────────────
#
# apps.conf says, in its own header: "Ports 4001-4004 are the pre-existing
# handcrafted services (bridge, loki, orangecat; evig joined the register on 2026-09-11) — they keep
# their own units and Caddy blocks and are NOT listed here." They are still
# public, still on the one box, and still unwatched, so leaving them out would
# reproduce the exact blind spot this script exists to close.
#
# This list is meant to DIE. When those four are registered in apps.conf,
# test-uptime-sweep.sh fails on the duplicate and forces its removal — a
# hand-list that cannot quietly outlive its reason.
#
# Health paths for both lists live in HEALTH_PATHS below, so there is one place
# to look when an app does not follow the convention.
#
# annushka is here for a different reason and will NOT die the same way: it is a
# static concept site with no repo, deployed by hand, so it can never appear in
# a manifest whose other fields are a repo path and a deploy target. It does
# have a process — annushka-api on 4030 serves /api/* — which can fall over
# while the static pages carry on serving perfectly. Exactly botsmann's shape.
#
# bitbaum is the studio site itself — static files Caddy serves straight from
# /opt/bitbaum/app, so it has no port, no unit and no repo path and can never
# hold a manifest row either. It was the one public host on the box that
# nothing watched, which mattered little while nothing linked to it and matters
# now: every package README points at it and /hire/ takes waitlist signups
# through it.
EXTRA_TARGETS='
bridge|bridge.orangecat.ch
loki|loki.orangecat.ch
orangecat|orangecat.ch
annushka|annushka.orangecat.ch
bitbaum|bitbaum.orangecat.ch
'

# Apps whose health route is not at the fleet's /api/health. One table for
# manifest apps and hand-listed ones alike — an app that answers somewhere else
# is the same problem whichever list it came from.
#
# bridge is a ~300-line SSE fan-out service, not a Next app: it answers /healthz
# and 404s on `/` by design. Probed the standard way it read DOWN — a perfectly
# healthy service, which is how a monitor teaches people to ignore it.
#
# petvity is worse, because its /api/health looks like it exists. That path is
# the pet HEALTH-RECORDS api, behind auth, so it 307s to /login. The sweep read
# "no health route" and settled for asking whether the homepage renders — while
# /api/healthz was there the whole time answering {"ok":true,"db":true}, the
# database check we actually wanted. Measured 2026-08-28.
HEALTH_PATHS='
bridge|/healthz
petvity|/api/healthz
bitbaum|/
'

# ── Pure helpers (no network, no box) — exercised by test-uptime-sweep.sh ─────

# health_path_for <name> — the declared health path, or the fleet default.
health_path_for() {
  local declared
  declared=$(printf '%s\n' "$HEALTH_PATHS" | awk -F'|' -v n="$1" '$1 == n { print $2; exit }')
  printf '%s' "${declared:-$DEFAULT_HEALTH_PATH}"
}

# manifest_targets <file> — echo "name<TAB>domain" per monitorable app.
#
# Skips comments, blanks, internal-only apps ('-' domain), and apps whose status
# says they are not ours to page on. Takes the FIRST domain of a comma list, the
# same way selfhost-deploy.yml resolves ${DOMAINS%%,*} — www aliases are the
# same app and a second probe would only double the noise.
manifest_targets() {
  awk -F'|' -v HEALTH="$DEFAULT_HEALTH_PATH" -v PATHS="$HEALTH_PATHS" '
    BEGIN {
      n = split(PATHS, lines, "\n")
      for (i = 1; i <= n; i++) {
        if (split(lines[i], f, "|") == 2 && f[1] != "") declared[f[1]] = f[2]
      }
    }
    function health_for(name) { return (name in declared) ? declared[name] : HEALTH }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      name = $1; domains = $3; status = $9
      if (domains == "-" || domains == "") next
      if (status == "archived" || status == "handed-over") next
      sub(/,.*/, "", domains)
      print name "\t" domains "\t" health_for(name)
    }
  ' "$1"
}

# manifest_skipped <file> — echo "name<TAB>reason" for every app NOT probed, so
# the report can never imply coverage it does not have.
manifest_skipped() {
  awk -F'|' '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      name = $1; domains = $3; status = $9
      if (domains == "-" || domains == "") { print name "\tinternal-only (no public domain)"; next }
      if (status == "archived" || status == "handed-over") { print name "\tstatus=" status; next }
    }
  ' "$1"
}

# extra_targets — the documented-absent four, same "name<TAB>domain" shape.
extra_targets() {
  printf '%s\n' "$EXTRA_TARGETS" \
    | awk -F'|' -v HEALTH="$DEFAULT_HEALTH_PATH" -v PATHS="$HEALTH_PATHS" '
    BEGIN {
      n = split(PATHS, lines, "\n")
      for (i = 1; i <= n; i++) {
        if (split(lines[i], f, "|") == 2 && f[1] != "") declared[f[1]] = f[2]
      }
    }
    function health_for(name) { return (name in declared) ? declared[name] : HEALTH }
        NF>=2 { print $1 "\t" $2 "\t" health_for($1) }'
}

# health_verdict <http_code> — what /api/health told us.
#
#   up      200, and only 200. A health route that cannot say 200 is not healthy.
#   down    5xx, or 000 (DNS failure / connection refused / timeout).
#   absent  anything else — chiefly 404 (no health route) and 3xx (a redirect
#           handled it, so the route does not exist here either). Not a failure;
#           a question we could not ask, which the caller retries against `/`.
health_verdict() {
  case "$1" in
    200)          echo up ;;
    5??|000|"")   echo down ;;
    *)            echo absent ;;
  esac
}

# is_redirect <http_code> — 3xx, the code that means "ask somewhere else".
is_redirect() { case "$1" in 3??) return 0 ;; *) return 1 ;; esac; }

# url_path <url> — the path, without query or fragment, trailing slash trimmed.
# `https://h/api/health?x=1` -> `/api/health`; `https://h` -> `/`.
url_path() {
  local rest="${1#*://}"
  case "$rest" in
    */*) rest="/${rest#*/}" ;;
    *)   rest="/" ;;
  esac
  rest="${rest%%\?*}"
  rest="${rest%%#*}"
  [ "$rest" = / ] || rest="${rest%/}"
  printf '%s' "$rest"
}

# url_host <url> — the hostname, for saying WHERE we ended up in the report.
url_host() {
  local rest="${1#*://}"
  printf '%s' "${rest%%/*}"
}

# same_path_redirect <requested_path> <redirect_url> — did this redirect only
# move HOSTS, keeping the path we asked for?
#
# A 3xx on the health path is two different things wearing one status code, and
# they need opposite treatment:
#
#   aoz-wohnen.orangecat.ch 308s to aoz.orangecat.ch — same path, canonical
#   host. The health route exists and answers 200; we were asking the wrong
#   hostname and reporting LIMITED for an app that has a working check. Worse,
#   had its database died the redirect would still have been a 308 and the
#   sweep would still have said "serving".
#
#   petvity 307s /api/health to /login?returnTo=%2Fapi%2Fhealth — an auth wall.
#   Following that returns 200 from a LOGIN PAGE. A blanket `curl -L` would
#   report petvity UP on the strength of a form: a false green, which is worse
#   than the blind spot it set out to fix.
#
# So: follow it only when the path survives.
same_path_redirect() {
  local want="$1" got
  [ -n "${2:-}" ] || return 1
  got="$(url_path "$2")"
  [ "$want" = / ] || want="${want%/}"
  [ "$got" = "$want" ]
}

# cert_verdict <days_until_expiry> — how much warning is left?
#
# Caddy renews at 30 days remaining and has never missed. That is exactly why
# nothing watches it, and why a failure would be silent: the first symptom of a
# broken renewal is every site on the box going dark at once, with no prior
# signal anywhere. Renewal can break for reasons the app never sees — an ACME
# rate limit, port 80 closed by a firewall change, a DNS record moved.
#
#   ok        >= 21 days. Caddy renews at 30, so it has had nine days of tries.
#   warn      7-20. Renewal should have happened and did not; look now, while
#             looking is cheap.
#   critical  < 7, or unreadable. An outage with a date on it.
#
# Unknown is critical, never ok: "we could not read the certificate" and "the
# certificate is fine" must not share an outcome. That conflation is what let
# botsmann's 503 read as healthy for weeks.
cert_verdict() {
  case "$1" in
    ''|*[!0-9-]*) echo critical ;;
    -*)           echo critical ;;
    *) if   [ "$1" -lt 7  ]; then echo critical
       elif [ "$1" -lt 21 ]; then echo warn
       else                       echo ok
       fi ;;
  esac
}

# root_verdict <http_code> — the weaker fallback question: does it serve at all?
# 3xx counts as serving: several apps redirect `/` to a locale or a canonical
# host (aoz-wohnen, petvity, vitareba all do) and that is a working app.
root_verdict() {
  case "$1" in
    2??|3??) echo up ;;
    *)       echo down ;;
  esac
}

# normalize_code <raw> — curl's output, reduced to exactly three digits or 000.
#
# The obvious `curl ... || echo 000` is WRONG, and was wrong here first: on a
# connection failure curl prints its own "000" AND the fallback echoes another,
# giving "000000". No verdict matches that, so it fell through to `absent` — an
# unreachable app was reported as "no health route" and then re-probed at `/`.
# For an app that serves static pages without its database (botsmann's exact
# shape) that turns a hard outage into a soft LIMITED. A monitor whose failure
# mode is to SOFTEN failures is worse than no monitor, so the code coming back
# from curl is validated, never trusted.
normalize_code() {
  case "$1" in
    [0-9][0-9][0-9]) echo "$1" ;;
    *)               echo 000 ;;
  esac
}

# Sourced by test-uptime-sweep.sh to exercise the pure helpers above without a
# network, a box, or a checkout.
if [ -n "${UPTIME_SWEEP_LIB_ONLY:-}" ]; then return 0; fi

# ── Probe ────────────────────────────────────────────────────────────────────

MODE=report
case "${1:-}" in
  --check) MODE=check ;;
  --json)  MODE=json ;;
  --certs) MODE=certs ;;
  "")      MODE=report ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

[ -r "$MANIFEST" ] || { echo "manifest not readable: $MANIFEST" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl not found" >&2; exit 2; }

# probe_code <url> — echo the HTTP status as exactly three digits, or 000.
probe_code() {
  normalize_code "$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$1" 2>/dev/null || true)"
}

# probe_redirect <url> — echo the Location this URL redirects to, or nothing.
probe_redirect() {
  curl -sS -o /dev/null -w '%{redirect_url}' --max-time "$TIMEOUT" "$1" 2>/dev/null || true
}

# probe_app <domain> — echo "<state> <detail>".
#
# Retries only a NEGATIVE result. A 200 is believed immediately; a failure is
# re-asked, because GitHub's runners and a single box both blip and a monitor
# that pages on one bad packet gets muted, which is worse than no monitor.
probe_app() {
  local domain="$1" health_path="$2" code verdict try
  for (( try = 1; try <= TRIES; try++ )); do
    code=$(probe_code "https://$domain$health_path")
    verdict=$(health_verdict "$code")
    [ "$verdict" = up ] && { echo "up health:$code"; return; }
    [ "$verdict" = absent ] && break   # no route — retrying cannot create one
    [ "$try" -lt "$TRIES" ] && sleep "$SLEEP"
  done

  # Before giving up on the health route, check whether the 3xx was merely the
  # canonical host telling us where it lives. Only a path-preserving redirect
  # counts — see same_path_redirect for why following an auth wall is worse
  # than not following at all.
  if [ "$verdict" = absent ] && is_redirect "$code"; then
    local target
    target=$(probe_redirect "https://$domain$health_path")
    if same_path_redirect "$health_path" "$target"; then
      for (( try = 1; try <= TRIES; try++ )); do
        code=$(probe_code "$target")
        verdict=$(health_verdict "$code")
        [ "$verdict" = up ] && { echo "up health:$code (redirected to $(url_host "$target"))"; return; }
        [ "$verdict" = absent ] && break
        [ "$try" -lt "$TRIES" ] && sleep "$SLEEP"
      done
      [ "$verdict" = down ] && { echo "down health:$code (redirected to $(url_host "$target"))"; return; }
    fi
  fi

  if [ "$verdict" = absent ]; then
    local rcode rverdict
    for (( try = 1; try <= TRIES; try++ )); do
      rcode=$(probe_code "https://$domain/")
      rverdict=$(root_verdict "$rcode")
      [ "$rverdict" = up ] && { echo "limited root:$rcode (no health route)"; return; }
      [ "$try" -lt "$TRIES" ] && sleep "$SLEEP"
    done
    echo "down root:$rcode (no health route, and / did not serve)"
    return
  fi

  echo "down health:$code"
}


# cert_days <domain> — days until the TLS certificate expires, or empty if we
# could not read one. Deliberately the SAME target list as the HTTP sweep: a
# second list of domains is the gap that hid botsmann.
cert_days() {
  local end epoch
  end=$(echo | timeout "$TIMEOUT" openssl s_client -servername "$1" -connect "$1:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] || return 0
  epoch=$(date -d "$end" +%s 2>/dev/null) || return 0
  echo $(( (epoch - $(date +%s)) / 86400 ))
}

if [ "$MODE" = certs ]; then
  command -v openssl >/dev/null 2>&1 || { echo "openssl not found" >&2; exit 2; }
  n_ok=0; n_warn=0; n_crit=0; bad=""
  printf '%-34s %6s  %s\n' DOMAIN DAYS STATE
  while IFS=$'\t' read -r _name domain _hp; do
    [ -n "$domain" ] || continue
    days=$(cert_days "$domain")
    verdict=$(cert_verdict "$days")
    printf '%-34s %6s  %s\n' "$domain" "${days:-?}" "$verdict"
    case "$verdict" in
      ok)       n_ok=$((n_ok + 1)) ;;
      warn)     n_warn=$((n_warn + 1)); bad="$bad $domain(${days:-?}d)" ;;
      critical) n_crit=$((n_crit + 1)); bad="$bad $domain(${days:-?}d)" ;;
    esac
  done <<<"$( { manifest_targets "$MANIFEST"; extra_targets; } | sort -u )"

  echo
  echo "ok=$n_ok  warn=$n_warn  critical=$n_crit"
  [ -n "$bad" ] && echo "NEEDS A LOOK:$bad"
  [ "$n_crit" -gt 0 ] && exit 1
  exit 0
fi

targets=$( { manifest_targets "$MANIFEST"; extra_targets; } | sort -u )
[ -n "$targets" ] || { echo "no targets found in $MANIFEST" >&2; exit 2; }

down_list=""; limited_list=""
n_up=0; n_down=0; n_limited=0
results=""

while IFS=$'\t' read -r name domain health_path; do
  [ -n "$domain" ] || continue
  read -r state detail <<<"$(probe_app "$domain" "${health_path:-$DEFAULT_HEALTH_PATH}")"
  results="${results}${name}|${domain}|${state}|${detail}"$'\n'
  case "$state" in
    up)      n_up=$((n_up + 1)) ;;
    limited) n_limited=$((n_limited + 1)); limited_list="${limited_list}${name} " ;;
    down)    n_down=$((n_down + 1)); down_list="${down_list}${name} " ;;
  esac
done <<<"$targets"

if [ "$MODE" = json ]; then
  printf '%s' "$results" | awk -F'|' '
    BEGIN { printf "{\"down\":[" ; d = 0 }
    function esc(v) { gsub(/\\/, "\\\\", v); gsub(/"/, "\\\"", v); return v }
    $3 == "down" { printf "%s{\"app\":\"%s\",\"domain\":\"%s\",\"detail\":\"%s\"}", (d++ ? "," : ""), esc($1), esc($2), esc($4) }
    END { printf "],\"counts\":{\"up\":%s,\"limited\":%s,\"down\":%s}}\n", UP, LIM, DOWN }
  ' UP="$n_up" LIM="$n_limited" DOWN="$n_down"
  exit 0
fi

printf '%-22s %-34s %-9s %s\n' APP DOMAIN STATE DETAIL
printf '%s' "$results" | sort -t'|' -k3,3 -k1,1 \
  | awk -F'|' '{ printf "%-22s %-34s %-9s %s\n", $1, $2, toupper($3), $4 }'

echo
echo "up=$n_up  limited=$n_limited  down=$n_down"
[ -n "$limited_list" ] && echo "LIMITED (no health route — a dead database is invisible): $limited_list"
[ -n "$down_list" ] && echo "DOWN: $down_list"

# Never let the summary imply coverage we do not have.
skipped=$(manifest_skipped "$MANIFEST")
if [ -n "$skipped" ]; then
  echo
  echo "not probed:"
  printf '%s\n' "$skipped" | awk -F'\t' '{ printf "  %-22s %s\n", $1, $2 }'
fi

if [ "$MODE" = check ] && [ "$n_down" -gt 0 ]; then
  exit 1
fi
exit 0
