# Loki

Loki is an independent product for building and changing projects with AI
agents. Start with a brief, create a real repository, build and deploy, then use
project feedback to direct the next change. OrangeCat linking is optional;
an OrangeCat account is not required to build in Loki.

Org names and relationships come from [bitbaum/fleet](https://github.com/bitbaum/fleet/blob/main/AGENTS.md)
and its registers. Hosting addresses are recorded in `scripts/hetzner/apps.conf`.

The product thesis is simple: AI agents are becoming cheap execution capacity,
but serious users still need a trustworthy command center. Loki provides the
state, queues, handoffs, guardrails, and business context around that capacity.

Production: https://loki.orangecat.ch
**Status:** live, pre-1.0. Hosted on **Hetzner**.

## What It Does

- **Agent operations**: launch, monitor, switch, and dispatch supported agents across real project workspaces.
- **Hybrid control plane**: hosted Next.js app owns auth, database, product UI,
  and team state; an eligible cloud builder or connected Fleet Runner owns workspaces, shell, git, and agent CLIs.
- **Project execution memory**: per-project handoffs, queues, recent outcomes,
  lifecycle signals, git state, and saved context are visible in one place.
- **Builder life OS**: goals, people, habits, events, money, prompts, and
  thoughts live beside the work system rather than in disconnected apps.
- **Economy-aware**: Loki pulls open demand from sibling product OrangeCat and
  searches the economy by meaning (OrangeCat embeds the query server-side), so
  finding what already exists and building what's missing is one flow.
- **Operational trust**: runtime signals are persisted, versioned, and
  explained in the UI so users can tell the difference between active work,
  an open terminal, and historical handoff context.

## Product And Economic Model

Loki serves individual builders and teams. Optional OrangeCat links connect
build dossiers to public profiles and funding. Linking does not publish private
work: publishing requires a separate owner choice.

**Designed economic model** (planned monetization).

| Layer | Value | Planned monetization (not billed) |
| --- | --- | --- |
| Individual builder | One Loki for projects, agents, commitments, and execution memory | Pro subscription (planned) |
| Team / studio | Shared project state, team visibility, agent dispatch, audit trail | Per-seat team plan (planned) |
| Agent runtime | Local daemon connects private machines to the hosted control plane | Paid runtime seats / usage tiers (planned) |
| Execution intelligence | Prompt routing, queue reasoning, outcomes, continuation policies | Premium automation tier (planned) |
| Enterprise / investor diligence | Operating telemetry, governance, security, and project health | Managed deployment / annual contract (planned) |

See [docs/business-model.md](docs/business-model.md) for positioning,
pricing logic, expansion loops, and defensibility.

## Architecture At A Glance

```text
Hosted control plane (self-hosted Next.js on Hetzner, Caddy in front)
  Auth, database, UI, team state, command queue, runtime snapshots

Execution runtime (eligible cloud builder or user machine)
  Project workspaces, owned agent sessions, git, shell tools, runner

Data layer (Postgres / Drizzle)
  User projects, runtime state, orchestration events, prompt queues,
  goals, people, habits, events, billing, memories
```

Key design rules:

- **SSOT first**: schema, navigation, agent registry, runtime snapshots, prompt
  queues, and design tokens each have one canonical owner.
- **Cloud/local separation**: browser workflows stay cloud-safe; shell and
  terminal work routes through the authenticated builder for that project.
- **Runtime truth beats assumptions**: Control reflects recorded runs and current worker sessions. A queued prompt
  or successful agent turn is not deployment evidence.
- **Agent-agnostic direction**: Claude-era compatibility remains where needed,
  but adapters and registry definitions are the migration path.

## Stack

- **Next.js 16.2.6** App Router, React 19, TypeScript strict
- **PostgreSQL 17** with Drizzle ORM and schema-inferred types
- **NextAuth v5** with GitHub OAuth and local owner-key support for private
  installs
- **Tailwind CSS 4** with a tokenized dark-first design system
- **Builder-owned agent sessions** for terminal runtime control
- **Self-hosted on Hetzner** (`bitbaum` box, Caddy + systemd) — production deploys via `scripts/deploy-hetzner.sh` (build → rsync → restart); cron jobs run on the box
- **Husky + GitHub Actions** for type, lint, and audit checks

## Repository Map

```text
src/app/                 App routes and API endpoints
src/components/control/  Agent operations UI
src/components/*/        Domain surfaces: today, people, projects, goals, etc.
src/config/              Navigation, prompts, categories, product constants
src/db/schema/           Drizzle schema SSOT
src/db/queries/          Data access by domain
src/lib/                 Runtime, auth, orchestration, formatting, utilities
home/                    Local-first orchestration self-tests and runtime model
scripts/                 Daemon, install, smoke, migration, and verification tools
docs/                    Architecture, business model, cloud/local workflows
drizzle/                 Generated schema migrations
packages/agent/          Hosted installer CLI
content/                 Public essays and whitepaper content
```

## Quality Bar

Every change should preserve:

- `pnpm run verify` — the one canonical gate. CI runs it verbatim, so green
  local verify means green CI. Its step list lives in `package.json`
  (`scripts.verify`); this file deliberately does not restate it.
- `pnpm run build`

This used to enumerate an ad-hoc subset of test scripts. Every such list
drifts from the real gate — three docs ended up teaching three different,
all-weaker bars — so the rule is now: name the gate, never its contents.
- `pnpm run smoke`

CI runs type/lint/design/self-test checks on pushes and pull requests. A
scheduled audit workflow fails on high or critical dependency vulnerabilities.
Production deploys to the Hetzner box run via `scripts/deploy-hetzner.sh`
(build → rsync → restart `loki-app`).

## Local Development

```bash
pnpm install
docker compose up db -d
cp .env.example .env.local
pnpm run db:push   # local scratch DB only — never a shared/prod database
pnpm run dev
```

Minimum local `.env.local`:

```bash
DATABASE_URL=postgresql://loki:changeme@localhost:5432/loki
AUTH_SECRET=replace-me
AUTH_TRUST_HOST=true   # without it every /api/auth/session returns 500
GITHUB_CLIENT_ID=replace-me
GITHUB_CLIENT_SECRET=replace-me
```

`AUTH_TRUST_HOST` is not optional on localhost: Auth.js rejects an untrusted
host, so the pages render but nothing can read a session. It is compared to the
exact string `"true"` — `1` does not work.

The database needs the **pgvector** extension (the knowledge index stores a
`vector(384)`); `drizzle-kit push` fails on the first table without it. The
compose db service uses the `pgvector/pgvector` image and creates the extension
on first boot. Against your own Postgres, run `CREATE EXTENSION vector;` first.

On a fresh database, visit `/setup` to create the first user.

### Local Agent Runtime

Work runs on the cloud builder by default; a project runs on your computer
when its profile says so ("Runs on" in Control) or when its checkout exists
only there. Shared cloud building is restricted to eligible accounts, so other
accounts need a connected Fleet Runner; see `src/lib/execution-access.ts`. To
connect your machine:

```bash
curl -fsSL https://loki.orangecat.ch/api/agent/install | node - init --base-url https://loki.orangecat.ch
```

The runtime requires at least one supported CLI on `PATH`: `claude`,
`codex`, `gemini`, `agent` (Cursor), `grok`, or `openclaw`.

See [docs/development/cloud-local-workflows.md](docs/development/cloud-local-workflows.md)
for the full matrix of browser-only vs local-runtime workflows.

## Important Docs

- [Business model](docs/business-model.md)
- [Architecture principles](docs/architecture-first-principles.md)
- [Debt reduction roadmap](docs/debt-reduction-roadmap.md)
- [Cloud vs local workflows](docs/development/cloud-local-workflows.md)
- [Responsive design (mobile/tablet)](docs/development/responsive-design.md)
- [Postgres portability](docs/infrastructure/postgres-portability.md)
- [Local orchestration runtime](home/README.md)

## Security And Operations

- Secrets stay out of Git; use `.env.example` as the contract.
- Production uses direct and pooled Postgres URLs separately.
- Local daemon access should use per-user `ck_*` agent tokens.
- Legacy shared daemon tokens require an explicit server-side opt-in flag.
- Private surfaces can be PIN-gated server-side.
- Dependency audit runs daily and high+ findings block the audit workflow.

See [SECURITY.md](SECURITY.md) for reporting and operational expectations.
