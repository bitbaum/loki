---
title: Prompt Intelligence — Why Plumbing Was Not Enough
summary: A migration from "infrastructure-only auto-inject" to a strategist that composes context-aware prompts. Closes the gap between the queue, the agent, and the user's actual intent.
excerpt: We spent thirty commits making the queue durable, the status field model-agnostic, and the daemon honest. None of that made the injected prompt smarter. This is the work that does.
publishedAt: 2026-05-20
supersededBy: /whitepaper
tags: agents,prompts,orchestration,strategist,architecture
featured: false
author: g
readingTimeMin: 12
---

## The Gap That Took Two Audits To See

Over the last two weeks Loki's orchestration layer got steadily more correct: per-project `status` gating so auto-inject only fires when the agent self-reports `ready`, queue moved from `/tmp` to `project_states.prompt_queue`, daemon heartbeat to keep the cloud's view fresh, queue context plumbed into the dispatched prompt body, click-to-expand on truncated working banners, the lot. All real. All shipped. None of it changed what the model actually reads when it wakes up.

The injected prompt is still one of two ladders.

**`renderTaskForAdapter` in `src/lib/orchestration/renderers.ts`:**

```
Work on the project at <path>.
Before choosing work, scan in order:
1. interrupted or uncommitted work to resume
2. failing tests or broken flows
3. SSOT / DRY / quality violations
4. mission or product misalignment
Pick the highest-impact item and execute it fully.
```

**`~/.config/agent-prompts.json` consumed by `scripts/agent-hook-bridge.sh`:**

```
Run `git status && git log --oneline -10`. Then run `npx tsc --noEmit`…
Work in this order: type errors → uncommitted work → session next: → highest-impact gap.
One thing. Done and committed.
```

Two templates, same intent ID, slightly different text. Cursor's audit caught it; this doc is the migration plan.

The user's own custom prompts in `prompt_history` look nothing like either ladder. They name the bug verbatim ("Failed to load chunk … and the login email / password doesn't work"), they include constraints ("auth first, not release yet"), they often correct the orchestration system itself ("why was `continue` injected — is this SSOT?"). The auto-inject text is a generic triage scan that fires on a timer and produces work that drifts away from whatever the user last cared about.

The system has two halves and only one of them is intelligent.

## The Two Halves

| Half | What it does | Who wrote it |
|---|---|---|
| Plumbing | Get bytes from queue → DB → daemon → zellij → agent | Code (now solid) |
| Prompt | Decide what bytes to send | Static template (still dumb) |

The May 18 vision — *"go to bed, wake up to good work"* — needs the second half to be at least as smart as the first.

## What "Smart" Looks Like

Not a new model. Not a new service. The Groq call in `/api/control/dispatch` already has access to the right context: latest session handoff, queue head + tail, recent commits, outcome streak. Today it returns `ACTION: QUEUE | NEXTBEST + REASON` — a two-way classifier in 100 tokens. The strategist v1 promotes that same call to compose the *full prompt body* the agent receives, with a third action:

```
ACTION: QUEUE_ITEM | COMPOSED | NEXTBEST
PROMPT: <full text to inject, ≤4000 chars>
REASON: one sentence
```

