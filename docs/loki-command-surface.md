# Loki — the conversational command surface

**Status:** shipped (Phases 1–4 partial). This document started as the
design spec for the original vision and is retained as the rationale of record; the
**Shipped state** note below tracks what is actually live. See the `loki`/`control`
commit series in git history for the implementation.

**Last modified:** 2026-06-30 — Grok-like composer pass; multi-project chips inside the composer; explicit Control/Terminal dispatch card.

> **Scope note (2026-09-11).** This document covers the COMMAND surface — the
> composer, project resolution, and the dispatch fast paths. It says nothing
> about how Loki *answers* a question, because none of that existed when it was
> written: the grounding harness, the typed fact set, the retrieval planner, the
> model chain and the prompt budgets all came later. For the answering pipeline
> see **`docs/architecture/loki-answering.md`**. Where the two disagree about
> anything post-June, that one is current and this one is history.

### Shipped state (verified in the running app)

The Loki page (`/loki`) is live and in daily use as the dogfood surface. Confirmed working:

- **Single surface:** the shell FAB and `?` shortcut navigate to `/loki` (no chat-only
  modal). `loki:open` events from Control/Projects prefill the composer via `?q=` or
  an in-page `loki:prefill` event when already on `/loki`.
- **The command composer (§3):** one natural-language field; resolves the project named in
  the text (e.g. "for loki, …" scopes to the `loki` project) and routes the
  message to **dispatch** vs **chat** automatically.
- **Fleet fast paths:** "list my projects" returns the registered fleet from Postgres (no
  web search). "create project …" registers via `createUserProject`; "…and let's go"
  dispatches `next_best` on the new project. **"develop all my projects"** runs batch
  `fleet-kick` (respects multi-select on the right pane).
- **Fleet kick (Control):** **Start building** turns autopilot on and kicks up to three
  idle projects with `next_best`; reactive loops continue when agents finish.
- **Subset loops:** check projects on Control → **Build selected** / **Pause selected**;
  in Loki, multi-select + a command fans out to all selected (e.g. code review on three).
- **Screenshot → dispatch:** attach a screenshot with a project scoped — default ask or
  implement/fix language dispatches (vision text + `ux_review` when appropriate), not chat.
- **Business plan:** "generate/iterate business plan for `<project>`" calls the same
  `generateBusinessPlan` path as the Projects UI — persists plan + actions, links to
  `/projects?open=…`.
- **Profile updates:** "set/update `<field>` to …" queues an action draft on Today;
  approving executes `upsertEntityAttribute` (or description patch) — no silent writes.
- **Ambiguous dispatch:** when a command has no project, the transcript shows tappable
  project chips (plus the right-pane selector). Picking a chip re-dispatches without
  duplicating the user turn.
- **Develop handoff:** "let's develop/build" with one selected project, one fleet project,
  or a named project dispatches `next_best` instead of chatting.
- **Project-aware chat:** chat turns scoped to a selected or named project inject the same
  `getProjectContext` profile (mission, stack, goals, DoD) as dispatch — without running the agent.
- **The Loki page (§4):** the 3-pane layout shipped as specced — conversation list (left),
  transcript (center) with the composer at the bottom, and the selectable **Projects**
  panel (right). Project tiles surface each project's active goal as a subtitle.
- **Composer affordances (§4):** one large Grok-like input owns the whole command:
  selected-project chips, quick actions, text/screenshot attach, voice, compact model
  picker (`Auto` by default), and send. Multiple selected projects are shown as chips
  inside the composer and can be removed there.
- **Dispatch parity (§5):** a Loki dispatch produces the same `pending_command` → builder →
  agent-terminal path as a Control "Next best" click. Dispatch bubbles show a status
  card with target, runner state, and direct links to **Control state**, **Cloud terminal**,
  and **This computer** — full interactive xterm (type directly, not watch-only).
- **Move forward:** "move forward", "keep building", "make progress", etc. dispatch
  `next_best` when one project is selected; otherwise batch `fleet-kick` (same as Control
  Start building scope). When the cloud builder is online, queued dispatches show
  **With builder — starting shortly** (not "builder offline").
- **Fast project load:** `/loki` server-prefetches the project list and conversation
  history (no stuck "Loading…" panes). `?project=loki` auto-selects that project;
  a sole registered project is selected by default.
- **A project link opens that project's thread (2026-10-12):** `/loki?project=X`
  without `?c=` (Ask Loki from a project, the terminal, Control) opens X's most recent
  thread when it was active in the last 14 days, instead of an empty start screen
  whose next message would mint another thread. A `?q=` prefill still starts fresh.
  `initialThreadId` in `lib/loki/conversation-param.ts`.
- **The rail is an inbox (2026-10-11):** every row says what the thread needs —
  a project pick, a run that failed, a run that finished since you last looked,
  nothing — derived from its last message (`lib/loki/thread-state.ts`) and the
  thread's `last_read_at`. Rows sort by that before recency; pinned threads stay on
  top; "By project" folds the same rows under one header per project with its
  counts. The start screen carries the same counts as one line of taps.
