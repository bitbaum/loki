# Codebase Audit Report

> **STATUS — historical (added 2026-09-22).** A point-in-time audit of commit
> `b40686e`. Several of its findings are filed against code that has since been
> deleted, so they can no longer be acted on as written:
>
> - The **Stripe webhook** findings (unhandled DB errors in
>   `stripe/webhook/route.ts`, "guard the webhook", "flip Stripe live") target
>   routes removed in #508. There is no `src/app/api/stripe/` and no `stripe`
>   dependency.
> - **zellij** was deleted in #630; findings phrased as "types into zellij" or
>   "zellij tabs" describe a mechanism that no longer exists.
>
> Kept for the reasoning and the trail. Do not open work from it without first
> checking the finding still has a subject.

**Date**: 2026-07-13
**Auditor**: Claude Code (Opus 4.8, 3 parallel subagents + direct tracing)
**Branch**: `feat/calendar-drain`
**Commit**: `b40686e`

## Executive Summary

Loki is a **genuinely real, staff-engineer-quality product**, not a scaffold. Nearly every one of its ~50 routes is backed by live DB queries, real host syscalls, or live tool/SSE calls, with **zero fake placeholder metrics** — the "no magic numbers" rule is honored throughout. The core *command-your-fleet* loop (Control → `pending_commands` → runner polls → types into zellij → results stream back via `orchestration_runs`) is complete, hardened, and visibly battle-tested by real dogfooding. The design system holds perfectly (0 token violations across `src/`), type-safety debt is low (29 `any`/ts-ignore/eslint-disable across 824 files), and the action-execution state machine is verified **fail-closed and correct**.

The two material findings are strategic, not structural. **(1) Coherence:** the flagship *propose → approve → it happens → you see it* loop is lopsided — all five executors and the approval UI are built and safe, but **almost nothing produces queue actions** (the general NL producer `/api/actions/propose` has no live caller anywhere). The product reads as "a superb fleet-command tool with a high-quality personal-CRUD app bolted alongside it," the two halves barely talking. **(2) Security:** posture is strong (no IDOR, no SQL injection, no shell injection), but there is one **fix-today** secret-leak, a cluster of unguarded/unbounded route handlers, and ~7 routes that bypass the orphaned-session recovery layer the codebase already built.

Bottom line: the scaffolding, safety, and fleet loop are excellent. The highest-leverage work is **wiring a real producer into the action queue** and **hardening the money/identity/external-fetch paths** before charging a stranger — not building more features.

## Health Score

| Area | Score | Notes |
|------|-------|-------|
| First Principles | 8/10 | 0 design-token violations, low `any` debt, no code litter. Deductions: executors-without-producers (built ahead of need), one-directional fleet↔life-OS bridge. |
| Best Practices | 8/10 | SSOT honored, structured errors, fail-closed action model. Deductions: uneven `AbortSignal.timeout` usage, ~102 `console.*` (mostly legit server logging, a few leftovers), CLAUDE.md Views table stale. |
| Mission Alignment | 7/10 | Fleet half strongly realizes "see + govern"; life-OS half is real but thinly integrated. Producer gap keeps the "life-OS run by your fleet" thesis unproven in-app. |
| Functional Correctness | 8/10 | Action state machine, dispatch loop, token/workspace auth all verified sound. Deductions: unguarded Stripe webhook + `/api/github/repos`, stale-JWT-id class bug. |
| Security | 7/10 | Consistent multi-tenant isolation, UUID validation, escaped shell. Deductions: HIGH token-leak in email fallback, MEDIUM path-traversal write primitive. |
| **Overall** | **7.5/10** | A strong, real, safe product one coherence-bridge and one hardening pass away from being sellable. |

---

## Phase 1 — First Principles

Direct metrics (my own greps, `src/` + `home/`):

