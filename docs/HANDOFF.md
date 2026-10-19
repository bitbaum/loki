# Loki — Handoff

**Read this first.** A 5-minute brief on what Loki is, where it stands, what to work on next, and what you'll get wrong if you don't know.

> **⚠ Written 2026-06-07. Re-checked 2026-09-02: the VERSION AND SCALE FIGURES
> BELOW ARE WRONG.** The narrative — why the architecture is shaped this way,
> what the bundled-renderer disaster taught — is still worth reading. The numbers
> are not. Verified today:
>
> | This file says | Actually |
> |---|---|
> | Desktop v0.7.5 latest | **v0.8.19** (35+ releases since) |
> | Electron 33 | **^43.4.1** |
> | 39 tables | ~57 schema modules |
> | `drizzle-kit migrate` on deploy | forward-only applier, `scripts/hetzner/apply-schema.sh` |
> | "Next: A3, A4, A6" | all ticked in the priority plan |
> | Release recipe: run the mirror by hand | automated in `desktop-release.yml` |
> | `src/lib/terminals/*`, `src/lib/zellij.ts`, TerminalAdapter, "Fleet Runner bundles Zellij" | **deleted 2026-09-11 (Fleet Runner 0.8.19)** — the runner owns every agent PTY (node-pty); no zellij, no `home/worker.ts`, no focus-tab, no restore-on-boot |
> | "Solo founder … under the (planned) `bitbaum AG` holding" (§7) | bitbaum is **unregistered** (`bitbaum/fleet` `registers/org.json`); not an AG, not incorporation-pending. More than one person builds here — never "solo founder" |
>
> Because this file opens with "read this first", a stale number here propagates
> further than one buried in a reference doc. Prefer `CLAUDE.md` for architecture
> and `docs/development/cloud-local-workflows.md` for what runs where.

Written 2026-06-07 after a 2-day session that took the product from v0.7.0 (broken bundled-renderer disaster) to v0.7.5 (clean Electron web-shell + adapter architecture + observability + migration ledger). Audience is the next agent or contributor.

> **Infra update (2026-06-12):** Loki left Vercel entirely. The web app and
> Postgres are now **self-hosted on the Hetzner `bitbaum` box** (Caddy + systemd),
> serving at `https://loki.orangecat.ch`; deploys run via
> `scripts/deploy-hetzner.sh` (build → rsync → restart `loki-app`). The
> references to Vercel below have been updated to this reality, but read
> `docs/infrastructure/hetzner-migration.md` for the authoritative current layout.

> **Execution update (2026-06-30):** Cloud execution keystone is **`loki-box-runner.service`**
> (headless builder on Hetzner), not the desktop Fleet Runner. The web app is a control
> plane only (`RUNTIME_AVAILABLE` unset). Terminal → Cloud watches box-runner agents via
> peek-stream; `/api/workspaces` is gated on prod. Priority stack:
> `docs/architecture/priority-plan-2026-H2.md`.

---

## 1. The product in one paragraph

Loki is a multi-user SaaS for builders who run **multiple AI agents across multiple projects in parallel**. The user signs into `loki.orangecat.ch` (GitHub OAuth), registers their projects, and dispatches prompts to agents running on the **cloud builder** (`loki-box-runner` on Hetzner) and/or optionally on their computer via the desktop Fleet Runner app. The cloud is the **coordination layer**; agents and terminals are pluggable adapters. Loki itself is the customer of sibling product **OrangeCat** (BTC payment/economic layer). Both ship under solo pseudonymous founder **Cato**, pre-revenue, one paying user (himself, dogfooding).

## 2. The lay of the land

