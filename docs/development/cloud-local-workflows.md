# Cloud vs Local Workflows

---
created_date: 2026-05-21
last_modified_date: 2026-09-11
last_modified_summary: Cloud is the stored default tier; local is a per-project choice; every builder drives owned PTYs (zellij removed, Fleet Runner 0.8.19).
---

Loki is a **hybrid** product: the hosted web app (cloud control plane) owns auth, the database, and the UI. Agents run via the **builder** — the cloud service on Hetzner (box-runner) and/or the optional desktop app on your computer.

**Which builder runs a project is a stored decision, never a guess.** `pickDispatchChannel(project)` in `src/lib/execution-access.ts` reads the project only: a locus lock (a checkout that exists on one machine stays there; a checkout under the box clone root stays cloud), then the project's `builder_pref` ("Runs on" in Control → project profile), then the cloud floor (`DEFAULT_BUILDER_CHANNEL = "cloud"`). Runner presence and laptop power do not route; a chosen builder that is offline queues the work visibly (`runnerConnected: false`) instead of rerouting it. Every builder runs the agent in a PTY it owns (node-pty).

**Shared cloud execution is restricted.** The always-on box-runner is not a multi-tenant sandbox. Until hosted execution is sandboxed per account, only eligible accounts (`isDefault` or `LOKI_CLOUD_BUILDER_USER_IDS`) may use the shared cloud builder. Everyone else runs through their own Fleet Runner on this computer (`src/lib/execution-access.ts`). Docs and UI must not pretend cloud building is universal.

User-facing copy lives in `src/config/executor-copy.ts`. Internal docs may still say Fleet Runner / box-runner.

> **Historical audit:** [user-flow-audit.md](./user-flow-audit.md) records a July 2026 snapshot. Its percentages and grades are not current product status.

> **Fleet Runner desktop** = optional app on your computer. **box-runner** = the same engine headless on Hetzner. Together they are the **builder**.

## Quick start for new users

| Step | Where | Install required? |
|------|-------|-----------------|
| 1. Sign in (GitHub OAuth or email) | Browser | No |
| 2. Onboarding — username, optional first project | Browser | No |
| 3. **Go to Control** — explore, link GitHub repos, press Start building | Browser | No |
| 4. Use goals, projects metadata, prompts library, Loki, settings | Browser | No |
| 5. Connect Fleet Runner from `/download` if cloud execution is unavailable for your account | Desktop | Required for execution without eligible cloud access |

### Desktop setup (required without eligible cloud access)

Use this when you want agents to run on your machine instead of (or alongside) cloud workers:

