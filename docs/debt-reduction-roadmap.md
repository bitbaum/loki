# Loki Debt Reduction Roadmap

> **STATUS — partly superseded (added 2026-09-22).** This roadmap is linked from
> the README as current, so read this first:
>
> - **The Beacon sections are obsolete.** The beacon popup was retired on
>   2026-06-11 (`2391c6f7`) and its remains were deleted in #804:
>   `scripts/beacon.py`, `POST /api/beacon` and the `beacon_sessions` table are
>   gone, and `/beacon/live` 404s. Anything below that treats Beacon as live
>   architecture — "stabilize Beacon as a client", "the always-on-top desktop
>   overlay" — describes something that no longer exists. What replaced it is
>   Fleet Runner's `notifyOnIdle` + autopilot dispatch.
> - Its file links were absolute paths into one machine's home directory and
>   were broken for every other reader; they are now repo-relative.
>
> The non-Beacon debt items have not been re-checked against current main.

## Purpose

This document turns the current architectural concerns into an execution
roadmap for reducing code debt and making Loki viable as a startup-grade
product.

The standard is no longer "works for me locally." The standard is:

- understandable by a new engineer
- auditable in production
- portable across users and machines
- adaptable across agent vendors
- cheap to extend without multiplying hidden complexity

## Debt Themes

The main debt is concentrated in four categories.

### 1. Split orchestration authority

The product loop is currently spread across:

- local hooks and `/tmp` signals
- Beacon desktop UX
- Loki browser UX
- direct injection routes
- partial orchestration adapters

This creates duplicated behavior and weak ownership.

### 2. Claude-era semantics leaking into product logic

Examples:

- `claude-*` sentinel compatibility paths
- prompt-key compatibility mappings
- session handoff assumptions baked into route logic

These are acceptable as migration artifacts, not as architecture.

### 3. State assembled from multiple partial truths

Current state is inferred from:

- `/tmp` files
- process scanning
- session markdown files
- DB fallbacks
- latest orchestration run rows

That is survivable in migration, but expensive as a long-term model.

### 4. UI behavior duplicated across surfaces

The browser and Beacon both contain:

- prompt selection UX
- countdown behavior
- continue semantics
- state presentation logic

That should become one decision engine with multiple renderers.

## Operating Rule

The target architecture is:

- local runtime detects
- adapters translate
- Loki decides
- UI surfaces render

Anything that does not fit that rule is debt.

## Delete

These are the things to remove as independent concepts.

### Delete independent prompt semantics outside Loki

Why:

- prompt meaning must have one SSOT

Targets:

- direct prompt semantics embedded in Beacon file-reading logic in
  [scripts/beacon.py](../scripts/beacon.py)
- any remaining Claude-only prompt meaning outside
  [src/lib/orchestration/intents.ts](../src/lib/orchestration/intents.ts)

Action:

- Beacon may render prompt choices, but must not define prompt meaning

### Delete top-level route dependence on raw runtime semantics

Why:

- routes should not be the primary interpreter of local vendor artifacts

Targets:

- direct ready/closing/closed interpretation in
  [src/app/api/control/route.ts](../src/app/api/control/route.ts)
- direct prompt/run semantics in
  [src/app/api/inject/route.ts](../src/app/api/inject/route.ts)

Action:

- move interpretation behind orchestration state services and adapter ingestion

### Delete duplicated countdown authority

Why:

- only one place should decide auto-continue timing and default behavior

Targets:

- browser countdown in
  [src/components/control/project-card-helpers.tsx](../src/components/control/project-card-helpers.tsx)
- Beacon countdown logic in
  [scripts/beacon.py](../scripts/beacon.py)

Action:

- keep one policy engine; treat UI countdowns as renderers only

## Merge

These concepts exist more than once and should be unified.

### Merge prompt metadata and intent presentation

Current split:

- prompt config in [src/lib/agent-config.ts](../src/lib/agent-config.ts)
- orchestration intents in [src/lib/orchestration/intents.ts](../src/lib/orchestration/intents.ts)
- control button labels/groups in [src/config/control-intents.ts](../src/config/control-intents.ts)
- Beacon prompt metadata loading in [scripts/beacon.py](../scripts/beacon.py)

Problem:

- prompt text, prompt identity, intent identity, and UI grouping are related but split

Merge target:

- one canonical intent registry
- one adapter rendering layer for agent-specific prompt text
- one presentation config for UI ordering and labels

### Merge runtime state ingestion

Current split:

- fast-state reading in [src/lib/control-fast-state.ts](../src/lib/control-fast-state.ts)
- slower control aggregation in [src/app/api/control/route.ts](../src/app/api/control/route.ts)
- orchestration run persistence in
  [src/db/queries/orchestration-runs.ts](../src/db/queries/orchestration-runs.ts)

Problem:

- multiple code paths interpret the same project lifecycle differently

Merge target:

- one runtime-ingestion module
- one derived-state module
- one API response assembler

### Merge project identity handling

Current split:

- DB user projects
- projects conf parsing
- owned-PTY tab listing (`listOwnedTabs`, `src/lib/agent-execution/owned.ts`)

Targets:

- [src/lib/agent-config.ts](../src/lib/agent-config.ts)
- [src/app/api/control/route.ts](../src/app/api/control/route.ts)
- [src/app/api/inject/route.ts](../src/app/api/inject/route.ts)

Merge target:

- project ID is canonical
- tab/session names are runtime bindings

## Stabilize

These are worth preserving, but they need firmer boundaries.

### Stabilize Beacon as a client, not a brain

Keep:

