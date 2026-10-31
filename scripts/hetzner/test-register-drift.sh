#!/usr/bin/env bash
# Tests for register-drift.sh: a row only the box knows, or one that differs,
# fails; a row only main knows warns; agreement passes; comments are ignored.
#
# Run: bash scripts/hetzner/test-register-drift.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }
run()  { bash "$HERE/register-drift.sh" "$TMP/box" "$TMP/main" > "$TMP/out" 2>&1; }

A='a|4010|a.example|/x/a|.|a|bitbaum|product|live|-|-|-'
B='biaslens|4038|biaslens.example|/x/b|.|-|bitbaum|product|validating|-|-|-'
S='signin|4038|signin.example|/x/s|.|signin|bitbaum|infra|prospect|-|-|-'

printf '# header\n%s\n' "$A" > "$TMP/box";  printf '%s\n\n# other comment\n' "$A" > "$TMP/main"
run && grep -q 'none' "$TMP/out" && ok "same rows, different comments: no drift" || fail "agreement reported as drift: $(cat "$TMP/out")"

printf '%s\n%s\n' "$A" "$B" > "$TMP/box"; printf '%s\n%s\n' "$A" "$S" > "$TMP/main"
if run; then fail "a box-only row passed"; fi
grep -q '^box-only: biaslens (port 4038)' "$TMP/out" && ok "a box-only row fails, by name and port" || fail "box-only not named: $(cat "$TMP/out")"
grep -q '^main-only (box checkout lags): signin (port 4038)' "$TMP/out" && ok "a main-only row is reported as lag" || fail "main-only not named"

printf '%s\n' "$A" > "$TMP/box"; printf '%s\n%s\n' "$A" "$S" > "$TMP/main"
run && ok "main-only alone warns, does not fail" || fail "main-only failed the run"

printf '%s\n' "${S/4038/4040}" > "$TMP/box"; printf '%s\n' "$S" > "$TMP/main"
if run; then fail "a differing row passed"; fi
grep -q '^differs:  signin (box port 4040, main port 4038' "$TMP/out" && ok "a differing row fails, both ports named" || fail "differs not named: $(cat "$TMP/out")"

W="$HERE/../../.github/workflows/register-drift.yml"
grep -q 'bash scripts/hetzner/register-drift.sh "$RUNNER_TEMP/box-apps.conf" scripts/hetzner/apps.conf' "$W" \
  && grep -q 'schedule:' "$W" && ok "the workflow runs the rule on a schedule against main's register" || fail "workflow wiring"

echo "register-drift: $PASSED passed"
