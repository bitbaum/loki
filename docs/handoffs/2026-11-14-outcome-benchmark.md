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

The focused accounting tests passed. The docs-truth audit passed before this
checkpoint was added; repeat after its final update. Full `pnpm run verify`
is running; no claim is made here that it passed, merged or deployed.

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
   PR and deployment evidence here before claiming those stages.
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
