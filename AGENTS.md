# AGENTS.md — Loki

<!-- fleet:rules:begin — generated from bitbaum/fleet templates/agent-rules.md; edit it there, not here -->

## Org rules

Read `bitbaum/fleet` `AGENTS.md`, `SHARED.md` and the registers it names before
inventing a host, a name, a page or a shared behaviour. Do not copy their facts
into this file.

- **Packages first.** If a `@bitbaum/*` package (or `bip-kit`, `limitkit`,
  `threadkit`, `ai-forms`) already does it, use it and fix a defect in the
  package, not in this app. Every chat is `@bitbaum/chatkit`, every search box
  `@bitbaum/searchkit`, every chart `@bitbaum/chartkit`, accounts
  `@bitbaum/accountkit`, model calls `@bitbaum/ai-kit`. Review this product's
  `package-plan.json` before building anything.
- **One shape per kind.** Things of the same kind look the same and sit in the
  same place (fleet `AGENTS.md`, "One shape per kind").
- **Finished work ships by itself.** Open a non-draft pull request; the fleet
  auto-merge sweep is the only merge path. Never merge by hand, through the
  merge API, with `--auto` or with an admin bypass, and never force-push a
  shared branch.
- **Nothing made up.** A fact on a page or in a doc needs a source that was
  opened; where there is none, the line is removed or softened.
- **Bitcoin orange is for Bitcoin and top-of-funnel actions only.**
- **No model identifier** in anything pushed to a repository.
- Before you finish, run `node <fleet>/scripts/ci/docs-truth-audit.mjs --dir .`:
  the same check the sweep runs on every pull request.

<!-- fleet:rules:end -->

Read [bitbaum/fleet AGENTS.md](https://github.com/bitbaum/fleet/blob/main/AGENTS.md)
and the registers it names before working here.

Operational guide for agents working in this repo; `CLAUDE.md` points here.
Where each surface's code lives, and what each view is for, is
[`docs/development/surfaces.md`](docs/development/surfaces.md).

## What this is

Loki is an independent product for building and changing projects with AI
agents: brief → repository → deployed result → feedback → verified change.
OrangeCat linking is optional. Execution access is defined in
`src/lib/execution-access.ts`; project identity is not a terminal tab name.
A queued run or successful agent turn does not prove a deployment.

**Loki builds software. It does not make video, music or prose.** That
neighbour capability lives on OrangeCat (its Studio), and what it can do is
stated once in `src/config/ecosystem.ts` → `ORANGECAT_CAPABILITIES`, which
Loki's capability preface reads verbatim. Do not restate it in prose anywhere
else, and do not let any surface imply Loki renders media itself — it points at
where that happens.

Two different things are called "studio" around here, so always qualify:
**OrangeCat's Studio** is that media surface, while **the studio map** in this
repo's own comments means the fleet overview (`fleetMapFacts`, published by
`/api/fleet/map`). The prompt only ever sees the latter labelled "Fleet map",
which is what keeps the model from confusing them — keep it that way.

## What Loki builds: entities

Loki is the **execution plane** of an entity. An entity is anything that can
hold a wallet and is better for holding one — a test rather than a list, which
is what keeps the list open in principle: a new type earns its place by
answering the test, not by resembling the types already there.

The same entity sits on three planes. **OrangeCat** is its economy (it can
hold, receive and send value), **Solon** its governance (its decisions can be
put to a signed vote), **Loki** its execution (it can be worked on, built and
shipped). A project Loki builds for someone is that third plane of a thing
that also has the other two.

This plane was called "engineering" until 2026-09-20, and the rename is not
cosmetic — the old word kept producing a wrong conclusion. Engineering is
Loki's deepest capability, not its extent: Today, People, Crew, Money, Goals
and Habits are here too, they work, and OrangeCat has no such surfaces to
receive them (its dashboard is entities — assets, causes, loans, services,
store). Under the narrow label those surfaces read as scope creep, and the
repeated proposal was to move them to the Cat. That proposal was made twice in
one session and was wrong both times.

What separates the three is AUDIENCE, not category: OrangeCat is public by
design, Loki is private by default, Solon is shared with its members. Work
crosses a boundary when it needs to be SEEN, PAID or DECIDED — which is
exactly the seam Crew already implements, keeping an assignment private here
and mirroring it to OrangeCat as a service only once it is paid. The one-word
role is SSOT in `orangecat/src/config/ecosystem.ts` → `ECOSYSTEM_PILLARS`.

