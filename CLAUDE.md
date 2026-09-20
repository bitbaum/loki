# Loki

@~/.claude/CLAUDE.md

## Mission

Read [bitbaum/fleet AGENTS.md](https://github.com/bitbaum/fleet/blob/main/AGENTS.md)
and its registers for org facts. Read this repo's `AGENTS.md` for the product
contract. Loki builds and changes projects independently; OrangeCat is an
optional integration, with separate consent for public publishing.

What the neighbour can do — OrangeCat's Studio renders video, music, longform
writing and artwork, and finances or sells the result — is SSOT in
`src/config/ecosystem.ts` → `ORANGECAT_CAPABILITIES`. Loki's capability preface
reads it verbatim so the assistant can point there without ever claiming to
render anything itself.

## What This Is

Loki is a multi-user SaaS platform for commanding AI agent fleets across projects. Users sign in (GitHub OAuth), register their projects, and launch/monitor AI agents from a single dashboard. Dark-first, mobile-ready, designed for builders who want control without complexity.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **TypeScript strict** — no `any` without justification
- **Tailwind CSS 4 + shadcn/ui** — dark by DEFAULT, not forced. `ThemeProvider`
  sets `defaultTheme="dark"`; `ThemeToggle` ships in the account menu, the
  Settings page and the public nav, so light mode is a real state your styling
  must survive. Never assume a dark ground outside the always-dark surfaces
  noted below. It used to ship in eight places including the app top bar,
  where it was the only bordered control among ghost-circle status icons — a
  preference drawn heavier than every live signal beside it.
- **Drizzle ORM** — schema is SSOT for types (`$inferSelect`, `$inferInsert`)
- **PostgreSQL 17** (self-hosted, `loki` database)

## Architecture

```
src/
├── app/           → Pages + API routes (thin, delegate to queries/components)
├── components/
│   ├── ui/        → Shared primitives (Card, Modal, Drawer, Field, PageLayout)
│   ├── shell/     → AppShell, Sidebar, AppTopBar + AccountMenu, MobileNav,
│   │                 AskLokiButton → /loki.
│   │                 The sidebar NAVIGATES; the account menu acts on the
│   │                 ACCOUNT. Nothing appears in both — that split is what
│   │                 stopped the sidebar footer becoming a second settings
│   │                 page. Sign out, Settings, appearance and the private-zone
│   │                 lock live in AccountMenu (top bar, every viewport).
│   │                 Sections are SSOT in config/navigation.ts and are the
│   │                 operator loop: Now (what needs me) · Fleet (what is it
│   │                 doing) · Command (how do I act) + PIN-gated Private.
│   │                 A page that answers none of those three does not get a
│   │                 sidebar seat — that test is what dissolved "More".
│   ├── control/   → ControlPanel, ProjectCard, ProjectProfile (fleet command).
│   │                 There is no ProjectTile
│   │                 ControlFleetStatus = the hero: ONE question ("is anything
│   │                 waiting on me?"), the projects by name, at most one button.
│   │                 ControlInbox = one collapsed queue for every small task
│   │                 (feedback triage + widget coverage) — add a group, never a
│   │                 new full-width strip. ControlSettingsSheet = autopilot,
│   │                 refresh, builder detail (settings, not state).
│   │                 See docs/development/responsive-design.md.
│   ├── loki/      → LokiWorkspace, Transcript, Composer, ConversationList (chat assistant)
│   ├── terminal/  → TerminalSurface (the ONE shell: tab strip + mode bar +
│   │                 session + composer), TerminalTabStrip, TerminalModeBar,
│   │                 TerminalComposer, ShellWorkspace (server-owned bash PTYs,
│   │                 local/sandbox only), TerminalView (the one xterm),
│   │                 terminal-transport (substrate seam), TabVoiceMic.
│   │                 Modes are SSOT in config/terminal-modes.ts; never add a
│   │                 second terminal shell — add a transport.
│   │                 Below md the same state drives phone chrome:
│   │                 TerminalMobileHeader (one line) + TerminalSessionSheet
│   │                 (all the setup) + TerminalMobileDock = TerminalKeyDeck
│   │                 (the arrows/Esc/Tab/Ctrl a soft keyboard lacks — bytes are
│   │                 SSOT in config/terminal-keys.ts) + TerminalRawComposer.
│   │                 See docs/development/responsive-design.md.
│   ├── activity/  → ActivityView, EventStream, DigestPanel (fleet activity timeline + digests)
│   ├── today/     → StickyNoteCard (captures; Loki "add X to my list"), CalendarCard, WeatherCard, CommitmentsCard, SubscriptionsCard, HabitsList
│   ├── people/    → PeopleGrid, PersonCard, PersonDetail
│   ├── crew/      → CrewWorkspace (board + roster), AssignmentCard,
│   │                 NewAssignmentButton, AddCrewButton, SharedTaskView.
│   │                 Work for HUMANS: an assignment is a draft until the
│   │                 operator hands it over, and the assignee answers through
│   │                 a share link with no account. Who may move a task is
│   │                 SSOT in config/crew.ts (OPERATOR_MOVES vs ASSIGNEE_MOVES)
│   │                 — never widen one to "fix" a stuck row.
│   ├── projects/  → ProjectsWorkspace + ProjectRow (list), ProjectWorkspaceView +
│   │                 ProjectWorkspaceHeader (detail). ProjectGrid/ProjectDetail
│   │                 survive only as TYPE names (project-grid-row.ts,
│   │                 project-detail-types.ts) — there are no such components
│   ├── goals/     → GoalCard, GoalsGrid, NewGoalButton
│   ├── money/     → SubscriptionActions, NewSubscriptionButton
│   ├── habits/    → HabitHeatmap (per-row daily check-off lives in today/)
│   ├── events/    → EventCard, AddEventForm, EventsGrid
│   ├── prompts/   → PromptCard (replaced the old FeaturedCard + PromptRow),
│   │                 GroupBar (was CategoryBar), RunModal, ScheduleModal
│   ├── settings/  → TeamSettings (invite flow)
│   └── system/    → JobDetail, SystemStats, FleetDoctorCard, ScheduledJobsCard,
│   │                 RecentFailuresCard, HetznerCapacityCard (no AutopilotCard)
├── config/        → SSOT for navigation, channels, prompt-library, subscriptions,
│                    actors (who may be listed vs delegated to) and crew (who
│                    may move an assignment, and to where)
├── db/
│   ├── schema/    → Drizzle tables (SSOT for all types)
│   └── queries/   → Data access functions (one file per domain)
├── hooks/         → useFetch, useCreateMutation, useInlineEdit
└── lib/           → constants, dates, tools, utils, api/* wrappers

home/              → Agent orchestration library. Pure pieces that tail one
                     append-only JSONL event log: watcher.ts (Bridge — emits
                     worker.idle when ~/.loki/sessions/*.md changes),
                     plus decide/render/state/emit/log/projects/calendar-drain.
                     The worker (zellij consumer) was deleted 2026-09-11.
                     The standalone Brain (home/server.ts, port 3001) and its
                     scripts/home-start.sh launcher were RETIRED in a3f470d.
                     These pieces are a LIBRARY, not a process — three different
                     executors embed them via startWatcher():
                       • scripts/box-runner.ts — systemd on the box. The DEFAULT.
                         Exists precisely to delete the "laptop must be on"
                         dependency (b62e3aeb, 2026-06-26).
                       • desktop/ (Fleet Runner) — the user's own machine, for
                         work that must touch local files or a local checkout.
                       • scripts/hosted-runner.ts — ephemeral hosted runs.
                     Do NOT describe any one of them as the sole executor; which
                     one serves a given workflow is SSOT in
                     docs/development/cloud-local-workflows.md. Dispatch goes through /api/inject → pending_command → an authorized
                     runner. Project-owned sessions are the execution identity;
                     Tabs are owned PTYs keyed by project; there is no
                     multiplexer to guess. Which builder runs a project is a
                     STORED decision (locus lock → `builder_pref` → cloud
                     floor, src/lib/execution-access.ts), never presence. To
                     iterate on a single piece, run it directly (`pnpm exec tsx
                     home/watcher.ts --start`); test the whole library with
                     `pnpm run test:home`. Full docs: home/README.md.

widget/            → The embeddable feedback widget customer sites load as
                     <script src=".../widget.js">. Zero-dependency vanilla TS,
                     bundled by esbuild on `prebuild` into public/widget.js
                     (gitignored — built, never committed). main.ts is the UI
                     (Shadow DOM, so host CSS cannot reach it), voice.ts is
                     speak-your-feedback, report-payload.ts is the shared
                     budgeting the ingest route also relies on.
                     This is the ONLY surface strangers on other people's sites
                     touch, so it earns the same care as src/ — it is covered by
                     `pnpm run lint` and tsc. It cannot see globals.css or
                     Tailwind, so its colours travel differently: the boot
                     response ships PALETTE.widget, which is GENERATED from
                     @bitbaum/design-tokens by scripts/generate-widget-theme.ts
                     (scripts/test/widget-theme-from-tokens.ts fails on drift).
                     Never type a colour into widget/ or palette.ts — change the
                     tokens and regenerate.
```

## Key Conventions

### Design System — The Four-Layer Architecture

Every pixel in Loki flows through exactly four layers in order. Any shortcut past a layer is a violation.

```
Layer 1  globals.css :root / .dark     → Raw values: OKLCH colors, rem sizes, shadows
Layer 2  globals.css @theme inline     → Tailwind mappings: --color-* pointing to Layer 1 vars
Layer 3  globals.css @layer components → ui-* classes: every recurring visual pattern
Layer 4  JSX in components/            → Uses Layer 3 classes + layout-only Tailwind
```

**The rule in one sentence:** components describe structure and layout; globals.css owns every visual decision.

#### Layer 1 — CSS Custom Properties (the raw values)

All raw values live in `:root` / `.dark` in `globals.css`. Never define a visual value anywhere else.

```
Surfaces:  --surface-page → --surface-base → --surface-raised → --surface-overlay
Text:      --text-primary → --text-secondary → --text-tertiary → --text-muted
Borders:   --border-subtle → --border-default → --border-strong → --border-interactive
Accent:    --accent-primary, --accent-hover, --accent-muted, --accent-text
Status:    --status-positive / -warning / -negative / -neutral (+ -subtle variants)
Type:      --text-micro (10px), --text-nano (8px), --tracking-*, --font-*
Shadows:   --shadow-panel, --shadow-panel-strong
Spacing:   --modal-max-height (85vh), --page-min-height (60vh)
```

Dark mode is handled automatically — tokens flip under `.dark`. Components never hardcode light/dark variants.

#### Layer 2 — Tailwind Theme Mapping

`@theme inline` in `globals.css` maps Tailwind utilities to the Layer 1 vars. This means Tailwind class names like `bg-surface-raised`, `text-text-primary`, `shadow-panel-strong`, `text-micro` all resolve through CSS vars — one retheme = one file change.

**Never** put literal hex or RGB values in `@theme inline`. Only `var(--*)` references.

#### Layer 3 — The `ui-*` Class System (SSOT for patterns)

Every recurring visual pattern is a named `ui-*` class in `@layer components`. This is where all styling decisions are encoded.

```
Panels:    ui-panel, ui-card-shell, ui-card-shell-raised, ui-settings-section
Buttons:   ui-btn-primary, ui-btn-secondary, ui-btn-ghost, ui-btn-chip,
           ui-btn-icon, ui-btn-xs, ui-btn-save, ui-btn-submit, ui-btn-lg,
           ui-btn-ready-primary, ui-btn-ready-action, ui-btn-ready-more,
           ui-btn-confirm, ui-btn-danger, ui-btn-overlay
Inputs:    ui-input, ui-input-compact, ui-input-tight, ui-input-inline
Text:      ui-kicker, ui-micro-label, ui-page-title, ui-page-subtitle, ui-error
Chips:     ui-chip-filter, ui-chip-toggle, ui-badge, ui-tag (+ variants)
Status:    ui-dot-positive/-warning/-negative, ui-tag-positive/-warning/-negative
Layout:    app-page, ui-page-header, ui-empty-page (error/empty/placeholder pages)
Control:   ui-control-hero, ui-control-card-header-meta, ui-control-metric-*
Auth:      ui-auth-card, ui-auth-input, ui-auth-submit-btn, ui-auth-label (etc.)
Public:    ui-public-surface, ui-public-nav, ui-public-title, ui-public-badge (etc.)
Brand:     ui-channel-whatsapp/-telegram/-phone/-in-person (contact channel icons)
           ui-lang-ts/-js/-py/-go/-rs/-rb/-cs/-java (programming language badges)
           ui-cat-fleet/-security/-engineering/-frontend/... (prompt categories)
```

When a pattern appears in 3+ components: extract it to `@layer components` immediately.

**The public and auth surfaces** (`ui-public-*`, `ui-auth-*`) intentionally use `text-white/[opacity]` and `bg-white/[opacity]` inside their class definitions — those surfaces are always dark (near-black bg). This is correct and centralized. Components should use the class name, not the opacity utilities directly.

#### Layer 4 — JSX (structure and layout only)

In component JSX, only two things are allowed:
1. **`ui-*` class names** (semantic, from Layer 3)
2. **Tailwind layout utilities** — `flex`, `grid`, `gap-*`, `px-*`, `py-*`, `w-*`, `h-*`, `max-w-*`, `min-h-*`, `items-*`, `justify-*`, `col-span-*`, `overflow-*`, `rounded-*` (using the token-mapped values), `text-*` sizing only (not color)

**Absolutely never in JSX:**
```
❌  text-gray-400       ← palette color (use text-text-secondary etc.)
❌  bg-indigo-500       ← palette color
❌  bg-[#1a2b3c]        ← hex value
❌  text-[10px]         ← arbitrary size (use text-micro)
❌  text-[8px]          ← arbitrary size (use text-nano)
❌  shadow-[var(--*)]   ← use shadow-panel / shadow-panel-strong
❌  min-h-[44px]        ← use min-h-11 (44px on spacing scale)
❌  h-[72px]            ← use h-18 (72px on spacing scale)
❌  min-h-[60vh]        ← use ui-empty-page class
```

#### The Decision Tree

Adding any visual element — ask in order:

1. **Does a `ui-*` class already exist for this?** → Use it.
2. **Is this a new recurring pattern (will appear 3+ times)?** → Add a `ui-*` class to `globals.css @layer components`.
3. **Is this a new color?** → Add a CSS custom property to `:root`/`.dark` in `globals.css`, map it in `@theme inline`, then use it via a new `ui-*` class or a semantic Tailwind class.
4. **Is this a layout value?** → Check the Tailwind spacing scale first (multiples of 4px: `h-18`=72px, `min-h-11`=44px). Use a CSS var + token if it's repeated (`--modal-max-height`, `--page-min-height`).
5. **Is this a one-off layout constraint with no semantic meaning?** → Arbitrary value `[value]` is acceptable only here, and only for layout (widths, heights, max-widths) — never for colors or typography.

#### Audit command

```bash
# Find all violations instantly:
grep -rn "text-gray-\|text-slate-\|text-zinc-\|text-blue-\|text-green-\|text-red-\|text-purple-\|text-yellow-\|text-orange-\|text-cyan-\|text-violet-\|bg-gray-\|bg-blue-\|bg-green-\|bg-red-\|bg-\[#\|text-\[#\|text-\[1[0-9]px\]\|text-\[8px\]" src/components/ src/app/ --include="*.tsx" --include="*.ts"
# Zero output = compliant.
```

### AI form assist (fleet standard)

Every create form is fillable from prose and changeable by talking to it.
Shared implementation: [`@fleet/ai-forms`](https://github.com/bitbaum/ai-forms)
(headless — it ships no markup, so this repo keeps its own `ui-*` styling).

Adding assistance to a form is two edits:

1. Register the form in `src/config/ai-forms.ts` (`AI_FORMS` is the SSOT — the
   API route accepts those keys and no others; derive option lists from the
   existing constants, never retype an enum). Mark ids and ownership columns
   `aiExcluded` so the model can neither see nor write them.
2. In the component, replace the per-field `useState` with `useAiForm(...)` and
   pass `assist={form}` to `<ModalForm>`. The bar, undo, and the per-field `AI`
   marker come for free.

`/api/ai/form-assist` serves every form; it never needs changing. Intent is
inferred — an empty form is filled, a filled one is refined — so `fill` protects
what the user typed while `refine` lets the model win on the fields it returns.

While a form is open it registers in `src/lib/active-form.ts`, so the floating
Loki assistant writes into it instead of describing which fields to type in.
Loki also receives a `pageContext` excerpt of the rendered `<main>`, with an
explicit rule to admit when something is not in that excerpt.

`pnpm run test:ai-forms` exercises fill + follow-up refine against the live model
(needs `GROQ_API_KEY`; not part of `verify`).

### No dead ends
A gate records; it never blocks. Anything that pauses a person shows the way
forward on the same screen: a default with its consequence stated and one tap
to change it, a skip that lands exactly where the old path landed, an error
state with a button, never a wall. The interview before a kickoff
(`components/projects/ProjectInterview.tsx`) is the pattern — every question
skippable, "Skip to the build" even when the questions fail to load. This is
fleet-wide; its permanent home is bitbaum/fleet `AGENTS.md`.

### SSOT Rules
- **User ID**: `getApiUserId()` (API routes, returns `string | null`) or `requirePageUserId()`
  (pages, throws/redirects) from `lib/session.ts`. There is no `getCurrentUserId` and no
  `DEFAULT_USER_ID` — both were removed in 98e88b65 and neither has existed since
- **Username normalization**: `normalizeUsername()` from `lib/username.ts` — used in forms, API, DB queries
- **Page layout**: `.app-page` class on root div — never repeat padding pattern
- **Navigation**: `config/navigation.ts` is SSOT for sidebar items
- **Modals/Drawers**: Use `<Modal>` / `<Drawer>` from `components/ui/modal.tsx` — never re-roll the `fixed inset-0 z-50 + backdrop + Esc handler` boilerplate
- **Date helpers**: `lib/dates.ts` exports `toLocalDateStr` (YYYY-MM-DD in local time) and `deadlineLabel`
- **Inline-edit lifecycle**: `useInlineEdit` from `hooks/use-inline-edit.ts`
- **Create flow**: `useCreateMutation` from `hooks/use-create-mutation.ts`
- **API envelope**: this repo returns `{ ok: true, ... }` on success and `{ error }` on failure — use `jsonOk`/`jsonError` from `lib/api/route-helpers.ts` in new routes (overrides the global `{ success, data }` guidance)

### Data Flow
- **Server Components** for DB data (commitments, entities, subscriptions) — query directly
- **Client Components** for tool data (calendar, weather, GitHub) — fetch via API routes
- **API routes** shell out to local CLI tools via `lib/tools.ts` for live data (gog, weather.sh, github-status.sh) when `isRuntimeAvailable()`

### Database
- Connection: `DATABASE_URL` env var (required, fail-fast if missing)
- Schema change flow: edit `src/db/schema/` → `pnpm run db:generate` (versioned `drizzle/NNNN_*.sql`) → review the SQL in the PR → the deploy applies it forward-only (`scripts/hetzner/apply-schema.sh`, guarded + rollback-on-drift). See `docs/infrastructure/migration-strategy.md`.
- `pnpm run db:push` (`drizzle-kit push`) is for a **throwaway local/scratch DB only** — never a shared or production database (it diff-applies with no reviewable file and can drop data).
- Seed: `DATABASE_URL=... pnpm exec tsx scripts/seed.ts`
- Every table has `user_id` for multi-user prep
- UUIDs for all primary keys
- JSONB for flexible metadata

### Security
- Escape LIKE wildcards in search queries (`escapeLike` in people.ts)
- Validate UUID format on API params before DB queries
- Validate/clamp input length and ranges at API boundary
- `runTool` in `lib/tools.ts` must never accept user-derived input

## Cloud vs local

See `docs/development/cloud-local-workflows.md` — SSOT for which workflows run in the browser vs require a builder (owned agent PTYs, agent CLIs), and for the stored routing rule.

See `docs/development/responsive-design.md` — SSOT for mobile chrome tokens, shell layout, viewport-height panes, and responsive component patterns. All pages must work at 320px+ without horizontal scroll.

That rule now has a check behind it. `pnpm run audit:responsive` drives the
AUTHENTICATED pages through real viewports (320/390/768/1440) in headless
Chromium, fails on horizontal overflow, reports touch targets under 44px, and
writes a screenshot per page/viewport to `.tmp/responsive-audit/`. It needs a
session: set `LOKI_SESSION_TOKEN`, or `AUDIT_DATABASE_URL` + `AUTH_SECRET`
— and since prod Postgres is firewalled to the box, `eval "$(bash
scripts/db-tunnel.sh)"` opens an SSH tunnel and exports the right URL. Not part
of `pnpm run verify` (needs network, a session, and a browser download).

## Shipping: nobody merges by hand

A green, non-draft PR merges and deploys itself. `.github/workflows/auto-merge.yml`
squash-merges it, then dispatches CI on `main` and reconciles Deploy so the box
gets the build. The policy is no longer in this repo: it lives once for the whole
fleet in `bitbaum/fleet`, `scripts/ci/auto-merge-sweep.sh`, and this repo
calls it as a reusable workflow. Read that file before changing anything here —
and change it THERE, because a fix made here would reach nobody.

- **Hold work back** with a **draft** PR (waits forever) or a `hold` /
  `no-automerge` / `do-not-merge` / `wip` label.
- **Corollary: never open a non-draft PR you would not want deployed.** Marking
  a PR ready for review *is* the decision to ship it.
- One PR merges per sweep, and only onto a green `main` — a PR's checks prove it
  against the `main` it branched from, not against the other queued PRs.
- The CD re-arm at the end of the sweep is load-bearing: a push made with the
  default `GITHUB_TOKEN` does not trigger workflows, so without it merges land
  and silently never deploy. `ci.yml` carries `workflow_dispatch` for this.
- **The `GITHUB_TOKEN` no-cascade rule applies one level deeper than you
  expect — but check WHICH TOKEN the sweep is holding.** With the default
  token, the re-armed CI run is *itself* `GITHUB_TOKEN`-created, so its
  completion fires no `workflow_run` event either, and anything listening for
  CI never wakes on an automated merge. Observed 2026-08-05: three PRs merged
  onto a green `main` and zero Deploy runs created — invisible, because CI
  itself ran and went green.

  **That is no longer what happens here.** `FLEET_PAT` is a live `bitbaum`
  **org** secret and `auto-merge.yml` passes it to the sweep, so the re-arm is
  PAT-created and **does** emit `workflow_run`. Deliberately — it is what makes
  the queue drain at CI speed instead of at the throttled schedule — but the
  conclusion above inverts with it: downstream *does* wake, and the sweep wakes
  **itself**. Verified 2026-09-17 by listing the org secrets.

  So the invariant is conditional, and reasoning from the wrong half is
  expensive in both directions: assume no-cascade under a PAT and you miss a
  feedback loop (bitbaum/solon that day: six sweeps a minute apart re-running
  two mutually-cancelling CI runs on one commit, Deploy failing on a docs-only
  change); assume cascade under the default token and you ship a merge that
  silently never deploys. **Establish which token is in play before predicting
  what a dispatch wakes.**
- **Deployment is a reconciler, not a trigger.** Each sweep compares `main`'s tip
  against the last successful Deploy and dispatches `deploy.yml` directly when
  they differ, so a deploy that never fired *or* failed is retried next sweep
  instead of sitting merged-but-not-live. Never add a workflow that only
  triggers on `workflow_run` of CI and assume automated merges reach it — give
  it `workflow_dispatch` and drive it from the sweep.
- **After merging, confirm the commit is LIVE, not just merged.** Green CI plus
  a merge is not a deploy; check the running site.

## Dev Commands

```bash
pnpm run dev          # Start dev server (default port 3000)
pnpm run build        # Production build
pnpm run smoke        # Curl every page route on localhost:3000 and assert 2xx/3xx
pnpm run test:home    # Run all eight home/ inline self-test suites (~14s)
pnpm run check:desktop # Typecheck + build desktop/ (Fleet Runner). Part of `verify`.
                      # Runs on EVERY PR, not just desktop ones: desktop/src/main
                      # bundles ../src and ../home, so a src/ change can break it.
pnpm run db:generate  # Generate a versioned migration file from schema changes
pnpm run db:push      # drizzle-kit push — LOCAL/scratch DB only, never shared/prod
pnpm exec tsx scripts/seed.ts  # Re-seed database from knowledge.sqlite + contacts
pnpm exec tsx home/watcher.ts --start # Run a single home/ piece for iteration
                                # (Fleet Runner desktop is the real executor)
```

A husky **pre-commit** hook runs `eslint` on STAGED FILES ONLY — no `tsc`. A
commit is cheap and local, so it is gated cheaply.

A husky **pre-push** hook runs only the gates the CHANGED FILES can affect —
NOT the full bundle. It used to run everything; that cost 7h13m under load on
2026-09-11, and the hook's own header records why it stopped. A docs-or-config
-only push therefore runs **nothing** locally and prints so.

**Green pre-push does NOT mean green CI.** CI is the gate; the hook is only a
fast filter. Before declaring a change done, run `pnpm run verify` yourself —
that is the bundle CI runs verbatim.

When they do fire, the hook's extras are a schema-drift guard, dev-server smoke
(if one is up), and, when `SMOKE_PRIVATE_PIN` is in `.env.local` (or exported),
`pnpm run test:pre-push-prod-dogfood`: authenticated prod smoke and headless
prod UI dogfood (`ui-flows` always; `dogfood:loki` when the builder is online;
`dogfood:machine` when a local Fleet Runner is connected).

## Views

| View | Route | Status |
|------|-------|--------|
| Control | /control | Fleet command center: dispatch intents to AI agents, real-time SSE status, per-project cards, git sync guard |
| Agents | /agents | RETIRED — redirects to /control. Control already is the roster; escalations land there |
| Loki | /loki | Chat assistant workspace — conversations, project-scoped dispatch, save-to-memory |
| Approvals | /approvals | The Approval Queue as a destination — review/approve Loki's proposed actions; locked-zone state shows pending count + unlock CTA |
| Feedback | /feedback | Every report across the fleet in one ironing-out loop: what phase each fix is in and the next action, without opening a project. Fed by the embeddable widget (`widget/`, served as `/widget.js`), AI review, and synthesized briefs. `ControlInbox` is the preview; this is the surface |
| Terminal | /terminal | Live embedded terminal — watch/drive the cloud builder or local Fleet Runner PTY per project tab |
| Activity | /activity | Fleet activity timeline — digests, event stream, per-project status strip across windows (hour/day/week/month). `/digests`, `/decisions` and `/history` are redirect stubs onto this page |
| Atlas | /atlas | RETIRED — redirects to /projects. Live URL and down-state live on Projects |
| Duet | /duet | RETIRED — redirects to /agents, which now redirects on to /control (side-by-side prompt view earned nothing over Terminal + Control) |
| Today | /today | Calendar, weather, commitments, bills, daily habit check-off, log conversation |
| People | /people | Contacts, search, detail panel, inline name/notes edit |
| Crew | /crew | Humans in the loop + the work you hand them. Draft → hand over (mints a share link) → they accept/decline/deliver → you accept. Paid assignments mirror to OrangeCat as a service; the roster is person entities flagged `crew:member`, never a parallel table |
| Money | /money | Subscriptions, monthly burn |
| Goals | /goals | Hierarchical tree, progress, milestones, inline target-date / progress edit |
| Projects | /projects | registered projects + GitHub CI, inline editors for name/desc/status/maturity; per-project dossier + shareable public link (/share/project/[token], audience-scoped resource visibility) |
| Habits | /habits | 30-day heatmap per habit, streak indicator, summary stats |
| Events | /events | Opportunities and deadlines, type-chip filter, archive flow |
| Prompts | /prompts | Prompt library, run-now via Loki, schedule as cron job |
| System | /system | Gateway, memory, disk, uptime, autopilot jobs |
| Memory | /memory | Knowledge graph stats and recent activity |
| Thoughts | /thoughts | Published essays on architecture and execution systems |
| Settings | /settings | Profile + team invite management |
