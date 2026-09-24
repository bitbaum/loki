#!/usr/bin/env bash
# Tests for the client-ledger gate (scripts/ci/check-client-ledger.sh).
#
# WHY THIS EXISTS AT ALL
#
# A ratchet that can never fail is indistinguishable from no ratchet, and this
# fleet has shipped that exact thing: a baseline file resolved to the wrong
# directory, so the gate read a missing file, fell back to the current count and
# reported "at baseline" for every value forever. Green, permanently, by
# construction — and nothing noticed, because a gate that always passes looks
# exactly like a gate with nothing to report.
#
# So this gate is proved by MUTATION, in both directions: a register that
# regresses must go RED, and a register that improves must go green while saying
# so. A test that only ever runs the real register proves the gate can parse a
# file, which was never the thing in doubt.
#
# Every case mutates a COPY. Nothing here writes to scripts/hetzner/apps.conf —
# a mutation test that edits the real register ships the mutation. The last case
# asserts that, by checksum, rather than trusting the sentence above.
#
# No network, no box. Run: pnpm run test:client-ledger-gate

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_SRC="$SCRIPT_DIR/.."
REAL_CONF="$SCRIPTS_SRC/hetzner/apps.conf"
REAL_SUM_BEFORE="$(cksum < "$REAL_CONF")"
TMP="$(mktemp -d)"
[ -n "$TMP" ] && [ -d "$TMP" ] || { echo "  ✗ mktemp -d produced no usable dir" >&2; exit 1; }
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

# Both paths are deterministic, so they are constants rather than something
# fixture() hands back. The first version echoed the gate path and assigned CONF
# inside the function, but a command substitution runs the function in a
# SUBSHELL — so CONF was set in a process that had exited before any case read it.
GATE="$TMP/scripts/ci/check-client-ledger.sh"
CONF="$TMP/scripts/hetzner/apps.conf"

# A pristine copy per case. `cp -r a b` NESTS when b already exists, which would
# silently make one case re-run the previous case's register while reporting a
# pass — so the destination is removed first, every time.
fixture() {
  rm -rf "$TMP/scripts"
  cp -r "$SCRIPTS_SRC" "$TMP/scripts"
}
add_row() { printf '%s\n' "$1" >> "$CONF"; }
# Give one named app terms, by rewriting only its own line: the first nine
# fields are kept verbatim and the plan/price pair after them is filled.
give_terms() {
  sed -i "s#^\($1|[^|]*|[^|]*|[^|]*|[^|]*|[^|]*|[^|]*|[^|]*|[^|]*\)|-|-|#\1|retainer|CHF 250/mo|#" "$CONF"
}

echo "client-ledger gate"

# --- the register as committed -------------------------------------------
# Asserted against whatever it currently holds, NOT against a hardcoded count.
# The first version of this file pinned "at baseline" and "a baseline of 4", so
# recording real terms — the outcome the gate exists to produce — broke its own
# test suite. A test that fails when the thing it guards SUCCEEDS is measuring
# the fleet's commercial state, not the gate. The ratchet cases below build
# their own registers for the same reason.
fixture
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "the committed register must pass its own baseline (rc=$RC): $OUT"
grep -qE "client ledger: (all [0-9]+|[0-9]+ of [0-9]+)" <<<"$OUT" \
  || fail "the committed register must produce a verdict, got: $OUT"
ok "the register as committed passes its own baseline"

# --- a NEW live client engagement without terms is a regression ----------
fixture
add_row "newclient|4099|newclient.orangecat.ch|/nonexistent/dev/newclient|.|-|SomeGmbH|client-app|live|-|-|-"
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 1 ] || fail "one more live client without terms must fail the gate (rc=$RC): $OUT"
grep -qE "up from a baseline of [0-9]+" <<<"$OUT" || fail "must name the baseline it rose from, got: $OUT"
grep -q "newclient" <<<"$OUT" || fail "must name the offending app, got: $OUT"
ok "a new live client engagement without terms goes RED"

