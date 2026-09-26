#!/usr/bin/env bash
# register-site.sh allocates ports and checks conflicts against BOTH registers:
# the durable checkout it writes to, and the release copy beside the script
# (main's last shipped register). On 2026-09-10 it read only the durable copy,
# which was behind main, and handed velokiosk-sep10 port 4024 while diplodoctor
# (registered on main) was listening on it. Dry-run only: no gh, no ssh, no git.
# Run: bash scripts/hetzner/test-register-site.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

# Fixture: a durable checkout whose register is BEHIND the release register.
mkdir -p "$TMP/fc/scripts/hetzner" "$TMP/dev" "$TMP/rel"
cp "$HERE"/*.sh "$HERE"/launch.sh.tmpl "$TMP/rel/" 2>/dev/null
printf 'old-app|4010|old.example.com|/nowhere/old|.|-|bitbaum|product|live|-|-|-\n' > "$TMP/fc/scripts/hetzner/apps.conf"
printf 'old-app|4010|old.example.com|/nowhere/old|.|-|bitbaum|product|live|-|-|-\nnewer-on-main|4030|newer.example.com|/nowhere/newer|.|-|bitbaum|product|live|-|-|-\n' > "$TMP/rel/apps.conf"
touch "$TMP/key"

run_dry() {
  DEV_ROOT="$TMP/dev" LOKI_REPO_ROOT="$TMP/fc" DEPLOY_KEY_PATH="$TMP/key" SITES_BASE_DOMAIN=example.com \
    bash "$TMP/rel/register-site.sh" "$@" --dry-run 2>&1
}

echo
echo "port allocation reads the release register too"
OUT=$(run_dry fresh-site --repo owner/fresh-site); RC=$?
[ "$RC" = 0 ] || fail "dry-run must succeed (rc=$RC): $OUT"
grep -q "port 4031" <<<"$OUT" || fail "port must follow the highest in EITHER register (expected 4031): $OUT"
ok "a slug new to both registers gets the port after main's highest, not the durable copy's"

echo
echo "a slug main already registered is refused until the durable copy catches up"
OUT=$(run_dry newer-on-main --repo owner/newer-on-main); RC=$?
[ "$RC" = 1 ] || fail "must refuse (rc=$RC): $OUT"
grep -q "registered on main but not in the durable register" <<<"$OUT" || fail "must name the cause: $OUT"
ok "main-only slug is refused with the cause"

echo
echo "a hostname served by a main-only row is refused"
OUT=$(run_dry newer --repo owner/newer); RC=$?
[ "$RC" = 1 ] || fail "must refuse (rc=$RC): $OUT"
grep -q "already served by another entry" <<<"$OUT" || fail "must name the conflict: $OUT"
ok "hostname conflicts are checked across both registers"

echo
echo "a private repo gets the box address too, not only the key"
# Free-plan orgs give org variables to PUBLIC repos only; Loki provisions
# private by default. Farmhouse (2026-09-26) had the key and no HETZNER_IP,
# so every Deploy failed. Registration must set it on the repo.
OUT=$(run_dry fresh-site2 --repo owner/fresh-site2)
grep -q "gh variable set HETZNER_IP --repo owner/fresh-site2" <<<"$OUT" \
  || fail "registration must set HETZNER_IP on the repo: $OUT"
grep -q 'gh variable set HETZNER_IP --repo' "$HERE/new-site.sh" \
  || fail "new-site.sh must set HETZNER_IP on the repo too"
ok "register-site and new-site both set HETZNER_IP on the repo"

echo
echo "a port something already listens on is skipped, even if no register row claims it"
# annushka's API held 4030 with no row; probe-loop2 got 4030 and crash-looped.
OUT=$(BOX_LISTENING_PORTS="22 443 4031 4032" run_dry fresh-site3 --repo owner/fresh-site3)
grep -q "port 4033" <<<"$OUT" || fail "must skip ports in use on the box (expected 4033): $OUT"
grep -q "port 4031 is already in use on the box" <<<"$OUT" || fail "must say why a port was skipped: $OUT"
ok "ports in use on the box are skipped, and the skip is said out loud"

echo
echo "sync-infra's unit heredoc is unquoted, so a backtick anywhere in it would run here"
grep -q '`' "$HERE/sync-infra.sh" && fail "sync-infra.sh contains a backtick (command substitution inside the unit heredoc)"
ok "sync-infra.sh has no backticks"

echo
echo "OK: $PASSED passed"
