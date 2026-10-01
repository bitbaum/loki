---
title: The Captain's Refactor — Making the Bridge Real
summary: Loki's thesis is sound — govern a fleet you can trust, with verification and economy no worker tool builds. The codebase still carries three eras at once. This is a first-principles refactor plan grounded in what the repo actually does today, what Grok Bot-style products do differently, and the order that closes the gap without lying to the operator.
excerpt: The captain's job is not more features. It is one dispatch spine, one truth model, one executor contract, and a product that never claims a power it does not own.
publishedAt: 2026-08-19
supersededBy: /whitepaper
tags: architecture,strategy,refactor,orchestration,loki,execution
featured: true
author: Loki
readingTimeMin: 22
---

## The gap between the thesis and the repo

Loki's positioning is precise: **borrow the workers, own the bridge.** Claude Code, Grok Build, Codex, Cursor, OpenClaw — these are converging on the same worker substrate. Loki sits one tier up. One captain's interface over swappable runtimes, with cross-model verification, fleet governance, and an economy underneath that no single-agent tool is trying to build.

That thesis is already partially real. The definition-of-done gate asks a different model lineage to judge a worker's handoff. Loki resolves natural language into project-scoped dispatches. `injectPrompt()` assembles project context, fleet RAG, operator goals, and escalation blocks before anything reaches an agent. Activity shows run outcomes, not just "something was sent." OrangeCat and Solon integrations exist on production paths that were witnessed end to end — a bar [Shipped Is Not Witnessed](/thoughts/shipped-is-not-witnessed) established the hard way.

But the implementation still carries **three eras at once**, and the operator pays for that in cognitive load, silent queues, and UI surfaces that oversell what the runtime can guarantee.

Era one: Claude-shaped local hooks, zellij tab names, `/tmp` sentinels, session markdown handoffs.

Era two: Postgres-backed orchestration — `pending_commands`, `orchestration_runs`, `run_events`, adapter registry, FIFO claim gates.

Era three: the north star in `docs/architecture/agent-execution-platform.md` — Loki-owned PTYs, event-sourced workspace state, `LocalPtyExecutor` and `SandboxExecutor` behind one interface, terminal as view not substrate.

The product narrative speaks in era three. Daily dogfood still walks through era one and two. Until those converge, Loki cannot honestly do what Rahul's Grok Bot thread describes — nor should it try to copy that playbook blindly. It can become the **captain layer that orchestrates those workers**, including browser-native ones, once the hull is sealed.

This post is the refactor map: what the codebase actually does, where it breaks the captain model, and the build order that makes the bridge real.

## What Grok Bot optimizes for (and why Loki is not that yet)

The viral Grok Bot playbook is not "better coding agent." It is **managed cloud hands for SaaS surfaces**: one shared cloud computer, account-level OAuth plugins, demonstration capture ("teach a task"), scheduled and event-triggered routines, and a roster of business-role bots (Chief of Staff, Scout, Quill, Guide, Ledger) coordinating in group chat.

That product optimizes for a solo founder grinding LinkedIn, Gmail, Slack, and CRM clicks while the laptop is closed. The wedge is **browser-native autonomy with shared sessions**.

Loki optimizes for something else: a builder running **many code projects** who needs to command agents, verify outcomes, and compound project memory without trusting a single model's self-report. The wedge is **governance across a fleet** — queues, handoffs, cross-model verification, approval gates, OrangeCat demand signals, Solon-signed decisions.

The overlap is real but smaller than the marketing implies:

| Job | Grok Bot today | Loki today |
| --- | --- | --- |
| Cold email / LinkedIn / CRM clicks | Core product | Not built |
| Inbox triage → draft reply | Core product | No Gmail integration; Loki cannot send |
| Teach UI workflow once → nightly routine | Core product | Prompt library + cron; no demo capture |
| 50 named specialist bots in group chat | Core product | One Loki identity + per-project coding agents |
| Code, test, commit, deploy across repos | Peripheral | Core path via `injectPrompt` → runner |
| Cross-model "is this actually done?" | Weak (judge = worker) | Shipped DoD gate in orchestration contract |
| Multi-project fleet command | Weak | Control + Loki fleet-kick, batch dispatch |
| Approval before external writes | Ad hoc guardrails | Explicit action queue (`execute-action.ts`) |
| 24/7 without laptop | Default (cloud VM) | box-runner for founder; ~63% of UI flows need extra runtime on hosted prod |

The honest product audit (`docs/development/user-flow-audit.md`, verified 2026-07-04) puts the number on it: on hosted production, **~37% of mapped flows deliver the full implied outcome without a builder, integration, or known gap.** Page shells load. The loop does not always close.

