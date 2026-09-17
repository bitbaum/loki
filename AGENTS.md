# AGENTS.md — Loki

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

Loki is the **engineering plane** of an entity. An entity is anything that can
hold a wallet and is better for holding one — a test rather than a list, which
is what keeps the list open in principle: a new type earns its place by
answering the test, not by resembling the types already there.

The same entity sits on three planes. **OrangeCat** is its economy (it can
hold, receive and send value), **Solon** its governance (its decisions can be
put to a signed vote), **Loki** its engineering (it can be built and shipped by
agents). A project Loki builds for someone is that third plane of a thing that
also has the other two.

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
home/             Local-first agent orchestration (runs on the user's machine)
scripts/          deploy, tests, db tooling, generators
drizzle/          Versioned migration files + meta/ (journal + snapshot)
docs/             Architecture + infrastructure notes
```

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
verify ⇒ green CI. Run it before declaring any change done. A husky pre-commit
hook runs `tsc --noEmit` + `eslint`; pre-push runs `test:home` (+ `smoke` when
the dev server is up).

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

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