- **Design system (Truth #2, SSOT):** `0` token violations (`text-gray-*`, `bg-[#...]`, arbitrary sizes). The four-layer design architecture is fully respected — a genuine achievement.
- **Type safety (Truth #6):** `29` total `: any` / `@ts-ignore` / `eslint-disable` across `824` TS/TSX files. Very low; `tsc --noEmit` clean.
- **Code litter:** `14` TODO/FIXME/HACK markers — unfinished work lives in docs, not code.
- **God components (Truth #5):** `15` components >300 lines. Largest: `ProjectOverviewTab.tsx` (565), `ControlPanel.tsx` (476), `LokiWorkspace.tsx` (472), `TerminalView.tsx` (467), `ProjectCard.tsx` (459). Candidates for a split pass, but cohesive — not urgent.
- **`console.*`:** `102` calls; the correctness agent confirmed these are overwhelmingly legitimate server-side logging. Two concrete leftovers/leaks flagged in Phase 5 (#1 leak, #9 client leftover).

**Schema-as-SSOT is genuinely well-executed** — status enums live in `constants/statuses.ts` and `$type<>()`-flow into Drizzle columns; types derive from schemas (`$inferSelect`, `PLAN_VALUES`, `ORCHESTRATION_OUTCOMES`); config layer (`channels.ts`, `subscriptions.ts`, `plans.ts`, `control-labels.ts`) is clean single-source. The real debt is concentrated in the **control/dispatch status cluster** (below).

---

## Phase 2 — Best Practices / SSOT (dedicated subagent)

### HIGH
- **`"cloud" | "local"` builder-channel union hand-declared in 7 places** — `RunnerChannel` (`pending-commands.ts:67`), `BuilderChannel` (`event-stream-types.ts:76`), `PeekBuilderChannel` (`sse-bus.ts:27`), inline prop (`TabVoiceMic.tsx:30`), + 2× `z.enum(["cloud","local"])` (`peek-frame/route.ts:16`, `tab-inject-raw/route.ts:21`). Adding a 3rd channel = 7 edits. **Fix:** `BUILDER_CHANNELS = ["cloud","local"] as const` once; derive type + zod enum.
- **Session-status magic strings across ~10 files** — `"ready"/"working"/"blocked"` gate the auto-inject **iron rule** yet are compared as bare literals with **no `SESSION_STATUS` constant** (`control-presenter.ts:62,65`, `session-state.ts:73,110`, `dispatch-gates.ts:8,54`, `control-states.ts:333,343`, `fleet-kick.ts:127`, `infer-outcome.ts:44`). A rename silently breaks the safety gate. **Fix:** add `SESSION_STATUS` to `constants/statuses.ts`, reference everywhere. *(Safety-relevant — I'd treat this as near-HIGH-security.)*
- **`orangecat-context.ts` dead** — `getOrangeCatContext`/`renderOrangeCatContext` (149 lines) have **zero importers** incl. `desktop/`; built but never wired into dispatch. **Fix:** wire into dispatch context assembly or delete.

### MEDIUM
- **API response envelope drift** — CLAUDE.md mandates `{ success, data }`/`{ success, error }`, but of 160 routes: 1 uses `success:true`, **94 use `{ ok:true }`, 123 emit bare `{ error }`, 0 use `data:`**. The documented SSOT contradicts the de-facto standard. **Fix:** adopt the `{ ok }`/`{ error }` reality, correct CLAUDE.md, add `jsonOk`/`jsonError` helpers.
- **`control-states.ts` dead accessor layer** — 7 exported fns (`projectStateDotClass`, `runnerStateLabel`, …) never called; consumers read `STATE_DEFINITIONS` directly. **Fix:** delete.
- **`StatusTone` union declared twice** (`activity-status.ts:11` as `EventStatus`, `dispatch-status.ts:69` inline as `tone`) + **`EventStatus` name collision** (same name, two unrelated meanings: `"active"|"archived"` vs `"negative"|"warning"|…`). **Fix:** one shared `StatusTone`; rename the activity one.
- **Orchestration-outcome magic strings** — `"success"/"partial"/"error"` compared as literals across ~10 files despite `ORCHESTRATION_OUTCOMES` SSOT existing. **Fix:** reference the constant.
- **3 dead query fns** — `listPromptsForProject`, `updateBeaconChoice`, and `removeSubscriptionByEndpoint` (the last is a mild correctness smell: push-subscription 410-cleanup never runs). **Fix:** wire `removeSubscriptionByEndpoint` into the 410 path; delete the others.
- ~~half-wired calendar-drain (launch-manual-only)~~ — **RESOLVED this session** in commit `b40686e`: `drainOnce` is now embedded in Fleet Runner's lifecycle (`desktop/src/main/calendar-drain.ts`).

### LOW
- Duplicated `queueBlockedReason` expression in `ProjectCard.tsx:224,373`; copy-pasted status-chip class string (`ProjectListRow.tsx:45`, `ProjectStatusChips.tsx:30`) → should be a `ui-*` class; inline `timeAgo` in `u/[username]/page.tsx:24` (use `compactRelativeDate` from `dates.ts`); dead exports (`getAgentCwds`, `readProjectsMap`, `renderPromptBody`, `EventKind`); stale doc-map comment in `control-states.ts:23`.

**Verified clean:** schema→constants status flow, `channels.ts`/`subscriptions.ts`/`plans.ts` SSOT, `route-helpers.ts` (id/body/unique-violation helpers used), the five god components are large-but-cohesive (no split warranted on size alone).

---

## Phase 3 — Mission / Product Coherence

**Verdict:** coherent and close to the "captain layer" vision on the *fleet* half; the *life-OS* half is real but bolted-on. The single highest-leverage fix is wiring a producer into the action queue and feeding life-OS state into agent dispatch context — that one bridge collapses "two halves" into the unified *life-OS-run-by-your-fleet* the mission describes.

**View reality check** (CLAUDE.md Views table is **stale** — Duet is retired; Loki/Terminal/Activity are the real first-class fleet views):

| View | Rating | Note |
|------|--------|------|
| Control | Real | Live DB + zellij tabs + SSE; runner-stall detection |
| Agents | Real | Parses live `inbox-*.md` + open tabs |
| Duet | **Stub (retired)** | `page.tsx` redirects to `/agents`; CLAUDE.md still lists it active |
| Today / People / Money / Goals / Habits / Events | Real | All DB-backed, computed stats, no hardcoded metrics |
| Projects | Real | Production-grade: CI, inline editors, dossier, public share tokens |
| Prompts / System / Memory / Thoughts / Settings | Real | Live data, real host syscalls, Stripe/token/PIN config |

**Top coherence problems:**
1. **Action queue has executors but no producers.** Only `proposeAction` caller is the profile-edit path; `/api/actions/propose` has no live caller. `/api/loki` chat is pure text-in/out — never queues an action. The SEND_MESSAGE / SEND_EMAIL / CREATE_EVENT executors (incl. the calendar-drain shipped this session) are built for actions almost nothing generates.
2. **Dead rendering logic:** `ActionQueueCard.tsx` groups stale-contact "check-in" actions no producer creates.
3. **Fleet↔life-OS bridge is one-directional + thin:** `loki-fleet-context.ts` injects only projects + RAG into dispatch — never goals/commitments/habits/people.
4. **Doc drift signals scope churn:** Views table stale; `/decisions`, `/digests`, `/history` are vestigial redirects.
5. **Two-Loki ambiguity:** chat-advisor `askLoki` vs the OpenClaw agent-with-hands; `loki-core.ts` invests heavily in preventing over-claiming precisely because the split confuses even the model.

**Strongest / most core to mission:**
- **The Control dispatch loop** — `pending-commands.ts` uses `FOR UPDATE SKIP LOCKED` claiming, per-project FIFO serialization, stale-claim reclaim, and execution-stall detection distinct from the sync heartbeat. This is see+govern-your-fleet, working.
- **The action-execution safety model** — nothing reaches `executed` without a real successful effect; the IRON RULE (only `approved` executes) is enforced at the SQL guard level; unwired types defer honestly.
- **The cloud↔local execution split** — the `drain-events` seam books calendar events on the operator's machine with `actions` as sole SSOT. Correct answer to "captain in the cloud, hands on the operator's machine."

---

## Phase 5 — Functional Correctness & Security

**Posture: strong.** Multi-tenant isolation applied consistently (every `[id]`/`[tab]` route derives `userId` from the session, never the body; every query constrains by `userId`; all `[id]` routes validate UUID via `readIdParam`; all 7 `runTool` sites use constants/escaped/validated input; crons cron-secret-gated; Stripe webhook signature-verified). No confirmed cross-tenant IDOR, SQL injection, or shell injection.

**Findings (severity → file:line → scenario):**

1. **HIGH — CONFIRMED — reset/verify tokens leaked to stdout.** `src/lib/email.ts:35` — when `RESEND_API_KEY` unset, `sendEmailFire` `console.log`s the full body, incl. the live one-time reset/verify token URL → account takeover for anyone with log access. (The awaitable `sendEmail` correctly does not.)
2. **HIGH — CONFIRMED — unhandled `/api/github/repos`.** `route.ts:17-48` — no try/catch, `fetch` has no timeout, `res.json()` unguarded → 500+stack or indefinite hang on slow/malformed GitHub.
3. **HIGH — CONFIRMED — unhandled DB in Stripe webhook.** `stripe/webhook/route.ts:26-64` — sig check is fine, but `getUserByStripeCustomerId`/`updateUserBilling` aren't wrapped → a DB blip on `subscription.updated` throws 500 and leaves the user on the wrong plan. Fix: wrap the switch, return 500 deliberately so Stripe retries.
4. **MEDIUM — CONFIRMED — stale-JWT-id bypasses `resolveSessionUserId`.** `control/commands/route.ts:17`, `project/bootstrap:102`, `project/sync:16`, `project/ai-brief:50`, `project/clear-context:16,30`, `invitations`, `checkout/[plan]`. A valid 30-day JWT can outlive its user row (reseed/restore) — the exact cause of "21 projects went invisible." These skip the email-recovery fallback. Fix: route through `resolveSessionUserId()`/`getApiUserId()`.
5. **MEDIUM — CONFIRMED — unbounded external fetches (no timeout):** `github-provision.ts:48,106,149`, `weather/route.ts:19`, `integrations/orangecat-publish.ts:61,151`, `x-oauth1.ts:65,84`. Pattern already exists (`AbortSignal.timeout` in `rag/embeddings.ts`) — apply evenly.
6. **MEDIUM — CONFIRMED — path-traversal write primitive.** `beacon/queue/[tab]/route.ts` → `prompt-queue-mirror.ts:8-15` — `[tab]` lowercased but not checked for `/`/`..` before `fs.writeFileSync(/tmp/agent-queue-<tab>)`; **not** gated behind `isRuntimeAvailable()`. Fix: reject tabs containing `/` or `..`.
7. **LOW — `/api/github` + `/api/calendar` return local-tool data with no auth check** (mitigated: hosted box leaves `RUNTIME_AVAILABLE` unset). Add `getApiUserId()` gate like `/api/weather`.
8. **LOW — `/api/project/commit` accepts arbitrary `dir`** (shell-escaped, runtime-gated; path-authorization gap, operator's own FS).
9. **LOW — client debug leftover** `FleetRunnerAutoMint.tsx:73` (no token value).
10. **LOW — unescaped LIKE wildcards** in project-name `ilike` (`projects.ts:159,346` et al.) — parameterized + user-scoped, over-match only.

**Verified sound (checked, not bugs):** the action approval/execution state machine (`proposeAction` inserts `draft` only w/ dedup index; `approve`/`reject` guard on `draft`; `markActionExecuted` guards on `approved`, idempotent; `executeAction` fail-closed); `claimNextPendingCommand` (`FOR UPDATE SKIP LOCKED`, per-user); agent-token validation; workspace ownership; last-auth-method disconnect guard; PIN rate-limiting; `escapeLike` in people search.

---

## Phase 4 — Improvement Roadmap (prioritized)

### 🔴 Do this week (security + correctness, small)
1. **Redact email body in `sendEmailFire`** (email.ts:35) — never log reset/verify token URLs. ~2 lines.
2. **Guard the Stripe webhook + `/api/github/repos`** — try/catch + `AbortSignal.timeout`. Money/identity path.
3. **Reject `/` and `..` in the beacon `[tab]` param** (prompt-queue-mirror) — close the write primitive.
4. **Route the ~7 raw-`session.user.id` handlers through `resolveSessionUserId()`** — kill the orphaned-session class for good.
5. **Add `SESSION_STATUS` constant** and replace the bare `"ready"/"working"/"blocked"` literals — these gate the auto-inject iron rule; a silent rename breaks the safety gate.

### 🟠 The coherence bridge + SSOT (medium, highest strategic leverage)
6. **Wire a real producer into the action queue** — make chat-Loki (or the OpenClaw gateway agent) actually POST proposals to `/api/actions/propose`. This makes the five executors (and the calendar-drain) *do something*.
7. **Feed life-OS state into dispatch context** (`loki-fleet-context.ts`) — goals/commitments/people, not just projects+RAG. Collapses the "two halves."
8. **Collapse the control/dispatch status cluster to SSOT** — `BUILDER_CHANNELS` (kills the 7-place `"cloud"|"local"` dup), reference `ORCHESTRATION_OUTCOMES`, single `StatusTone`, fix the `EventStatus` collision.
9. **Reconcile the API-envelope contract** — adopt the real `{ ok }`/`{ error }` shape, add `jsonOk`/`jsonError`, correct CLAUDE.md.
10. **Apply `AbortSignal.timeout` evenly** across the remaining external fetches.

### 🟡 Hygiene (cheap, when touching the area)
11. Delete dead code: `orangecat-context.ts` (or wire it), `control-states.ts` accessor layer, 3 dead query fns (wire `removeSubscriptionByEndpoint` into the 410 path), stray dead exports.
12. Update the CLAUDE.md Views table (retire Duet, add Loki/Terminal/Activity).
13. Remove the dead check-in grouping in `ActionQueueCard` (or wire the producer that justifies it).
14. Small dup fixes: `queueBlockedReason` reuse, status-chip → `ui-*` class, inline `timeAgo` → `compactRelativeDate`.

### Strategic (aligned with master-plan-2026-07)
- **Phase 0 — verify the OrangeCat bridge loop live** (login + publish + promote, with a human witness). Days of work; converts the whole strategy from claim to fact.
- **Phase 1 — open the BYO-runner SaaS tier** + flip Stripe live. First paying customer.
- **Phase 3.5 — tests on money/identity paths** (OIDC RP, publish/promote idempotency, Stripe webhook) before a stranger pays.

---

## Action Items (single prioritized list)

1. Fix the email token leak (email.ts:35) — **today**
2. Guard Stripe webhook + `/api/github/repos` (try/catch + timeout)
3. Reject path separators in beacon `[tab]`
4. Migrate raw `session.user.id` handlers to `resolveSessionUserId()`
5. **Wire a producer into the action queue** (chat-Loki / OpenClaw → `/api/actions/propose`)
6. Inject life-OS state into dispatch context
7. Even out `AbortSignal.timeout` on external fetches
8. Verify the OrangeCat bridge loop live (master-plan Phase 0)
9. Doc/hygiene: Views table, dead check-in UI, god-component splits
10. Tests on money/identity paths before opening the doors
