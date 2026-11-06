#!/usr/bin/env bash
# Tests for box-register-follow.sh against throwaway git repositories (no box,
# no network): a stale register follows main; a box-only row, a local commit,
# a change outside apps.conf and a branch other than main each refuse and
# change nothing; a dry run changes nothing; and the workflow's wiring.
#
# Run: bash scripts/hetzner/test-box-register-follow.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# Run from the husky pre-push hook, the inherited GIT_DIR turned `git init "$U"`
# into the REAL repo: commits "one"/"two" landed on the pushing branch, emptied
# its tree, and core.bare=true reached the shared .git/config (2026-11-06).
source "$HERE/../test/lib/git-fixture-env.sh"
export TMPDIR="$TMP" HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0=init.defaultBranch GIT_CONFIG_VALUE_0=main
export GIT_CONFIG_KEY_1=advice.detachedHead GIT_CONFIG_VALUE_1=false

PASSED=0
fail() { echo "  ✗ $1" >&2; exit 1; }
ok()   { PASSED=$((PASSED + 1)); echo "  ✓ $1"; }

S="$HERE/box-register-follow.sh"
A='a|4010|a.example|/x/a|.|-|bitbaum|product|live|-|-|-'
B='b|4011|b.example|/x/b|.|b|bitbaum|product|prospect|-|-|-'
C='c|4012|c.example|/x/c|.|-|bitbaum|product|live|-|-|-'

# upstream: commit 1 has a and b (b prospect); commit 2 makes b live and adds c.
U="$TMP/upstream"
git init -q "$U"; mkdir -p "$U/scripts/hetzner"
printf '# header\n%s\n%s\n' "$A" "$B" > "$U/scripts/hetzner/apps.conf"
git -C "$U" add -A; git -C "$U" commit -qm one
printf '# header\n%s\n%s\n%s\n' "$A" "${B/prospect/live}" "$C" > "$U/scripts/hetzner/apps.conf"
git -C "$U" commit -qam two
MAIN="$(git -C "$U" rev-parse HEAD)"

fresh() { # a box checkout at commit one, with the register edited in place
  rm -rf "$TMP/box"; git clone -q "$U" "$TMP/box"; git -C "$TMP/box" reset -q --hard HEAD~1
  printf '%s\n' "$@" > "$TMP/box/scripts/hetzner/apps.conf"
}
follow() { bash "$S" "$TMP/box" "$1" "$U" > "$TMP/out" 2>&1; }
at_main() { [ "$(git -C "$TMP/box" rev-parse HEAD)" = "$MAIN" ]; }

fresh '# header' "$A" "$B"
follow 0 || fail "dry run failed: $(cat "$TMP/out")"
! at_main && grep -q 'DRY RUN' "$TMP/out" && grep -q '1 commit(s) to fast-forward' "$TMP/out" \
  && ok "a dry run plans the fast-forward and changes nothing" || fail "dry run: $(cat "$TMP/out")"
grep -q '^  b$' "$TMP/out" && grep -A1 'will gain' "$TMP/out" | grep -q '^  c$' \
  && ok "it names the row taking main's value and the row the box gains" || fail "plan names: $(cat "$TMP/out")"

follow 1 || fail "follow failed: $(cat "$TMP/out")"
at_main && [ -z "$(git -C "$TMP/box" status --porcelain --untracked-files=no)" ] && [ -f "$HOME/.apps.conf.before-follow" ] \
  && ok "go fast-forwards to main, the register is main's, the old one is kept" || fail "follow: $(cat "$TMP/out")"

fresh '# header' "$A" "$B" 'orangecat-2|4035|o.example|/x/o|.|-|bitbaum|client-site|prospect|-|-|-'
if follow 1; then fail "a box-only row was followed over"; fi
! at_main && grep -q '^  orangecat-2$' "$TMP/out" && grep -q 'orangecat-2' "$TMP/box/scripts/hetzner/apps.conf" \
  && ok "a row main lacks refuses, by name, and is left in place" || fail "box-only: $(cat "$TMP/out")"

fresh '# header' "$A" "$B"
echo x > "$TMP/box/README"; git -C "$TMP/box" add README; git -C "$TMP/box" commit -qm local
if follow 1; then fail "a local commit was overrun"; fi
grep -q 'not a fast-forward' "$TMP/out" && ok "a commit main does not have refuses" || fail "local commit: $(cat "$TMP/out")"

fresh '# header' "$A" "$B"
echo x > "$TMP/box/scripts/hetzner/other.sh"; git -C "$TMP/box" add scripts/hetzner/other.sh
if follow 1; then fail "a change outside apps.conf was overrun"; fi
grep -q 'scripts/hetzner/other.sh' "$TMP/out" && ok "a change outside apps.conf refuses, by path" || fail "dirty: $(cat "$TMP/out")"

fresh '# header' "$A" "$B"; git -C "$TMP/box" checkout -qb side
if follow 1; then fail "a branch other than main was followed"; fi
grep -q "not main" "$TMP/out" && ok "a checkout on another branch refuses" || fail "branch: $(cat "$TMP/out")"

# The box's checkout is a shallow clone: its HEAD and main share history only
# once the fetch is deepened past HEAD.
for k in 1 2 3; do echo "$k" > "$U/f$k"; git -C "$U" add "f$k"; GIT_COMMITTER_DATE="2030-01-0$k" git -C "$U" commit -qm "more $k"; done
MAIN="$(git -C "$U" rev-parse HEAD)"
rm -rf "$TMP/box"; git clone -q --depth 1 "file://$U" "$TMP/box"
git -C "$TMP/box" fetch -q --depth 1 "file://$U" "$(git -C "$U" rev-parse HEAD~4)" 2>/dev/null
git -C "$TMP/box" reset -q --hard "$(git -C "$U" rev-parse HEAD~4)"
[ "$(git -C "$TMP/box" rev-parse --is-shallow-repository)" = true ] || fail "fixture is not shallow"
bash "$S" "$TMP/box" 1 "file://$U" > "$TMP/out" 2>&1 || fail "shallow follow refused: $(cat "$TMP/out")"
at_main && ok "a shallow checkout behind main is deepened and fast-forwarded" || fail "shallow: $(cat "$TMP/out")"

W="$ROOT/.github/workflows/box-register.yml"
grep -q 'bash -s -- "$BOX_LOKI" "$go" < scripts/hetzner/box-register-follow.sh' "$W" && grep -q 'default: false' "$W" \
  && ok "the workflow sends the script to the box, plan by default" || fail "workflow wiring"
grep -q '^  group: deploy-prod$' "$W" && ! grep -qE '^\s+(push|schedule|pull_request):' "$W" \
  && ok "dispatch only, never alongside a registration or deploy" || fail "workflow triggers or concurrency"

echo "box-register-follow: $PASSED passed"