- `QUEUE_ITEM` — fire `queue[0]` verbatim (unchanged behavior; fast path when the user has been explicit).
- `COMPOSED` — Groq writes a fresh prompt body using the handoff's `next:`, the queue tail, the last commit message, and the outcome streak. This is what closes the gap.
- `NEXTBEST` — explicit fallback to the SSOT next_best template (rarely; only when the strategist genuinely can't find a more specific direction).

The hard gates stay where they are: `status === 'ready'` agent-side, health-critical → recovery intent, manual click bypasses everything. The strategist only chooses *what to compose*, not *whether to fire*.

## What's Being Shipped

In order, smallest blast radius first.

### 1. One database for cloud and local stack

Local cockpit-app on `localhost:3000` has been pointed at a local Postgres for dev convenience. The hosted app on Vercel has always used Neon. The user's queue items, project rows, and `prompt_history` all live in Neon — the local Postgres is a near-empty dev artifact (2 users, 3 cockpit-ish project rows, zero non-empty queues at the time of this writing).

The split caused real bugs: yesterday's `/api/control` GET sync (commit `58e4366`) and `/api/control/runtime-state` POST sync (commit `eadb392`) both mirror DB → `/tmp/agent-queue-<tab>` when called from a local cockpit-app — but they query whichever DB the local cockpit-app is configured for, which has been local Postgres, which has been empty. The home/ queue badge from `3c78208` correspondingly read `/tmp` and reported zero queued even when Neon had pending items.

The fix is one line in `.env.local`: point `DATABASE_URL` (and `NEON_DATABASE_URL_DIRECT` for migrations) at Neon. Existing local data is preserved untouched (just no longer authoritative). Restart `cockpit-app`. Done.

### 2. SSOT one `next_best` template

The two templates that have diverged converge on the bash-hook version's shape, which Cursor noted is the better one: concrete commands ordered by priority, not abstract scanning categories. The repo-side source moves to that style in `src/lib/orchestration/renderers.ts:renderIntentBody`. The user-managed `~/.config/agent-prompts.json` is left to the user — it's their stored template, not in the repo — but is documented as a layer that should match.

### 3. Strategist v1 — `/api/control/dispatch` writes the prompt

`buildPrompt()` already constructs the system prompt that asks Groq to pick between queue and nextbest. Two changes:

- The Groq prompt asks for the new three-action protocol with an optional `PROMPT:` body.
- The response parser handles the third action and returns `prompt` alongside `reason`.

`DispatchResult` gains an optional `prompt: string | null` field. The caller — `handleAutoInject` in `src/hooks/use-project-card-actions.ts` and the beacon's parallel path — picks up the composed body and injects it as a custom prompt (going through `onInject` with `customPrompt`) rather than firing the canned `next_best` intent.

`maxTokens` on the Groq call jumps from 100 to ~1500 to give room for a composed body. Temperature stays low (0.2) so the strategist sticks to the facts in context rather than improvising fiction.

Failure mode is the existing one: if Groq times out, errors, or returns malformed output, fall back to queue head → next_best. The strategist is additive, not load-bearing.

### 4. `autoInjectMode` flag

A new per-user (or per-project) setting in `beacon_settings`:

```
auto_inject_mode: 'strategist' | 'queue_only' | 'next_best' | 'off'
```

- `strategist` (default) — full chain: queue → strategist → next_best fallback.
- `queue_only` — only fire queue items; never auto-compose, never next_best.
- `next_best` — legacy behavior (raw template, no strategist call). For users who want the current ladder.
- `off` — disable auto-inject entirely; user dispatches by hand.

`handleAutoInject` respects the mode. Default for existing users is `strategist`, which is a behavior change — the migration note is that this is the intended product direction and the user can opt back into `next_best` if they prefer the old ladder.

### 5. Sentinel-ordering fix — read once, cleanup at end

In `scripts/agent-hook-bridge.sh:handle_stop`, the runId sentinel is read once at the top into a local, both `finish_orchestration_run` and `emit_worker_finished` consume the local, and the sentinel is deleted exactly once at the end. This is the "read-once" shape Cursor described — smaller diff than the swap I'd tried before, no logic change inside either function.

## What's Deliberately Out of Scope

- A separate strategist service or worker pool. The existing Groq call is enough for v1.
- A persistent prompt-evaluation feedback loop ("did this composed prompt produce a useful outcome?"). That's v2.
- Multi-project queue intelligence (compose across projects). Single-project for now.
- Replacing the bash hook's prompt file. User-owned config, left alone.

## Success Signal

After this lands, if you write `status: ready` in `Loki.md` and walk away, the next thing your terminal receives is either (a) the top queue item you actually queued, or (b) a Groq-composed prompt that names what you said you'd do next, references the last commit's failure if there was one, and asks for the specific work — not "scan in order: 1, 2, 3, 4."

If you wake up and see "Pick the highest-impact item and execute it fully" again, the strategist has failed and we revert to the gate.

## Provenance

This document is the synthesis of two audits — Cursor Composer 2.5's first pass on this codebase, and Claude's response refining it. The actual implementation commits will reference this file.