So the question is not "can Loki beat Grok Bot at Grok Bot's game tomorrow?" It cannot, and copying that surface area first would dilute the captain thesis. The question is: **what refactor makes Loki actually work as the bridge it claims to be** — and optionally orchestrate Grok-class workers later without becoming them.

## Forensic: how dispatch actually works today

Every serious path eventually touches `injectPrompt()` in `src/lib/inject-core.ts`. That function is the de facto SSOT for "send work to a project." Control intents, Loki command resolution, widget installs, and approved profile-update actions all funnel here or to the same `executeInject()` queue layer in `src/lib/executor.ts`.

The happy path on hosted production:

```
Operator (Control / Loki / cron)
  → injectPrompt()
  → assembleInjectPrompt() — profile, goals, intent template, fleet RAG
  → createOrchestrationRun() + emitRunEvent("dispatched")
  → executeInject() — mode "queued"
  → pending_commands row (Postgres)
  → box-runner OR Fleet Runner claims (SELECT … FOR UPDATE SKIP LOCKED)
  → inject into agent CLI (owned PTY or legacy zellij)
  → session handoff closes run → DoD gate → Activity
```

That spine is real. Horizon A and B of `docs/architecture/priority-plan-2026-H2.md` marked most of it done: Terminal Cloud peek, builder presence chips, context on every dispatch path, runner stall detection, truthful block-reason chips.

But `inject-core.ts` still branches on realities the north-star doc explicitly retires:

- **Zellij tab resolution** when no owned PTY exists — `getZellijTabs()`, `resolveEffectiveTab()`, 422 if tab not open.
- **Keystroke injection** via `injectIntoTab()` as fallback when `ptyBacked` is false.
- **Human-at-prompt gate** via `isUserTypingInTab()` — a zellij-only concept tied to `~/.zshrc` hooks.
- **Local-only imports** from `agent-config` and `zellij` modules gated by `isRuntimeAvailable()`.

Meanwhile `src/lib/agent-execution/types.ts` defines the future correctly: stable `WorkspaceId`, event-sourced `AgentEvent` stream, no tab names. `LocalPtyExecutor` and `SandboxExecutor` are selectable via `LOKI_EXECUTOR`. The interface is minimal and intentional — grow it only when a concrete executor needs more.

**The refactor starts here:** every dispatch must eventually read as `command → orchestrator → executor.provision/write → event log`, with zellij relegated to an optional power-user view, not a hidden branch inside the captain's spine.

## Forensic: where truth lives (and why it still lies sometimes)

Loki already has the bones of event-sourced orchestration:

- `orchestration_runs` with `ORCH_STATE` (`waiting`, `running`, `done`, `error`, …)
- `run_events` via `emitRunEvent()` — dispatched, delivered, closed, etc.
- `orchestration_events` reducer path (partial — debt roadmap P1–2)
- Session handoff fields in `ORCHESTRATION_TASK_SUMMARY_FIELDS` — `tsc`, `lint`, `commit`, `block-reason`, `verification`

The contract in `src/lib/orchestration/contract.ts` is explicit about the captain's moat: the `verification` block on a task summary records that a **different model lineage** judged the worker's handoff against the project's definition of done. A single-agent runtime cannot structurally do this; its judge would be itself.

Yet status still arrives through multiple partial truths, as `docs/debt-reduction-roadmap.md` names:

- `/tmp` sentinels and typing hooks
- process scans and zellij tab lists
- `~/.loki/sessions/*.md` handoff files
- DB rows in `project_states` and `runtime_snapshots`
- latest orchestration run inference

The queue post from May — [The Queue Is Not a Single Source of Truth (Yet)](/thoughts/the-queue-is-not-a-single-source-of-truth) — was about beacon/localStorage/file duplication. The orchestration layer improved since then, but the **principle remains**: when five components share state and none is authoritative, the product lies in the gaps.

For the captain refactor, the rule is non-negotiable:

> **Run events are truth. Everything else is a projection.**

The UI may cache. The runner may mirror. Loki may narrate. But `run_events` + `orchestration_runs.state` win every conflict. No card should show "running" because a tab name matched; only because the run ledger says so.

## Forensic: Loki — supervisor or chatbot?

Loki shipped as the low-cognitive-load front door ([Reducing Cognitive Load — Toward One Command](/thoughts/reducing-cognitive-load-toward-one-command)). The `/loki` page resolves NL to `{ project, intent | prompt }`, dispatches through the same queue as Control, and shows status cards with links to Terminal Cloud.

But `src/lib/loki-core.ts` carries a capability contract worth treating as law:

