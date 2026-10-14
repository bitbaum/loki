#!/usr/bin/env bash
# A site's own domain: the vhost rule (lib.sh caddy_vhost) and attach-domain.sh.
# No box, no DNS, no gh: the vhost generator is pure, and attach-domain runs
# with --dry-run against a fixture register and FAKE_DNS.
# Run: bash scripts/hetzner/test-custom-domain.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

# shellcheck source=lib.sh
source "$HERE/lib.sh"
set +e

echo
echo "the redirect rule changes no row in the real register"
# Every row today is free-address-only or own-domain-only, so each must be
# served in full with no redirect block. If this fails, someone added a row
# that mixes the two — check that the redirect is what they meant.
while IFS='|' read -r name port domains _; do
  [ "$domains" = "-" ] && continue
  out=$(caddy_vhost "$name" "$port" "$domains" orangecat.ch)
  grep -q "redir " <<<"$out" && fail "$name would gain a redirect: $domains"
  head -1 <<<"$out" | grep -qx "${domains//,/, } {" || fail "$name must serve every host: $(head -1 <<<"$out")"
done < <(grep -v '^#' "$HERE/apps.conf" | grep .)
ok "every registered row is served exactly as before"

echo
echo "own domain + free address: serve the own domain, 308 the free one"
out=$(caddy_vhost evig 4040 evig.ch,www.evig.ch,evig.orangecat.ch,revampit.orangecat.ch orangecat.ch)
head -1 <<<"$out" | grep -qx "evig.ch, www.evig.ch {" || fail "own-domain hosts must be served: $out"
grep -qx "evig.orangecat.ch, revampit.orangecat.ch {" <<<"$out" || fail "free hosts must get their own block: $out"
grep -qx "  redir https://evig.ch{uri} 308" <<<"$out" || fail "free hosts must 308 to the canonical own domain: $out"
grep -q " 301" <<<"$out" && fail "never a 301 — it turns POSTs into bodyless GETs"
ok "evig.ch canonical, evig.orangecat.ch → 308"
[ "$(canonical_host evig.orangecat.ch,evig.ch orangecat.ch)" = evig.ch ] || fail "canonical is the first own-domain host, wherever it sits"
[ "$(canonical_host sinktattoo.com,www.sinktattoo.com orangecat.ch)" = sinktattoo.com ] || fail "own-domain-only row: first host"
[ "$(canonical_host heidi.orangecat.ch orangecat.ch)" = heidi.orangecat.ch ] || fail "free-only row: first host"
ok "canonical_host picks the address a row is meant to be reached at"

