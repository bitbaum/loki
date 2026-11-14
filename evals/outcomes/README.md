# Outcome benchmark

This is a development benchmark for OrangeCat and Loki work, with an offline
evidence ledger. It does not call models, dispatch builds, change routing or
move money. The cases are regression-derived scenarios, not fifty previously
completed customer jobs and not held-out evidence. Each case cites the source
revision and fixture from which its setup and acceptance criteria were derived.
Private production records must not be copied into this public directory.

## Start a comparison

From the repository root, choose an existing private parent directory outside
the checkout. The final experiment directory must not exist:

```sh
node scripts/evals/outcomes.mjs plan /private/evaluation/pilot current-stack,candidate-stack 3
node scripts/evals/outcomes.mjs report /private/evaluation/pilot
```

The plan snapshots the cases and their hash before work starts. Each named
configuration receives every case, repeated the requested number of times.
Keep an immutable private configuration manifest alongside the plan: exact
agent/harness versions, model settings, instruction and skill revisions, runtime
image, repository revision, spending limits and tool permissions. Labels alone
do not establish equivalent experimental conditions. Use the same fixture
snapshot, reset account and workspace state between jobs, randomize execution
order, and count timeouts, refusals and failed deployments. Freeze the budget
and stop conditions before execution. The ledger does not enforce a provider
spending cap: configure that in the existing runtime before dispatching.

Cases reference existing fixtures; replay them in isolated accounts and
throwaway local workspaces, not against customer data. For code-change tasks,
prepare a deliberately failing fixture first rather than asking an agent to
fix already-correct main. Never treat running an existing unit test as a new
agent success. The rail scenarios require a provisioned isolated integration
environment; do not run production end-to-end scripts as benchmark adapters.

## Record a job

One result represents a case/configuration/repetition, including **all** its
attempts. Do not record cumulative heartbeat snapshots as separate attempts.
An attempt references an actual run id; a run cannot be charged to two jobs.
Use the existing orchestration run's meter through the exported
`meteringFromRun` helper in `scripts/evals/outcomes.mjs`. It retains partial and
unknown pricing instead of inventing a new rate table. Non-final usage and
unpriced participants are not complete costs. Missing adapters need their own
meter evidence before comparing economic results.

Create a private result JSON with this shape (replace the descriptive values):

```json
{
  "jobId": "unique-job-id",
  "caseId": "OC-LK-001",
  "configuration": "current-stack",
  "repetition": 1,
  "outcome": "unreviewed",
  "humanMinutes": null,
  "humanTimeEvidence": null,
  "attempts": [
    {
      "runId": "actual-run-id",
      "costUsd": null,
      "costStatus": "unknown",
      "source": "orchestration-run"
    }
  ],
  "reviewer": null,
  "reviewedAt": null,
  "artifacts": [],
  "checks": []
}
```

Store evidence inside the private experiment directory. Each artifact needs
`id`, relative `path` and the file's `sha256`. Record a criterion's `id`,
`verdict` (`pass`, `fail`, `unknown`) and `evidence` (artifact ids). Every
predeclared criterion needs a verdict before a reviewed outcome is accepted.
`verified` requires all criteria to pass; `failed` needs a failing criterion.
An unresolved criterion leaves the job `unreviewed`. A reviewer other than the
building agent checks observable artifacts; the recorder validates identity
presence and evidence integrity, not the truth or independence of a review.
For a delivered fix, evidence includes the served revision and the affected
journey; a PR or agent summary alone cannot prove the requested outcome.

Human minutes include setup, clarification, review and rework across all
attempts. Record actual active minutes and a log artifact id in
`humanTimeEvidence`; unknown is `null`, never a guessed zero. A genuine measured
zero is permitted with evidence. Keep end-to-end timestamps in the evidence
as well so elapsed delivery time remains available for analysis.

```sh
node scripts/evals/outcomes.mjs record /private/evaluation/pilot /private/evaluation/job.json
node scripts/evals/outcomes.mjs report /private/evaluation/pilot
```

The recorder is sequential and append-only per case slot; it refuses duplicate
jobs and changed suite snapshots. Record the complete attempt list once the
job ends. An unreviewed observation can subsequently be closed with:

```sh
node scripts/evals/outcomes.mjs review /private/evaluation/pilot /private/evaluation/reviewed-job.json
```

Review appends an adjudication and retains the original observation. It cannot
change attempts, job identity or already measured human time, and it must retain
the original evidence. The report counts the adjudicated job once. Further
attempts belong in a new planned experiment. Do not run concurrent recorders
against the same experiment.

## Interpret the report

Cost per verified outcome divides **all recorded attempt costs**, including
failed jobs and retries, by verified outcomes. Human minutes use the same
denominator. If any attempt is unpriced or partial, complete cost and cost per
outcome remain null; the known subtotal is labelled separately. Incomplete human
time stays unknown. Coverage, missing jobs and unreviewed jobs remain visible.
These are provisional batch metrics until the whole predeclared plan is
reviewed. Critical boundary failures prevent comparison readiness. The tool
does not choose a winner or switch production models.

The first operational step is to provision replay fixtures and run the current
stack, then repeat the exact plan with the candidate. After that, collect fresh
consented customer jobs into a private held-out set whose expected outcomes are
written before agent execution. Use paired results and uncertainty estimates
before changing routing. Profit per human hour additionally needs measured
revenue and non-model delivery costs; this ledger does not infer either.

Shared-package assessment: the fleet building-block register and Loki's
package composition plan were reviewed. This is product-specific offline
accounting over existing meter exports, with no UI, model client or shared
runtime behavior, so no package or dependency is added.
