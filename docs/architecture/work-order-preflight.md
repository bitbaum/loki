# Work-order preflight: first cross-provider contract

**Status: contract, a Crew read-only adapter, a private GET endpoint and
pure unit tests.** No new storage, dispatch API, robot control, provider
directory, automatic spend or payment settlement has shipped. The current owner
of execution remains Loki.

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

## Crew projection (implemented)

`projectCrewWork(task)` takes an owner-scoped Crew detail returned by Loki's
existing `getHumanTask(userId, id)`. It emits a projection that includes
`previewOnly: true`, the original Crew status, a linked work order when
its project/assignee/fee fields are complete, and **observations** from the
Crew timeline. It never exposes the bearer share token, private contact notes,
fee payee URL or the full timeline.

The only HTTP surface is:

`GET /api/crew/tasks/{id}/work-order`

It requires the same private-zone access as Crew's existing routes. A missing
or other user's assignment returns 404. Responses are explicitly non-cacheable.
There are no POST, PATCH, PUT or DELETE methods.

The projected capability is the **generic** `human.delegated_assignment`.
Its two criteria describe Crew's procedural handoff and operator review;
they are NOT a domain-specific inspection or manufacturing quality standard.
More precise task criteria must come from the owning domain before real
dispatch. The source assignment may lack a project or assignee, so the
projection reports `issues` and leaves `order` null instead of inventing one.

Crew stores fees in a numeric field read into a JavaScript number. The
adapter converts only values that can be represented without denomination
rounding (2 decimals for CHF/USD/EUR/GBP, 8 for BTC) to integer minor units.
A missing currency or an unrepresentable quote **blocks** the work-order
projection; it is never rewritten as free work. Fee terms and payment settlement
remain authoritative in Crew and OrangeCat respectively.

### Important known Crew consent gap

Today's `patchHumanTask` can change an assignee even after they have
responded, without binding that historical acceptance to the new assignee.
The timeline also does not carry an authenticated person ID that proves who
accepted the current revision. Therefore `currentAssigneeConsentVerified`
is **always false** in this adapter, regardless of status or timeline.
`assigneeResponseRecorded`, `deliveryRecorded` and
`workflowCompletionRecorded` are observations of existing events, not
authorization credentials. Do not derive `AcceptanceStamp` from them.

The projection's revision uses `updatedAt` milliseconds for a conservative
display snapshot only; timestamps are not guaranteed monotonically unique
and MUST NOT be used to sign dispatch approvals. Before active cross-provider
dispatch, introduce an atomically incremented Crew revision and bind every
assignee acceptance to that exact revision and assignee identity. Revoke or
invalidate outstanding links when assignment identity changes.

## Next implementation steps (not included here)

1. Fix Crew's reassignment/consent/version binding in its authoritative write
   path, and add a signed or transactionally verified acceptance evidence API.
2. Create the read-only agent-run projection. Never equate an agent's "ready"
   sentinel with a verified deliverable.
3. Prove one real human handoff with attached acceptance criteria, independently
   checked evidence and owner approval.
4. Add a bounded physical robot gateway with offline fail-safe and explicit
   deny-path tests.
5. Connect OrangeCat's accepted provider offers and actual settlement events,
   with durable replay and reconciliation.

## Tests

`scripts/test/work-order-preflight.ts` and
`scripts/test/work-order-crew-projection.ts` are auto-discovered by Loki's
existing `scripts/test-unit.ts`. They pin stale-scope rejection, separate
human consent, exact money matching, missing criteria, fresh robot telemetry,
owner-scoped projections, non-invented fields and data minimization.

When this contract is used across two independently deployed products, extract
the **stable wire schema** into one versioned Fleet package. Do not extract it
before the actual integration proves what both consumers need.
