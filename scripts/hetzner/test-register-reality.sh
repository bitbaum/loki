#!/usr/bin/env bash
# Tests for check-register-reality.sh.
#
# The thing it checks lives in the world — live hosts, the box's Caddy dir, the
# box's listening ports — so the world is STUBBED on PATH: a fake `curl` that
# answers from a script, and a fake `ssh` that prints a canned box. That keeps
# every case offline and deterministic while still exercising the real script,
# rather than a reimplementation of it.
#
# Both directions, always: a clean world must pass, and each defect must fail
# AND be named. A drift check that cannot go red is decoration.
#
# Run: bash scripts/hetzner/test-register-reality.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../ci/check-register-reality.sh"
TMP="$(mktemp -d)"
[ -n "$TMP" ] && [ -d "$TMP" ] || { echo "  ✗ mktemp failed" >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

mkdir -p "$TMP/bin"
# Fake curl: -w '%{url_effective}' prints the mapped host, '%{http_code}' prints
# 200. The mapping lives in $TMP/redirects as "from to"; anything unmapped
# resolves to itself.
cat > "$TMP/bin/curl" <<'CURL'
#!/usr/bin/env bash
url=""; want=""
for a in "$@"; do
  case "$prev" in -w) want="$a" ;; esac
  case "$a" in https://*) url="$a" ;; esac
  prev="$a"
done
host="${url#https://}"; host="${host%%/*}"
to=$(awk -v h="$host" '$1==h{print $2}' "$REDIRECTS" 2>/dev/null)
[ -n "$to" ] || to="$host"
case "$want" in
  *url_effective*) printf 'https://%s/' "$to" ;;
  *http_code*)     printf '200' ;;
esac
CURL
# Fake ssh: prints the canned box inventory, ignoring every flag.
cat > "$TMP/bin/ssh" <<'SSH'
#!/usr/bin/env bash
cat "$BOXOUT" 2>/dev/null
SSH
chmod +x "$TMP/bin/curl" "$TMP/bin/ssh"
export PATH="$TMP/bin:$PATH"
export REDIRECTS="$TMP/redirects" BOXOUT="$TMP/boxout"

CONF="$TMP/apps.conf"
ALLOW="$TMP/allow"
run() { ALLOW_FILE="$ALLOW" bash "$GATE" --manifest "$CONF" 2>&1; }

reset() {
  cat > "$CONF" <<'EOF'
alpha|4010|alpha.orangecat.ch|/nonexistent|.|-|bitbaum|product|live|-|-|-
beta|4011|beta.orangecat.ch|/nonexistent|.|-|SomeGmbH|client-app|live|favour|0|-
EOF
  : > "$REDIRECTS"
  : > "$ALLOW"
  printf 'alpha.caddy\nbeta.caddy\n---PORTS---\n127.0.0.1:4010\n127.0.0.1:4011\n' > "$BOXOUT"
}

echo "register vs reality"

reset
OUT=$(run); RC=$?
[ "$RC" = 0 ] || fail "a consistent world must pass (rc=$RC): $OUT"
grep -q "all 2 registered hosts serve themselves" <<<"$OUT" || fail "got: $OUT"
ok "a register that matches the world passes"

# --- a registered domain that only redirects ------------------------------
reset
echo "alpha.orangecat.ch alpha-new.orangecat.ch" > "$REDIRECTS"
OUT=$(run); RC=$?
[ "$RC" = 1 ] || fail "a redirecting domain must fail (rc=$RC): $OUT"
grep -q "alpha" <<<"$OUT" || fail "must name the app: $OUT"
grep -q "alpha-new.orangecat.ch" <<<"$OUT" || fail "must name where it actually goes: $OUT"
ok "a registered host that only redirects goes RED, naming both hosts (aoz's exact shape)"

# --- a vhost with no row ---------------------------------------------------
reset
printf 'alpha.caddy\nbeta.caddy\nmystery.caddy\n---PORTS---\n127.0.0.1:4010\n' > "$BOXOUT"
OUT=$(run); RC=$?
[ "$RC" = 1 ] || fail "an unbacked vhost must fail (rc=$RC): $OUT"
grep -q "mystery" <<<"$OUT" || fail "must name the vhost: $OUT"
ok "a Caddy site with no register row goes RED"

# --- ...unless it is a recorded exception ----------------------------------
reset
printf 'alpha.caddy\nbeta.caddy\nmystery.caddy\n---PORTS---\n127.0.0.1:4010\n' > "$BOXOUT"
echo 'vhost|mystery|Deliberate: a hand-written redirect sync-infra must not regenerate.' > "$ALLOW"
OUT=$(run); RC=$?
[ "$RC" = 0 ] || fail "an allowed vhost must pass (rc=$RC): $OUT"
ok "an exception WITH a reason is accepted (a decision, not a silence)"

# --- a port nothing registered holds ---------------------------------------
reset
printf 'alpha.caddy\nbeta.caddy\n---PORTS---\n127.0.0.1:4010\n127.0.0.1:4030\n' > "$BOXOUT"
OUT=$(run); RC=$?
[ "$RC" = 1 ] || fail "an unregistered listener must fail (rc=$RC): $OUT"
grep -q "4030" <<<"$OUT" || fail "must name the port: $OUT"
ok "an unregistered listener in the app band goes RED (annushka's exact shape)"

reset
printf 'alpha.caddy\nbeta.caddy\n---PORTS---\n127.0.0.1:4030\n' > "$BOXOUT"
echo 'port|4030|Deliberate: annushka enquiry API.' > "$ALLOW"
OUT=$(run); RC=$?
[ "$RC" = 0 ] || fail "an allowed port must pass (rc=$RC): $OUT"
ok "an allowed port is accepted"

# --- outside the band is none of our business ------------------------------
reset
printf 'alpha.caddy\nbeta.caddy\n---PORTS---\n127.0.0.1:22\n127.0.0.1:5432\n127.0.0.1:8080\n' > "$BOXOUT"
OUT=$(run); RC=$?
[ "$RC" = 0 ] || fail "ports outside 4000-4099 must be ignored (rc=$RC): $OUT"
ok "listeners outside the app band are ignored (ssh, postgres, whatever else)"

# --- could not look != nothing to see --------------------------------------
reset
: > "$BOXOUT"
OUT=$(run); RC=$?
[ "$RC" = 0 ] || fail "an unreachable box must not fail the check (rc=$RC): $OUT"
grep -q "NOT RUN" <<<"$OUT" || fail "must ANNOUNCE that it could not look: $OUT"
if grep -q "every Caddy site is either registered" <<<"$OUT"; then
  fail "must not claim the vhosts passed when it never read them: $OUT"
fi
ok "an unreachable box is announced, never reported as clean"

reset
OUT=$(ALLOW_FILE="$ALLOW" bash "$GATE" --no-box --manifest "$CONF" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "--no-box must pass on a clean register (rc=$RC): $OUT"
grep -q "SKIPPED" <<<"$OUT" || fail "--no-box must say it skipped: $OUT"
ok "--no-box says so out loud"

# --- a redirect still fails even when the box cannot be read ----------------
reset
echo "beta.orangecat.ch beta-old.orangecat.ch" > "$REDIRECTS"
: > "$BOXOUT"
OUT=$(run); RC=$?
[ "$RC" = 1 ] || fail "the domain finding must survive an unreachable box (rc=$RC): $OUT"
ok "a domain finding is not swallowed by the box being unreachable"

echo "  $PASSED passed"