| Surface | URL / path | Status |
|---|---|---|
| Cloud web app | `https://loki.orangecat.ch` | Production, self-hosted on Hetzner (Caddy + systemd), Postgres 17 on the same box |
| SSE bridge | `https://bridge.orangecat.ch` | Production, same Hetzner box — **CX33: 4 vCPU / 8 GB / 80 GB** (measured 2026-09-04: `nproc` 4, 7746 MiB, 75 G, 4 GB swap). Live figures: `/api/system/hetzner` |
| DB | `postgresql://loki@postgresqlbridge.orangecat.ch:5432/loki` | Postgres 17.10, 10 MB used, 39 tables, all healthy |
| Desktop app | `Fleet Runner` (Electron 33) | v0.7.5 latest, ships as .deb / .dmg / .exe / AppImage |
| Releases | `https://github.com/bitbaum/loki-releases/releases` | Mirror of build artifacts |
| Source repo | `https://github.com/bitbaum/loki` | Public |
| /releases page | `https://loki.orangecat.ch/releases` | Public changelog (SSOT: `src/config/changelog.ts`) |

## 3. Architecture in one diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/loki-core (NOT YET EXTRACTED — see §6)           │
│   types, zod contracts, pure domain functions                   │
└─────────────────────────────────────────────────────────────────┘
        ↑ depended on by ↑
