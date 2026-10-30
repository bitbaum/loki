#!/usr/bin/env bash
# Tests for app-secrets.sh, its remote half run locally (no box, no network).
#
# What must hold, because the values are ones nobody can recover:
#   - a value already in a file is never replaced, on any re-run;
#   - a pair (signin's SIGNIN_CLIENT_SECRET_<ID> = the app's SIGNIN_CLIENT_SECRET)
#     ends up EQUAL in both files, whichever side had it first;
#   - two different values are reported, never "fixed";
#   - no value is ever printed.
#
# `ssh` and `systemctl` are stubbed on PATH: ssh runs the heredoc with local
# bash, and APP_SECRETS_OPT points the remote half at a temp dir for /opt.
#
# Run: bash scripts/hetzner/test-app-secrets.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\nexec bash -s\n' > "$TMP/bin/ssh"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/bin/systemctl"   # no units yet
chmod +x "$TMP/bin/ssh" "$TMP/bin/systemctl"

OPT="$TMP/opt"
run() { PATH="$TMP/bin:$PATH" APP_SECRETS_OPT="$OPT" bash "$HERE/app-secrets.sh" "$@" 2>&1; }
val() { grep -E "^$1=" "$2" | tail -n 1 | cut -d= -f2-; }
count() { grep -cE "^$1=" "$2" || true; }

S="$OPT/signin/shared/.env"
for a in signin causius diplodoctor heidi revamp-info solon substrata; do
  mkdir -p "$OPT/$a/shared"; : > "$OPT/$a/shared/.env"
done
# biaslens has no env on this "box": its pair must be skipped, not half-written.
# heidi already holds a client secret; solon holds one that disagrees with signin.
echo "SIGNIN_CLIENT_SECRET=heidi-existing-value-0123456789abcdef0123" >> "$OPT/heidi/shared/.env"
echo "SIGNIN_CLIENT_SECRET=solon-side-value-0123456789abcdef01234567" >> "$OPT/solon/shared/.env"
echo "SIGNIN_CLIENT_SECRET_SOLON=signin-side-value-0123456789abcdef012345" >> "$S"
echo "BETTER_AUTH_SECRET=from-provision-db-0123456789abcdef0123456789" >> "$S"

OUT="$(run ensure signin)" || fail "ensure signin failed: $OUT"

[ "$(val SIGNIN_URL "$S")" = "https://signin.orangecat.ch" ] && ok "SIGNIN_URL is the issuer, no trailing slash" || fail "SIGNIN_URL: $(val SIGNIN_URL "$S")"
[ "$(val BETTER_AUTH_SECRET "$S")" = "from-provision-db-0123456789abcdef0123456789" ] && [ "$(count BETTER_AUTH_SECRET "$S")" = 1 ] \
  && ok "an existing BETTER_AUTH_SECRET is kept, not duplicated" || fail "BETTER_AUTH_SECRET was touched"
[[ "$(val SIGNIN_PAIRWISE_SECRET "$S")" =~ ^[0-9a-f]{64}$ ]] && ok "SIGNIN_PAIRWISE_SECRET generated (64 hex)" || fail "no pairwise secret"

c="$(val SIGNIN_CLIENT_SECRET_CAUSIUS "$S")"
[[ "$c" =~ ^[0-9a-f]{64}$ ]] && [ "$c" = "$(val SIGNIN_CLIENT_SECRET "$OPT/causius/shared/.env")" ] \
  && ok "neither side set: one value, written to both" || fail "causius pair differs"
[ "$(val SIGNIN_CLIENT_SECRET_HIRNLI "$S")" = "$(val SIGNIN_CLIENT_SECRET "$OPT/revamp-info/shared/.env")" ] \
  && ok "the hirnli client's secret lands in revamp-info's env" || fail "hirnli pair differs"
[ "$(val SIGNIN_CLIENT_SECRET_HEIDI "$S")" = "heidi-existing-value-0123456789abcdef0123" ] \
  && [ "$(count SIGNIN_CLIENT_SECRET "$OPT/heidi/shared/.env")" = 1 ] \
  && ok "only the app had it: copied to signin, the app's value untouched" || fail "heidi pair wrong"
[ "$(val SIGNIN_CLIENT_SECRET_SOLON "$S")" = "signin-side-value-0123456789abcdef012345" ] \
  && [ "$(val SIGNIN_CLIENT_SECRET "$OPT/solon/shared/.env")" = "solon-side-value-0123456789abcdef01234567" ] \
  && grep -q "SIGNIN_CLIENT_SECRET_SOLON = solon SIGNIN_CLIENT_SECRET: MISMATCH" <<<"$OUT" \
  && ok "two different values: reported as MISMATCH, neither changed" || fail "solon mismatch handling: $OUT"
! grep -q "SIGNIN_CLIENT_SECRET_BIASLENS" "$S" && grep -q "biaslens has no env file on the box — pair skipped" <<<"$OUT" \
  && ok "an app with no env on the box: skipped, nothing written to either side" || fail "biaslens: $OUT"
grep -q "no signin-app unit yet" <<<"$OUT" && ok "no unit yet: says so instead of failing the restart" || fail "restart: $OUT"

# Nothing that was written may appear in the output.
leaked=""
for f in "$OPT"/*/shared/.env; do
  while IFS= read -r line; do
    v="${line#*=}"
    [ "${#v}" -ge 16 ] && [[ "$v" != https://* ]] && grep -qF -- "$v" <<<"$OUT" && leaked="$leaked ${line%%=*}"
  done < "$f"
done
[ -z "$leaked" ] && ok "no secret value appears in the output" || fail "printed:$leaked"

# A second run changes nothing.
before="$(cat "$OPT"/*/shared/.env | sha256sum)"
OUT2="$(run ensure signin)" || fail "second ensure failed: $OUT2"
[ "$before" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && ok "a re-run writes nothing" || fail "a re-run changed a file"
grep -q "nothing to add for signin" <<<"$OUT2" && ok "a re-run says there was nothing to add" || fail "$OUT2"

# show only reads.
OUT3="$(run show signin)" || fail "show failed"
[ "$before" = "$(cat "$OPT"/*/shared/.env | sha256sum)" ] && grep -q "SIGNIN_PAIRWISE_SECRET *set" <<<"$OUT3" \
  && ok "show reports set/not set and writes nothing" || fail "show: $OUT3"

# The existing apps are unchanged by the new kind.
OUT4="$(run ensure heidi)" || fail "ensure heidi failed: $OUT4"
grep -qE "^CRON_SECRET=[0-9a-f]{64}$" "$OPT/heidi/shared/.env" && grep -qE "^VAPID_PUBLIC_KEY=.+" "$OPT/heidi/shared/.env" \
  && ok "heidi's rows still work (hex32, vapid)" || fail "heidi: $OUT4"

echo "app-secrets: $PASSED passed"
