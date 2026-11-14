# Outcome benchmark checkpoint

## Objective and scope

Implement an evidence-based comparison foundation for OrangeCat and Loki:
source-grounded development cases, frozen plans, private evidence, full-attempt
cost and human-time accounting. Keep Loki as the active application. This
change adds offline tooling only; it does not alter routing, production data,
permissions, deployments or payment execution.

Working branch: `feat/outcome-benchmark`. Source revision for the initial cases:
`82c9fdc812b3dfc8384c263510cf761d91e812d1`. Files and usage are documented in
[the benchmark guide](../../evals/outcomes/README.md).

## Implemented

- Fifty development scenarios from the cited repository fixtures and incident
  records, with prompts, setup requirements and predeclared acceptance criteria.
- Offline plan, record, review and report commands; suite snapshot hashes and
  evidence file hashes; duplicate-job and duplicate-run rejection.
- Accounting that includes failed attempts and retries, preserves unknown and
  partial pricing, and separates verified outcomes from agent run status.
- Append-only adjudication of unreviewed jobs, retaining their original evidence.
- An existing-run metering adapter, with no second price catalogue or dependency.
- Unit-test discovery wiring for the accounting regression suite.

## Verification at preparation

Nine focused accounting tests passed, as did the changed-file formatting and
docs-truth audit. The initial full `pnpm run verify` passed its format,
register, type, lint, design and desktop stages, then reported 628/636 unit
files passing. Seven failures came from missing browser binaries or release
tags in this fresh checkout; those prerequisites were installed/fetched.
The eighth was reproduced separately: the spoken-walk browser fixture used
fixed speech offsets that no longer matched its actual navigation times.

The fixture now timestamps simulated speech on the browser's own recording
clock, independently of the product's captured moments. Its assertion checks
all four pages. This is a test-only prerequisite fix, not a change to voice
alignment behavior. Deployment-gate fixtures, operations fixtures and mailgate
checks passed separately. A subsequent normal push passed all 636 unit files
and 130 home/runtime tests, then failed in its EXIT trap: watchdog cleanup used
`pkill` without tolerating a timer with no children. Cleanup now preserves the
checks' exit status when the watchdog is already gone, with a shell regression
test for both successful and failing checks. The normal push gates rerun the
application checks against this final working tree; publication and CI outcomes are recorded on
the resulting pull request. This checkpoint makes no merge or deployment claim.

## Findings from the additional industry comparison

The [referenced post](https://x.com/m4lkxx/status/2114338456750997922)
distinguishes tool/runtime capability, evidence-driven correction and workflow
authority. Source review finds corresponding pieces in Loki, but does not
establish production reliability or an industry percentile:

- `src/lib/orchestration/evidence-precheck.ts` checks handoff field presence;
  nonblank agent prose satisfies that precheck. This is not independently
  observed command execution. The benchmark explicitly tests the distinction.
- `src/lib/orchestration/dod-gate.ts` can keep a success close when a goal reaches
  its cap despite an unmet verdict. Its summary flags escalation. This is a
  loop-control convention, not proof of goal success; the benchmark tests it.
- `src/lib/orchestration/parallel-run.ts` provides isolated lanes, with automatic
  busy-project parallel dispatch conditional on configuration. Source presence
  does not prove the production flag is enabled.
- `src/lib/orchestration/escalation-ladder.ts` and `dispatch-gates.ts` implement
  bounded retry escalation and failure/no-op brakes.

## Remaining acceptance criteria

1. Complete full verification, publish the branch through normal hooks, open a
   non-draft PR and use the fleet sweep as merge authority. Record exact check,
   PR and deployment evidence in the publication report before claiming those stages.
2. Provision isolated replay fixtures and deliberately failing code snapshots.
   The case descriptions are not executable agent adapters by themselves.
3. Freeze a private runtime configuration manifest and provider-enforced budget;
   run the current stack and candidate on the same fixtures. No paid benchmark
   jobs or production actions have been dispatched in this implementation.
4. Collect independent review, complete adapter pricing and human-time logs.
   An empty plan or successful unit suite supplies no agent success rate.
5. Build a fresh consented held-out customer set before making routing claims.
   The public development cases must never be presented as held-out evidence.

## Resume

Inspect the current branch and remote main first, then run the focused suite:
`node --test scripts/evals/outcomes.test.mjs`. Follow the guide to create a
private experiment. Do not commit private result files or fabricate missing
cost, human time or customer outcomes.