```text
CAPABILITIES — ground truth; never exceed or invent beyond this:
  search_people (private book)
  NO ability to send messages or emails — outbound frozen
  NO direct Google Calendar changes
  ONLY lever: the Loki approval queue — PROPOSE, operator APPROVES
  approved calendar → gog calendar create on operator's machine
  never claim a result without confirmation
```

That contract exists because Loki once invented an Approve button and a "security sandbox" excuse for a calendar write that never happened. The fix was not a better prompt. It was **honest capability bounds** injected every turn.

For the refactor, Loki should be three explicit roles — not one magical chatbox:

1. **Interpreter** — NL → `FleetCommand` or clarifying question.
2. **Supervisor** — policy, executor choice, approval requirement, project disambiguation.
3. **Narrator** — plain-language report from run events, never from wishful inference.

Every Loki turn should end in exactly one of: answer, draft action, queued run, clarification, approval request, or evidence-backed completion. That is how a captain behaves. A worker bot skips the approval layer; a captain cannot.

`src/lib/actions/execute-action.ts` already implements the mutation boundary: `SEND_EMAIL`, `CREATE_EVENT`, profile patches, feedback dispatch — with `DEFERRED_TYPES` fail-closed for unwired executors. The refactor extends that pattern to **all external effects**, including future browser worker writes.

## Forensic: execution — the borrowed ship

[The Captain Needs a Ship](/thoughts/the-captain-needs-a-ship) named the keystone gap precisely: Loki commands a fleet it does not fully run. box-runner on Hetzner (`loki-box-runner.service`) closes much of that for the founder account — 24/7 cloud builder, peek-stream Terminal, queue claim via bridge SSE. Fleet Runner desktop embeds the `home/` watcher/worker library; the standalone Brain on `:3001` was retired.

Still true in August 2026:

- Horizon **C5** (hosted runner Phase 1 product path) remains **gated** — SandboxExecutor substrate exists; public multi-tenant hosted execution does not.
- Horizon **B6** (PTY cutover off zellij name-puppeting) is **partial** — `inject-core.ts` uses owned PTY when present, zellij fallback otherwise.
- External users still hit **D1–D5** onboarding gates in the priority plan.

The worker tools moved execution to infrastructure that sleeps cheaply. Loki's refactor must finish that move for all tenants, not only the operator's box — or permanently narrow the product promise to "captain for builders who connect a runner." Both are valid; **mixing them in one UI is not.**

## The refactor — four boundaries, one spine

If Loki is to work as described, stop adding features at the surface and **harden four boundaries**:

### 1. Command surface (inputs)

Unify Control, Loki, cron, webhooks, and future triggers behind one envelope:

```ts
interface FleetCommand {
  id: string;
  source: "loki" | "control" | "cron" | "api" | "routine";
  userId: string;
  projectId?: string;
  intent: OrchestrationTaskIntentId | string;
  payload: Record<string, unknown>;
  capabilityClass: "code" | "knowledge" | "browser_ops" | "personal_ops" | "governance";
  approvalPolicy: "none" | "draft_only" | "human_required";
}
```

Today intents live in `ORCHESTRATION_TASK_INTENT_IDS`; approval is implicit per action type. The refactor makes both explicit at command creation time so Loki, Control, and cron cannot diverge.

**Concrete first step:** extract `src/domains/orchestration/commands/` (or equivalent) and route `/api/inject`, Loki messages, `kickFleet()`, and `/api/crons/nudge-idle` through one `submitCommand()` function. `injectPrompt()` becomes an adapter, then shrinks.

### 2. Orchestrator (brain)

Owns: resolution, policy, run creation, approval checks, executor selection, retry/continue rules, close semantics.

Does not own: PTY bytes, zellij names, Gmail OAuth, browser DOM.

The OpenClaw migration plan (`docs/openclaw-orchestration-plan.md`) already argues for this separation: orchestrator SSOT, agent adapters swappable, UI never Claude-shaped again. The refactor **implements** that doc instead of letting it drift.

**Concrete first step:** move run lifecycle transitions out of route handlers and `inject-core.ts` tail logic into `src/lib/orchestration/supervisor.ts` (name arbitrary; boundary is not). Routes parse HTTP; supervisor decides state.

### 3. Executors (hands)

The `Executor` interface in `src/lib/agent-execution/types.ts` is the right abstraction. Three implementations, one contract:

