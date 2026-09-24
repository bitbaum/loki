# Loki Feedback Widget

**Created:** 2026-07-17  
**Last modified:** 2026-09-17
**Last modified summary:** Added reporter claim links, personal tracking, visible submission times, and project-level editor authorization.

**Status**: COMPLETE 2026-07-28. Phases 1–4 implemented 2026-07-17 — four
`feat(feedback):` commits (ingest spine, embed bundle, inbox + dispatch,
self-dogfood); find them with `git log --oneline --grep 'feat(feedback)'`.
Prod activation done 2026-07-17 (box DDL + FEEDBACK_WIDGET_TOKEN). Customer #1
cutover done 2026-07-28: revampit/evig prod (revampit.orangecat.ch) loads the
embed via `LokiFeedbackEmbed` (revampit main 90bfb3497; retired React
widget deleted in 6341ac7f1), verified e2e — a prod submission lands in this
inbox. Hardening learned from the cutover: the OPTIONS preflight reflects
`Access-Control-Request-Headers`, because customer sites monkey-patch
window.fetch and stamp extra headers (revampit stamped x-csrf-token) onto the
widget's cross-origin POST — a hardcoded allowlist silently drops submissions.
The per-token Origin allowlist in POST remains the security boundary. Embed
supports `data-fc-bottom` to offset the FAB above a host site's own FAB.

## Captain loop (one-click north star)

```
Enable & install (Control coverage / project Widget)
        ↓
Visitor FAB on every managed site  →  POST /api/feedback
        ↓
Control strip (auto-expands)
        ↓
  1 item  →  Dispatch fix
  2+      →  Dispatch all as one   (preferred for a single coherent pass)
  3+      →  Synthesize themes    (optional second triage gate)
        ↓
injectPrompt SSOT  →  local Fleet Runner if connected, else cloud builder
        ↓
Run succeeds  →  feedback auto-resolves (+ optional reporter email)
```

## People and permissions

The feedback row has three distinct actors. Keeping them distinct is the
multi-tenant security boundary:

- **Reporter:** the widget returns a 30-day HMAC-signed claim URL after the DB
  insert. The success view stays open and offers **Track this feedback**. After
  sign-up/sign-in, that one row is linked through
  `site_feedback.reporter_user_id` and appears at `/my-feedback`. A reporter can
  read their own text, submission timestamp, project name, and implementation
  status. They cannot read the project inbox or call a mutation route.
- **Editor:** an owner adds an existing Loki account by email in the project's
  Feedback tab. `project_memberships` grants `editor` or `viewer` per entity
  project. Editors can read, triage, and Implement feedback; execution still
  uses the owner's project and runner tenant. Viewers are read-only.
- **Owner:** the `user_projects.user_id` owner retains project identity,
  runtime credentials, billing, and membership management. Project membership
  never copies or transfers those credentials.

All feedback mutation routes resolve `getProjectAccess` before acting. UI
capabilities follow the same API result. Contact text is not identity and never
grants access. Every operator row renders an exact `Submitted <date, time>`;
relative ages remain appropriate only for runtime activity.

**You do not choose a terminal.** Dispatch never targets “this Cursor chat” or
“Loki’s Terminal page” directly. It injects into the **project’s agent
session** through `injectPrompt` (`src/lib/inject-core.ts`), which runs where the
project’s stored routing decision says (`pickDispatchChannel`: locus lock → “Runs
on” → cloud floor); an offline chosen builder queues visibly and is never rerouted. Control / Terminal / Loki are captain surfaces that *also* call the
same SSOT — feedback Dispatch is that path with a composed prompt.

### Surfaces

| Action | Where |
| --- | --- |
| Enable & install (token + agent embed) | Control coverage strip; project Widget card |
| Review open reports | Control feedback strip (new + in-progress); `/projects/{id}#feedback` |
| Implement / Retry | Same rows — status is **Not started → Queued → Working · N min → PR #N · open → merged → Live · confirm → Done** (or **Not running / Stalled / Failed**). A project with no repository and no folder gets **Connect a repository** instead of Implement, and the dispatch route refuses the same case with a 422 |
| Watch live output | **Watch** on the feedback row — short step summary from the run ledger + dig-in event trail; **Terminal** once a PTY exists (`source=cloud`). Queued without a builder is **Builder offline** under Needs you (Telegram), never “moving on its own” |