# --- the same row WITH terms is fine -------------------------------------
fixture
add_row "newclient|4099|newclient.orangecat.ch|/nonexistent/dev/newclient|.|-|SomeGmbH|client-app|live|retainer|CHF 250/mo|2026-09-08"
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "a new live client WITH terms must pass (rc=$RC): $OUT"
ok "the same engagement with terms recorded passes"

# --- the predicate is narrow: products are never counted -----------------
fixture
add_row "someproduct|4098|someproduct.orangecat.ch|/nonexistent/dev/someproduct|.|-|bitbaum|product|live|-|-|-"
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "a product with no terms must NOT be counted (rc=$RC): $OUT"
if grep -q "someproduct" <<<"$OUT"; then
  fail "a product must not appear in the ledger at all: $OUT"
fi
ok "products we own are never counted — nobody invoices themselves"

# --- a non-live client engagement is deferred, and ANNOUNCED -------------
fixture
OUT=$("$GATE" 2>&1)
grep -q "not yet counted" <<<"$OUT" || fail "near-misses must be announced, got: $OUT"
grep -q "printcraft:prospect" <<<"$OUT" || fail "a prospect must be named as deferred, got: $OUT"
ok "prospects are deferred but announced, never silently dropped"

# --- an improvement passes AND says how to bank it -----------------------
# Its own register and its own baseline, so this keeps testing the DIRECTION of
# the ratchet no matter what the real fleet is charging today. Two unpriced live
# clients against a baseline of 2; give one terms and the count must fall to 1.
fixture
cat > "$CONF" <<'EOF'
alpha|4090|alpha.orangecat.ch|/nonexistent/dev/alpha|.|-|AlphaGmbH|client-app|live|-|-|-
beta|4091|beta.orangecat.ch|/nonexistent/dev/beta|.|-|BetaAG|client-site|live|-|-|-
EOF
echo 2 > "$TMP/scripts/ci/client-ledger.baseline"
give_terms alpha
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "recording terms must not fail the gate (rc=$RC): $OUT"
grep -q "down from a baseline of 2" <<<"$OUT" || fail "an improvement must state the old baseline, got: $OUT"
grep -q "echo 1 >" <<<"$OUT" || fail "must print the exact command to lower the baseline, got: $OUT"
ok "recording terms lowers the count and prints how to bank it"

# --- the fully-recorded end state ----------------------------------------
fixture
cat > "$CONF" <<'EOF'
alpha|4090|alpha.orangecat.ch|/nonexistent/dev/alpha|.|-|AlphaGmbH|client-app|live|-|-|-
beta|4091|beta.orangecat.ch|/nonexistent/dev/beta|.|-|BetaAG|client-site|live|-|-|-
EOF
echo 2 > "$TMP/scripts/ci/client-ledger.baseline"
give_terms alpha; give_terms beta
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "a fully recorded ledger must pass (rc=$RC): $OUT"
grep -q "all 2 live client engagement(s) have recorded terms" <<<"$OUT" \
  || fail "the goal state must be stated plainly, got: $OUT"
grep -q "echo 0 >" <<<"$OUT" || fail "reaching zero must still say how to bank it, got: $OUT"
ok "the goal state — every live engagement priced — reports clean"

# --- 'favour|0' is a recorded answer, not an empty one -------------------
# The real register uses it: George confirmed on 2026-09-10 that all four live
# engagements are unpaid on purpose. The gate must treat that as SETTLED, or
# recording the truth would look identical to never having asked.
fixture
cat > "$CONF" <<'EOF'
gratis|4092|gratis.orangecat.ch|/nonexistent/dev/gratis|.|-|SomeClient|client-site|live|favour|0|2026-09-10
EOF
echo 0 > "$TMP/scripts/ci/client-ledger.baseline"
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "favour|0 must count as recorded terms (rc=$RC): $OUT"
grep -q "all 1 live client engagement(s) have recorded terms" <<<"$OUT" \
  || fail "favour|0 must read as settled, not missing: $OUT"
