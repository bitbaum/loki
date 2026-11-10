#!/usr/bin/env bash
#
# Tests for the CI gate's verdict — the rule that decides whether a commit is
# allowed to reach production.
#
# This rule had been wrong three times before it had a single test, and each
# bug was found the same way: a real deploy blocked, a human digging through
# Actions logs to learn that the gate had misread them.
#
#   1. Dependabot's updater run counted as CI, so solon and reparaturbonus-zh
#      could not deploy commits whose `verify` was green.
#   2. The deploy workflow counted itself, so a retry after a failed deploy
#      read its own earlier failure as a red and could never succeed.
#   3. A cancelled run outvoted the green RE-RUN that replaced it on the same
#      SHA, so printcraft's storage-security fix sat undeployed while `verify`
#      passed.
#
# All three are cases where the gate said RED about code that was fine. That is
# the dangerous direction for a gate to be wrong in, because the only way past
# a gate that will not open is to disable it. So each is pinned here.
#
# The opposite direction is pinned too: every "must block" case below exists so
# a future simplification cannot make the gate permissive to buy convenience.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/ci-gate.sh"

PASS=0; FAIL=0
ok() { printf '  ✓ %s\n' "$1"; PASS=$((PASS + 1)); }
no() { printf '  ✗ %s\n' "$1"; FAIL=$((FAIL + 1)); }

export CI_GATE_LIB_ONLY=1
# shellcheck source=/dev/null
source "$GATE" owner/repo deadbeef
unset CI_GATE_LIB_ONLY

# run <path> <run_number> <status> <conclusion> [event, default push]
run() {
  printf '{"path":"%s","run_number":%s,"status":"%s","conclusion":%s,"event":"%s"}' \
    "$1" "$2" "$3" "$([ "$4" = "null" ] && echo null || echo "\"$4\"")" "${5:-push}"
}
runs() { local IFS=,; echo "[$*]"; }

expect() {
  local desc="$1" want="$2" exclude="$3" json="$4"
  local got; got="$(printf '%s' "$json" | ci_verdict "$exclude" | cut -d' ' -f1)"
  [ "$got" = "$want" ] && ok "$desc" || no "$desc (want $want, got $got)"
}

CI='.github/workflows/ci.yml'
DEPLOY='.github/workflows/deploy.yml'
SWEEP='.github/workflows/sweep.yml'
DEPENDABOT='dynamic/dependabot/dependabot-updates'

echo "the verdict rule:"

expect "one green workflow is green" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)")"

expect "a genuine failure blocks" FAILED "" \
  "$(runs "$(run "$CI" 1 completed failure)")"

expect "a timeout blocks — it is not a cancellation" FAILED "" \
  "$(runs "$(run "$CI" 1 completed timed_out)")"

expect "an unfinished workflow is pending, not green" PENDING "" \
  "$(runs "$(run "$CI" 1 in_progress null)")"

expect "no runs at all means no CI is defined" NONE "" "[]"

expect "green only when EVERY workflow is green" FAILED "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$SWEEP" 1 completed failure)")"

echo
echo "regressions — each of these once blocked a real deploy:"

# Bug 3, the one that blocked printcraft's security fix today.
expect "a green re-run replaces the cancelled attempt it superseded" GREEN "" \
  "$(runs "$(run "$CI" 1 completed cancelled)" "$(run "$CI" 2 completed success)")"

expect "...and the cancellation is judged by recency, not list order" GREEN "" \
  "$(runs "$(run "$CI" 2 completed success)" "$(run "$CI" 1 completed cancelled)")"

# The inverse must still hold, or "latest wins" would be a way to launder a red.
expect "a cancellation AFTER a green run is not laundered by the earlier pass" CANCELLED "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$CI" 2 completed cancelled)")"

expect "a failing re-run overrides an earlier pass" FAILED "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$CI" 2 completed failure)")"

# Bug 2 — the deploy workflow reading its own earlier failure as red.
expect "the deploy workflow does not count itself as CI" GREEN "$DEPLOY" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$DEPLOY" 1 completed failure)")"

expect "excluding deploy does not excuse a real CI failure" FAILED "$DEPLOY" \
  "$(runs "$(run "$CI" 1 completed failure)" "$(run "$DEPLOY" 1 completed failure)")"

# Bug 1 — dependabot's updater is not a statement about the code.
expect "a failed dependabot update is not a red CI" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$DEPENDABOT" 1 completed failure)")"

expect "excluding non-workflow runs cannot manufacture a pass from nothing" NONE "" \
  "$(runs "$(run "$DEPENDABOT" 1 completed success)")"

# Bug 4 — a data load dispatched on main's SHA failed, and the commit could not deploy.
LOAD='.github/workflows/law-text.yml'
expect "a failed hand-started run is not a red CI" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$LOAD" 21 completed failure workflow_dispatch)")"

expect "a failed scheduled run is not a red CI" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$LOAD" 22 completed failure schedule)")"

expect "a hand-started run cannot outvote the push run's red" FAILED "" \
  "$(runs "$(run "$CI" 1 completed failure)" "$(run "$CI" 2 completed success workflow_dispatch)")"

# Bug 5 — the auto-merge sweep (workflow_run) runs on main's SHA after every PR's
# CI, so it was always pending somewhere and held deploys for minutes at a time.
SWEEP='.github/workflows/auto-merge.yml'
expect "a running sweep does not hold the gate" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$SWEEP" 40 in_progress null workflow_run)")"

expect "a failed chained data job is not a red CI" GREEN "" \
  "$(runs "$(run "$CI" 1 completed success)" "$(run "$LOAD" 23 completed failure workflow_run)")"

expect "a chained run cannot outvote the push run's red" FAILED "" \
  "$(runs "$(run "$CI" 1 completed failure)" "$(run "$SWEEP" 41 completed success workflow_run)")"

expect "a pending push run still holds the gate" PENDING "" \
  "$(runs "$(run "$CI" 1 in_progress null)" "$(run "$SWEEP" 42 completed success workflow_run)")"

# Cancellation still has to survive as a signal — it is how a superseded commit
# bows out with exit 3 instead of deploying stale code.
expect "an unreplaced cancellation is still reported as cancelled" CANCELLED "" \
  "$(runs "$(run "$CI" 1 completed cancelled)")"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