- **Threads are named for what they are about (2026-10-12):** once the first answer
  lands, Loki asks the fast model for a 2–6 word title from the exchange
  (`lib/loki/thread-title.ts`, `POST /api/conversations/[id]/title`). It replaces only
  a title that is still the placeholder or the derived opening line — a person's own
  name is never overwritten. Rename by clicking the title in the desktop top bar, or
  "Rename" in the phone's thread menu. Neither naming nor renaming bumps recency.
- **Approve where it was proposed (2026-10-12):** an answer that queued an action
  (a message, an event, a commitment) carries a card under it with **Do it** and
  **Not now**, decided through the same `/api/actions/[id]/decision` path as the
  Approvals page. It reads the action's real status on load
  (`/api/actions/[id]/status`), asks for the private-zone PIN in place when the zone
  is locked, and says plainly what happened: done, waiting in Approvals because no
  executor exists for that kind, failed with the reason, declined, or expired
  (`lib/loki/queued-action-view.ts`).

Open questions §6 #1 (chat vs command — both, routed by intent resolution) and #2
(dispatches go to the project's existing session; the conversation is the human-readable
log) are resolved the way the doc was leaning. The remaining design notes below are kept
for context.

This document covers two related-but-distinct ideas, kept in separate sections so they
don't blur together:

- **§3 — The command composer** (one field; natural language; auto-selects the project
  you name; reduces decisions).
- **§4 — The Loki page** (a ChatGPT/Claude/Grok-style page: one composer, a conversation
  list, a project filter).

They converge (§5): the Loki page is where the composer lives, but the composer behaviour
is also useful inside Control/Terminal, so it's specified on its own.

---

## 1. The problem: cognitive load

To make an agent do something today, the operator must hold the *UI's structure* in their
head and make several decisions before any work starts:

1. Which page? (Control vs Terminal vs Prompts.)
2. Which project? (find + select the card.)
3. Which action? (an intent button, or hand-write a prompt.)

That's 3 decisions + spatial memory of the app, every time. The north star is to drive
that toward **one decision, expressed in words**: *say what you want; the system figures
out where and how.*

> "I want to do a code review for kivvi" → it selects kivvi and runs the review. No card
> hunting, no intent button, no prompt authoring.

## 2. The key architectural insight (why this is cheap)

Terminal, Control, and Loki are **three rungs of one ladder** — all of them are "tell an
agent what to do," at decreasing cognitive cost:

| Rung | Surface | Input | Cognitive load | Who |
|------|---------|-------|----------------|-----|
| Low-level | **Terminal** | raw keystrokes | high (you drive the shell) | power user, debugging |
| Mid-level | **Control** | pick project + intent | medium | operator managing the fleet |
| High-level | **Loki** | natural language | low (system infers) | everyone, default |

Loki does **not** need a new execution engine. It sits *above* the dispatch backend that
already exists and that the autopilot loop already uses:

```
Loki composer → parse NL → { project, intent|prompt } → existing dispatch
   (the same /api/control/dispatch + runner injectPty path we just hardened)
```

So Loki is a **new front-end over the same backend**. The composer's only new logic is
*resolution* (NL → project + intent), which is one cheap LLM classification call.

## 3. The command composer (Thread C)

**Behaviour:**
- One text field. You type intent in natural language.
- **Project resolution:**
  - If a project is **explicitly selected** (Loki right panel / Control card) → scope there.
  - Else if the text **names a project** ("…for kivvi", "kivvi: …", "on revampit") → match
    against the project registry (`agent-projects.conf` / entities) and auto-select it.
  - Else **ambiguous** → ask a one-tap disambiguation ("Which project?") rather than guess.
    (Later: bias toward the most-recent / most-active project; see §6.)
- **Intent resolution:** map the phrase to an existing `ORCHESTRATION_INTENTS` id when it
  matches a known verb ("code review" → review, "fix types"/"tests" → test_and_fix,
  "next best"/"keep going" → next_best, "commit" → commit_push, "audit" → full_audit),
  otherwise pass the text through as a free-form prompt. SSOT for the verb→intent map lives
  next to `src/config/control-intents.ts`.
- Resolution is a fast model call (cheap tier) returning `{ projectKey|null, intentId|null,
  prompt }`; low-confidence → ask, don't assume.

**Why it reduces load:** collapses "page → project → action" into one sentence, and degrades
gracefully (explicit selection always wins; ambiguity asks instead of misfiring).

## 4. The Loki page (Thread D)

A new top-level page **above Terminal** in the nav. Layout mirrors ChatGPT/Claude/Grok:

```
┌── left (collapsed nav) ──┬──────────── center ────────────┬──── right ────┐
│ Conversations            │  Conversation transcript        │ Projects      │
│  • kivvi: review (2m)    │  (messages: you ⇄ agent/Ivy)    │ [x] kivvi     │
│  • revampit: workshops   │                                 │ [ ] revampit  │
│  • orangecat: …          │                                 │ [x] orangecat │
│                          │                                 │ …             │
│                          │  ┌── composer ───────────────┐  │  (select/    │
│                          │  │ 🎤  type a command…   📎 ⌄ │  │   deselect    │
│                          │  └────────────────────────────┘ │   filters     │
│                          │     mic · attach · model picker  │   convos)     │
└──────────────────────────┴─────────────────────────────────┴───────────────┘
```