| Executor | Serves | Status |
| --- | --- | --- |
| `LocalRunnerExecutor` | User machine — private repos, local CLIs, `gog` | Shipped as Fleet Runner + partial PTY |
| `HostedSandboxExecutor` | Multi-tenant cloud — isolated, metered | Substrate behind env flag; product gated |
| `BrowserWorkerExecutor` | SaaS automation — LinkedIn, Gmail, Notion | **Not built** — required only if pursuing Grok-class ops |

zellij/tmux are **not** executors. At most, a optional attach client to a `LocalRunnerExecutor` workspace.

**Concrete first step:** delete the zellij fallback from the default hosted path. If no owned workspace exists, queue `launch_agent` and show `awaiting_executor` — never 422 "tab not open."

### 4. Event plane (truth)

SSOT: `run_events` + `orchestration_runs`. Project cards, Loki status bubbles, Activity, push notifications — all projections.

Add missing lifecycle events the product already implies but does not always emit:

- `awaiting_approval`
- `awaiting_auth` (OAuth handoff for browser worker)
- `blocked` with structured `block-reason`
- `evidence_attached` (test output, screenshot, commit SHA)

**Concrete first step:** ban UI status derived from tab lists without a run join. Control already trends this way with truthful chips; finish the migration.

## Capability classes — why "can Loki do X?" gets a real answer

Grok Bot collapses everything into "the bot clicks it." Loki should not. Split capabilities so policy, approval, and executor routing are obvious:

| Class | Examples | Default executor | Approval |
| --- | --- | --- | --- |
| `code` | next_best, test_and_fix, commit_push | Local runner or sandbox | medium — DoD gate |
| `knowledge` | research, summarise, plan draft | model/orchestrator only | low |
| `browser_ops` | CRM update, inbox triage | browser worker (future) | **high — draft only** |
| `personal_ops` | calendar, habits, subscriptions | local tools / integrations | high |
| `governance` | Solon vote, publish to OrangeCat | verified workflow | explicit |

Loki's capability preface in `loki-core.ts` becomes generated from this table — not hand-maintained prose drifting from reality.

## Routines without copying Grok Bot's fragility

Grok Bot's "teach a task" is demonstration capture on a shared cloud browser. Powerful. Also brittle — UI redesigns break routines; shared credentials enlarge blast radius.

Loki's native version should be **action graphs**, not GUI recording first:

1. **Phase 1 — Structured routines:** cron + intent + project scope + approval policy. Already partially exists (`ScheduledJobsCard`, prompt schedule modal); unify under orchestrator.
2. **Phase 2 — Role packs:** Scout, Guide, Ledger as **policy bundles** — not separate chatbots. One Loki dispatches scoped commands with charter-like boundaries encoded in policy JSON.
3. **Phase 3 — Demonstration capture:** record terminal or browser flows into replayable graphs **with human review before unattended schedule**.

Inspectability beats magic. The captain's job is to leave an audit trail Grok Bot's group chat handoffs do not guarantee.

## Split Fleet domain from Life OS domain

Loki mixes project execution with goals, people, habits, money, events, thoughts. Philosophically coherent; architecturally expensive.

Refactor rule: **the fleet must work when the life OS is passive.**

- **Fleet domain:** projects, runs, queues, agents, prompts, approvals, terminals, deploy signals.
- **Personal OS domain:** people book, habits, money, calendar captures.

Shared surfaces (Today, Loki operator context) consume projections from both, but orchestration assumptions must not leak across the boundary. Calendar booking via `gog` is a personal_ops executor concern, not a dispatch inject concern — `execute-action.ts` already treats it that way when cloud lacks local runtime.

## Repo shape — stop scattering orchestration

Today orchestration logic lives across:

- `src/lib/inject-core.ts` (~600 lines)
- `src/lib/executor.ts`
- `src/app/api/control/*`
- `src/app/api/conversations/[id]/messages/route.ts`
- `src/db/queries/pending-commands.ts` (FIFO SQL, stall detection)
- `desktop/src/main/poller.ts` (runner claim loop)
- `home/watcher.ts` + `home/worker.ts`
- cron routes under `src/app/api/crons/`

The debt roadmap's theme **"split orchestration authority"** is still the top structural debt.

Target layout (incremental, not big-bang):

```text
src/domains/
  orchestration/   commands, supervisor, policies, intents
  execution/       executor registry, workspace lifecycle
  agents/          adapter registry (already partial)
  approvals/       action queue, execute-action
  routines/        schedules, role packs
  fleet/           projects, context, RAG assembly
  personal/        people, habits, money — no inject imports
```

Move code as touch boundaries arise. Do not freeze the repo for a month-long move. **Do** forbid new orchestration logic outside `domains/orchestration`.

## Phased build order (dependency-respecting)

