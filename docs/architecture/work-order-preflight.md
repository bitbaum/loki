# Work-order preflight: first cross-provider contract

**Status: contract and pure unit tests only.** No storage, dispatch API, robot
control, provider directory, automatic spend, or payment settlement has shipped
with this change. The current owner of execution remains Loki.

## Why this exists

Loki already has three independent real concepts:

- **Agent runs** — a project's orchestration/run records, not a new work-order
  status column.
- **Human assignments** — `human_tasks` and `config/crew.ts`. The operator
  asks, the person accepts or declines, and the operator verifies delivery.
  Nobody may record acceptance on the person's behalf.
- **Robots** — private machine profiles and optional OrangeCat asset listings.
  A listing is not a live machine connection or a safety permit.

An external commercial provider is a fourth case: a specific accepted offer,
not merely a search result. `WorkProvider` makes the differences explicit while
giving the planner one way to describe required capability, scope and evidence.

## This slice

`src/lib/work-orders/preflight.ts` defines a *projection envelope*, not a
competing persistence model:

- One immutable work-order ID, project ID and revision number.
- A capability, description and at least one measurable acceptance criterion.
- A provider reference to an agent, Crew assignment, robot or external offer.
- An optional integer-minor-unit price, including an exact currency.
- A pure prerequisite check returning **reasons** rather than executing work.

Approvals are scoped to the exact order revision. Changing scope, price or
provider invalidates earlier stamps. Human acceptance is separately required,
and must be verified from Crew's authenticated share-link lifecycle before a
trusted server constructs the stamp. External offers need equivalent acceptance.

Quoted paid work needs a separate spending approval tied to the exact price.
No payment instruction is produced by preflight, and OrangeCat remains the
economic system of record.

Robot work also needs a robot/gateway/capability-matching ready signal no older
than five seconds. That signal must originate from a trusted device gateway; an
AI-generated statement, client input or previously cached value is not enough.

**A green preflight is not a grant of authority.** It is only a checklist.
At the actual I/O boundary, the dispatcher must authenticate the caller,
validate credentials and ownership, re-check resource permissions and budgets,
enforce idempotency, and use locally enforced robot safety interlocks. A gateway
must independently refuse unsafe or out-of-scope commands, including after
disconnection. Failure to perform any of those checks means DO NOT DISPATCH.

## Integration boundaries

| Current system | What becomes a work-order input | Authoritative system |
| --- | --- | --- |
| Loki agent runner | Agent ID, requested capability, run evidence | Loki orchestration and runner |
| Loki Crew | Assignment ID, assignee's accepted status | Loki `human_tasks` |
| Loki Robots | Device ID and proposed capability | Loki registry; local gateway for true readiness |
| OrangeCat | Accepted service offer, exact quote, payment reference | OrangeCat provider/economic records |
| Solon | Optional group mandate or policy decision | Solon signed decision, re-verified by executor |
| DataCat / Kivvi | Observations, item IDs and acceptance artifacts | Each domain's own records |

Do not copy confidential case, patient or customer data into a shared global
work-order graph. Reference the minimum permitted artifact, with a scoped access
check in its original system.

## Next implementation steps (not included here)

1. Create a **read-only adapter** from an existing Crew assignment into a
   work-order preview, preserving Crew's existing status vocabulary.
2. Create the equivalent projection from an agent run. Verify that no generic
   'done' status can override actual run evidence.
3. Prove one real handoff with a person and a verified deliverable, without a new
   work-order table or parallel human-task lifecycle.
4. Only then add an authorized robot gateway adapter; start with a bounded
   status-only integration and explicitly tested deny paths.
5. Connect OrangeCat's signed provider offer and settled payment records,
   through an outbox with replay and reconciliation, never by guessed status.

## Tests

`scripts/test/work-order-preflight.ts` is auto-discovered by Loki's existing
`scripts/test-unit.ts`. It pins stale-scope rejection, distinct human consent,
exact money matching, missing criteria, and fresh robot telemetry.

When this contract is used across two independently deployed products, extract
the **stable wire schema** into one versioned Fleet package. Do not extract it
before the actual integration proves what both consumers need.