┌─────────────────────────────┐  ┌──────────────────────────────┐
│ src/  (Next.js — Hetzner)   │  │ desktop/src/main/  (Electron) │
│   Pages + /api/* routes     │  │   poller / pusher / watcher  │
│   Adapters:                 │  │   IPC bridge (window.fleetRunner) │
│   • lib/agents/<id>.ts      │  │   Owns agent PTYs (node-pty) via │
│   • lib/agent-execution/*   │  │   src/lib/agent-execution/*     │
│   • lib/git-state.ts        │  └──────────────────────────────┘
│                             │            ↑ wraps ↑
│   • Drizzle schemas         │     loki.orangecat.ch inside Electron
└─────────────────────────────┘
        ↓ NOTIFY pg_notify ↓
┌─────────────────────────────────────────────────────────────────┐
│ bridge.orangecat.ch (Hetzner)                                    │
│   LISTEN 'fc:state' on Postgres                                  │
│   Fan-out: SSE → all signed-in browsers + desktop instances     │
└─────────────────────────────────────────────────────────────────┘
```

**One UI codebase** (the Next.js app). Electron wraps it with native integrations (tray, deep-link auth, IPC for Peek + auto-mint + local-dev-scan). The bundled local renderer in `desktop/src/renderer/` was deleted in v0.7.4 — DO NOT bring it back. That parallel UI was the source of the v0.7.0 disaster.

## 4. The adapter pattern (the strategic move)

Loki doesn't own a model. It owns the **coordination layer where any model plugs in** — and, since 2026-09-11, it owns every agent's PTY itself rather than borrowing a multiplexer.

### Agents

```
src/lib/agents/
├── types.ts        AgentAdapter interface
├── helpers.ts      commandExistsInPath, parseTomlStringField, dedupeStrings
├── claude.ts       \
├── codex.ts        |
├── grok.ts         |  one file per agent, all behavior in one place:
├── gemini.ts       |  detectAvailable, readConfiguredModel, buildLaunchCommand,
├── cursor.ts       |  syncSelectedModel?, capabilities, processMatchers,
├── openclaw.ts     /  defaultModel, modelSuggestions, quitCommand, installCommand
└── index.ts        ALL_ADAPTERS = [claude, grok, cursor, codex, openclaw, gemini]
                    findAdapter(id), effectiveDefaultModel, effectiveModelSuggestions
```

**Adding a new agent** (Cline, Aider, opencode, whatever): create one new file `src/lib/agents/newagent.ts` exporting `newagentAdapter: AgentAdapter`, add it to `ALL_ADAPTERS` in `index.ts`. **No edits to any other file.** The catalog, the launcher, the availability badge, the install button, the UI dropdowns all read from the adapter automatically.

### Terminals — there is no terminal adapter any more

`src/lib/terminals/*` (the `TerminalAdapter` interface and its zellij implementation) and the `src/lib/zellij.ts` compat shim were deleted on 2026-09-11 with Fleet Runner 0.8.19. There is one substrate: the runner (desktop Fleet Runner or the headless box runner) spawns each agent in a node-pty PTY it owns (`src/lib/agent-execution/`). The web local runtime (`RUNTIME_AVAILABLE=true`) acts only on those owned PTYs: `/api/control` reports them as `liveTabs` (`listOwnedTabs` in `src/lib/agent-execution/owned.ts`); orchestration run, switch-agent, clear-context (409 when no live agent) and `/api/control/agent` apply-to-open-tabs all terminate/provision owned PTYs. `shellEscape` lives in `src/lib/shell-escape.ts`; failure classification is `src/lib/failure-remedy.ts` (`START_SESSION | RETRY | NONE`). An inject for a tab with no live owned PTY fails loudly ("no running agent for … — dispatch to start one") and the cloud enqueues a dispatch (cold start) instead. Agent installers run in an owned PTY watchable in the web terminal; Peek reads the owned PTY buffer.

### Agent switching (v0.8.0)

Users switch agents without touching a terminal:

| Surface | How |
|---|---|
| Project card chip | Click the agent status chip (e.g. "Codex ready") → pick another installed agent |
| Cmd+K palette | `Switch <project> to Cursor` → deep-links `/control?focus=<project>&switchTo=<agent>` (selects the project on Control) + queues switch |
| Rate-limit banner | Appears when session text matches capacity regex; one-click fallback |
| API | `POST /api/control/switch-agent` — terminates the owned PTY for the project and provisions a new one running `toAgent` |

**Detection SSOT:** `src/lib/agent-resolution.ts` (client-safe) + `src/lib/agent-process-scan.ts` (server `/proc`). The UI warns on mismatch when `agentPref` disagrees with `activeAgents`.

**Cloud mode:** switch enqueues `pending_commands` type `switch_agent`; the runner that owns the project's PTY (box runner or Fleet Runner, per the stored routing decision) executes it.

### What's deferred

A `TransportAdapter` (Hetzner SSE bridge → Cloudflare Durable Objects → WebSocket → ...) and a `StorageAdapter` (Postgres → SQLite local-first → ...) are the next two ports if the user demand pulls us there. **Don't build them speculatively.** Today the self-hosted Hetzner stack handles a 1-user workload trivially.

## 5. The dispatch flow end-to-end

Critical for understanding everything else:

```
User clicks "Send next-best to Loki" on /control (browser or Electron)
  ↓
POST /api/inject  → pickDispatchChannel(project): locus lock → user_projects.builder_pref
                    ("Runs on") → cloud floor (DEFAULT_BUILDER_CHANNEL = "cloud").
                    Presence routes nothing; an offline chosen builder queues visibly.
                  → writes pending_commands row in Postgres
  ↓ AFTER INSERT trigger fc_notify_pending_commands fires pg_notify('fc:state', ...)
  ↓
bridge.orangecat.ch (LISTEN 'fc:state') receives event
  ↓ HTTP/2 SSE fan-out
  ↓
Runner poller (box runner or desktop Fleet Runner) receives "wake" signal → calls /api/control/commands?wait=0
  ↓
Server: claimNextPendingCommand (FOR UPDATE SKIP LOCKED) → returns the row
  ↓
Runner main process: validateCommand (zod) → writes the prompt into the owned PTY
  ↓ no live PTY for the tab → dispatch spawns the agent CLI in a fresh node-pty PTY (cold start)
  ↓
Claude/Codex/etc. starts executing inside the runner's own process tree
  ↓
On idle, agent writes ~/.loki/sessions/<tab>.md
  ↓
desktop watcher detects file change → appends worker.idle event → pushNow() → POST /api/control/runtime-state
  ↓ INSERT into runtime_snapshots fires fc_notify_runtime_snapshots
  ↓ bridge fans out via SSE
  ↓
Browser /control re-fetches → UI updates within ~200ms of the DB write
```

**Sub-second cloud↔runner round-trip** when the chosen runner is connected. This is the v0.6 work; everything else builds on it.

## 6. Status by area, as of 2026-06-07 17:00 UTC

### Production
- ✅ **All systems green**. App deployed on the Hetzner box (`loki-app` healthy). Hetzner DB 10 MB, 2/100 conns. Bridge SSE running.
- ✅ Latest desktop: **v0.7.5**. Auto-update with explicit fallback banner on .deb.

### What was just done (this session)
14 commits in chronological order — see `/releases` page for human-readable changelog. Highlights:

1. **v0.7.1 → v0.7.5 desktop releases** — reverted broken Phase C bundled-renderer flip, shipped Peek feature, added token-401 auto-recovery, removed bundled renderer entirely, shipped in-app update banner with manual-install command for .deb.
2. **Port 1 — AgentAdapter** (`src/lib/agents/*`). Was: 427-line registry with switch statements + per-agent functions scattered. Now: one file per agent, all behavior in one place.
3. **Port 2 — TerminalAdapter** (`src/lib/terminals/*`). Was: 263 lines of hardcoded `zellij action ...` shellouts. Then: behind an interface. (Deleted 2026-09-11 — see the staleness table.)
4. **God-route extraction** — `/api/control/route.ts` went from 537 to 407 lines. Extracted `lib/git-state.ts`, `lib/project-profile-match.ts`. Two more sections (lifecycle writeback, response assembly) still inline; not blocking.
5. **DB hygiene** — dropped duplicate `project_states_notify` trigger (was doubling NOTIFY traffic), fixed `/api/event-stream-token` minting a fresh token per request (10 stale tokens piled up in 36h; now reuses up to 7d old + daily cron cleanup at 05:00 UTC), bootstrapped `drizzle.__drizzle_migrations` (was missing — schema arrived via `push`, future migrations were untracked).
6. **Code-quality SSOT batches** — daemon timing constants, token-store, ANSI strip, agent-list derived from registry, zellij focus-dance HOF + `zellijCmd` helper, refresh-delay timing constants, `PHASE_DOT_CLASS` exhaustive map. Total ~50 lines per touched file became ~10.
7. **Observability** — `/api/metrics` endpoint with 6 query aggregations across existing tables (dispatch, runs, errors, tokens, daemon, projects). Zero new deps.
8. **/releases page** — public changelog at `/releases`, sourced from `src/config/changelog.ts`. Footer version pill links to it.
9. **Command palette + projects** — Cmd-K now lists user's projects (was missing).

