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

Operational quick-reference for agents working in this repo. Deep conventions
(design system, SSOT rules, view map) live in `CLAUDE.md`; read it too.

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
```

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

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