Upper layers fail if lower layers lie. Same stack as the H2 priority plan: **Execution → Trust → One command → Growth.**

### Phase 1 — Honesty and convergence (weeks 1–4)

- Single `submitCommand()` entry; deprecate parallel inject paths.
- UI grades from user-flow audit: every **D** surface gets a gate or honest label (much already done via `executor-copy.ts` and `ExecutorHonestyChip`).
- Loki capability text generated from policy SSOT.
- Document publicly: hosted prod requires builder for agent work — or ship hosted sandbox for tenants.

**Exit criterion:** No user-visible "success" without a run id and event trail.

### Phase 2 — Executor unification (weeks 4–10)

- Default hosted path: owned PTY only; zellij fallback behind explicit `legacy_zellij=1` dev flag.
- Finish B6: box-runner and Fleet Runner on executor interface exclusively.
- Product-gate SandboxExecutor: per-user credentials, metering, onboarding smoke.

**Exit criterion:** New engineer can trace one dispatch without learning zellij tab names.

### Phase 3 — Approval and action contracts (weeks 8–12)

- Extend `execute-action.ts` pattern to all external mutations.
- Draft-only defaults for anything touching mail, money, publish, or CRM.
- Browser worker stub executor that only returns drafts until Phase 5.

**Exit criterion:** Loki cannot claim an external effect that did not produce an audit event.

### Phase 4 — Routines and role packs (weeks 10–14)

- Unified scheduler under orchestrator (not "cron inserts pending_commands directly" — that antipattern was fixed for nudge-idle; enforce everywhere).
- Scout/Guide/Ledger as downloadable policy packs tied to capability classes.

**Exit criterion:** One scheduled job runs end-to-end with evidence in Activity.

### Phase 5 — Browser worker (weeks 14+, optional product bet)

- Isolated sessions per tenant, login handoff, no shared account blast radius.
- Read-only integrations first (monitor competitor pricing → Slack alert).
- Grok Bot as **adapter**, not identity — if xAI exposes stable automation API, register in agent registry; Loki still owns verification and approval.

**Exit criterion:** Reversible, low-stakes browser job completes with human approval gate — never unattended send on v1.

### Phase 6 — Multi-agent coordination (after Phase 2–3 stable)

- Supervisor assigns stages to specialists; user sees one thread.
- Handoffs are run events, not chat messages between bots.

**Exit criterion:** Objective with three stages produces three linked runs and one Loki summary — no silent parallel sends.

## What we should not do

- **Rebuild Grok Bot inside Loki** before executor unification — you would add a fourth era.
- **Expand Life OS surfaces** while ~63% of hosted flows still grade B/C/D — [The Captain Needs a Ship](/thoughts/the-captain-needs-a-ship) applies to UX honesty too.
- **Open box-runner to all tenants** before SandboxExecutor product gates — D5 exists for a reason.
- **Let Loki send mail** without passing through approval and audit — one hallucinated send destroys captain trust faster than any missing feature.

## How this relates to Grok Bot — strategically

Grok Bot is a **worker**. Loki is a **captain**. The win is not feature parity on LinkedIn automation. The win is:

- orchestrate Grok (already in `ORCHESTRATION_ADAPTER_IDS`) alongside Claude and OpenClaw
- verify outcomes with a different model lineage
- enforce approval before external writes
- compound project and fleet memory OrangeCat and Solon plug into

Rahul's six-bot company is a **policy and routine design pattern** worth stealing — charters, boundaries, scheduled briefs — implemented as Loki role packs and action graphs, not as six separate cloud chatbots with shared credentials.

## Dogfood metrics — know when the refactor worked

From `docs/architecture/priority-plan-2026-H2.md` and the user-flow audit, track:

- **Hosted full-outcome flow rate** — raise from ~37% toward 80%+ for declared v1 core (sign in → dispatch → watch terminal → see closed run with verification).
- **Silent queue rate** — dispatches with no claim within grace window (runner stall detector already exists; trend to zero).
- **Status lie rate** — card shows running but no open run; target zero.
- **Unverified close rate** — runs closed success without commit/DoD when project declares a bar; surface, do not hide.
- **Time to first witnessed loop** — new user with git project to closed run on cloud builder without desktop install.

## The single line

Loki becomes real when **one sentence from Loki becomes one command, one run, one event trail, one executor, and one honest status** — with verification and approval built in, not bolted on.

The worker tools will keep getting better at clicking and coding. Let them. The refactor's job is to make the bridge trustworthy enough that those workers serve the fleet instead of replacing the need for a captain.

That is not a feature sprint. It is an authority consolidation — and it starts in `inject-core.ts`, not in a new sidebar item.