### What's solid and you shouldn't touch
- The dispatch pipeline (DB NOTIFY → bridge → SSE → UI). It's been hardened over v0.6.
- The schema. 39 tables, FK-clean, drift-free, ledger now exists.
- The AgentAdapter interface. Lock it in; it's the SSOT for new agent plug-ins. (The TerminalAdapter interface was deleted on 2026-09-11 — there is no multiplexer to adapt.)
- The brand SSOT (`globals.css` four-layer system, `ui-*` classes). Don't introduce raw palette colors or arbitrary text sizes; the project CLAUDE.md has an audit grep that catches violations.

### What's deferred and why
| Task | Why deferred |
|---|---|
| **`useControlData` split into 3 hooks** (#56) | The hook is 325 lines doing 4 jobs. Audit said split into `useControlData` (snapshot), `useAgentConfigDraft` (form), `useControlMutations` (dispatch fns). Real refactor; many consumers; no integration test harness to prove safe. Worth a focused day. |
| **`ProjectState` schema derivation** | The control-types ProjectState is a wire format that composes the DB row + computed fields. Audit suggested deriving from `DbProjectState` via Pick + extra fields. Risk: many UI components consume the current shape; touching it has wide blast radius. Worth careful diff. |
| **Self-hosted apt repo at `apt.loki.com`** (#48) | The user has hit this. v0.7.5 banner covers the symptom; the durable answer is a proper apt repo with GPG signing. 1-2 day project (key gen + Packages.gz pipeline + static hosting on the box behind Caddy + docs). |
| **Publish to Flathub** (#47) | Backlog; only relevant when Linux user count is meaningful. |
| **First-launch wizard polish** (#61) | `/onboarding` + `EmptyStateWelcome` + `MissingCLIsBanner` already cover the major beats; a unified "agents detected ✓ terminal detected ✓ first project ✓" celebration screen would be nice but not blocking. |
| **OrangeCat off managed Supabase** (#16) | Done 2026-06-12 — OrangeCat now runs on the self-hosted Supabase stack at `supabase.orangecat.ch` on the Hetzner box. Sibling product; not a Loki task. |

### What's broken / known footguns
- **Auto-update on .deb is silently broken at the OS level.** electron-updater downloads but can't apply (sudo needed). v0.7.5's UpdateBanner is the user-facing fix. The durable fix is task #48 (apt repo).
- **Smoke test (`pnpm run smoke`) requires the local dev server.** Husky pre-push skips it when the server isn't running. Run `pnpm run dev` before pushing if you want full validation.
- **`drizzle-kit push` is the historical migration path on prod.** Migration ledger now exists; future deploys should use `drizzle-kit migrate`. Push is still safe for dev DBs but DO NOT use on prod after this point.
- **Agent CLI distribution is by official installer, not bundled.** Fleet Runner bundles no agent CLI (and, since 0.8.19, no zellij binary either). The "Install X" UI button on /control runs the agent's official one-line installer in an owned PTY you can watch in the web terminal. Detection lives in each adapter's `detectAvailable()`.

## 7. Strategic direction (what we are pursuing and why)

### The bet
Solo founder + AI assistant building two products under the (planned) `bitbaum AG` holding:
- **OrangeCat** — economic layer (BTC payments, escrow, transactions between humans). Runs on the self-hosted Supabase stack (`supabase.orangecat.ch`) on the Hetzner box since the 2026-06-12 exit off managed Supabase.
- **Loki** — agent-fleet coordination (this product). Customer of OrangeCat.

The thesis: builders who run multiple agents in parallel need a single coordination surface. Owning that surface — not the models, not the terminals — is the position.

### Why this product shape
The "captain-mode SaaS" thesis says: the user shouldn't dispatch agents one at a time; they should **govern** a fleet. Auto-inject, autopilot, scheduler, prompt queue, beacon settings — every one of those is "Loki decides when, the human approves." Hence: heavy investment in lifecycle signals (`session_status`, `session.md` handoffs), automation policy (`auto_inject_mode`), and dispatch decisioning (`lib/decide.ts`, autopilot watchdog).

### Why we shipped 5 desktop releases in 36 hours (v0.7.0 → v0.7.5)
v0.7.0 contained the **Phase C bundled-renderer-as-primary** flip — a premature architectural move that produced a broken user-visible experience (the "YOUR MACHINES. YOUR AGENTS. / 0 projects" screen). Each subsequent release reverted, fixed, or hardened: v0.7.1 reverted; v0.7.2 added Peek (the killer dignity feature); v0.7.3 auto-cleared dead tokens; v0.7.4 deleted the parallel UI for good; v0.7.5 fixed the silent-update gap that hid all of the above from the user.

**Lesson encoded in v0.7.4**: one UI codebase. The Phase-C aspiration ("Cursor-like fully local renderer") was discarded as YAGNI. Loki is in the Slack/Linear/Notion category — web UI + native integrations.

### What we are NOT pursuing
- **Forking VSCode** (Cursor's path). Wrong product category; we are not an IDE.
- **CRDT sync for offline writes**. No multi-user concurrent editing problem.
- **Native iOS/Android apps**. PWA install + push notifications cover the mobile story for now.
- **Self-hosted DB / multi-tenant deployments**. Premature at 1 user. Architecture supports it (every query is user-scoped) but no productization yet.
- **Kubernetes / microservices**. A single Hetzner box handles 10k users. Discord ran on Postgres for years.

## 8. How to ship a desktop release (the muscle memory)

```bash
# Bump version
edit desktop/package.json   # "version": "0.7.X" → "0.7.Y"

# Append a CHANGELOG entry at the top of src/config/changelog.ts

# Commit
git add -A
git commit -m "feat(desktop): v0.7.Y — <one line>"
git push

# Tag → CI → mirror
git tag -a fleet-runner-v0.7.Y -m "v0.7.Y — <one line>"
git push origin fleet-runner-v0.7.Y

# Watch CI build (3-5 min) + mirror script auto-fires after success
gh run watch --workflow=desktop-release.yml --repo bitbaum/loki

# Or use the existing Monitor pattern from earlier sessions:
until s=$(gh run list --workflow=desktop-release.yml --repo bitbaum/loki --branch fleet-runner-v0.7.Y --limit 1 --json status,conclusion --jq '.[0] | "\(.status)/\(.conclusion)"' 2>/dev/null); [ -n "$s" ] && echo "$s" | grep -qE "completed/"; do sleep 30; done; echo "$s"
# Then on success:
bash scripts/mirror-desktop-release.sh 0.7.Y
```

The mirror script is the bridge between `bitbaum/loki` (where CI builds) and `bitbaum/loki-releases` (where users download). It uses workflow artifacts as the source, NOT the draft release — the draft race-conditions when matrix jobs all try to push.

## 9. How to dogfood

1. `pnpm run dev` — local Next.js at `:3000`.
2. The user's daemon runs as `systemd --user` unit `loki-app` (NOT a fresh `next dev` process). See `pattern_local_prod_systemd` in agent memory — this is a footgun.
3. Fleet Runner desktop wraps `loki.orangecat.ch` by default. Set `LOKI_WEB_URL=http://localhost:3000` for local dogfood.
4. Hit `/api/metrics` to see what the cloud knows about the user's recent activity.
5. Hit `/releases` to see the public changelog you've been writing.

## 10. First moves for the new agent

**Follow `docs/architecture/priority-plan-2026-H2.md`** (Horizon A → B). In priority order:

1. **Horizon A — closed loop (in progress).** A1+A2 shipped 2026-06-30: Terminal Cloud uses box-runner peek; `/api/workspaces` gated on cloud. Next: A3 box-runner hardening (Claude auth, clone-on-demand), A4 builder presence clarity, A6 doc pass completion.

2. **Horizon B — orchestration SSOT (B1).** Without derived state from `orchestration_events`, Control chips keep lying. Start after A loop is dogfood-clean.

3. **First external user (Horizon D)** — only after watch path works without SSH. Everything else is theater until one other builder gets value.

4. **Task #48 — apt repo** — durable fix for silent .deb auto-update failures (see §6 footguns).

5. **Lift `/api/metrics` into `/system`** — operator dashboard visibility.

## 11. Important external context

The repo's `CLAUDE.md` files (project and user-global at `~/.claude/CLAUDE.md`) are the ground rules. Read them. Highlights:
- **Cato is a pseudonym.** Never use the founder's real name in code/commits/messages.
  The retired pseudonym "Mao Nakamoto" is equally out of bounds — see
  scripts/hetzner/test-no-retired-name.sh, which fails if either returns.
- **Exact action steps for the user.** Full URL + numbered steps + UI branches + verification. No vague directives.
- **Design tokens are SSOT.** Four-layer system in `globals.css`; no arbitrary hex / sizes in JSX.
- **First-principles, not analogy.** Don't say "X does it this way." Say "the constraint is Y, so we do Z."

Agent memory at `~/.claude/projects/-home-g-dev-loki/memory/` has additional historical context across sessions.

## 12. Where to look when something breaks

| Symptom | First place to look |
|---|---|
| "Daemon offline" but the daemon is running | `~/.config/loki/fleet-runner-token` — is it 401-rejecting against `/api/control/runtime-state`? |
| `/control` shows old data | Check the bridge SSE connection in browser DevTools network tab. Or check `runtime_snapshots` for `observed_at` freshness. |
| Dispatch goes nowhere | `pending_commands` table — was the row inserted? Did the poller claim it? Check `result` field after claim. |
| Auto-update silently fails | It does on .deb. That's why v0.7.5 ships the UpdateBanner. Task #48 is the real fix. |
| `drizzle-kit migrate` wants to re-apply old migrations | The ledger now exists. If somehow it's empty, re-run `pnpm exec tsx scripts/db/bootstrap-migration-ledger.ts --apply` with `DATABASE_URL` set. |
| /api/metrics is empty | Either the user has no activity in the last 24h, or the new metric query you added has a bug. Check `getDispatchMetrics`/`getRunMetrics` in `src/db/queries/metrics.ts`. |

---

**End of handoff.** When you're done with your session, append your own one-paragraph summary to the changelog (`src/config/changelog.ts` for desktop releases, this doc for architectural changes), and update `MEMORY.md` at `~/.claude/projects/-home-g-dev-loki/memory/` with anything surprising or non-obvious that future-you would want to know.

Build for change. Ship correct code.
