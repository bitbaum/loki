#!/usr/bin/env bash
# CI gate for push-deploys — deploy only what CI has verified.
#
# WHY: the push-deploy hook used to fire deploy.sh IN PARALLEL with GitHub CI,
# so prod shipped before the CI verdict existed; the only gate was local
# pre-push hooks (bypassable with --no-verify, and different per repo). This
# waits for the pushed commit's own workflow runs and blocks the deploy on a red.
#
# CANCELLED != FAILED. GitHub CI runs with `cancel-in-progress: true`, so a
# second push (a parallel session, a quick follow-up) CANCELS the earlier
# commit's CI run. The earlier code was fine — it was simply superseded. The old
# gate counted `cancelled` as a failure and printed "CI FAILED", blocking a
# deploy that never should have run anyway (the newer commit deploys instead).
# That false-negative cost real re-deploys. Now a cancelled run on a SUPERSEDED
# commit exits 3 (clean skip); only genuine failures block.
#
# Exit codes:
#   0  CI green (or no CI within grace)      → deploy may proceed
#   1  CI failed / still pending at timeout   → block (alarm; fix or re-push)
#   3  commit superseded (cancelled, and no   → skip quietly; the newer commit's
#      longer the branch tip)                    own gated deploy will ship
#
# Usage: ci-gate.sh <owner/repo> <sha>
set -euo pipefail

NWO="${1:?usage: ci-gate.sh <owner/repo> <sha>}"
SHA="${2:?}"
GRACE_S="${CI_GATE_GRACE_S:-90}"       # window for CI to register at all
TIMEOUT_S="${CI_GATE_TIMEOUT_S:-1500}" # 25 min ceiling for slow suites
POLL_S=20

# WHAT COUNTS AS "CI". Only workflow runs defined in the repository —
# .github/workflows/*. Everything else that reports against a commit is noise
# for this purpose:
#
#   * Dependabot's updater runs report as workflow runs with event=dynamic and
#     path=dynamic/dependabot/dependabot-updates. A failed dependency-graph
#     update is not a statement about whether the code works, but it blocked
#     solon and reparaturbonus-zh from deploying commits whose `verify` was
#     green. (Filtering by app slug does NOT separate them — Dependabot runs
#     under github-actions too. The workflow PATH is the discriminator.)
#   * Third-party check apps (Snyk) can sit pending forever and deadlock a gate
#     that waits for every check on the commit.
#
# Hence: the workflow-runs API filtered to real repo workflows, not the
# check-runs API.
# Exclude the DEPLOY workflow itself — every run of it, not just the current
# one. A retry after a failed deploy lands on the SAME SHA as the failure, so
# counting past deploy runs makes the second attempt permanently unreachable:
# the gate reads its own earlier failure as "CI is red". solon hit exactly this.
EXCLUDE_PATH="${CI_GATE_EXCLUDE_PATH:-}"

# THE VERDICT IS A PURE FUNCTION of the run list. Everything above is about
# which runs to look at; this decides what they mean, reads no clock and calls
# no API, and is driven directly by test-ci-gate.sh. Three separate bugs have
# been fixed in this judgement by comment alone (dependabot, deploy-self-retry,
# cancelled-vs-superseded) and each was found in production, on a blocked
# deploy. A rule you can only exercise by merging to main is a rule nobody
# re-tests after editing it.
#
# LATEST RUN PER WORKFLOW is the load-bearing part. A workflow can run more than
# once on one SHA — a re-run, or `cancel-in-progress` firing when auto-merge
# pushes while the PR run is still going. Counting every run then means an
# earlier cancelled attempt outvotes the green re-run that replaced it, and the
# commit can never deploy no matter how many times CI passes. printcraft hit
# exactly this: `verify` was cancelled once and succeeded once on the same SHA,
# and a security fix sat undeployed. Only a workflow's most recent run states
# its current verdict.
#
# Reads a JSON array of workflow runs on stdin. Prints "VERDICT total".
#   NONE      no CI defined for this commit
#   PENDING   at least one workflow has not finished
#   FAILED    a genuine red
#   CANCELLED all finished, but a workflow's latest run was cancelled
#   GREEN     every workflow's latest run succeeded
ci_verdict() {
  jq -r --arg exclude "${1:-}" '
    [ .[]
      | select(.path | startswith(".github/workflows/"))
      | select($exclude == "" or .path != $exclude)
    ]
    | group_by(.path)
    | map(max_by(.run_number))
    | . as $latest
    | ($latest | length) as $total
    | if $total == 0 then "NONE 0"
      elif ($latest | any(.conclusion | IN("failure","timed_out","action_required")))
        then "FAILED \($total)"
      elif ($latest | any(.status != "completed"))
        then "PENDING \($total)"
      elif ($latest | any(.conclusion == "cancelled"))
        then "CANCELLED \($total)"
      else "GREEN \($total)"
      end
  '
}