ok "'favour|0' counts as recorded — unpaid ON PURPOSE is an answer"

# --- a register with NOTHING to announce ---------------------------------
#
# The two trailing announcements are `[ -n "$x" ] && echo ...`, and the real
# register always has something to put in both — so every case above exercises
# only the true branch. Under `set -e` a false leading test is exactly the shape
# that can end a script early, and the failure would be invisible: the gate would
# stop before its final verdict, on the register that has nothing wrong with it.
# So the empty case gets its own minimal register.
fixture
cat > "$CONF" <<'EOF'
# minimal register: nothing deferred, no guessed owners
someproduct|4098|someproduct.orangecat.ch|/nonexistent/dev/someproduct|.|-|bitbaum|product|live|-|-|-
goodclient|4097|goodclient.orangecat.ch|/nonexistent/dev/goodclient|.|-|SomeGmbH|client-app|live|retainer|CHF 250/mo|2026-09-08
EOF
OUT=$("$GATE" 2>&1); RC=$?
[ "$RC" = 0 ] || fail "a register with nothing to announce must still pass (rc=$RC): $OUT"
grep -q "all 1 live client engagement(s) have recorded terms" <<<"$OUT" \
  || fail "the gate must reach its verdict with both announcements empty, got: $OUT"
if grep -q "not yet counted" <<<"$OUT"; then
  fail "nothing is deferred here; the line must not print: $OUT"
fi
ok "a register with nothing to announce still reaches its verdict"

# --- the scaffold refuses the same thing, EARLIER ------------------------
#
# The rule lives in two places on purpose: CI rejects a bad row, and new-site.sh
# rejects it before the repo exists, because by the time CI has an opinion the
# site is created, pushed and serving. Both are asserted here — one rule, one
# test file. Every case below exits at argument validation, before the scaffold
# touches a repo, the box, or the network.
NEW_SITE="$TMP/scripts/hetzner/new-site.sh"

fixture
OUT=$("$NEW_SITE" probe-slug --kind client-site --status live --dry-run 2>&1); RC=$?
[ "$RC" = 2 ] || fail "live client work without terms must be refused by the scaffold (rc=$RC): $OUT"
grep -q "needs --plan and --price" <<<"$OUT" || fail "the refusal must say what is missing, got: $OUT"
grep -q "check-client-ledger.sh" <<<"$OUT" || fail "the refusal must name the gate it front-runs, got: $OUT"
ok "the scaffold refuses live client work with no terms, before creating anything"

# Past the guard, the next refusal is about the slug — which is how we know the
# guard let it through without having to let the scaffold actually build a site.
fixture
OUT=$("$NEW_SITE" sink --kind client-site --status live --plan retainer --price "CHF 250/mo" --dry-run 2>&1); RC=$?
[ "$RC" = 1 ] || fail "with terms, the scaffold must get past the guard (rc=$RC): $OUT"
grep -q "already in" <<<"$OUT" || fail "expected the duplicate-slug refusal, got: $OUT"
ok "the same command with terms passes the guard"

fixture
OUT=$("$NEW_SITE" sink --kind client-site --status prospect --dry-run 2>&1); RC=$?
[ "$RC" = 1 ] || fail "a prospect must not be asked for terms (rc=$RC): $OUT"
grep -q "already in" <<<"$OUT" || fail "expected the duplicate-slug refusal, got: $OUT"
ok "a prospect is never asked for terms — '-' is honest there"

# --- the real register is never written to -------------------------------
[ "$(cksum < "$REAL_CONF")" = "$REAL_SUM_BEFORE" ] \
  || fail "scripts/hetzner/apps.conf was modified by a test run"
ok "the real register is byte-identical after every case above"

echo "  $PASSED passed"
