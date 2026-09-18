# Fresh system review — 2026-09-17

Read-only production reassessment after other agents continued work. No new dispatches or provider changes made during this review.

## Verified current state

- Remote main and production health: c11651821645f288f7874a82ffcdd2b1e640620a. Deploy workflows report success.
- Provider-switch implementation merged in #757; operator ranking propagation in #760; offline-after-delivery diagnosis in #769.
- Real Claude/Opus feedback run f34a83a2-25ab-4497-9ddf-61929297f60a closed `done/partial` at 07:06:25 UTC, with lastProgressAt 07:07:59 UTC. It used model `opus`. Do not represent its recorded outcome as success merely because code shipped.
- Authenticated production Control browser walk: C116518 build, 3 working / 0 awaiting input / 20 idle; no page errors. Loki card says Working / Live agent process detected while API says agentRunning=false and activeAgents=[]; a separate hook turn may justify Working, but the process-specific explanation is inaccurate.
- Branch fix/control-presenter-run-truth contains committed/pushed 6c30b29a, not merged. Four-file change exposes verifiedRunActive to presenter; prior validation 44 presenter checks, 189 unit test files, 130 home tests, desktop and ops passed. Must rebase and reassess against current main before shipping.
- Open #772 repairs outcome text from local handoffs and the no-change end-to-end probe's contradictory completion assertion. Open #770 repairs capacity reporting. Coordinate rather than duplicate these changes.

## Remaining architectural risks found in current main

1. Control presenter still derives isRunning from promptRunning || liveTurnRunning. Verified orchestration output only changes agentRunning in API, which means session-open rather than Working in presenter. Use one shared run projection across Control, Feedback and Terminal.
2. /api/providers reads getRuntimeSnapshot(userId), not the selected project's execution channel. Installation/auth/quota evidence must be scoped to the actual machine/account and stamped with observation time. Unknown is selectable but must be visibly unknown, not claimed ready.
3. Feedback attach-work falls back from closed pending command to current project routing preference. A current setting cannot prove where a historical attempt ran. Persist immutable execution identity per attempt.
4. Offline-after-delivery guard only covers runs without lastProgressAt. Explicitly cover previously-streaming-then-offline runs as well, after progress freshness expires.
5. A closed attempt, a PR, merged code and verified deployment are distinct milestones. Record and show each, and report the result back into the originating thread. Investigate the observed partial outcome and post-close progress before changing closure policy.

## Recommended sequence

Unify run identity and evidence-derived status; finish source-thread outcome delivery; prove one real feedback change through deployed behavior; make provider/model/machine/cost selection obvious before dispatch; then test editor vs reporter permissions with distinct accounts.

User model instruction persists: use Claude Code Opus, do not use Fable. Provider ranking alone does not satisfy model selection or cost visibility.

---

## Addendum — 2026-09-18 (added after the review, by a later session)

The review above is left exactly as written. This section records what has since
changed, so a reader does not re-diagnose a closed item.

**Closed.**

- `#770` (capacity reporting) and `#772` (outcome text back to the thread) were
  open when the review was written; both are merged.
- `#773` gave `/api/terminal/run`, `watch` and `dispatch` one hydration.
- Risk 1 is fixed in `#775`. `fix/control-presenter-run-truth` (6c30b29a) had no
  PR, which is why it never merged; it was rebased and carried in. Note that
  `#733` had meanwhile split `control/route.ts`, so the original commit no
  longer applied — `verifiedRunActive` is now threaded through
  `resolveAgentRuntime()`.
- The "Live agent process detected" inaccuracy is fixed. `isRunning` had three
  causes and the evidence line asserted one of them for all three; none of the
  three is a `/proc` scan. `ProjectDisplayState.runningEvidence` now names the
  signal that actually fired, and one derivation produces both the boolean and
  the reason so the badge and the line beneath it cannot drift.
  Verified live: the change is in the served tree on the box.

**Still open, and why one of them is not just unfinished work.**

Risks 2, 3, 4 and 5 stand as written. On risk 5 specifically — the run that
delivered `#757` and recorded `partial`:

`partial` is a terminal verdict. The post-reap honesty pass in
`src/lib/orchestration/reap-evidence.ts` exists precisely to correct an outcome
from evidence that appeared later, but both its input filter and its `UPDATE`
guard require `outcome = TIMEOUT`. It only ever promotes `timeout -> partial`. A
run that closed `partial` is never revisited, however plainly the work later
merged and deployed.

So the outcome is stamped once, at close — necessarily before auto-merge and
deploy have happened — and nothing reconciles it afterward. That is the
mechanism behind "shipping and outcome reporting disagree", and it is the same
gap risk 5 names: attempt, PR, merge, deployment and verified result are
distinct milestones and only the first is recorded.

Deliberately not fixed here. Promoting `partial -> success` touches the
escalation ladder and autopilot's continue-loop (`partial` is a non-failing
outcome, so an undeserved upgrade silently cancels escalation — the file
documents a case where one push satisfied three overlapping runs' time
windows). That is a closure-policy decision, and the review itself says to
investigate before changing closure policy.
