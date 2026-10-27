# Loki Feedback Widget

**Created:** 2026-07-17  
**Last modified:** 2026-10-15
**Last modified summary:** Loki on the site knows how the site is built (the packages its code uses, the kickoff's plan, the owner's build conventions — `src/config/build-conventions.ts`) and answers "is this using our packages?" from that; talking to Loki is a step in a Review, never silence; one page read at a time. Before that: The loop closes on the site: **Your changes** in the owner's panel (Building · On its way · Live · Needs you, from the inbox's own phase), Loki announcing a change that went live since the last look; Continue in Loki (the thread carried into `/loki` or `/terminal`); the advisor knows the owner by their pass and never hands the builder's job back to the client; the owner's sign-in is on the first screen; "Follow the build" never tours a page that has not changed; the header fits a phone.

**Status**: COMPLETE 2026-07-28. Phases 1–4 implemented 2026-07-17 — four
`feat(feedback):` commits (ingest spine, embed bundle, inbox + dispatch,
self-dogfood); find them with `git log --oneline --grep 'feat(feedback)'`.
Prod activation done 2026-07-17 (box DDL + FEEDBACK_WIDGET_TOKEN). Customer #1
cutover done 2026-07-28: evig prod (formerly revampit.orangecat.ch, now evig.orangecat.ch) loads the
embed via `LokiFeedbackEmbed` (revampit main 90bfb3497; retired React
widget deleted in 6341ac7f1), verified e2e — a prod submission lands in this
inbox. Hardening learned from the cutover: the OPTIONS preflight reflects
`Access-Control-Request-Headers`, because customer sites monkey-patch
window.fetch and stamp extra headers (revampit stamped x-csrf-token) onto the
widget's cross-origin POST — a hardcoded allowlist silently drops submissions.
The per-token Origin allowlist in POST remains the security boundary. Where the
launcher sits, how it avoids host UI, and the host contract (`data-fc-avoid`,
`data-fc-place`, legacy `data-fc-bottom`) are documented once, in
[`widget/README.md`](../../widget/README.md).

## Voice review while browsing