# ------------------------------------------------------------ attach-domain
mkdir -p "$TMP/fc/scripts/hetzner" "$TMP/rel"
cp "$HERE"/*.sh "$HERE"/launch.sh.tmpl "$TMP/rel/" 2>/dev/null
cat > "$TMP/fc/scripts/hetzner/apps.conf" <<'CONF'
shop|4040|shop.example.org|/dev/shop|.|-|bitbaum|client-site|prospect|-|-|-
own|4041|own.com,www.own.com|/dev/own|.|-|Own|client-site|live|favour|0|-
hand|4004|hand.example.org|/dev/hand|.|-|bitbaum|product|live|-|-|-
CONF
cp "$TMP/fc/scripts/hetzner/apps.conf" "$TMP/rel/apps.conf"
attach() {
  LOKI_REPO_ROOT="$TMP/fc" SITES_BASE_DOMAIN=example.org HETZNER_IP=10.0.0.1 \
    bash "$TMP/rel/attach-domain.sh" "$@" --dry-run 2>&1
}

echo
echo "a domain that does not point here changes nothing and names the records"
OUT=$(FAKE_DNS="shop.ch A 192.0.2.9" attach shop shop.ch); RC=$?
[ "$RC" = 3 ] || fail "must exit 3 (rc=$RC): $OUT"
grep -q "shop.ch      A      10.0.0.1" <<<"$OUT" || fail "must give the A record: $OUT"
grep -q "www.shop.ch  CNAME  shop.example.org" <<<"$OUT" || fail "must give the www CNAME: $OUT"
grep -q "DRY  row" <<<"$OUT" && fail "must not plan a row change"
ok "unresolved domain → exit 3 with A + CNAME"
OUT=$(FAKE_DNS="$(printf 'shop.ch A 10.0.0.1\nshop.ch AAAA 2001:db8::1')" attach shop shop.ch); RC=$?
[ "$RC" = 3 ] && grep -q "AAAA" <<<"$OUT" || fail "a stray AAAA must refuse — Let's Encrypt would validate over IPv6 (rc=$RC): $OUT"
ok "an AAAA pointing elsewhere is refused by name"
OUT=$(FAKE_DNS="shop.example.ch A 10.0.0.1" attach shop app.shop.ch); RC=$?
grep -q "app.shop.ch  CNAME  shop.example.org" <<<"$OUT" || fail "a subdomain gets one CNAME: $OUT"
ok "subdomain → a single CNAME"

echo
echo "a domain that points here becomes the address; the free one is kept"
OUT=$(FAKE_DNS="$(printf 'shop.ch A 10.0.0.1\nwww.shop.ch A 10.0.0.1')" attach shop SHOP.ch.); RC=$?
[ "$RC" = 0 ] || fail "must succeed (rc=$RC): $OUT"
grep -q "DRY  row: shop|4040|shop.ch,www.shop.ch,shop.example.org|/dev/shop|" <<<"$OUT" || fail "row must lead with the own domain and keep the free host: $OUT"
grep -qx "LIVE_URL=https://shop.ch" <<<"$OUT" || fail "must print the new address: $OUT"
ok "shop.ch + www.shop.ch served, shop.example.org kept (normalised from SHOP.ch.)"
OUT=$(FAKE_DNS="shop.ch A 10.0.0.1" attach shop shop.ch)
grep -q "DRY  row: shop|4040|shop.ch,shop.example.org|" <<<"$OUT" || fail "www not pointing here must be left out: $OUT"
ok "www is served only when it points here too"

echo
echo "refusals"
OUT=$(attach shop other.example.org); [ $? = 1 ] && grep -q "free address" <<<"$OUT" || fail "base-domain host must be refused: $OUT"
OUT=$(FAKE_DNS="own.com A 10.0.0.1" attach shop own.com); [ $? = 1 ] && grep -q "already served by 'own'" <<<"$OUT" || fail "a host another row serves must be refused: $OUT"
OUT=$(attach shop 'not a domain'); [ $? = 1 ] || fail "garbage must be refused: $OUT"
OUT=$(FAKE_DNS="hand.ch A 10.0.0.1" attach hand hand.ch); [ $? = 1 ] && grep -q "hand-written block" <<<"$OUT" || fail "handcrafted 4001-4004 services must be refused: $OUT"
OUT=$(attach own --detach); [ $? = 1 ] && grep -q "off the air" <<<"$OUT" || fail "detach with no free address must be refused: $OUT"
OUT=$(attach nope x.ch); [ $? = 1 ] || fail "an unregistered slug must be refused: $OUT"
ok "free host, taken host, garbage, handcrafted, no-fallback detach, unknown slug"

echo
echo "detach returns the site to its free address"
printf 'shop|4040|shop.ch,www.shop.ch,shop.example.org|/dev/shop|.|-|bitbaum|client-site|prospect|-|-|-\n' > "$TMP/fc/scripts/hetzner/apps.conf"
OUT=$(attach shop --detach); RC=$?
[ "$RC" = 0 ] && grep -q "DRY  row: shop|4040|shop.example.org|" <<<"$OUT" && grep -qx "LIVE_URL=https://shop.example.org" <<<"$OUT" \
  || fail "detach must leave only the free host (rc=$RC): $OUT"
ok "detach → shop.example.org"

grep -q '`' "$HERE/attach-domain.sh" && fail "attach-domain.sh contains a backtick"
ok "no backticks"

echo
echo "$PASSED passed"