| Widget modes | Embed panel is **Loki-on-the-site**: `data-fc-modes` picks Chat (default) / Report / Watch (`widget/surface-modes.ts`; unshipped modes render no control). **Chat** talks to Loki (development agent) or Cat (OrangeCat's economic agent) — agents in `widget/agents.ts`, personas in `src/config/widget-agents.ts`, served by `/api/widget/chat` (fcw_* token + origin allowlist, stateless, streamed). "Send to Loki to build" hands the conversation to `/api/feedback` as a brief; Cat cannot move money and hands off to `/dashboard/cat` on OrangeCat. Watch is still a seam |
| Who merges | **Ship fixes automatically** is a per-project switch (`user_projects.auto_ship`, Feedback section on the project page). Off — the default, and what an unset project gets — the row asks the operator to merge. On, Loki merges **the pull request its own dispatch opened, and nothing else**, once GitHub says mergeable and every check passed. Deliberately NOT an `auto-merge.yml` in the customer's repo: that would be a commit in someone else's repository, would need back-filling into repos Loki never provisioned, and would merge any green PR including a person's. Conditions and their wording live in `src/lib/feedback/auto-ship.ts`; **a repository with no checks is a hold, not a pass** (absence of red is not evidence), and one failed deploy pauses the project until that fix is sorted |
| Who is told | Three announcements, not one. A visitor filing (`notify-new.ts`), an agent's run closing (`notify-close.ts`), and — the one that matters — **a fix reaching the live site or failing to deploy** (`notify-shipped.ts`, alert types `fix_live` / `fix_deploy_failed`). The third exists because a run closes at a PULL REQUEST: telling someone "the agent finished" is the same claim the ledger was built to stop making. It fires on a ledger TRANSITION only (the inbox polls every 8s), so each fix announces at most once, and it names whether Loki merged it automatically — the fact an operator needs to keep trusting that switch |
| Grouping | Sections are **Needs you / Under way / Shipped**, keyed on `work.waitingOn` (`src/lib/feedback/work-phase.ts`), never on DB status — `dispatched` covers both an agent mid-run (machine) and a fix that deployed an hour ago (you). An open PR and a running deploy are machine; stalled, failed, merged, deployed and "nothing shipped" are you |
| After the run | The **fix ledger** (`src/lib/feedback/fix-shipping.ts`, refreshed from GitHub with the user's token and cached on the run as `payload.fix`): **PR #N · open → merged → deploying → Live · confirm**, or **nothing shipped / PR closed / deploy failed**. "Check live" appears only once a deploy-like workflow succeeded on the merge commit (or the PR merged and no deploy workflow exists — then the reader has to look). It opens the PROJECT's live URL plus the reported path, never the visitor's host. Confirm resolves; the undo arrow reopens as "not fixed" |
| Why it is quiet | Silence has two meanings and only one is the operator's problem. When a delivered run prints nothing for 90 s the runner asks the same authentication question the dispatch path already asks (`detectAuthFailure`) and puts the answer on the next heartbeat; the row then reads **"Needs you to sign in"** with Watch opening the terminal, instead of "no output". Measured 2026-09-12: a dispatch sat silent for thirteen minutes wanting a sign-in and the product could only report the silence. Note a blocked agent prints nothing, so `shouldBeat` deliberately lets a beat through on silence *that carries a reason* |
| Working vs Stalled | The box runner beats `PATCH /api/control/runs/:id/progress` while the agent's PTY keeps printing (contract: `src/lib/run-progress.ts`, at most one beat per 45 s, none when silent). A beat within 10 min = Working, however long the run; older = **Stalled**; never any = Not running after 10 min. Before this heartbeat every hour-long fix read "Not running" from minute ten |
| Pause widget (instant, no deploy) | Project Widget card |

**Enable & install preflight** (`POST …/widget-token/install`):

1. **No git URL and no local dir** → `422 no_repo` — agent cannot land the snippet; copy from Widget card instead.
2. **Live site unreachable** (probe of `user_projects.liveUrl`, else legacy attrs) → `422 site_unreachable` — widget cannot appear until the Hetzner host responds; token may already exist.
3. Only then queue `injectPrompt` on the project’s chosen builder (cloud by default; Fleet Runner on this computer when “Runs on” says so). Response points to `/control?focus=…`, a client-side deep link that selects and highlights the project on Control (there is no server focus-tab call any more). Terminal is empty until a session is actually running.

**One-click captain loop (intended):**

1. **Enable & install** → agent edits repo → push/deploy on Hetzner → widget boots → coverage shows Live.
2. Visitor reports → inbox → **Implement** → same inject path → agent works → **Watch** only while Working (Terminal) / otherwise Control.
3. Done when work phase is Done (or you Resolve); not when the API said “queued.”

Status vocabulary is SSOT in `lib/feedback/work-phase.ts`. The DB may still store
`dispatched`; the UI never presents that word as “finished.” **Queued / Install queued
is not proof of work** — prove it with Working (heartbeat-backed), Failed/Not running/Stalled, or Attention Retry.

Dogfood check 2026-08-14: botsmann.orangecat.ch boots `fcw_73518de7…` (`last_seen_origin`
https://botsmann.orangecat.ch, `/api/widget-boot` `{active:true}`). Earlier “waiting for
first page load” was CSP (`script-src` blocked widget.js) after Next tree-shook an empty
build-time token — not a dead ingest pipe.
**Origin**: Extract revampit's visitor-feedback FAB (`src/components/feedback/`, ~900 lines,
modular, survived the Hirn deletion intentionally) into a Loki-owned embeddable
widget. Any registered project drops one script tag on its site; visitor feedback flows
into a per-project inbox in Loki and becomes dispatchable agent work.

## Why this is a Loki feature, not a revampit feature

Loki's thesis is captain-mode: see + govern work across agents you've deployed.
Visitor feedback is inbound work discovery — today it dies in email inboxes. Closing
visitor-feedback → project inbox → agent dispatch makes feedback actionable fleet work.
It is also the first embeddable Loki surface on customer sites (revampit =
customer #1, dogfood).

## The one-sentence architecture

Loki serves a self-contained script (`/widget.js`); the script renders the
feedback FAB in a Shadow DOM on the customer's page and POSTs submissions to
`POST /api/feedback` keyed by a per-project widget token; Loki persists first,
surfaces an inbox on the project detail page, and each item has a one-click
"Dispatch fix" that routes through the existing `/api/control/dispatch` flow.

## Decisions (with reasoning)

### 1. Serve routes, don't ship an npm package

Consistent with `cross-product-identity-bridge.md` (embed-don't-share-UI). Customers add:

```html
<script src="https://<loki-host>/widget.js" data-fc-project="fcw_..." async></script>
```

One tag, zero build-step integration, and we can ship widget fixes to every customer
site instantly. An npm package would freeze old versions into customer bundles.

### 2. Script tag + Shadow DOM, NOT an iframe

The killer feature of the revampit widget is **element scope**: the visitor clicks the
actual broken element and we capture `elementType` / `elementText` / CSS `selector`.
An iframe cannot reach the host DOM, so iframe embedding is structurally incompatible
with element picking. Therefore: script tag, with all UI rendered inside a Shadow DOM
so host CSS and widget CSS cannot bleed into each other.

### 3. Rebuild the UI framework-free; port the logic 1:1

The revampit implementation is React + next-intl + shadcn — it cannot mount on
arbitrary customer sites (WordPress, static HTML, Vue, ...). The widget is rebuilt as
a dependency-free vanilla TS bundle (~10–15 KB gz, esbuild). What ports nearly 1:1
because it's DOM-level, not React-level:

- `useElementSelection` → element highlight + selector computation + click capture
- `useKeyboardShortcuts` → Esc closes, Ctrl+Enter submits
- The submission shape (see schema below)
- The interaction design: FAB → panel → scope selector (element | page | site) →
  optional element picking → textarea + optional contact → submit → success state

revampit's React widget is retired in Phase 4 and replaced by the embed tag
(customer #1 dogfood).

### 4. Dedicated `widget_tokens` table — do NOT reuse `project_shares`

`project_shares.token` grants *read* access to a dossier and is revoked/rotated on
different lifecycles. The widget token grants exactly one capability: *submit feedback
to this project*. Coupling them means revoking a share link silently kills a
customer's widget. Separate table, same shape/pattern.

The token is public by design (visible in page source). That is fine because it
authorizes only writes into an inbox, never reads — worst case is spam, which rate
limiting and per-token revocation handle.

### 5. Persist-first pipeline (proven in revampit)

revampit's `/api/suggestions` learned this the hard way: DB insert is the channel that
never silently drops; notifications and email are best-effort layered on top, with
results checked. Same order here: 1) insert `site_feedback`, 2) in-app surfacing
(inbox badge is derived from the table — no extra write), 3) optional email/Telegram
notification later.

## Schema (Drizzle, `src/db/schema/`)

```ts
// widget-tokens.ts
export const widgetTokens = pgTable("widget_tokens", {
  id:        uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token:     text("token").notNull().unique(),          // "fcw_" + 32 random hex
  origins:   jsonb("origins").$type<string[]>(),        // CORS allowlist; null/empty = any
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// site-feedback.ts
export const siteFeedback = pgTable("site_feedback", {
  id:               uuid("id").primaryKey().defaultRandom(),
  projectId:        uuid("project_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
  userId:           uuid("user_id").notNull().references(() => users.id),  // project owner, denormalized for inbox queries
  tokenId:          uuid("token_id").references(() => widgetTokens.id, { onDelete: "set null" }),
  suggestion:       text("suggestion").notNull(),        // 1..2000 chars, clamped at API
  contact:          text("contact"),                     // optional name/email
  page:             text("page"),
  url:              text("url"),
  pageTitle:        text("page_title"),
  scope:            text("scope"),                       // element | page | site
  selectedElements: jsonb("selected_elements").$type<Array<{elementType: string; elementText: string; selector: string}>>(),
  userAgent:        text("user_agent"),
  source:           text("source"),                      // visitor | ai_review | synthesizer (null = legacy = visitor)
  contentHash:      text("content_hash"),                // sha256(normalized suggestion + page) — ingest dedupe key
  duplicateCount:   integer("duplicate_count").notNull().default(1),  // repeat submissions bump this instead of new rows
  screenshot:       text("screenshot"),                  // optional visitor-attached image (data URL ≤600k chars); excluded from list queries, served via GET /api/feedback/[id]/screenshot
  status:           text("status").notNull().default("new"),  // new | dispatched | resolved | archived
  dispatchedRunId:  uuid("dispatched_run_id"),           // link to orchestration run once dispatched
  resolvedAt:       timestamp("resolved_at", { withTimezone: true }),  // resolution evidence (close-the-loop or manual)
  featuredAt:       timestamp("featured_at", { withTimezone: true }),  // operator curation for the public "shipped thanks to feedback" strip
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_site_feedback_project").on(t.projectId, t.status),
  index("idx_site_feedback_user").on(t.userId, t.status),
  index("idx_site_feedback_dedupe").on(t.projectId, t.contentHash),
]);
```

Status flow: `new → dispatched → resolved`, or `new → archived`. Mirrors the action
queue's philosophy: nothing auto-dispatches; the operator triages.

## Programmatic reports (`window.Loki.report`)

The FAB assumes the visitor noticed something and went looking for the launcher.
Errors are the opposite case: the product already knows what broke, and making
the visitor re-describe it in their own words is both friction and information
loss. So the widget publishes one host-callable entry point:

```js
window.Loki?.report({
  message: "Cat could not update my product: permission denied for entity actions.",
  diagnostics: { code: "cat_permission_denied", action: "update_product", surface: "cat-chat" },
});
```

- **`message`** pre-fills the textarea, caret at the end, so the visitor adds
  detail instead of facing an empty box. They can edit or clear it — it is a
  draft, not a fixed payload.
- **`diagnostics`** is flat `key: value` context that stays OUT of the textarea
  (the visitor sees "⚙ Technical details attached", full text on hover) and is
  appended to `suggestion` at submit time. **No ingest change was needed** — no
  new column, no new inbox renderer.
- The budgeting rule: diagnostics are reserved first and the prose is trimmed
  around them, because a clipped sentence still reads while a clipped error code
  turns a self-routing report back into a human triage job.
  (`widget/report-payload.ts`, pinned by `scripts/test/widget-report-payload.ts`.)

Two behaviours worth knowing before you call it:

- **The stub is published synchronously**, before the async boot gate resolves,
  so a host page never has to know whether the widget finished booting. A call
  that lands early is held (latest wins — a double-click means one panel, not
  two) and replayed on mount. If the boot gate says inactive, the held report is
  simply dropped: the widget is off, and the submission could not land anyway.
- **An already-open panel is left alone.** The visitor may be mid-sentence, and
  silently replacing their text would lose it.

**Deciding what your own control should be — read `window.Loki.ready`.**
Because the stub is published synchronously, `typeof report === "function"` is
true even when the widget will never render (token paused, boot unreachable). A
host that treats the stub's existence as "clicking will do something" ships a
button that silently no-ops — trading one dead end for another. `ready` is false
until the boot gate has said active AND the panel exists:

```js
// Always a real link; upgraded in place when the panel can actually open.
<a href="/feedback" onClick={e => {
  if (window.Loki?.ready) { e.preventDefault(); window.Loki.report({ ... }); }
}}>Report this</a>
```

That shape also survives the two cases a readiness check alone does not: no
JavaScript, and `widget.js` not executed yet (it is loaded `async`). Prefer it
over polling for readiness.

## API surface

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /widget.js` | public | The embed bundle. Built by esbuild from `widget/` on `prebuild` into `public/` (gitignored — built, never committed). Served as a plain Next static asset: there is **no** version query and **no** cache-header rule for it (`next.config.ts` sets those for `/sw.js` only), so do not rely on immutable caching. |
| `POST /api/widget/transcribe` | widget token in form | Speech-to-text for the mic. Same `fcw_*` token and origin allowlist as ingest; per-IP and per-token limits; Groq Whisper only. Deliberately NOT `/api/beacon/transcribe`, which takes no token and would become an anonymous spend endpoint if opened cross-origin. |
| `OPTIONS /api/widget/transcribe` | public | CORS preflight, reflecting requested headers for the same reason ingest does. |
| `GET /api/widget-boot` | token in query | Render gate + heartbeat. The remote kill switch: pausing or revoking a token hides the widget on every site without touching their HTML. Also what makes Coverage "Live" observed truth rather than install intent. |
| `POST /api/feedback` | widget token in body | Ingest. Zod-validate, clamp lengths, resolve token → project (reject revoked), rate limit per IP+token, insert, `jsonOk`. |
| `OPTIONS /api/feedback` | public | CORS preflight. Echo origin if it passes the token's `origins` allowlist (or any when unset). |
| `GET/POST/DELETE /api/projects/[id]/widget-token` | session | Owner manages the token: create, view snippet, revoke/rotate. |
| `GET /api/projects/[id]/feedback` + `PATCH /api/feedback/[id]` | session | Inbox list + status transitions (archive, resolve). |

Gotchas already known:
- **CSP on the host site**: `script-src` and `connect-src` must allow the Loki
  origin (`https://loki.orangecat.ch`). Botsmann shipped the tag but stayed
  “Waiting for the first page load” because CSP blocked `widget.js` (2026-08-14).
  Coverage Live = boot heartbeat after the script actually runs, not after HTML contains the tag.
- **proxy.ts allowlist** (Next 16 middleware): `api/feedback` and `widget.js` must be
  added to the matcher exclusions or anonymous submissions bounce to /sign-in
  (same class as the OC-rail `proxy.ts` lesson).
- **Rate limiting is already solved — do not write another one.** `src/lib/rate-limit.ts`
  exists and is owned by the shared `limitkit` package (see dotfiles/SHARED.md);
  `/api/feedback`, `/api/widget-boot` and `/api/widget/transcribe` all use it.
  This bullet previously said no limiter existed and told you to port one, which
  is exactly how a fleet grows its fourteenth copy of the same utility.
- CORS: this is a cross-origin POST from customer sites. `Content-Type: application/json`
  triggers preflight — the OPTIONS handler is not optional.

## Inbox UI (Phase 3)

Per the UX north star (minimize clicks, act in place, lead with the one thing that
matters):

- **ProjectDetail → Feedback tab**: list of `site_feedback` rows for the project,
  `new` first, badge with new-count on the tab. Each row shows suggestion, page,
  scope chip, selected-element selectors, age.
- **Primary action per row: "Dispatch fix"** — one click composes a dispatch through
  the existing `/api/control/dispatch` flow with full context baked into the intent
  ("Visitor feedback on {url}: {suggestion}. Element(s): {selectors}"), sets
  `status=dispatched`, stores `dispatchedRunId`. Feedback becomes fleet work without
  leaving the row.
- **Secondary actions**: resolve, archive. Delete only via archive (audit trail).
- **Widget setup card** on the same tab: generate token → copy-paste snippet
  (one-click copy), origins field, rotate/revoke. Empty state of the Feedback tab IS
  the setup card — discovery and activation in one place.
- Optional later: aggregate "Feedback" strip on /control per-project cards.

## Phases

1. **Ingest spine** — schema push, `widget_tokens` + `site_feedback`, `/api/feedback`
   (+ CORS + rate limit), proxy.ts exclusions, token-management route. Testable with
   curl before any UI exists.
2. **Embed bundle** — `widget/` vanilla-TS source (FAB, panel, scope selector, element
   picker, form), esbuild → `public/widget.js`, Shadow DOM styles. Verify on a plain
   static HTML page AND on a Next.js site.
3. **Inbox + dispatch** — Feedback tab on ProjectDetail, dispatch-fix wiring, setup
   card with snippet copy.
4. **Dogfood cutover** — drop the tag on Loki's own public pages (/, /thoughts,
   /frontier) pointed at the Loki project; then revampit swaps its React widget
   for the embed tag (its `site_suggestions` pipeline retires; optional dual-write
   during transition).
5. **AI reviewer (shipped with prod activation)** — `POST /api/projects/[id]/feedback/ai-review`
   dispatches an agent (via the `injectPrompt` SSOT) to open a page headless
   (Playwright), review it on desktop + 320px mobile, and file each finding
   through the same public `POST /api/feedback` + `fcw_` token a human visitor
   uses (`contact: "Loki AI reviewer"`). Human and AI feedback share one
   inbox and one triage flow; review runs never auto-dispatch fixes. UI: "AI
   review" button on the project feedback section (needs an active widget token).
6. **Later (not now, YAGNI)** — per-page analytics, theming API, site-wide crawl
   review, conversational widget (Loki-in-widget — needs its own security model;
   the fcw_ token stays write-only).

   SHIPPED since this list was written, despite still reading as "later":
   the email loop back to the submitter, screenshot capture, auto-triage draft
   actions via the action queue, and voice input. Check the API table above
   before trusting any "not yet" in this file.

## Since v1 (2026-08-24)

- **`window.Loki.report(...)`** (see above): host pages can file a report
  with the error already described and machine-readable context attached, in one
  click. Built for OrangeCat's AI failure notices, where every dead-end error
  message now carries a "Report" action instead of leaving the user to find the
  FAB and re-type what the product already knew.

- **Owner notification on ingest** (the "optional email/Telegram notification
  later" above, finally): `POST /api/feedback` fires `notifyFeedbackReceived`
  after the insert — web push + Telegram, fire-and-forget, visitor-source rows
  only (AI-review/synthesizer bursts and duplicate bumps stay silent).
- **Cross-project inbox at `/feedback`** (nav: Work → Feedback): every
  project's rows in one surface with honest work phases, grouped
  Needs you / In progress / Shipped, filterable by project and source. The
  per-project section and this page share one row component
  (`src/components/feedback/FeedbackItemRow.tsx`) and one actions hook.
- The Control strip's "Full inbox" deep-links to `/feedback?project=…`; the
  sidebar Feedback item carries a NEW-count badge from `/api/feedback/summary`.

## Out of scope

- Reading anything through the widget token (write-only by construction).
- npm-published widget package.
- Multi-language widget UI (ship English; revampit's German strings become a simple
  `data-fc-lang` attribute later if needed).
- Session replay — big surface, privacy questions; still not built. (Screenshots
  ARE built: `screenshot` column, client-downscaled data URL, owner-scoped read.)