The composer's **Talk** — the panel's one microphone — leaves the host site interactive, with a red edge round the screen while it records. The dock notes the
part of the page in view (nearest heading) at the start, when scrolling
settles and on **Mark**; Whisper's sentence timings put each sentence under
the part that was in view (`widget/voice-moments.ts`). Done opens one
editable note that says what Loki heard (*0:43 across 4 pages*) and leads
with Loki's read of it (`widget/walk-read.ts`, `/api/widget/understand`):
a list of what was asked, one change or question per line with where it
applies, and the asides left out, with the words as spoken one tap away. Each
change is saved as its own note with only its moments. The owner can also
start talking from the microphone inside their launcher pill without opening the
panel (`widget/quick-talk.ts`). A question leads with **Ask Loki**, about the whole walk;
a change is sent — a visitor as **Save feedback**, the owner or an editor as
**Save** (held out of automatic work) or **Fix it now**. A site-wide finding
(the page's language) is said on the first page of a visit only. The receipt remains in the
same widget thread and links to the project Feedback view or run. Visitors
can save notes without a Loki account but cannot authorize development.
Unsent text/context survives same-tab page loads; audio cannot survive a full
navigation. [Design, verification and limits](../development/contextual-voice-feedback.md).

## One conversation, one Loki appearance

The widget opens as a conversation with Loki. **Ask** is the
default; **Save feedback** files a visitor note, while a verified owner sees
**Fix it**. This is an intent choice, not a model selector: all routes
use the same project and conversation record, and Loki hands approved work to
the project's existing builder queue. The shared chat view and its fallback
use the same wording. The fallback does not repeat a “Loki” speaker label on
every answer because the panel header already identifies the assistant.

Appearance comes from the same `@bitbaum/design-tokens` source as Loki's app.
The boot response carries generated light and dark variants; an embed can set
`data-fc-theme="light"` or `"dark"`, otherwise it follows the browser's color
scheme. Loki's own embed sets the active app theme explicitly. Surface, text,
borders, accent, status colors, type and radii stay generated from tokens; the
widget does not copy or invent a separate palette. Mobile uses the full-width
bottom sheet, touch-sized controls and the same thread; desktop uses a compact
anchored panel. No model selector is shown in the small widget.

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
- **Builder (`editor`):** invited by the owner from the project's People tab —
  a link sent on WhatsApp, or an email. `project_memberships` grants `editor`,
  `client` or `viewer` per entity project. A Builder's note on the site builds
  at once: Loki hands Builders the same pass as the owner
  (`lib/feedback/pass-rule.ts`, `mayHoldPass`), ingest records them as the
  reporter, and the owner is told, not asked (`notifyBuilderAsked`). Execution
  still uses the owner's project and runner tenant. A client's or viewer's
  note, like a stranger's, waits for the owner. The words a person reads for
  all of this are `ROLE_LABELS` and `roleGuide` in `lib/project-capabilities.ts`,
  shown on the invite page and again on the project after joining.
  The site is one of two doors. On the project's page in Loki a member asks in
  the box at `#ask` (`ProjectAskBox`, `POST /api/projects/[id]/ask`,
  `lib/feedback/ask-in-loki.ts`), which files the same row the widget would —
  built at once for a Builder, waiting for the owner otherwise. Loki's chat
  runs in the member's OWN account, which has no builder for the project, so
  the project's header sends members to that box rather than to the chat, and
  Today and Control show `SharedProjectsCard` instead of "Add a project" or the
  desktop-app pitch (walk as Manu, 2026-10-18: the chat told a Builder to edit
  HTML and install the desktop app). The chat's facts name each shared project
  and where it is changed (`sharedProjectLine`).
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

| One conversation | The panel is **one thread with Loki** — its state and every call in `widget/conversation-model.ts` (no DOM; `snapshot()` / `subscribe()`), drawn by one of two views over that one model: `widget/conversation.ts` (the panel's own DOM) or, with `data-fc-chat="kit"` on the tag, the **shared chat** — `@bitbaum/chatkit`, the thread and composer Loki's own chat renders. That view is a separate chunk, `public/widget-chat.js` (`widget/chat/`, built by `scripts/build-widget-chat.ts` with Preact standing in for React, ~24 KB gzipped, budget 32), fetched only when the panel first opens (`widget/chat-loader.ts`, carrying the tag's nonce). `widget/conversation-kit.ts` turns the model's snapshot into what chatkit draws; widget-owned pieces (Fix this, the changes checklist, the confirmation card, the About chips, Continue in Loki) travel as DOM nodes into chatkit's slots. chatkit's CSS is rewritten for the shadow root (`:root` → `:host`, rem → px, so a host's 62.5% root cannot shrink it) and coloured from the boot theme (`widget/chat/theme.ts`). A chunk that cannot load (CSP, offline, 8 s) leaves the panel's own view — no dead end. Opt-in only: Loki's own embed draws the same panel every customer site gets (`DogfoodFeedbackWidget.tsx`, 2026-10-18 — two looks read as two products). While the panel is open, keys stop at the widget's shadow root on the way out (host hotkeys never see panel typing, and controls inside the panel still get their own keys). A compact scope menu defaults to the current page; **Point to area** stays visible as a direct action, with whole-site and Loki-self context one tap away; the composer starts in **Ask** and offers **Save feedback** beside it (verified owners see **Fix it**). This is an intent choice, not a model selector. You type, speak, paste a screenshot or point at an element; Loki answers about this page (one tap: the whole site; an element when picked) from an outline the browser builds (`widget/page-snapshot.ts` → `POST /api/widget/advise`, prompt `src/lib/widget-advise/advisor.ts`, owner's AI budget). Every change it recommends — and your own last message, as written — has **Send to builder →** (owner: **Build this →**), which opens a confirmation card IN the thread; the receipt (building / track link) lands in the thread. The thread is kept per tab in `sessionStorage` (`widget/thread.ts`, validated on restore) so it survives the site's page loads. `data-fc-modes` now only picks who answers (`thread.ts assistantFor`): default = advisor; `chat` = the studio concierge (Cat + Loki, `POST /api/widget/chat`); `report` = no AI, straight to the confirmation. The owner always gets the advisor — and the advisor knows it: the owner pass travels with each question (`ownerPass` on `POST /api/widget/advise`, verified exactly as ingest verifies it), so "add X" from the owner is answered as a build (what would be built, the request itself as the one change to tap), not as advice. Whoever asks, the advisor never explains how to edit the site and never writes the site's own content (2026-10-09: an owner asking for one new page was told which heading to insert and given five invented sentences in the site's language). **Continue in Loki** sits under the composer once something has been said: for the owner, **Chat →** (`/loki?project=…` with the thread in the composer, nothing sent) and **Terminal →** (`/terminal?project=…&view=terminal`); for anyone else, after their first message, one link that signs them in and finds out whether the site is theirs. Both go through `GET /api/widget/continue?token=&view=&q=&return=` (`widget/continue.ts` builds the hand-off text, newest turns kept, ≤1800 chars; `src/lib/widget/continue.ts` says where it lands), so the widget never learns the project's name. The owner's door — **This is my site — sign in with Loki →** — is also under Loki's greeting, not only behind Watch. **Your changes** (owner only, `widget/changes.ts`) is folded into the panel's one status line (`widget/thoughts-view.ts`: *● Watching · 2 to look at · 4 live ›*, its most urgent fragment from `changesHeadline`) and opens under it: the project's recent changes with one word each — Waiting · Starting · Building · On its way · Checking · Live · Needs you · Done · Closed — derived on the server from the same `attachFeedbackWork` phase the inbox shows (`src/lib/feedback/owner-view.ts` writes the owner's sentences; the work view never leaves the server), **See it →** (the owner's walkthrough of that change, only once it is live) or **Open in Loki →** (when something needs them), and "All N in Loki". It asks `POST /api/widget/owner/changes` on arrival and every 30 s while something is moving (stops when everything is settled, or after 2 h). What this browser last saw of each change is kept in `localStorage` (`loki-changes-seen:<token>`); a change seen building that is now live is announced once — in the thread when the panel is open, beside the launcher (bubble + unread) when it is not — never on first sight. Tests: `widget-conversation-model.ts`, `widget-kit-browser.ts` (the chatkit view in a real browser, the fallback, the weight budget), `widget-chat-css.ts`, `widget-thread.ts`, `widget-continue.ts`, `widget-changes.ts`, `widget-advise.ts`, `widget-embed-browser.ts` |
| Watch + Review (owner only) | Visitors have no Watch control. The owner sign-in link stays under the greeting; after verification, the owner sees Watch state and pause/resume in the conversation’s thoughts row. Review runs only when requested, and its evidence and follow-up stay in the same thread. The launcher carries the owner’s watching state. See `widget/watch.ts`, `widget/watch-trail.ts`, `widget/page-checks.ts`, and `widget/conversation-model.ts`; browser coverage: `widget-watch-browser.ts` and `widget-advise.ts`. |
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

Status flow: `new → dispatched → resolved`, or `new → archived`. A stranger's
report never auto-dispatches; the operator triages. A note proven by a pass
(the owner's or a Builder's) is the decision, and builds at once.

Who filed a note is the server's call, never the sender's
(`scripts/test/feedback-trust.ts`):

- `source` in the body is ignored. Loki's reviewer and synthesizer prove
  themselves with `agentPass` (`lib/feedback/agent-pass.ts`, one project, 48h),
  which the prompt that starts them carries. Without it a note is a visitor's.
- An overnight allowance builds only notes someone vouched for (the owner's,
  Loki's own). A plan holding a stranger's note waits for a tap.
- Opening a tracking link builds nothing. Someone who can build the project
  lands on the inbox instead, and the reporter's claim is left for them.
- A **seat** on the project — a Builder (`editor`), a `client`, a `viewer` —
  asks; the owner decides. Their ask from the project page or the site is a
  feedback row in the owner's tenant naming who asked (`source = client` or
  `member`), announced like a visitor's note, and it waits for the owner's
  tap: the night never builds it unasked, and the fix never merges as if the
  owner had said it. Only the owner's own word (`source = owner`, the owner
  pass or the owner's session) starts a build, on the owner's builder and
  engine — whoever asks pays, in their own builder
  (`docs/architecture/private-builders.md`). Until 2026-10-20 a Builder's
  ask built at once and a client's built on a monthly allowance, both on the
  owner's subscription; both are gone. A change built FOR the person who
  asked (`on_allowance`, read as `previewFirst`) opens as a DRAFT pull
  request and merges only after they tap **Make it live**
  (`/api/feedback/[id]/live`, `lib/feedback/go-live.ts`), which lifts the
  draft and merges once green (`auto-ship.ts`); an explicit auto-ship OFF
  still means the owner merges. `scripts/test/client-seat.ts`,
  `scripts/test/client-seat-browser.ts`.
- On the SITE, a member (client, viewer) is known by a member pass, minted
  for their "Open" link on their project page and by the widget's sign-in
  door for anyone on the project who is not a builder
  (`lib/feedback/member-pass.ts`, fragment `#loki-member=`). The panel stays
  the ordinary one; ingest files the note through `askInLoki`, so a seat's
  note on the site goes to the owner exactly as from their project page. Membership is read at use, so removing someone ends their
  pass. The owner pass is the owner's console and is never sent to anyone.
- A visitor follows their note without an account: the tracking link opens
  `/claim-feedback` on the note's own status (`ReporterFeedbackCard`, the same
  card as My feedback), valid six months, and is mailed to the address they
  leave (`lib/feedback/receipt-mail.ts`, three a day per address) and again in
  the "shipped" mail. `scripts/test/seat-on-site-and-tracking.ts`.
- Telegram carries the operator's own projects only
  (`lib/actions/telegram-for-user.ts`); other accounts hear through push and
  their alerts.

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
| `POST /api/widget/chat` | widget token in body | Chat mode, opt-in per embed (`data-fc-modes="chat,report"`). `{token, message, history?[≤12], url?, pageTitle?}` → `{ok, reply, messages[{speaker: "cat"|"loki"|null, text}], links[{label,url}], degraded?}`. A plain chat the Cat and Loki both live in: whichever the question belongs to answers as itself (both when both have something useful), from the public fleet map (`src/lib/widget-chat/concierge.ts`) and route the visitor to one project or studio door. Links come from the map, never from the model. Charged to the token owner's fair share; when the budget or every vendor refuses it still routes by keyword match (`degraded: true`). Not `askLoki()` — a stranger gets the catalogue, not the operator's agent. `images?[≤3]` (data URLs, jpeg/png/webp, ≤600k chars each — the ingest's `screenshots` shape) are read by the vision chain (`src/lib/vision.ts`) and folded into the prompt as the visitor's material; when no model can read them the answer says so in code (`pictures: "unread"`), never silently. `mode: "intake"` (+ `purpose: "studio"|"partner"`) is the studio's door on bitbaum.orangecat.ch (`src/lib/widget-chat/intake.ts`): Loki asks one or two questions at a time and names the published engagement it resembles, from commission.json; → `{reply, messages, ready, summary}`. The answer's JSON shape, the rules (no unpublished price, date, booking or past work) and `ready` are decided in code (`scripts/test/widget-chat-intake.ts`); a broken rule, a spent budget or a model outage answers with an honest question instead (`degraded`). The site files the request itself — this route stores nothing. |
| `GET /api/widget/continue` | session (top-level navigation) | **Continue in Loki.** `?token=&view=chat\|terminal&q=&return=`: signs the person in if needed (and comes back), checks `getProjectAccess` on the widget's project, resolves the project key (`getWidgetProjectKey`: `user_projects.name`, else the entity's name) and redirects into `/loki?project=&q=` or `/terminal?project=&view=terminal`. Someone without access goes back to `return` with `#loki-owner-denied` (same `ownerReturnUrl` rule as `/api/widget/owner`). |
| `POST /api/widget/owner/changes` | widget token + owner pass in body | **Your changes.** `{token, ownerPass}` → `{ok, owner, changes[{id,text,at,label,tone,detail,live,settled,href,action}], inbox}`. The pass must name this project and this owner (same test as ingest); otherwise `{owner: false, changes: []}` — a stranger holding the public token learns nothing. Reads `listProjectFeedback` through `attachFeedbackWork` (so a ledger refresh and a "fix is live" push here are the owner's own path, run for the owner), then `ownerStatusFor` (owner-view.ts). Origin allowlist, per-IP limit. |
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
  `/api/feedback`, `/api/widget-boot`, `/api/widget/transcribe` and `/api/widget/chat` all use it.
  This bullet previously said no limiter existed and told you to port one, which
  is exactly how a fleet grows its fourteenth copy of the same utility.
- CORS: this is a cross-origin POST from customer sites. `Content-Type: application/json`
  triggers preflight — the OPTIONS handler is not optional.

## Chat answers reviewed every night

The same inbox takes findings from the fleet's chats: a thumb under any
chatkit answer, and a nightly judge reading each product's day of
conversations, file into `/feedback` on that product's Loki project as
`source: ai_review` — see `docs/architecture/chat-review.md`.

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

- **2026-10-15 — Loki's look, in Loki's mode, with one scroll.** The widget's
  colours came from the fleet's shared tokens, whose accent is OrangeCat's
  warm orange, and it was dark only: on a client's light site the owner saw an
  orange-ringed black panel and asked why Loki's widget looked like OrangeCat.
  Now `scripts/generate-widget-theme.ts` reads Loki's own `globals.css`
  (`:root` and `.dark`) into `WIDGET_THEMES` — the accent is the ink, the warm
  colour only the focus ring and a picked element's outline on the host page.
  Every widget stylesheet reads `var(--lk-…)`; `themeVarsCSS` defines both
  modes on the shadow host and `widget/theme-mode.ts` sets `data-lk-theme`:
  the owner's choice in Loki (`user_preferences.theme`, saved by
  `ThemeSync` → `PUT /api/me/theme`, returned by `/api/widget/owner/changes`
  and remembered per site), everyone else their device's setting, followed
  live. The panel is one column with ONE scroll area — the thread — between a
  fixed header and composer (the whole card used to scroll too, which hid the
  composer below a laptop's fold and nested a scroll inside a scroll on
  phones); a phone sheet opens at two thirds of the screen; the desktop card no
  longer greys out the site it invites you to use; About is a segmented
  control that fits a 320px phone on one line.

- **2026-10-15 — Loki answers what was asked.** On a client's site the owner
  said a description field had no microphone and asked, twice, whether the
  site used the fleet's packages; Loki answered with the same advice about one
  textarea twice, in German, and its Review called the minutes spent talking
  to it "the page never responded for 194 s". Now: the advisor receives how
  the site is BUILT (`src/lib/widget-advise/build-facts.ts` from
  `project_packages`, `project_package_scans` and `user_projects.kit_plan`,
  via `getWidgetBuildFacts`) and the owner's **build conventions**
  (`src/config/build-conventions.ts` — the one list, also carried by every
  dispatch through `renderOperatingPrinciples`); naming a package is not
  "explaining how to edit"; a point about every form is answered as a rule
  across the site; it never repeats an earlier answer; it replies in the
  language of the latest message. What the owner says to Loki is a `talk`
  step in Watch's trail (`watch-trail.ts`), so a Review reads that time as
  talking, and Review may not name an endpoint the evidence does not show.
  Loki's unasked read of a page skips test data and replaces the previous
  read in the thread instead of stacking one per page (`thread.ts
  pushPageRead`).

- **2026-10-09 — fixes go as one, and watch notices what taps do.**
  Suggested changes are one decision (`widget/suggestions.ts`): every row
  ticked, a tap unticks, and **Build these N as one change** files ONE note —
  one agent, one pull request, one row in Your changes — instead of a
  "Build this" per row that started N runs in the project's one lane with
  nothing saying so. The owner's builds start without a confirmation card
  ("Edit first" opens it); a visitor's still confirm. Your changes is one
  summary line that opens ("1 building · 1 in line · 1 live"), and a change
  waiting behind another reads **In line**, not "Starting"
  (`owner-view.ts`). Watch waits 1.5 s after each tap on a button or link for
  the page to change, ask the server or navigate, notes which, and says at
  once when nothing visibly happened. **Point** is the other half of the
  owner's launcher — there whether Loki watches or is paused — and points at
  something on the page, or marks **This screen** (the blocks in the
  viewport, `picker.ts visibleBlocks`), opening the panel with it attached.
  The owner's launcher is never hidden by the avoid pass and never fades on
  scroll, so the top bar appears only for `data-fc-place="hidden"` (2026-10-10:
  the bar and the launcher taking turns on a phone read as two competing
  tools). On a phone the panel is a sheet: drag up for full screen, down to
  peek, further to close (`widget/sheet.ts`).

- **2026-10-09 — the first day is the whole product.** Onboarding asks for
  the website (optional); a project created with one gets its widget token
  at once (origin = the site's), the step shows the one line to paste or
  lets an agent add it (repo present), and **Open your site with Loki →**
  carries the owner pass. Finishing lands on the project, not Control. A
  stalled build and a failed kickoff offer the other two ways to get it
  built (`GetHelpLine`, from `build-paths.ts`). Tests: `onboarding-site-step.ts`.
- **2026-10-09 — every stranger's door ends at `/build`.** The three ways
  to get something built (yourself, with a partner, by the studio) are one
  list, `src/config/build-paths.ts`; the panel's last line for anyone who is
  not the owner is "Made with Loki — build something of your own →"
  (`/build?from=<host>`), the tour's "Get this for your site" lands there
  too, and the concierge has the same door. Tests: `build-paths.ts`.
- **2026-10-09 — watch says what it sees.** Watch used to speak only when
  something was wrong, so between remarks the owner could not tell what it
  was doing. The panel now carries **What Loki sees** (`widget/thoughts.ts`,
  `thoughts-view.ts`): one row that opens into the trail worded as notes —
  pages opened, taps, what the page sent, and every look at a settled page
  (a `look` trail step, recorded even when the page is clean). The status
  light is the logo's spiral (`widget/brand-mark.generated.ts`, generated from
  `src/config/brand-mark.ts` by `scripts/generate-widget-brand-mark.ts`): it
  turns while Loki watches, spins while it thinks, and stops when paused.
  Loki's answers render paragraphs, bullets, headings and bold
  (`widget/rich-text.ts`) — from text nodes, never HTML.
  The panel was redesigned as one surface at the same time: the header holds
  only who and where (✕, and Watch for someone not yet known as the owner);
  watching is shown and paused from the notes row; Loki's words are prose and
  yours a pill; suggested changes are a hairline list with **Build this →** as
  accent text; and "About", the words, the tools and the two ways to send are
  ONE composer card. Rule: at most one filled accent button per region —
  every other action is quiet text aligned in its row.

- **2026-10-09 — the loop closes on the site.** The receipt used to end at
  "Loki tells you when" and on the site it never did. Now the owner's panel
  carries **Your changes**, a change that went live since the last look is
  announced there and beside the launcher, **Continue in Loki** carries the
  thread into `/loki` or `/terminal`, the advisor answers the owner as the
  owner, and `/feedback/<id>/watch-fix` lands on the inbox row while the
  change is still being built instead of touring the unchanged page.

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