1. **Download Fleet Runner** from [`/download`](https://loki.orangecat.ch/download) — same UI as the website, plus a background executor.
2. **Sign in** with the same Loki account (or paste an agent token from Settings).
3. **Install at least one supported agent CLI** — the desktop app can guide you.
4. **Launch at login** (Settings → Startup) so your machine stays connected.

Until a builder is online, Control **queues** dispatches. **Start building** also queues when offline. Git-backed projects can route to the **hosted worker** (Hermes PR mode) when no builder claims the job.

### Cloud builder (box-runner) — eligible accounts only

`loki-box-runner.service` is the shared Hetzner executor for **eligible** accounts (product-owner / allowlisted), not every signed-in user:

- **Enabled on boot**, `Restart=always` — intended to run 24/7 without a laptop.
- **Separate from `loki-app`** — web deploys restart the site, not agent PTYs; deploy still **syncs + restarts** box-runner code via `scripts/deploy-hetzner.sh`.
- **First install:** `bash scripts/hetzner/install-box-runner.sh`
- Control shows **Cloud builder online** when the bridge connection is live and the runner reports a `box-*` version.
- **Non-eligible accounts** get `cloud-builder-private` / `builder-required` from `resolveQueuedExecution` and must connect Fleet Runner locally.

The optional **desktop app** is the same queue on your computer. Eligible accounts may use both; each job goes to one claimant.

### Reliability

Fleet Runner embeds the `home/` orchestration library and owns execution end-to-end. The old standalone worker and terminal multiplexer are retired:

| Mechanism | What it does |
|-----------|----------------|
| **Long-poll claim** | Runner claims pending commands via `SELECT … FOR UPDATE SKIP LOCKED` so two runners never grab the same job |
| **Idempotent replay** | On restart the worker replays the JSONL log to rebuild which `runId`s already started; it refuses to double-fire |
| **Append-only event log** | `~/.loki/events.jsonl` is the single source of truth for crash recovery |
| **Connection-based presence** | Runner online/offline is the live bridge SSE connection, not a heartbeat (see `runner_presence`). Presence tells you whether queued work will run now; it never selects the builder |
| **Auto-continue pause** | `/tmp/loki-auto-continue-<project>` sentinel is applied by the runner; it controls continuation and does not route the project's builder. |

## Component roles (builder vs web app)

| Component | Runs where | Responsibility |
|-----------|------------|----------------|
| **Web app** | Hosted Hetzner box (`loki-app`) or local dev | Auth, Postgres, Control/Loki UI, command queue — **control plane only on prod** (`RUNTIME_AVAILABLE` unset) |
| **box-runner** | Hetzner box (`loki-box-runner.service`) | Eligible-account cloud builder: polls queue, owned PTY agents, session stream for Terminal → Cloud builder |
| **Fleet Runner** | Optional — operator's computer (Electron) | Runs project work on your computer; Terminal → Your computer |
| **Hosted runner (Hermes)** | Optional — per project, `builder_pref = hosted` (Control → profile → Runs on) | No PTY: the task goes straight to Hermes in its own clone on the box, on the providers the box has keys for (Copilot, Gemini, Groq); every task ends in a pull request and the tracked run closes with it, so the outcome reaches the thread that asked. Needs no Claude credential — the unattended path when the box builder has none. |
| **Hermes runner** | Hetzner sandbox | PR-mode offline dispatches when no builder claims |
| **`home/` library** | Embedded in desktop runner | Local JSONL event loop; see `home/README.md` |

**Production control flow:** Browser → API → Postgres queue → eligible cloud builder or Fleet Runner → owned PTY → agent CLI. Terminal session filtering does not change a project's `Runs on` setting; a direct start action names its builder and does not silently rewrite that setting.

Priority stack: `docs/architecture/priority-plan-2026-H2.md`.

## Workflow matrix

### Works in browser only (no local install)

| Workflow | Notes |
|----------|-------|
| Sign-in, onboarding, profile, team invites | GitHub repo picker needs GitHub OAuth |
| Goals, commitments, captures, prompts browse | Full CRUD |
| Projects (metadata, inline edit) | No live git/CI without local runtime |
| Weather (Today) | Open-Meteo on cloud |
| Ask Loki (`/loki`) — chat | Needs `GROQ_API_KEY` and/or local openclaw |
| Ask Loki — **dispatch** ("move forward", "code review for …") | Same builder queue as Control; runs when cloud or desktop builder is online (queues if offline) |
| Agent token minting | Settings creates the token; the hosted installer connects your machine |
| Schedule prompt job (Prompts → Schedule) | Stored in Postgres per user; **execution** still needs local openclaw |
| Private zone (People, Money, Habits, Events) | PIN enforced server-side when `PRIVATE_ZONE_PIN_HASH` is set |

### Execution and machine-dependent tools

| Workflow | Local dependency |
|----------|------------------|
| Agent dispatch (Control) | Authorized cloud builder or connected Fleet Runner + supported agent CLI |
| Live agent-terminal list on Control (cloud) | Each runner pushes its owned-PTY tabs as `openTabs` → `runtime_snapshots` (one row per channel) |
| Project orchestration (cloud queues; runner executes) | Authorized builder and project worker session |
| Agent selection | Project `agentPref`, adapter capabilities and builder availability; do not infer support from terminal labels |
| Bootstrap with AI, AI brief | Local `claude` CLI |
| Git sync / commit from Control | Local git |
| Calendar (Today) | Local `gog` |
| GitHub CI on Projects | Local `gh` |
| System stats (mem/disk/uptime) | Local shell |
| Voice transcription (default) | Fleet Runner + ffmpeg + Whisper; or Groq in cloud |
| Run cron job now | Local openclaw |
| Auto-continue pause from web (cloud) | Queued `auto_continue` command → runner writes `/tmp` sentinel |
| Push notifications (agent ready) | Browser subscribe + VAPID on server; `/api/push/notify` |
| **Terminal session view** | `/terminal` streams the selected builder-owned PTY and accepts live input. |

### Terminal page (`/terminal`)

Two session sources behind one view (toggle **Cloud builder** | **Your computer**). This selector filters the sessions shown; it is not the project execution setting:

| Source | Substrate | When to use |
|--------|-----------|-------------|
| **Cloud builder** | Agent PTYs on Hetzner (box-runner) | Eligible accounts only — project dispatches run here when `Runs on` is set to cloud and the builder is online |
| **Your computer** | Fleet Runner-owned agent PTYs on your computer | Live view of sessions on the connected machine |

Loki and Control do **not** connect to Terminal directly. They enqueue commands; the configured builder starts/injects into the agent CLI; Terminal is the watch surface (`source=cloud` or `source=machine`).

**Your computer** lists the owned PTYs Fleet Runner reported through runtime state and streams the selected session. **Cloud builder** lists sessions owned by the hosted runner.

### Environment-gated (optional features)

| Feature | Env vars |
|---------|----------|
| Email verification / password reset | `RESEND_API_KEY` |
| Ivy / strategist Groq fallback | `GROQ_API_KEY` |
| Paid-tier checkout (OrangeCat BTC rail) | `ORANGECAT_PAY_URL_PERSONAL`, `ORANGECAT_PAY_URL_PRO`, `ORANGECAT_PAY_URL_TEAM` |
| Cron Telegram delivery | `TELEGRAM_CHAT_ID` (optional; jobs save without it) |
| Private zone PIN | `PRIVATE_ZONE_PIN_HASH` |
| Scheduled cron janitors (run on the box) | `CRON_SECRET` |
| Web Push (agent-ready notifications) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |

## Architecture sketch

```
 Browser (loki.orangecat.ch or localhost:3000)
   │  auth, DB, UI, command queue, dispatch gates
   ▼
 PostgreSQL (pending_commands, runtime_snapshots, runner_presence, …)
   ▲
   │  long-poll claim (SKIP LOCKED) + push runtime state
 Fleet Runner desktop  (embeds home/ watcher)
   │  inject → owned PTYs → agent CLIs
   ▼
 Your projects on disk
```

## Related docs

- `CLAUDE.md` — engineering conventions
- `docs/infrastructure/postgres-portability.md` — vendor-neutral DB env vars, dump/restore, future Oracle/Hetzner migration
- [The Database Kill Switch](/thoughts/the-database-kill-switch-neon-oracle-and-the-studio-stack) — postmortem, egress, Neon vs Oracle vs Hetzner
- `home/README.md` — the local Bridge + Worker library embedded in Fleet Runner (the standalone Brain on `:3001` was retired)
- `docs/debt-reduction-roadmap.md` — orchestration consolidation plan
