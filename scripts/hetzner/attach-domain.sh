#!/usr/bin/env bash
#
# Give a registered site its own domain — or take it back to its free one.
#
#   attach-domain.sh <slug> <domain> [--dry-run]
#   attach-domain.sh <slug> --detach [--dry-run]
#
# A site starts on <slug>.$SITES_BASE_DOMAIN. Once its owner buys a domain and
# points it here, this makes that domain the site's address: the domain (and
# www.<domain>, when it points here too) is served, and the free address
# answers with a 308 to it — so nothing the visitor sees says where it is
# hosted. The rule itself lives in lib.sh (caddy_vhost); this script only
# checks DNS, edits the register row, and syncs.
#
# DNS is checked BEFORE anything changes. Caddy asks Let's Encrypt for a
# certificate the moment a host appears in a vhost; a host whose DNS points
# elsewhere fails that challenge and is retried with backoff for hours, while
# the site's free address is already redirecting to it. So a domain that does
# not resolve to this box is refused, with the records to set.
#
# Exit codes: 0 attached/detached and answering, 1 refused, 2 usage,
# 3 DNS not pointing here yet (nothing changed), 4 attached but not answering
# over HTTPS yet (certificate still being issued — check again shortly).
#
# Prints LIVE_URL=<url> as its last line on success, for the app to record.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/lib.sh"

SLUG=""; DOMAIN=""; DETACH=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --detach)  DETACH=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      if   [ -z "$SLUG" ];   then SLUG="$1"
      elif [ -z "$DOMAIN" ]; then DOMAIN="$1"
      else echo "unexpected arg: $1" >&2; exit 2; fi
      shift ;;
  esac
done
[ -n "$SLUG" ] || { echo "usage: attach-domain.sh <slug> <domain> | <slug> --detach" >&2; exit 2; }
if [ "$DETACH" = 1 ]; then
  [ -z "$DOMAIN" ] || { echo "--detach takes no domain" >&2; exit 2; }
else
  [ -n "$DOMAIN" ] || { echo "usage: attach-domain.sh <slug> <domain>" >&2; exit 2; }
fi

say() { printf '  %s\n' "$*"; }
BASE="$SITES_BASE_DOMAIN"

# Same register resolution as register-site.sh: write the durable checkout,
# check conflicts against it AND the release copy beside this script.
FC_REPO="${LOKI_REPO_ROOT:-$DEV_ROOT/loki}"
if [ -f "$FC_REPO/scripts/hetzner/apps.conf" ]; then MANIFEST="$FC_REPO/scripts/hetzner/apps.conf"
else MANIFEST="$HERE/apps.conf"; fi
RELEASE_MANIFEST="$HERE/apps.conf"
export MANIFEST
registers() { printf '%s\n' "$MANIFEST"; [ "$RELEASE_MANIFEST" != "$MANIFEST" ] && [ -f "$RELEASE_MANIFEST" ] && printf '%s\n' "$RELEASE_MANIFEST"; return 0; }

if [ "$DRY" != 1 ]; then
  # One writer of the register at a time — the lock register-site.sh holds.
  exec 9>"${TMPDIR:-/tmp}/loki-register-site.lock"
  flock -w 60 -x 9 || { echo "ERROR: another registration is still running; retry shortly" >&2; exit 1; }
fi

app_lookup "$SLUG" || exit 1
ROW=$(grep -v '^#' "$MANIFEST" | grep "^$SLUG|")

# Ports 4001-4004 are the handcrafted services (apps.conf header): their Caddy
# blocks are written by hand in /etc/caddy/Caddyfile, not by sync-infra. A
# generated apps.d block for the same host would be a duplicate site address,
# caddy validate would fail, and the reload would abort for every app.
if [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 4001 ] && [ "$PORT" -le 4004 ]; then
  echo "✗ '$SLUG' is served by a hand-written block in /etc/caddy/Caddyfile, not by apps.d." >&2
  echo "  Add the domain to that block by hand (and a 308 from the free address), or move the block into apps.d first." >&2
  echo "  See docs/infrastructure/custom-domains.md." >&2
  exit 1
fi

# The base-domain hosts the row already has — kept in every case.
base_hosts=""
IFS=',' read -ra current <<<"$DOMAINS"
for h in "${current[@]}"; do
  [ -n "$h" ] && [ "$h" != "-" ] || continue
  is_base_host "$h" "$BASE" && base_hosts="${base_hosts:+$base_hosts,}$h"
done

# resolve <type> <host> — addresses, one per line. FAKE_DNS ("host TYPE addr"
# lines) stands in for the resolver in tests. getent follows CNAMEs, which is
# what we want: www → <slug>.orangecat.ch → this box counts as pointing here.
resolve() {
  if [ -n "${FAKE_DNS+x}" ]; then
    awk -v h="$2" -v t="$1" '$1 == h && $2 == t { print $3 }' <<<"$FAKE_DNS"
    return 0
  fi
  local db=ahostsv4; [ "$1" = AAAA ] && db=ahostsv6
  getent "$db" "$2" 2>/dev/null | awk '{print $1}' | sort -u
}
# points_here <host> — every A record is this box and no AAAA points elsewhere.
points_here() {
  local a aaaa
  a=$(resolve A "$1"); aaaa=$(resolve AAAA "$1" | grep -v '^::ffff:' || true)
  [ -n "$a" ] || return 1
  [ -z "$(grep -vx "$HETZNER_IP" <<<"$a")" ] || return 1
  if [ -n "$aaaa" ]; then
    [ -n "${BOX_IPV6:-}" ] && [ -z "$(grep -vx "$BOX_IPV6" <<<"$aaaa")" ] || return 2
  fi
  return 0
}