- the interruption UX
- always-on-top desktop overlay behavior
- fast decision surface

Do not keep:

- separate prompt authority
- separate orchestration semantics
- separate countdown decision logic

Target role:

- Beacon becomes a Loki-controlled desktop client

### Stabilize adapter contracts

Keep building on:

- [src/lib/orchestration/contract.ts](../src/lib/orchestration/contract.ts)
- [src/lib/orchestration/adapters.ts](../src/lib/orchestration/adapters.ts)
- [src/lib/orchestration/runners/openclaw.ts](../src/lib/orchestration/runners/openclaw.ts)

Needed:

- explicit event ingestion contract
- explicit state derivation contract
- explicit close/continue capabilities

### Stabilize session handoff

Keep:

- the habit of forcing end-of-run summaries

Current locations:

- [src/lib/control-fast-state.ts](../src/lib/control-fast-state.ts)
- [src/app/api/sessions/route.ts](../src/app/api/sessions/route.ts)
- [src/lib/agent-config.ts](../src/lib/agent-config.ts)

Needed:

- one parser
- one writer contract
- structured summary artifact, optionally mirrored to markdown

### Stabilize control-panel rendering

Keep:

- the project card structure
- the lifecycle banners
- the operator affordances

Needed:

- render derived orchestration state, not inferred adapter truth

## Defer

These are useful, but should wait until the core architecture is cleaner.

### Defer broad multi-agent generalization

Do not build a speculative framework for many future vendors yet.

Reason:

- Claude, Codex, and OpenClaw already provide enough concrete needs

### Defer deep UI redesign

Do not spend cycles polishing visual redesigns until:

- orchestration truth is stable
- Beacon/browser duplication is resolved
- policy and event history exist

### Defer advanced portfolio automation

Examples:

- autonomous project prioritization
- budget-aware runtime scheduling
- cross-project queue optimization

These are valuable later, but they sit above unresolved state and policy debt.

## Ruthless Priorities

If time is limited, do these in order.

### Priority 1: Unify orchestration authority

Implement:

- one state model
- one event model
- one policy engine

Files to center:

- [src/lib/orchestration/contract.ts](../src/lib/orchestration/contract.ts)
- [src/lib/orchestration/intents.ts](../src/lib/orchestration/intents.ts)

### Priority 2: Introduce event log and derived state

Implement:

- orchestration events table
- ingestion from current `/tmp` and session signals
- state reducer

Result:

- raw runtime files become adapter inputs, not product truth

### Priority 3: Collapse prompt and intent duplication

Implement:

- one intent registry
- one UI metadata layer
- one adapter rendering path

Result:

- Beacon and Loki render the same choices from the same source

### Priority 4: Reframe Beacon

Implement:

- Beacon reads Loki-owned state/prompt/policy contract
- Beacon sends actions back through Loki

Result:

- keep the good UX without keeping split product logic

### Priority 5: Remove route-level lifecycle interpretation

Implement:

- services for state derivation
- thinner API routes

Result:

- fewer bugs from inconsistent state assembly

## 30-Day Execution Plan

### Week 1

- define canonical orchestration event types beyond run rows
- add DB schema for orchestration events
- define one project runtime binding model

### Week 2

- build event-ingestion service for current local signals
- derive current control state from events plus live runtime facts
- refactor `/api/control` to consume derived state

### Week 3

- unify prompt/intents/presentation registry
- refactor control UI to consume unified intent metadata
- make Beacon consume the same prompt metadata contract

### Week 4

- move countdown/default-action policy into one backend-owned policy path
- make browser and Beacon render the same decision
- document remaining `dotfiles` responsibilities and remove semantic leakage

## File-Level Guidance

### Highest-risk files

- [src/app/api/control/route.ts](../src/app/api/control/route.ts)
- [src/app/api/inject/route.ts](../src/app/api/inject/route.ts)
- [src/lib/agent-config.ts](../src/lib/agent-config.ts)
- [src/lib/control-fast-state.ts](../src/lib/control-fast-state.ts)
- [scripts/beacon.py](../scripts/beacon.py)

Reason:

- these currently carry the most cross-boundary semantics

### Current extraction status

Implemented:

- `dotfiles` stop and notification hooks now delegate to
  [scripts/agent-hook-bridge.sh](../scripts/agent-hook-bridge.sh)
- shared runtime hook utilities now live in
  [scripts/agent-hook-lib.sh](../scripts/agent-hook-lib.sh)
- `dotfiles` Beacon now delegates to
  [scripts/beacon.py](../scripts/beacon.py)

Still a shim:

- `dotfiles` remains the place where Claude registers hook entrypoints
- `lib.sh` in `dotfiles` still exists as compatibility/runtime residue
- local hooks only signal lifecycle (start/stop/handoff); since 2026-09-11 all
  injection goes through runner-owned PTYs (node-pty) — there is no zellij path
  left for a hook to call, and no terminal adapter to make neutral

### Good foundation files

- [src/lib/orchestration/contract.ts](../src/lib/orchestration/contract.ts)
- [src/lib/orchestration/intents.ts](../src/lib/orchestration/intents.ts)
- [src/db/schema/orchestration-runs.ts](../src/db/schema/orchestration-runs.ts)

Reason:

- these are already moving toward neutral orchestration concepts

## Decision Test

Before merging any change, ask:

1. Does this add a second source of truth?
2. Does this place product semantics in runtime glue?
3. Does this make Beacon and Loki diverge more or less?
4. Does this make routes thinner or fatter?
5. Can a new engineer explain where the truth lives after this change?

If the answers move in the wrong direction, the change should not merge.
