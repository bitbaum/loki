# Loki

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

Loki is a multi-user SaaS **execution layer** for builders: where an operator's
work actually gets done. Users sign in, register their projects, and command AI
agent fleets from one dashboard — and the same workspace holds the people they
work with, the commitments they owe, and what they spend. Dark-first,
mobile-ready, designed for builders who want control without complexity.

Commanding agent fleets is the largest part of that and the reason most people
arrive, but it is not the whole product, and describing Loki as "the
engineering plane" made the rest look like clutter that belonged elsewhere.
There is nowhere else: OrangeCat's dashboard is economic entities and has no
Today, no habits, no commitments, no crew. See `AGENTS.md` → "What Loki builds"
for the audience-based split that actually separates the three products, and
`orangecat/src/config/ecosystem.ts` → `ECOSYSTEM_PILLARS` for the SSOT.

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
│   │                 Sections are SSOT in config/navigation.ts, grouped by
│   │                 THING, not by question: Build (Home, Projects,
│   │                 Sessions, Prompts) · Loki (chat, Voice, Today,
│   │                 Suggestions) · To review · The fleet +
│   │                 PIN-gated Private. The phone's bottom bar is Home ·
│   │                 Projects · Loki · More (the rest, in those sections).
│   ├── control/   → ControlPanel = HOME (/control, labelled "Home" since
│   │                 2026-10-19), ProjectCard, ProjectProfile.
│   │                 There is no ProjectTile. HomeComposer = the top: what to
│   │                 build + a project chip, sent via /api/inject — the one
│   │                 place work starts (no "Start something" card).
│   │                 Under it, three sections of ListRows answer, in order:
│   │                 "Needs you" (AttentionBar + ControlInbox + the hero,
│   │                 heading hidden when all are quiet), "Being built"
│   │                 (ControlNow: one row per job, live step from the
│   │                 runner's beat via lib/run-step, opening the live
│   │                 session) and "Done" (ControlDone). ControlFoot = two
│   │                 rows: builder (opens settings) + New project.
│   │                 ControlFleetStatus = the hero, shown ONLY for alarms the
│   │                 rows do not already name: ONE question, one button.
│   │                 ControlInbox = one collapsed queue for every small task
│   │                 (feedback triage + widget coverage) — add a group, never a
│   │                 new full-width strip. ControlSettingsSheet = autopilot,
│   │                 refresh, builder detail (settings, not state).
│   │                 See docs/development/responsive-design.md.
│   ├── composer/  → Composer — THE composer (text, attach, voice, model,
│   │                 Send/Stop, optional modes). Loki chat (loki/Composer →
│   │                 LokiComposer), the terminal's Loki rail + Control's quick send
│   │                 (terminal/TerminalComposer) and the session box
│   │                 (terminal/SessionComposer) all render it. Never add a second message box — add a prop.
│   ├── loki/      → LokiWorkspace, Thread, LokiComposer (Composer.tsx), ThreadRail (conversation list) (chat assistant)
│   ├── terminal/  → TerminalSurface (the ONE shell: tab strip + session bar +
│   │                 session + session box), TerminalTabStrip, TerminalModeBar,
│   │                 TerminalComposer, ShellWorkspace (server-owned bash PTYs,
│   │                 local/sandbox only), TerminalView (the one xterm),
│   │                 terminal-transport (substrate seam).
│   │                 SessionComposer = THE box for the agent in a session,
│   │                 in the terminal view AND the conversation view, at
│   │                 every width: microphone, screenshots, prompt library
│   │                 ("/"), "What's going on?" + held-still next steps above
│   │                 it. It picks the path: a live session is typed into
│   │                 (bracketed paste + Enter), a screenshot goes via
│   │                 chat-send, nothing running → tab-inject (starts/queues).
│   │                 There is no Type / Prompt / Voice switch — never add one.
│   │                 The box's row is + · model · mic · send, nothing else.
│   │                 "+" (or "/") opens SessionPicker, a bottom SHEET (photo
│   │                 or screenshot, Keys on a phone, agent commands, Loki's
│   │                 records, the prompt library); chatkit's paperclip is
│   │                 hidden there but mounted — "Photo or screenshot" presses
│   │                 it, so paste and Camera/Photos/Files stay chatkit's. In
│   │                 the conversation view next steps are reply rows under
│   │                 the answer (ReplySteps → the box's sendRequest), never
│   │                 chips over the box. A panel pinned above the box ran off the
│   │                 screen once its search raised the keyboard. Nothing in
│   │                 it takes the keyboard on a touch screen. The agent
│   │                 cannot read Loki's database, so
│   │                 Loki's records reach it only as a VISIBLE file on the box
│   │                 (LokiFiles; feedback via /api/feedback/export, fenced as
│   │                 untrusted) — a library prompt that needs one declares
│   │                 `attach` and gets it; the box agents' contract
│   │                 (scripts/hetzner/box-agent-claude.md, re-applied on every
│   │                 deploy) tells them to ask for it in one line. SessionInfo
│   │                 (the model chip, in BOTH views: TerminalSessionInfo
│   │                 reads the log itself in the terminal view, and the box's
│   │                 row is identical in both) names the model, effort and mode
│   │                 READ from the session log, in words, and changes them
│   │                 in place: each row lists its choices and a tap sends
│   │                 the agent's own command with the choice named
│   │                 (`/model sonnet`, `/effort high`). Never type a bare
│   │                 `/model` from a sheet: the picker opens in the terminal
│   │                 behind it and nothing visible happens (2026-10-18).
│   │                 Models are FAMILIES by Claude Code's own aliases
│   │                 (fable/opus/sonnet/haiku, config/agent-commands.ts),
│   │                 never versions; the row settles on Claude Code's own
│   │                 "Set model to Opus 5.5" (a `setting` transcript item)
│   │                 or shows its refusal in its words.
│   │                 Modes are SSOT in config/terminal-modes.ts; never add a
│   │                 second terminal shell — add a transport.
│   │                 TerminalActions = what the screen needs TYPED (signed
│   │                 out → /login, a menu → Enter), one click from the
│   │                 session. The agent CLIs' own commands are SSOT in
│   │                 config/agent-commands.ts; they are typed as keys, never
│   │                 injected (inject wraps text in project context).
│   │                 A press on the read-only screen puts the cursor in the box.
│   │                 Below md the same state drives phone chrome:
│   │                 TerminalMobileHeader (a chat app's: back to Control ·
│   │                 the session's name, "Claude · 2 sessions · cloud
│   │                 builder" under it · ⋮, and the Chat | Terminal pill
│   │                 centred below; no row of tabs) + TerminalSessionSheet
│   │                 (the name: sessions, New session, where it runs, agent)
│   │                 + TerminalMoreSheet (⋮: What's going on?, full screen,
│   │                 text size, live keystrokes). An open session hides the
│   │                 app bars below md (useImmersiveChat), so back is the way
│   │                 out + TerminalMobileDock = TerminalKeyDeck
│   │                 (the arrows/Esc/Tab/Ctrl a soft keyboard lacks — bytes are
│   │                 SSOT in config/terminal-keys.ts), opened by the Keys
│   │                 button on the terminal's corner — never a second text
│   │                 box. While the phone keyboard is up, the app bar and the
│   │                 view switch step aside and next steps go to one row
│   │                 (`fc-keyboard-open` in globals.css). Keys open hides
│   │                 the next-step row. A command button anywhere TYPES its
│   │                 words, then Enter as its own keystroke (lib/session-
│   │                 keystrokes typeCommand) — in one write Claude Code reads
│   │                 "/model opus\r" as a paste and the CR as a newline.
│   │                 Three surfaces talk, on purpose, and only three: the
│   │                 session box (the agent), TerminalLokiRail (Loki about
│   │                 this session — beside it on a wide screen; on a phone
│   │                 "What's going on?" opens it as a SHEET showing the
│   │                 answer and its steps, with no composer and no model
│   │                 picker, `presentation="sheet"`), and /loki (Loki chat).
│   │                 Two "models" exist and are named apart: the agent's
│   │                 (SessionInfo chip, "Opus 5.5") and the one answering
│   │                 Loki (loki/ModelPicker, "Loki answers with").
│   │                 See docs/development/responsive-design.md.
│   ├── activity/  → ActivityView (scope menus, the answer as a sentence, NeedsYouCard
│   │                 and EventStream as ListRows), ActivityReport (the written
│   │                 report, the page's one action, in a sheet)
│   ├── today/     → Greeting, SummaryBar (the day in one sentence), StickyNoteCard (captures; Loki "add X to my list"), CalendarCard, WeatherCard (one line), CommitmentsCard, HabitsList — sections of rows, no cards
│   ├── people/    → PeopleList (ListRows + Show/Sort menus; import/merge in a
│   │                 sheet, PeopleBookPanel), PersonDetail (the person page)
│   ├── crew/      → CrewWorkspace (asks + roster as ListRows), AssignmentSheet,
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
│   ├── goals/     → GoalsList (ListRows, progress ring), GoalDetail (/goals/[id]),
│   │                 NewGoalButton
│   ├── money/     → SubscriptionsList, SubscriptionSheet, NewSubscriptionButton
│   ├── habits/    → HabitsList (check off from the row; heatmap + settings in a
│   │                 sheet), HabitHeatmap, NewHabitButton
│   ├── events/    → EventsList (by date: deadline, else the day it happens),
│   │                 EventSheet, NewEventButton
│   ├── prompts/   → PromptLibraryClient (ListRows: yours, then Loki's by group),
│   │                 RunModal (THE Run sheet: one Run button — a project's
│   │                 agent for project work, Loki for personal prompts,
│   │                 lib/prompt-run), ScheduleModal, PromptForm, PromptPreview
│   ├── settings/  → SettingsTabs (a list of sections on a phone, a rail from lg),
│   │                 one component per section (TeamSettings = invite flow)
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
                     (gitignored — built, never committed). widget/chat/ is the
                     one exception to zero-dependency: the conversation drawn
                     by @bitbaum/chatkit (on Preact), its own lazy chunk
                     public/widget-chat.js, opt-in by data-fc-chat="kit". main.ts is the UI
                     (Shadow DOM, so host CSS cannot reach it), voice.ts is
                     speak-your-feedback, report-payload.ts is the shared
                     budgeting the ingest route also relies on.
                     This is the ONLY surface strangers on other people's sites
                     touch, so it earns the same care as src/ — it is covered by
                     `pnpm run lint` and tsc. It cannot see globals.css or
                     Tailwind, so its colours travel differently: the boot
                     response ships PALETTE.widgetThemes — light AND dark,
                     GENERATED from Loki's own globals.css (:root / .dark) by
                     scripts/generate-widget-theme.ts, so the panel is Loki's
                     monochrome, never OrangeCat's orange
                     (scripts/test/widget-theme-from-tokens.ts fails on drift).
                     Every widget stylesheet reads var(--lk-…) and the host
                     says which mode (widget/theme-mode.ts): the owner's Loki
                     choice (user_preferences.theme, saved by ThemeSync),
                     everyone else their device's. Never type a colour into
                     widget/ or palette.ts — change the tokens and regenerate.

extension/         → Loki for Firefox (Android and desktop): fills a form Loki
                     hands it and stops at the final button — the phone half
                     of what Fleet Runner's browser window does on a computer.
                     A web page cannot type into another site, so on a phone
                     an extension is the only way. Recipes are SSOT in
                     src/config/browser-tasks.ts and the filler is the same
                     src/lib/browser-fill.ts Fleet Runner runs; the manifest is
                     GENERATED from the recipe hosts (scripts/build-extension.ts
                     → extension/dist, gitignored). Every hand-off starts at
                     /fill, which picks the filler this device has.
                     scripts/test/browser-extension.ts loads the built
                     extension in Chromium end to end. Shipped to AMO by
                     .github/workflows/extension-release.yml once the AMO key
                     secrets exist.
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
Type:      --text-micro (12px — the floor; nothing renders smaller), --tracking-*, --font-*
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
           ui-btn-icon, ui-btn-xs, ui-btn-save, ui-btn-submit,
           ui-btn-ready-primary, ui-btn-ready-action, ui-btn-ready-more,
           ui-btn-confirm, ui-btn-danger
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
           (prompt categories have no colour: ui-tag-neutral — the ui-cat-*
           rainbow was retired 2026-10-20; colour in the app means status)
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
❌  text-[10px]         ← arbitrary size (use text-micro, 12px)
❌  text-[8px], text-nano ← below the floor (there is nothing under text-micro, 12px)
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

#### Rows of choices never wrap on their own terms

This is one instance of the fleet-wide rule, stated once in
[bitbaum/fleet AGENTS.md → "One shape per kind"](https://github.com/bitbaum/fleet/blob/main/AGENTS.md):
things of the same kind look the same, sit in the same place and are the same
size; siblings share one frame; rows of one list have one anatomy; actions
that belong together are equal cells; every label says what happens; an icon
promises its screen. Read it before building a screen, and run its pre-PR
checklist (390px, siblings, labels, one primary, the gates).


Pick one of a few → `<Segmented>` (`components/ui/segmented.tsx`): equal cells
in one row, or an even grid with `columns`, and the chosen one's meaning under
it. Many filters → `ui-filter-chip-row` (one line that scrolls on a phone). On/off
settings or long answers → one row each (`OptionRow`). Never chips in a
`flex-wrap` box: each pill as wide as its word, they broke into "4 + 1 orphan"
rows on a phone wherever the words ran out (owner, 2026-10-19: "Frankenstein
elements … not sized, not symmetrical"). `scripts/test/choice-rows.ts` fails
on the old shape.

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

See `docs/development/mcp.md` — how AI apps (claude.ai / ChatGPT connectors, Claude Code, Cursor) connect to Loki's MCP server at `/api/mcp`, its OrangeCat OAuth, and which scope each tool needs (values SSOT in `src/config/mcp.ts`).

See `docs/development/responsive-design.md` — SSOT for mobile chrome tokens, shell layout, viewport-height panes, and responsive component patterns. All pages must work at 320px+ without horizontal scroll.

That rule now has a check behind it. `pnpm run audit:responsive` drives the
AUTHENTICATED pages through real viewports (320/390/768/1440) in headless
Chromium, fails on horizontal overflow and on any word drawn across two lines
(chatkit's `findBrokenWords`, `@bitbaum/chatkit/audit` — "Di / re / ct / or /
y" is five syllables nobody wrote, and reading the CSS never finds it; the
widget test runs the same measure on the panel at 390), reports touch targets
under 44px, and writes a screenshot per page/viewport to
`.tmp/responsive-audit/`. It needs a
session: set `LOKI_SESSION_TOKEN`, or `AUDIT_DATABASE_URL` + `AUTH_SECRET`
— and since prod Postgres is firewalled to the box, `eval "$(bash
scripts/db-tunnel.sh)"` opens an SSH tunnel and exports the right URL. Not part
of `pnpm run verify` (needs network, a session, and a browser download).

## When you need George to do something: give the link and the exact steps

Never tell him to "go to the approvals page", "check the website" or "find X in
settings". Every ask ends with a **full clickable URL** and the **exact taps**,
and says what he will see when it worked. If you can do it yourself — through
the API, a workflow, the box — do it instead of asking. Say so when you did.

Examples of the shape (use the real host, `APP_URL` in `src/config/brand.ts`):

- "Approve the 3 p.m. event: https://loki.orangecat.ch/approvals → tap **Approve**
  on the card named *test*. It is booked within a minute and Telegram confirms."
- "Turn on phone notifications: open https://loki.orangecat.ch/settings on your
  phone → **Notifications** → **Turn on notifications** → **Send a test**."

George said this after an answer pointed him at "/approvals" as a bare path.
A path is not a link and "go and check" is a chore handed back. This is a
standing instruction for every session, in every repo.

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
  a merge is not a deploy; check the running site. `pnpm run ship:report --
  /route --focus '<selector>'` does the check and writes the proof — the live
  URL, phone and desktop screenshots of the deployed page, what was and was
  not verified. That report, not a merge notice, is what a finished message
  carries. See `docs/development/ship-report.md` for the message it replaces.

## Fleet packages install, always

Loki is built from the fleet's packages, and five of them install straight
from their GitHub repos (`github:bitbaum/chatkit`, `accountkit`, `searchkit`,
`whenkit`, `listkit` — see package.json). In a cloud agent session that was
not started with those repos, `pnpm install` fails with a 403 from codeload.
**That is a missing attachment, not a reason to skip the packages.** Attach
each one with `add_repo` and `access: "push"`, then run `pnpm install
--frozen-lockfile` again; it then installs in seconds. Read access is NOT
enough: the kits are public, so a read attach returns "nothing was attached"
and codeload keeps answering 403 — only the credentialed attach opens the
tarball path (verified 2026-10-17: whenkit 403 → 200 after the push attach).
Never strip them from package.json to get an install through, and never
report a test "skipped because the package cannot be installed" — on 2026-10-16 an agent did exactly that and the owner,
rightly, read it as the packages not working.

## Dev Commands

```bash
pnpm run dev          # Start dev server (default port 3000)
pnpm run build        # Production build
pnpm run smoke        # Curl every page route on localhost:3000 and assert 2xx/3xx
pnpm run test:home    # Run every inline self-test suite: the eight home/ modules + three src/lib ones (~14s)
pnpm run check:desktop # Typecheck + build desktop/ (Fleet Runner). Part of `verify`.
                      # Runs on EVERY PR, not just desktop ones: desktop/src/main
                      # bundles ../src and ../home, so a src/ change can break it.
pnpm run db:generate  # Generate a versioned migration file from schema changes
pnpm run db:push      # drizzle-kit push — LOCAL/scratch DB only, never shared/prod
pnpm exec tsx scripts/seed.ts  # Re-seed database from knowledge.sqlite + contacts
pnpm exec tsx home/watcher.ts --start # Run a single home/ piece for iteration
                                # (Fleet Runner desktop is the real executor)
```

**The box runner updates only when its agents are idle, and Loki now makes
that moment come.** A runner-code change schedules `drain-and-restart-
runner.sh` on the box, which restarts the runner once no agent is working.
Autopilot used to refill the queue the instant one finished, so from
2026-10-17 23:38 to 2026-10-18 09:12 ten deploys in a row found "2 agent(s)
working" and the box ran code days behind the app (Control said "Model: not
known yet" of an answer it was showing). While the cloud runner's heartbeat
version is behind the deploy's (`config/changelog.ts`), the commands route
hands it no work-starting commands (`src/lib/runner-update-hold.ts`): current
tasks finish, nothing new starts, the restart lands, the queue resumes on the
new code. The rule is server-side on purpose — a runner-side one would have
waited for the very restart it was meant to allow. Control's builder line
says "a newer version waits for its agents to finish" meanwhile.

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
`scripts/machine-dogfood.mjs` when a local Fleet Runner is connected).

## Views

| View | Route | Status |
|------|-------|--------|
| Home | /control | (Was "Control".) The box to start work in a project, then what needs you, what is being built, what got done, and the project list. In-app primary buttons are monochrome (`ui-btn-primary` = `--accent-primary`); orange is the public site's only |
| Missions | /missions | A search row, a Show menu and one row per project (the problem first, then work in progress). `/missions/[id]`: Objective, Next move (with the one permissioned Continue), Roadmap, Latest handoff, Recent runs. Progress is what the goals report — never described as verified |
| Agents | /agents | RETIRED — redirects to /control. Control already is the roster; escalations land there |
| Loki | /loki | Chat assistant workspace — conversations, project-scoped dispatch, save-to-memory |
| Suggestions | /suggestions | Every front Loki keeps records on — Build, Business, Goals, People, Money, Habits (SSOT `config/suggestion-avenues.ts`) — read into one board of things to do next, each naming the record it came from. "Do it" opens Loki with the ask written and the project set (or the page only the person can act on); "Not now" hides it for a month. Decisions are rows in `suggestion_decisions` and are the ONLY source of the page's numbers; the `/loki` and Control build rows honour them too. Rankers are pure (`lib/build-suggestions/rank.ts`, `lib/suggestions/life.ts`); `lib/suggestions/load.ts` gathers |
| Approvals | /approvals | The Approval Queue as a destination — review/approve Loki's proposed actions; locked-zone state shows pending count + unlock CTA. Package updates a project's setting held (Update / Not now / Stay on this version) sit here too, shown behind the PIN as well — they name no private data. So do new accounts' build requests from /change (`config/build-requests`, operator only): the cloud builder runs only the operator's commands, so a stranger's "Make it real" is filed, approved here, and built as the operator's client work behind a code of that preview's own (`getProjectPreviewCode`); the visitor follows it on `/change/requests/<id>` |
| Feedback | /feedback | Every report across the fleet in one ironing-out loop: what phase each fix is in and the next action, without opening a project. Fed by the embeddable widget (`widget/`, served as `/widget.js`), AI review, and synthesized briefs. `ControlInbox` is the preview; this is the surface |
| My feedback | /my-feedback | The REPORTER's side of the same loop — the one feedback surface whose reader may be a stranger on someone else's site. Renders through the same pieces as `/feedback` (`FeedbackReportText`) on purpose: it kept its own row markup once, and the three-line clamp shipped to the operator inbox never reached it, so the person who asked for it watched their own report swallow the list. Status is DERIVED, never the DB word — `lib/feedback/reporter-view.ts` writes every reporter-facing sentence so builder asks, raw agent errors and run ids cannot travel. A seat on someone else's project (a Builder, a client, a viewer) asks; the owner decides — whoever asks pays, in their own builder (`docs/architecture/private-builders.md`), so no seat spends the owner's engine (the monthly client allowance that did was retired 2026-10-20). A change built FOR the person who asked (`site_feedback.on_allowance`, read as `previewFirst`) opens as a draft and waits here, and on their project page, as "Ready for you" with **Make it live** (`lib/feedback/go-live.ts`). On the site itself a member is known by their own member pass (`#loki-member=`, `lib/feedback/member-pass.ts`) — never the owner's link, which is the owner's console. A visitor with no account follows a note from its tracking link (`/claim-feedback`, mailed to the address they leave), which opens on the note's status; an account is optional, below it |
| Sessions | /terminal | (Was "Terminal".) Each agent's session, read as Chat or as its Terminal (the Chat | Terminal pill names views, never the agent; an agent with no chat view shows only the terminal). The terminal scrolls with a finger and, past the oldest kept line, points at Chat. The model chip's sheet: Model and Effort as `<Segmented>` rows, each choice explained; Mode as a list, switched by Shift+Tab until Claude Code's own footer names it (`use-live-mode`, `lib/claude-mode-footer`). Watch/drive the cloud builder or local Fleet Runner PTY per project tab. Nothing open: your projects, each with Resume (TerminalResume → `/api/agent/launch {resume:true}` → `claude --resume` of the folder's newest conversation; Codex: `codex resume --last`; other agents say Start), never a form. The box runner writes down its open sessions (`desktop/src/main/tab-memory.ts`, `~/.loki/open-tabs.json`) and reopens them when it starts, so a deploy's restart no longer ends them. **Plain shell**: a row "Plain shell" (nothing open, and in the session sheet) opens a real bash login shell on the builder — no project, no agent — operator-only, behind the PIN with a 10-minute idle lock, audited without content (`docs/architecture/plain-shell.md`, `lib/shell-session.ts`); it takes raw keystrokes, never the agent box |
| Activity | /activity | Fleet activity timeline — digests, event stream, per-project status strip across windows (hour/day/week/month). `/digests`, `/decisions` and `/history` are redirect stubs onto this page |
| Atlas | /atlas | RETIRED — redirects to /projects. Live URL and down-state live on Projects |
| Duet | /duet | RETIRED — redirects to /control (side-by-side prompt view earned nothing over Terminal + Control) |
| Today | /today | Calendar, weather, commitments, bills, daily habit check-off, log conversation |
| People | /people | Contacts as ListRows (search row, Show/Sort menus, "We talked today" in the row menu); import and merge in a sheet. `/people/[id]`: note, ways to reach them, conversations, details, actions |
| Crew | /crew | Humans in the loop + the work you hand them. Draft → hand over (mints a share link) → they accept/decline/deliver → you accept. Paid assignments mirror to OrangeCat as a service; the roster is person entities flagged `crew:member`, never a parallel table |
| Money | /money | The month as one sentence (per currency — no exchange rate is invented), subscriptions as ListRows, each opening a sheet (mark paid, edit, verify, alternatives, cancel, delete) |
| Goals | /goals | One sentence, goals as ListRows (progress ring, due · project), Sort/Project menus. `/goals/[id]`: progress, date, milestones, sub-goals (their own pages), habits that feed it, actions |
| Projects | /projects | ListRows: a search row, Show/Sort menus, one plain line per project (`lib/project-list-line.ts`: broken → busy → needs you → how it is) and the time since its last run; earlier `-refresh-` copies and archived projects fold under Archived. The `+` asks "Build a site" or "Add an existing project" (`NewProjectChooser`). A project page: one title, a section menu on a phone (tabs from md), sections as plain headings, checks/stage/feedback counts in Story; per-project dossier + shareable public link (/share/project/[token], audience-scoped resource visibility). A new site's kickoff plans which fleet packages it is BUILT FROM (`lib/kit-plan`, trigger words SSOT `config/kit-plan.ts` keyed by catalogue name, validated against the live catalogue): the kickoff screen says it in plain words (`KitPlanPreview`, text only, never a gate), the first build's prompt carries it as a `BUILT FROM` block with install lines and "do not write your own", and client work is also told to swap `@bitbaum/design-tokens` for the client's tokens. The plan is stored on `user_projects.kit_plan` (a plan — never written into `project_packages`, which stays observations) and shown as a "Planned" line under Built from; the kickoff run's `payload.kitPlan` records planned vs observed after the first build (`lib/kit-plan/coverage.ts`) |
| Packages | /packages | What the fleet is built from: every shared package in bitbaum/fleet's register (read through the fleet brief's one fetch, `lib/packages/catalogue.ts`), its latest version, and which of your projects is on which version (`/packages/[slug]`, behind first). Rows in `project_packages` are OBSERVATIONS read from each repo's package.json + lockfile (`lib/packages/sync.ts`) — never decisions; a project's Story tab shows the same as "Built from". Each project's UPDATE SETTING (`user_projects.package_updates`: Automatic / Ask me / Stay on these versions, SSOT `config/package-updates.ts`) is applied to its open Dependabot PRs every 15 minutes (`lib/packages/updates.ts`, cron `sync-package-updates`): Loki adds its own `hold` label where the setting or a breaking bump says wait, removes only holds it added, and merges only a breaking update a person approved once green — Dependabot proposes, the fleet sweep merges. Held updates are cards on /approvals, read from `package_update_requests`. The package's OWNER (whoever owns the Loki project that is the package repo; with no such project, whoever's GitHub token can push — `lib/packages/release-access.ts`) releases from `/packages/[slug]` ("Unreleased": changes since the highest version tag, next version from conventional commits — under 1.0 breaking is a minor — `lib/packages/release.ts`): Loki dispatches the repo's own `release.yml` (bitbaum/fleet `templates/package`) with an exact version and stores nothing about it. "Rollout" per recent version is DERIVED (`lib/packages/rollout.ts`); "Pause vX.Y.Z everywhere" is the one stored decision (`package_release_pauses`, SSOT words `config/package-releases.ts`): the update sync holds every open update to that version in every project whatever its setting, and resume removes only holds nothing else wants. **npm** (the panel at the top): the owner pastes ONE npm key (made on npmjs.com from a phone; settings SSOT `config/npm-publishing.ts`), Loki keeps it sealed (`lib/secret-box.ts`, table `npm_publish_keys`, never sent to a browser), and for every package npm does not know yet writes it into the package repo as the Actions secret `NPM_BOOTSTRAP_TOKEN` and starts its `publish.yml`, which publishes the first version and links itself as trusted publisher — later releases need no key. The 15-minute package cron does the same for packages registered later (`lib/packages/npm-publish.ts`). Android Chrome/Brave run no extensions, so this needs no browser extension at all |
| Habits | /habits | "3 of 5 done today", a row per habit with its check-off on the left; the row opens a sheet: 30-day heatmap, how often, linked goals, pause, rename, delete |
| Events | /events | Coming up / no date / already happened (deadline, else `date_start`), a Show menu for kinds, a sheet per event (edit, ask Loki, archive, delete) |
| Prompts | /prompts | Your prompts and Loki's library as rows; a row opens the Run sheet with ONE Run (the project's agent — started or queued through the inject core, also for a repo-only project — or Loki, streamed, for personal prompts); repeat on a schedule from the row's menu |
| System | /system | Gateway, memory, disk, uptime, autopilot jobs |
| Memory | /memory | Knowledge graph stats and recent activity |
| Thoughts | /thoughts | Published essays on architecture and execution systems |
| Settings | /settings | Twelve sections: a list of rows on a phone (each opens with a back row; the back gesture returns to the list), a rail from lg. Deep links `#ai`, `#agent` open a section |

## Websites for people: "create website for <Name>"

The flow is one command and it ends with a link, not a list of steps. Say
"create website for Murphy's Bar" and the result is `murphys-bar.orangecat.ch`,
behind the access code, with the feedback widget on it, built by the cloud
builder, with no repository and nothing public. Ask at most one question (the
address, default from the name). Full flow:
`docs/architecture/prospect-previews.md` → "Create website for <name>".

- **Their name is the address**: `<label>.orangecat.ch`, via
  `scripts/hetzner/attach-preview-host.sh`. A domain they buy later is
  `attach-domain.sh`.
- **The code is the operator's, chosen in the app** (the Access code field in
  Build a preview, or said to the chat), remembered in
  `user_preferences.preview_code`; `LOKI_PREVIEW_CODE` in the server env is only
  the fallback. Never write a real code into a repo: this one is public.
- **Ask Loki**: "create website for <Name>" in the chat runs `create_website`.
- **Client work is private until they agree** (`docs/architecture/client-work-consent.md`).
- **No repository per prospect.** Only on "they said yes".
- Work fast and finish it: use the shared packages, check it at 390px, give the
  link. Do not explain the machinery to the operator; do the thing.

