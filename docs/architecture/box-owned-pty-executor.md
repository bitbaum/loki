# Box-side owned-PTY executor — delete the laptop dependency

**Status:** P0 + P1 SHIPPED (2026-06-26) · P4 SHIPPED (2026-09-11) · **Date:** 2026-06-25

> **Update 2026-09-11 — P4 is live and the other substrate is gone.** Where a dispatch
> runs is a stored decision: `pickDispatchChannel(project)` = locus lock (a laptop-only
> checkout stays local; a checkout under the box clone root stays cloud) →
> `user_projects.builder_pref` ("Runs on" in Control → project profile) → cloud floor
> (`DEFAULT_BUILDER_CHANNEL = "cloud"`). Runner presence and laptop battery route
> nothing; an offline chosen builder queues visibly (`runnerConnected: false`), never
> reroutes. Fleet Runner 0.8.19 and the box runner own every agent PTY; zellij,
> `src/lib/zellij.ts`, `src/lib/terminals/*`, `home/worker.ts` and the focus-tab command
> are deleted. This document and `docs/development/cloud-local-workflows.md` supersede
> `docs/fleet-runner-pty-ownership.md` and `docs/archive/desktop-app-migration-plan.md`.

> **Update 2026-06-26 — P1 is live.** `loki-box-runner.service` runs on the box
> (headless, `tsx scripts/box-runner.ts`, `User=ubuntu`), reusing the desktop runner
> core verbatim. **`scripts/deploy-hetzner.sh` syncs runner code + restarts the
> service on every app deploy** (after first-time `install-box-runner.sh`).
> Verified end-to-end with the laptop off: presence shows online (bridge SSE), a
> `launch_agent` dispatch was claimed and executed in a Loki-owned node-pty PTY
> (`bash -lic … cd <dir> && claude`), `close_tab` terminated it cleanly, and the PTY
> lives in the box-runner's own process tree (a `loki-app` deploy can't touch it).
> Reproduce/redeploy with `scripts/hetzner/install-box-runner.sh`.
> **Remaining follow-ups before "any project, any agent":** (a) complete `claude /login`
> for interactive scopes; (b) clone-on-demand for all git-backed projects (partially
> shipped in `box-workspace.ts`); (c) `SandboxExecutor` before multi-tenant (P3).
**One line:** Run Loki's already-built owned-PTY executor on the always-on box, so dispatches execute server-side with no laptop. Make the desktop Fleet Runner *optional*, not the keystone.

## Context (the problem this deletes)

Today the whole platform's value is gated on the **desktop Fleet Runner being up**. The box is a *stateless control plane* by design — `RUNTIME_AVAILABLE` is unset, so every dispatch **queues** for the laptop to poll and execute. That contradicts the product's own promise: "Run your fleet. From anywhere" really means "…as long as your laptop is awake." The fix is not to make the desktop's reconnect more reliable — it's to **move execution onto the captain** (the always-on box) so the laptop stops being load-bearing. This is move #2 after the hosted Hermes runner (move #1).

## The key finding: the executor is already built and host-agnostic

This is not a from-scratch build. The execution engine already exists and is **shared, identical code** between the desktop and the web server:

- **`LocalPtyExecutor`** (`src/lib/agent-execution/local-pty.ts`) — spawns each agent in a **node-pty** PTY the process owns. Zero zellij. Status is event-sourced from process lifecycle (output→running, 1500ms quiet→idle, exit→exited); a 5000-event ring buffer per workspace replays on SSE reconnect.
- **The `Executor` interface** (`src/lib/agent-execution/types.ts`): `provision / write / resize / subscribe / get / list / terminate`. The singleton (`src/lib/agent-execution/index.ts`) is pinned to `globalThis`.
- **The web server already spawns PTYs**: `POST /api/workspaces` → `executor.provision()`; input/resize via `/api/workspaces/[id]`; **live stream via SSE** at `/api/workspaces/[id]/stream` (`executor.subscribe`, Last-Event-ID resumable). `runtime = "nodejs"`.
- **Ownership is namespace-safe**: `workspaceIdFor(userId, projectKey) = "${userId}:${projectKey}"`, checked via `ownsWorkspace()`. No DB lookup to route.
- **Adapters already define launch commands**: `src/lib/agents/*` (claude, grok, cursor, codex, gemini, openclaw). `buildLaunchCommand()` → `bash -lic "… cd <dir> && claude"`. Adding a CLI = one file in `ALL_ADAPTERS`.
- **node-pty already runs on the box** (`pty.node` native binary present in the runner + app standalone).