- **Left:** the main nav minimizes to a **conversation list** (most-recent first), like
  ChatGPT threads.
- **Center:** the active conversation transcript + the composer (§3) at the bottom, with
  **microphone** (voice → transcribe → composer), **file attach**, and a **model picker**.
- **Right:** **all projects**, each selectable. Selecting/deselecting projects **filters the
  conversation list** to those projects (and scopes new messages to the selected set).
- **Conversations** are persistent threads, each tagged with 0..n projects. A message in a
  conversation either (a) is answered (chat with Loki about the project) or (b) dispatches
  work to the project's agent — decided by the same intent resolution as §3.

## 5. How Loki relates to Control and Terminal

- **Loki = the front door** (low cognitive load, conversational). Becomes the default.
- **Control = the dashboard** (see every project's live state, autopilot toggles, the fleet
  at a glance). Loki links into it ("open kivvi in Control").
- **Terminal = the workbench** (watch the agent PTY — Cloud on Hetzner or This computer via
  the desktop app). Loki does **not** type into Terminal directly; it enqueues work the builder runs.
- A Loki "dispatch a command" and a Control "Next best" click produce the **same**
  `pending_command` → builder (box-runner or Fleet Runner, chosen by the project's stored
  routing decision) → agent CLI in a PTY the builder owns. One backend, three altitudes of UI.

### Build chain (what happens when you talk to Loki)

```
You → Loki composer → resolveCommand / fleet fast paths
  → injectPrompt() → pickDispatchChannel: locus lock → "Runs on" (builder_pref) → cloud floor
  → pending_commands (Postgres)
  → the chosen builder claims the job (cloud box-runner OR desktop Fleet Runner)
  → written into the builder-owned PTY (node-pty) → Claude / Codex / …
  → watch on Terminal (source=server | source=machine)
```

- **Chat turns** (`askLoki`) answer questions — they do **not** run agents.
- **Dispatch turns** run work — same queue as Control. The builder is the project's stored
  choice, not whoever is online: an offline chosen builder queues visibly
  (`runnerConnected: false`) and is never rerouted.
- Loki is connected to the **builder queue**, not to the xterm WebSocket. Terminal is a **view**
  of whichever machine is executing that project's session.

## 6. Open questions (need Mao's call before building)

1. **Chat vs command vs both.** Is a Loki message primarily *talking about* projects (Loki
   answers) or *commanding* agents (work runs), or both in one thread? (Leaning: both, with
   intent resolution routing each message.)
2. **Conversation ↔ session.** Does a conversation own a long-running agent session, or are
   dispatches fire-and-forget into the project's existing session? (Leaning: dispatches go to
   the project session; the conversation is the human-readable log + control thread.)
3. **Ambiguous project** with no selection and no mention: ask, or default to most-recent/most-
   active? (Leaning: ask first; learn to pre-select later.)
4. **Model picker** scope: which models, and does it map to agent adapters (Claude/Codex/etc.)?
5. **Voice + attachments**: transcription via shared voice hook; **images** are vision-described server-side (Groq Llama 4 Scout) and folded into chat + dispatch prompts; text files remain inline.

## 7. Phased plan

- **Phase 0 (done):** server terminal made usable (input no longer scrambles); this doc.
- **Phase 1 (done) — composer with NL resolution:** natural-language → `{ project, intent|prompt }`
  resolution shipped; naming a project in the text auto-scopes the dispatch.
- **Phase 2 (done) — Loki page scaffold:** conversations + the 3-pane layout; composer wired to
  Phase-1 resolution; chat via Loki; dispatch via the Control backend; projects panel on the right.
- **Phase 3 (done) — affordances:** microphone, file attach, and model picker are live.
- **Phase 4 (partial) — learned context:** project tiles surface each project's active goal;
  fleet list/create fast paths and ambiguous-dispatch project chips shipped; still open:
  pre-selecting the likely project from an unscoped message and surfacing suggested
  next commands (the cognitive-load north star).

## 8. Cross-references

- **Engineering standards (non-negotiable):** build this per `CONTRIBUTING.md` →
  "Engineering Standards" and the global standards imported in `CLAUDE.md` —
  SSOT, DRY, SoC, no god files, no hardcoded values, the four-layer design system,
  config-driven, first-principles. The resolver derives intent ids from
  `ORCHESTRATION_TASK_INTENT_IDS`; the composer reuses the existing dispatch path
  and `ui-*` classes rather than re-rolling either.
- Terminal parity / usability: `docs/terminal-parity.md` (Thread A — separate concern).
- Cleanup of organic-growth cruft: `docs/debt-reduction-roadmap.md` (Thread B).
- Dispatch backend Loki builds on: `docs/architecture/agent-execution-platform.md`,
  `src/config/control-intents.ts`, the runner inject path (`desktop/src/main/poller.ts`).