# Sourced by the tests to get ci_verdict without entering the polling loop.
if [ -n "${CI_GATE_LIB_ONLY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi


command -v gh >/dev/null 2>&1 || { echo "[ci-gate] gh not installed — passing open"; exit 0; }

# The branch tip decides whether a cancelled run means "superseded" (skip) or
# "the tip's own CI was cancelled" (rare; can't prove green → block). Resolved
# lazily and cached — only needed when a cancellation actually appears.
_TIP=""
resolve_tip() {
  [ -n "$_TIP" ] && { echo "$_TIP"; return; }
  local db
  db=$(gh api "repos/$NWO" --jq '.default_branch' 2>/dev/null) || db="main"
  _TIP=$(gh api "repos/$NWO/branches/$db" --jq '.commit.sha' 2>/dev/null) || _TIP=""
  echo "$_TIP"
}

start=$(date +%s)
while :; do
  now=$(date +%s); elapsed=$((now - start))

  err_file=$(mktemp)
  if ! runs=$(gh api "repos/$NWO/actions/runs?head_sha=$SHA&per_page=100" --paginate \
    --jq '.workflow_runs[]' 2>"$err_file" | jq -s '.'); then
    err=$(cat "$err_file"); rm -f "$err_file"
    # A refusal is not a network blip. On a PRIVATE repo whose deploy.yml does
    # not grant `actions: read`, this call is refused on every deploy, and
    # reading that as "network, passing open" meant the gate never gated a
    # private site (farmhouse, 2026-09-26). Still open — a deploy is not held
    # hostage to a token scope — but loudly, with the fix.
    if grep -qiE 'HTTP 40[34]|not accessible|Not Found' <<<"$err"; then
      echo "::warning::CI gate cannot read $NWO's workflow runs (token lacks actions: read) — this deploy is NOT gated on CI. Fix: add 'permissions: { contents: read, actions: read }' to the repo's deploy.yml."
      echo "[ci-gate] $NWO@$SHA: runs not readable ($(head -1 <<<"$err")) — passing open, UNGATED"
    else
      echo "[ci-gate] $NWO@$SHA: API unreachable — passing open (network, not verdict)"
    fi
    exit 0
  fi
  rm -f "$err_file"

  read -r verdict total <<<"$(printf '%s' "$runs" | ci_verdict "$EXCLUDE_PATH")"

  case "$verdict" in
    FAILED)
      echo "[ci-gate] $NWO@${SHA:0:8}: CI FAILED — deploy blocked"
      exit 1
      ;;
    GREEN)
      echo "[ci-gate] $NWO@${SHA:0:8}: CI green ($total workflow(s)) — deploy may proceed"
      exit 0
      ;;
    CANCELLED)
      # A workflow's LATEST run was cancelled, so nothing green replaced it.
      # Cancellation happens when a newer push supersedes this commit — if this
      # SHA is no longer the tip, bow out cleanly (the newer commit carries its
      # own gated deploy).
      tip=$(resolve_tip)
      if [ -n "$tip" ] && [ "$tip" != "$SHA" ]; then
        echo "[ci-gate] $NWO@${SHA:0:8}: superseded by ${tip:0:8} — skipping (newer commit will deploy)"
        exit 3
      fi
      # Still the tip with nothing newer to blame (rare race). We cannot prove
      # green; block with an actionable message rather than ship unverified code.
      echo "[ci-gate] $NWO@${SHA:0:8}: tip CI was cancelled unexpectedly — re-push to re-run, or deploy manually"
      exit 1
      ;;
    NONE)
      [ "$elapsed" -ge "$GRACE_S" ] && { echo "[ci-gate] $NWO@${SHA:0:8}: no CI configured — passing"; exit 0; }
      ;;
  esac

  if [ "$elapsed" -ge "$TIMEOUT_S" ]; then
    echo "[ci-gate] $NWO@${SHA:0:8}: CI still pending after ${TIMEOUT_S}s — deploy blocked (deploy manually once green)"
    exit 1
  fi
  sleep "$POLL_S"
done