if [ "$DETACH" = 1 ]; then
  [ -n "$base_hosts" ] || {
    echo "✗ '$SLUG' has no $BASE address to fall back to — detaching would take it off the air." >&2
    exit 1
  }
  NEW_DOMAINS="$base_hosts"
  echo "→ detaching own domain from '$SLUG'"
else
  echo "→ validating $DOMAIN"
  DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z'); DOMAIN="${DOMAIN%.}"
  [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$ ]] \
    || { echo "✗ '$DOMAIN' is not a domain name (letters, digits, hyphens and dots, e.g. evig.ch)" >&2; exit 1; }
  if is_base_host "$DOMAIN" "$BASE"; then
    echo "✗ $DOMAIN is under $BASE — that is the free address, not an own domain" >&2; exit 1
  fi
  for h in "$DOMAIN" "www.${DOMAIN#www.}"; do
    other=$(cat $(registers) | grep -v '^#' | grep -v "^$SLUG|" | awk -F'|' -v h="$h" '{ n = split($3, d, ","); for (i = 1; i <= n; i++) if (d[i] == h) { print $1; exit } }')
    [ -z "$other" ] || { echo "✗ $h is already served by '$other'" >&2; exit 1; }
  done

  echo "→ DNS"
  rc=0; points_here "$DOMAIN" || rc=$?
  if [ "$rc" != 0 ]; then
    echo "✗ $DOMAIN does not point at this server yet — nothing was changed." >&2
    [ "$rc" = 2 ] && echo "  It has an IPv6 (AAAA) record pointing elsewhere; remove it." >&2
    echo "  Set these records at the domain's registrar, then run this again:" >&2
    if [ "$DOMAIN" = "$(printf '%s' "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')" ]; then
      echo "    $DOMAIN      A      $HETZNER_IP" >&2
      echo "    www.$DOMAIN  CNAME  $SLUG.$BASE" >&2
    else
      echo "    $DOMAIN  CNAME  $SLUG.$BASE" >&2
    fi
    exit 3
  fi
  say "$DOMAIN → $HETZNER_IP"
  NEW_DOMAINS="$DOMAIN"
  if [[ "$DOMAIN" != www.* ]] && points_here "www.$DOMAIN"; then
    NEW_DOMAINS="$NEW_DOMAINS,www.$DOMAIN"
    say "www.$DOMAIN → $HETZNER_IP (served too)"
  elif [[ "$DOMAIN" != www.* ]]; then
    say "www.$DOMAIN does not point here — not served (add CNAME www → $SLUG.$BASE to serve it)"
  fi
  [ -z "$base_hosts" ] || NEW_DOMAINS="$NEW_DOMAINS,$base_hosts"
fi

NEW_ROW=$(awk -F'|' -v OFS='|' -v d="$NEW_DOMAINS" '{ $3 = d; print }' <<<"$ROW")
CANONICAL=$(canonical_host "$NEW_DOMAINS" "$BASE")
say "domains $DOMAINS  →  $NEW_DOMAINS"
say "address https://$CANONICAL"

if [ "$NEW_ROW" = "$ROW" ]; then
  say "register already says this — re-syncing only"
elif [ "$DRY" = 1 ]; then
  say "DRY  row: $NEW_ROW"
else
  awk -v s="$SLUG|" -v l="$NEW_ROW" 'index($0, s) == 1 { print l; next } { print }' "$MANIFEST" > "$MANIFEST.tmp" \
    && mv "$MANIFEST.tmp" "$MANIFEST"
  say "register updated ($MANIFEST)"
  publish_register_row "$SLUG" "$NEW_ROW"
fi

if [ "$DRY" = 1 ]; then
  say "DRY  would run sync-infra.sh $SLUG and check https://$CANONICAL"
  echo "LIVE_URL=https://$CANONICAL"
  exit 0
fi

echo "→ box (Caddy vhost)"
bash "$HERE/sync-infra.sh" "$SLUG"

# The certificate is issued on the first request after the reload; give it a
# minute before calling it a failure. Any HTTP answer below 500 is the site.
echo "→ https://$CANONICAL"
for _ in $(seq 1 12); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$CANONICAL/" 2>/dev/null || true)
  if [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]; then
    say "answering (HTTP $code)"
    echo "LIVE_URL=https://$CANONICAL"
    exit 0
  fi
  sleep 5
done
echo "⚠ https://$CANONICAL is not answering yet (last: ${code:-no response}). The register and Caddy are updated;" >&2
echo "  the certificate may still be in flight. Check again in a few minutes." >&2
echo "LIVE_URL=https://$CANONICAL"
exit 4