**So the only reasons the box doesn't execute today are operational:** `RUNTIME_AVAILABLE` is unset, the agent CLIs aren't installed/authed there, and there's no always-on process owning the PTYs across web-app deploys.

Box readiness check (2026-06-25): `RUNTIME_AVAILABLE` unset · CLIs installed: **hermes only** (claude/grok/codex/cursor MISSING; no multiplexer needed) · node-pty **OK** · isolation primitives **docker + unshare** present.

## The decision: a headless Fleet Runner on the box (not RUNTIME_AVAILABLE on the web app)

There are two ways to make the box execute. The naïve one has two real problems:

**Option A — flip `RUNTIME_AVAILABLE=true` on the web app.** The Next server process itself spawns the PTYs.
- ✗ **Deploy = agent death.** `deploy-hetzner.sh` restarts `loki-app` on every ship → kills every running agent PTY.
- ✗ **No isolation.** All users' agents run inside the one server process as the `ubuntu` user. Fine for one tenant, unacceptable for many.

**Option B — a headless Fleet Runner *process* on the box (recommended).** The desktop IS a Fleet Runner; run one **on the box, headless**. It does exactly what the desktop does — polls `pending_commands`, executes via the same `LocalPtyExecutor`, sets presence online — but it's always-on and **survives web-app deploys** because it's a separate `systemd` service. It reuses the desktop's runner core (`desktop/src/main/pty-runtime.ts` + the queue poller), just without Electron.
- ✓ Always-on → presence always "online" → dispatches execute immediately, no "runner offline."
- ✓ Independent lifecycle from the web app (deploys don't kill agents).
- ✓ Mirrors the existing dual-executor split cleanly: the box-runner is a runner like the desktop, streaming via the **runner transport** (`peek-stream`) the UI already supports.
- ✓ Lives next to the existing `/opt/loki/runner` (which already has full node_modules + the hosted Hermes runner) — same deployment pattern.

**Recommend Option B.** The cost is factoring the desktop's runner core out of the Electron main process into a headless package both the desktop and the box-runner import — real but bounded work, and it pays off as the shared runner SSOT.

## Architecture (Option B)

```
Web app (Next, stateless control plane)         Box-runner (headless Fleet Runner, systemd)
  /api/inject → injectPrompt → executeInject       polls pending_commands (claimedAt IS NULL)
     │ RUNTIME_AVAILABLE=false on the web app          │
     └─ enqueue inject/dispatch ──────────────────────┘ claims + executes:
                                                         LocalPtyExecutor.provision/write  (node-pty)
                                                         setRunnerConnected(owner, true)  ← always online
  Terminal "My machine" ◀── peek-stream SSE ◀── peek frames ◀── box-runner streams PTY frames
```

The web app stays a pure control plane (keep `RUNTIME_AVAILABLE` unset there — preserves statelessness + safe deploys). The **box-runner** is the runtime host. The existing queue (`pending_commands` inject/dispatch) + presence (`runner_presence`) + peek-streaming all work unchanged — the box-runner is just a second, always-on runner instance.

## The real lift: agent CLIs + auth on the box

The engine is free; the **agent CLIs are the work**, because each needs the user's credentials (the same pattern proven this session for Hermes/Nous and `gh`):

- **`claude`** first — the operator has Claude Max; install Claude Code + auth (device/OAuth flow the user approves). Highest-value, most-used adapter.
- Then **grok** (`curl x.ai/cli/install.sh`), **codex**, **cursor-agent** — each install + auth, added incrementally.
- Each runs via its existing adapter's `buildLaunchCommand()` inside `bash -lic` so PATH + `~/.bashrc` + model config resolve exactly as on the desktop.
- **I cannot enter credentials** — the user approves each CLI's auth in-browser, as with Hermes/gh.

## Isolation (the gate before multi-tenant)

`LocalPtyExecutor` spawns PTYs as one OS user with no sandbox. **P1 is single-tenant (the owner) — acceptable.** Before opening box-execution to *other* users, the planned **`SandboxExecutor`** (same `Executor` interface, isolation via docker/unshare/microVM — both primitives already on the box) must land. Running other people's agents-with-credentials as one unsandboxed OS user is the line not to cross. Name it; don't trip over it.

## Relationship to the hosted Hermes runner (move #1)

Two complementary cloud executors, both killing the laptop dependency:
- **Hermes runner** (built) — sandboxed, autonomous, **PR-mode** for write-class offline dispatches. Good when you want a change made + reviewed unattended.
- **Box-runner / owned-PTY** (this spec) — **interactive, live**, the same experience as the desktop (watch it in Terminal, steer it). The default replacement for "laptop must be on."

## Phasing

1. **P0 — prove one CLI on the box.** Install + auth `claude`; manually `executor.provision()` a workspace via `/api/workspaces` with `RUNTIME_AVAILABLE=true` in a *throwaway* box node process; confirm it spawns, streams over SSE, and accepts input. Validates node-pty + the CLI end-to-end. (No production wiring yet.)
2. **P1 — headless box-runner (single-tenant).** Factor the desktop runner core into a headless package; run it as `loki-box-runner.service`; it polls the queue, executes via `LocalPtyExecutor`, sets presence online for the owner, streams via peek. Now Control/Terminal are live with the laptop off. **This is the milestone that deletes the dependency for you.**
3. **P2 — more CLIs.** grok, codex, cursor — install + auth, incremental.
4. **P3 — `SandboxExecutor`.** Docker-backed substrate shipped behind `LOKI_EXECUTOR=sandbox`; public multi-tenant box execution still waits for per-user credentials, metering, and entitlement gates.
5. **P4 — demote the desktop.** SHIPPED 2026-09-11: cloud is the default builder (`DEFAULT_BUILDER_CHANNEL = "cloud"`), Fleet Runner is the *optional* per-project choice ("Runs on"), and both run the same owned-PTY executor. "From anywhere" is literally true.

## Verification

- P0: `curl POST /api/workspaces` (box, RUNTIME_AVAILABLE=true) → workspace provisions; `EventSource /api/workspaces/<id>/stream` shows live `claude` output; `POST {action:"input"}` reaches the agent.
- P1: with the desktop **closed**, dispatch from Loki/Control → Control card goes "working", Terminal "My machine"/server view streams the live agent, a PR/commit lands. Presence shows online with no laptop.
- Guard: confirm a `loki-app` deploy does **not** kill a running box-runner agent (separate service).

## Files this touches
- New: `loki-box-runner.service` (systemd, on the box) + a headless runner entry reusing `src/lib/agent-execution/*` (the executor) + the desktop's queue-poll/stream core (factored out of `desktop/src/main/pty-runtime.ts`).
- Box: install/auth `claude` (then others); a runner `.env` (DATABASE_URL, GitHub token, CLI creds).
- No web-app PTY spawning on prod for P1 — `RUNTIME_AVAILABLE` stays unset on the web app; Terminal → Cloud uses peek-stream (Horizon A1, 2026-06-30). `/api/workspaces` is gated when `!isRuntimeAvailable()` (A2). Local dev with `RUNTIME_AVAILABLE=true` may still use workspaces for P0 throwaway tests.
See [[project_hermes_on_box]] (move #1), `docs/architecture/agent-execution-platform.md`, `docs/fleet-runner-pty-ownership.md`.