The list of types has ONE producer: `orangecat/src/config/entity-registry.ts`,
where every type carries `wallet: { holds, why }` under a ratchet test
(bitbaum/orangecat#1071). Do not restate it here — the same rule this file
already applies to `ORANGECAT_CAPABILITIES` above, and for the same measured
reason: three copies of the entity list lived in orangecat's own agent-read
docs and all three had drifted, one naming a type that has never existed. See
`bitbaum/fleet` `AGENTS.md` → Producers.

## Where code lives

Every repository Loki creates or registers lives in the `bitbaum` GitHub
organisation. Never a personal account: `src/config/github-owner.ts` is the one
place the owner is decided, creation goes to the org and fails loudly if it
cannot, and `scripts/test/repos-are-created-in-the-org.ts` fails on any path
that does otherwise. `gh repo list catomean` should show one repo (the profile).

**Nobody is sent to GitHub to start.** Most people arriving with an idea have
no GitHub account and should never need one: Loki creates the repository with
the server's own org token for EVERY signed-in account and keeps the code
(`user_projects.code_custody = 'loki'`). That column is the whole safety
boundary — the org token may act destructively (archive, rewire, hand over)
only on a row that says `loki`, and only the two paths that created the
repository with that token may write it (`lib/kickoff/steps.ts`,
`api/projects/create-with-github`). A repository a person linked by hand is
theirs: their own token or nothing. `scripts/test/github-org-token.ts` pins
the rule. Once the site is live, Project settings offers to move the
repository to the person's own GitHub (`api/projects/[id]/handover`); after
that it is theirs to manage there. Keeping code is free; if it ever incurs a
real cost it becomes part of a paid plan, never a gate in front of starting.

## Fleet references in coding tasks

Fleet registers are the source of truth for shared packages and stack policy.
Routine task prompts stay focused and do not paste the full fleet catalog;
agents read the current repository's `AGENTS.md` and consult fleet references
when the task involves a shared package or stack decision. The catalogue and
snapshot remain available to reference surfaces (`src/lib/fleet-brief/`).
`scripts/test/dispatch-does-not-inject-fleet-catalog.ts` guards against adding
the full catalog back to every task.

The FIRST build of a new site gets one thing more: its "Built from" plan
(`src/lib/kit-plan/`), the shared packages its brief calls for — search,
sign-in, booking dates, mail, payments, chat — each with its install line and
"do not write your own". The trigger words are SSOT in
`src/config/kit-plan.ts`, keyed by the catalogue's package name; a package
fleet retires drops out of every plan, and a new one is one entry there.
Client work is also told to keep the starter's token structure but replace
`@bitbaum/design-tokens` with the client's own (fleet SHARED.md).

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **TypeScript strict** — no `any` without justification
- **Tailwind CSS 4 + shadcn/ui** — dark by default, with supported light mode
- **Drizzle ORM** — schema is SSOT for types
- **PostgreSQL 17** — self-hosted, `loki` database

## Layout

```
src/app/          Pages + API routes (thin; delegate to queries/components)
src/components/   UI (ui/ primitives, shell/, control/, loki/, terminal/, …)
src/config/       SSOT for navigation, channels, prompt-library, subscriptions
src/db/schema/    Drizzle tables — SSOT for all types
src/db/queries/   Data access (one file per domain)
src/lib/          constants, dates, tools, api wrappers, session, db-url
home/             Agent orchestration library (embedded by scripts/box-runner.ts, desktop/, scripts/hosted-runner.ts)
scripts/          deploy, tests, db tooling, generators
drizzle/          Versioned migration files + meta/ (journal + snapshot)
docs/             Architecture + infrastructure notes
```

## Writing copy: tap or click

Loki is used from phones and computers, so "tap this" is wrong on half of them.
Say what happens instead of the gesture ("Open the list", "Pick one", "Choose
Send"). Where the gesture IS the instruction ("tap the screen, then type"),
use `usePressVerb()` (`src/hooks/use-press-verb.ts`), which follows the device
in the person's hand; `widget/press.ts` is the same for the feedback widget.
Narration of what someone did says "pressed", which is true of both.

## Dev commands

```bash
pnpm run dev        # dev server (port 3000)
pnpm run build      # production build
pnpm run smoke      # curl every route on :3000, assert 2xx/3xx (needs dev server)
pnpm run test:home  # home/ inline self-test suites (~14s)
pnpm run check:desktop # typecheck + build desktop/ (Fleet Runner); part of verify, on every PR:
                       # desktop/src/main bundles ../src and ../home, so a src/ change can break it
pnpm run db:generate   # versioned migration from schema changes
pnpm exec tsx scripts/seed.ts         # re-seed from knowledge.sqlite + contacts
pnpm exec tsx home/watcher.ts --start # run one home/ piece for iteration
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

## verify (the one canonical gate)

```bash
pnpm run verify
# The step list lives in package.json "scripts.verify" and NOWHERE else.
# Read it there: `jq -r '.scripts.verify' package.json`
```

A previous copy of the list was inlined here and silently drifted — it named
five steps while the gate had grown to nine, so this file taught a weaker bar
than CI enforces. A doc that restates a machine-readable SSOT will always
eventually lie about it; point at the source instead.

CI (`.github/workflows/ci.yml`) runs `pnpm run verify` **verbatim** — green local
verify ⇒ green CI. Run it before declaring any change done. The hooks are only a
fast filter and prove nothing: pre-commit runs `eslint` on STAGED FILES ONLY (no
`tsc`), and pre-push runs only the gates the changed files can affect — a
docs-only push runs nothing at all.

## Database & schema (see `docs/infrastructure/migration-strategy.md`)

- **Schema (SSOT):** `src/db/schema/` — types via `$inferSelect` / `$inferInsert`.
- **Migrations:** `drizzle/NNNN_*.sql`, meta in `drizzle/meta/`.
- **Change flow:** edit schema → `pnpm run db:generate` (versioned file) →
  review the SQL in the PR → the deploy applies it forward-only.
- **Raw-SQL migrations** (`scripts/db/migrations/NNN_*.sql`, e.g. 074/075) are
  hand-applied via `pnpm run db:apply-box <file>` (runs as the app role so
  objects are owned by `loki`). The deploy's `apply-schema.sh` does NOT
  auto-apply these — apply them to the box **and** local dev *before* the code
  reaches `main`, or the drift-gate rolls the deploy back.
- **`drizzle-kit push` is for a throwaway local/scratch DB only** — never a
  shared or production database. (There is no `migrate` script; the proposed
  rename was implemented as the `db:generate` flow above.)
- Every table has `user_id` (multi-user); UUID primary keys; JSONB for metadata.
- `DATABASE_URL` is required; the app fails fast without it.

## Done means seen

A finished change is reported with the live URL first, screenshots of the
real deployed page (phone width first, the built section cropped), and two
lists: what was verified and what was not. `pnpm run ship:report -- /route
--focus '<selector>'` produces all three and exits non-zero while the build is
not live. A merge notice, a CI link or "it should go live on its own" is not a
report; `docs/development/ship-report.md` keeps the message that taught this.
After it ships, Loki records how the operator uses the surface
(`src/config/usage-surfaces.ts`) and reads it back, so a row nobody taps is a
finding and not a mystery.

## Self-host deploy path

- Prod host: Hetzner box (`167.233.22.31`), app at `/opt/loki/app`,
  self-hosted Postgres (`loki` DB).
- CI-gated: `.github/workflows/deploy.yml` fires **after a green CI on `main`**
  (dormant until repo var `DEPLOY_VIA_CI=true` + `HETZNER_SSH_KEY` secret), then
  runs `scripts/deploy-hetzner.sh --no-build`.
- `deploy-hetzner.sh` applies schema **before** shipping code via
  `scripts/hetzner/apply-schema.sh` — forward-only, ledger-based
  (`public._deploy_schema_history`), **refuses destructive statements**, single
  transaction. A post-apply schema-drift gate **rolls back** on missing objects.
- Never commit secrets. Never point `DATABASE_URL` at the box for `push`.

## Design System — The Four-Layer Architecture

Every pixel in Loki flows through exactly four layers in order. Any shortcut past a layer is a violation.

```
Layer 1  globals.css :root / .dark     → Raw values: OKLCH colors, rem sizes, shadows
Layer 2  globals.css @theme inline     → Tailwind mappings: --color-* pointing to Layer 1 vars
Layer 3  globals.css @layer components → ui-* classes: every recurring visual pattern
Layer 4  JSX in components/            → Uses Layer 3 classes + layout-only Tailwind
```

**The rule in one sentence:** components describe structure and layout; globals.css owns every visual decision.

### Layer 1 — CSS Custom Properties (the raw values)

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

### Layer 2 — Tailwind Theme Mapping

`@theme inline` in `globals.css` maps Tailwind utilities to the Layer 1 vars. This means Tailwind class names like `bg-surface-raised`, `text-text-primary`, `shadow-panel-strong`, `text-micro` all resolve through CSS vars — one retheme = one file change.

**Never** put literal hex or RGB values in `@theme inline`. Only `var(--*)` references.

### Layer 3 — The `ui-*` Class System (SSOT for patterns)

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

### Layer 4 — JSX (structure and layout only)

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

### The Decision Tree

Adding any visual element — ask in order:

1. **Does a `ui-*` class already exist for this?** → Use it.
2. **Is this a new recurring pattern (will appear 3+ times)?** → Add a `ui-*` class to `globals.css @layer components`.
3. **Is this a new color?** → Add a CSS custom property to `:root`/`.dark` in `globals.css`, map it in `@theme inline`, then use it via a new `ui-*` class or a semantic Tailwind class.
4. **Is this a layout value?** → Check the Tailwind spacing scale first (multiples of 4px: `h-18`=72px, `min-h-11`=44px). Use a CSS var + token if it's repeated (`--modal-max-height`, `--page-min-height`).
5. **Is this a one-off layout constraint with no semantic meaning?** → Arbitrary value `[value]` is acceptable only here, and only for layout (widths, heights, max-widths) — never for colors or typography.

### Rows of choices never wrap on their own terms

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

### Audit command

```bash
# Find all violations instantly:
grep -rn "text-gray-\|text-slate-\|text-zinc-\|text-blue-\|text-green-\|text-red-\|text-purple-\|text-yellow-\|text-orange-\|text-cyan-\|text-violet-\|bg-gray-\|bg-blue-\|bg-green-\|bg-red-\|bg-\[#\|text-\[#\|text-\[1[0-9]px\]\|text-\[8px\]" src/components/ src/app/ --include="*.tsx" --include="*.ts"
# Zero output = compliant.
```

## AI form assist (fleet standard)

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

## No dead ends here

The pattern for a gate that records rather than blocks is the interview before
a kickoff (`src/components/projects/ProjectInterview.tsx`): every question
skippable, "Skip to the build" even when the questions fail to load.

## SSOT Rules
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

## Data Flow
- **Server Components** for DB data (commitments, entities, subscriptions) — query directly
- **Client Components** for tool data (calendar, weather, GitHub) — fetch via API routes
- **API routes** shell out to local CLI tools via `lib/tools.ts` for live data (gog, weather.sh, github-status.sh) when `isRuntimeAvailable()`

## Security
- Escape LIKE wildcards in search queries (`escapeLike` in `src/db/queries/people.ts`)
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

## Shipping: which token the sweep holds

A green, non-draft PR merges and deploys itself through
`.github/workflows/auto-merge.yml`, which calls the fleet's sweep; change the
policy in `bitbaum/fleet`, never here. Deployment is a reconciler, not a
trigger: each sweep compares `main`'s tip with the last successful Deploy and
dispatches `deploy.yml` when they differ, so never add a workflow that only
listens for `workflow_run` of CI — give it `workflow_dispatch` and drive it
from the sweep.

**Establish which token is in play before predicting what a dispatch wakes.**
With the default `GITHUB_TOKEN`, the re-armed CI run fires no `workflow_run`,
so nothing downstream wakes on an automated merge (2026-08-05: three merges,
zero deploys). `FLEET_PAT` is a live `bitbaum` org secret that `auto-merge.yml`
passes to the sweep, so here the re-arm is PAT-created and **does** cascade —
and the sweep wakes itself (2026-09-17, bitbaum/solon: six sweeps a minute
apart re-running two mutually-cancelling CI runs). After merging, confirm the
commit is live, not just merged (see "Done means seen").

## Fleet packages install, always

Loki is built from the fleet's packages. Most come from the npm registry;
`@bitbaum/accountkit` still installs straight from its GitHub repo (see
`package.json`). In a cloud agent session started without that repo,
`pnpm install` fails with a 403 from codeload. **That is a missing attachment,
not a reason to skip the package.** Attach it with `add_repo` and
`access: "push"`, then run `pnpm install --frozen-lockfile` again. Read access
is not enough: the kits are public, so a read attach attaches nothing and
codeload keeps answering 403. Never strip a package from `package.json` to get
an install through, and never report a test "skipped because the package
cannot be installed".

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

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
