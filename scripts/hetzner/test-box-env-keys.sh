#!/usr/bin/env bash
# Tests for box-env-keys.sh, its remote half run locally (no box, no network).
#
# What must hold:
#   - only the listed names are written, and only when GitHub holds a value;
#   - a name GitHub does not hold leaves the box's line alone;
#   - a changed value replaces the old line (one line per name, never two);
#   - every value reads back exactly through bash `source`, including quotes,
#     spaces and a PEM key's newlines (stored as literal \n);
#   - no value is ever printed;
#   - a re-run with the same values changes nothing and restarts nothing.
#
# Run: bash scripts/hetzner/test-box-env-keys.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\nexec bash -s\n' > "$TMP/bin/ssh"
cat > "$TMP/bin/systemctl" <<STUB
#!/usr/bin/env bash
case "\$1" in is-active) exit 0 ;; esac
exit 0
STUB
printf '#!/usr/bin/env bash\n[ "$1" = systemctl ] && [ "$2" = restart ] && echo "$3" >> "%s"\nexit 0\n' "$TMP/restarts" > "$TMP/bin/sudo"
chmod +x "$TMP/bin/ssh" "$TMP/bin/systemctl" "$TMP/bin/sudo"

OPT="$TMP/opt"
ENVF="$OPT/morulia/shared/.env"
mkdir -p "$(dirname "$ENVF")"
printf 'SIGNIN_URL=https://morulia.orangecat.ch\nGH_CLIENT_ID=old-id\nMICROSOFT_CLIENT_ID=set-by-hand\n' > "$ENVF"

run() { env PATH="$TMP/bin:$PATH" BOX_ENV_KEYS_OPT="$OPT" "$@" bash "$HERE/box-env-keys.sh" morulia \
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GH_CLIENT_ID MICROSOFT_CLIENT_ID APPLE_PRIVATE_KEY 2>&1; }
readback() { ( set -a; source "$ENVF"; printf '%s' "${!1-}" ); }

PEM=$'-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG\nAAAA+/=\n-----END PRIVATE KEY-----'
SECRET="g\$ec'ret with spaces \"and\" \`ticks\`"
OUT="$(run GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com "GOOGLE_CLIENT_SECRET=$SECRET" \
  GH_CLIENT_ID=new-id "APPLE_PRIVATE_KEY=$PEM" UNLISTED_SECRET=nope)" || fail "first run failed: $OUT"

[ "$(readback GOOGLE_CLIENT_ID)" = "123-abc.apps.googleusercontent.com" ] && ok "a plain id is written" || fail "GOOGLE_CLIENT_ID: $(cat "$ENVF")"
[ "$(readback GOOGLE_CLIENT_SECRET)" = "$SECRET" ] && ok "quotes, spaces, \$ and backticks read back exactly through source" || fail "secret round trip: $(readback GOOGLE_CLIENT_SECRET)"
[ "$(readback APPLE_PRIVATE_KEY)" = "${PEM//$'\n'/\\n}" ] && ok "a PEM key is one line with literal \\n" || fail "PEM: $(readback APPLE_PRIVATE_KEY)"
[ "$(readback GH_CLIENT_ID)" = new-id ] && [ "$(grep -c '^GH_CLIENT_ID=' "$ENVF")" = 1 ] \
  && ok "a changed value replaces the old line, one line per name" || fail "GH_CLIENT_ID: $(cat "$ENVF")"
[ "$(readback MICROSOFT_CLIENT_ID)" = set-by-hand ] && grep -q "MICROSOFT_CLIENT_ID.*not in GitHub" <<<"$OUT" \
  && ok "a name GitHub does not hold leaves the box's line alone" || fail "MICROSOFT_CLIENT_ID: $OUT"
! grep -q UNLISTED_SECRET "$ENVF" && ok "a secret that is not listed is never written" || fail "unlisted written"
[ "$(readback SIGNIN_URL)" = "https://morulia.orangecat.ch" ] && ok "other lines are kept" || fail "SIGNIN_URL lost"
for v in 123-abc new-id "BEGIN PRIVATE" "spaces" old-id; do
  grep -q -- "$v" <<<"$OUT" && fail "a value was printed: $v"
done
ok "no value is printed"
grep -q "changed=4" <<<"$OUT" && [ "$(grep -c morulia "$TMP/restarts")" = 1 ] \
  && ok "changes are counted and the app restarted once" || fail "count/restart: $OUT"
[ "$(stat -c %a "$ENVF")" = 600 ] && ok "the env file stays 600" || fail "mode $(stat -c %a "$ENVF")"

OUT2="$(run GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com "GOOGLE_CLIENT_SECRET=$SECRET" \
  GH_CLIENT_ID=new-id "APPLE_PRIVATE_KEY=$PEM")" || fail "re-run failed: $OUT2"
grep -q "changed=0" <<<"$OUT2" && [ "$(grep -c morulia "$TMP/restarts")" = 1 ] \
  && ok "a re-run with the same values changes and restarts nothing" || fail "re-run: $OUT2"

OUT3="$(run)" || fail "empty run failed: $OUT3"
grep -q "changed=0" <<<"$OUT3" && ok "with no secret in GitHub nothing is touched" || fail "empty: $OUT3"

OUT4="$(env PATH="$TMP/bin:$PATH" BOX_ENV_KEYS_OPT="$OPT" bash "$HERE/box-env-keys.sh" morulia 'bad-name' 2>&1)" && fail "a bad name was accepted"
grep -q "bad variable name" <<<"$OUT4" && ok "a malformed name is refused" || fail "$OUT4"

OUT5="$(env PATH="$TMP/bin:$PATH" BOX_ENV_KEYS_OPT="$OPT" bash "$HERE/box-env-keys.sh" morulia GITHUB_CLIENT_ID 2>&1)" && fail "a GITHUB_-prefixed name was accepted"
grep -q "refuses secret names starting with GITHUB_" <<<"$OUT5" && ok "a GITHUB_-prefixed name is refused" || fail "$OUT5"

echo "box-env-keys: $PASSED checks passed"
