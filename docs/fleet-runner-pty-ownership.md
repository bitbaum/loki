# Fleet Runner v2 — Direct PTY Ownership

> **Status (2026-09-11): shipped in Fleet Runner 0.8.19 / on main.** The phases
> below are history; the zellij attach mode described here never shipped and is
> not planned. Fleet Runner owns every agent PTY (node-pty); zellij, the ZSH
> typing hooks, `home/worker.ts`, `src/lib/zellij.ts` and `src/lib/terminals/*`
> are deleted. Superseded by `docs/architecture/box-owned-pty-executor.md` and
> `docs/development/cloud-local-workflows.md`.

**Status**: Decision record (2026-06-02), shipped. Superseded the zellij-centered execution model in `docs/archive/desktop-app-migration-plan.md`.
**Date**: 2026-06-02
**Author trigger**: zellij `async-std/runtime` panic (`WouldBlock`) crashing kitty sessions on large pastes — exposing zellij as both a UX liability and a hard onboarding dependency.

## The Problem

Loki's execution path at the time of writing:

```
/control UI → /api/inject → home/worker.ts → zellij action write-chars → agent CLI in tab
```

This shape carried two structural costs:

1. **Onboarding wall.** To get value, a new user must (a) install zellij, (b) open a tab named exactly like their project key, (c) launch the right agent CLI in that tab, (d) keep it alive. Three install steps and one fragile naming convention before the dashboard does anything. This is the **#1 reason Loki can't onboard non-me users today.**
2. **Reliability tax.** Zellij 0.43.x has a known upstream panic in `blocking-1.2.0` when the PTY write returns `EWOULDBLOCK` (`.unwrap()` on `Err`). Large writes from the worker — or large pastes from the user — crash the entire zellij server. We don't control the fix.

Both costs traced to the same root: **Loki did not own the agent's PTY.** Zellij did. We were a tenant in someone else's terminal multiplexer.

## The Pivot

Fleet Runner v2 owns the PTY directly.

```
/control UI ─┐
             ├→ Fleet Runner (Electron main)
xterm.js  ←──┘   ├── PtySession manager (node-pty)
                 │   ├── spawn claude/codex/gemini/cursor
                 │   ├── stdout/stderr → SSE / WebSocket
                 │   └── stdin ← dispatched prompts
                 ├── Existing home/ event model (unchanged)
                 └── Existing decide / strategist (unchanged)
```

The agent process is a child of Fleet Runner, not of a zellij pane. The browser renders the live session through `xterm.js`, fed by an SSE stream off Fleet Runner. Zellij is not part of the product: there is one substrate, the owned PTY.

## What Stays

The pivot is **execution-layer only**. Everything upstream of injection is preserved:

- The append-only JSONL event log (`~/.loki/events.jsonl`)
- `applyEvent` / state projection (`home/state.ts`, consumed in-process by Fleet Runner)
- `decide()` and autonomy gates
- Strategist (`/api/control/dispatch` → Groq composition)
- Project registry, agent preferences, dispatch gates, blockers
- Session.md handoff format (still the agent's source of "what happened")
- The watcher (file-change → `worker.idle`) — reads the session.md the agent writes from its Fleet Runner-owned PTY
- All web UI, all API routes, all DB schemas

## What Changes

| Today | Fleet Runner v2 |
|-------|-----------------|
| `home/worker.ts` runs `zellij action write-chars` | Fleet Runner writes the prompt into the owned PTY (`home/worker.ts` is deleted) |
| Session is addressed by zellij tab name | Session is addressed by `runId` (or `projectKey` for the current session) |
| User sees agent output in their zellij pane | User sees agent output in browser via xterm.js, or in Fleet Runner's renderer window |
| Lifecycle: agent CLI started manually by user | Lifecycle: agent CLI spawned by Fleet Runner on first dispatch |
| Resize: zellij handles | Resize: PtySession listens to xterm.js `resize` events, calls `pty.resize(cols, rows)` |
| Kill: user `Ctrl+C` in their pane | Kill: UI "Stop" button → `PtySession.kill(runId)` |

## What Got Removed

- `scripts/install-loki-hooks.sh` (the ZSH typing-hooks installer). Only needed because we were sharing the pane with the user's interactive shell. Gone.
- `isUserTypingInTab()` — same reason.
- The "open a tab named exactly like your project" onboarding step.
- `injectIntoTab`, `src/lib/zellij.ts` and `src/lib/terminals/*` — deleted outright on 2026-09-11. An inject for a tab with no live owned PTY fails loudly ("no running agent for … — dispatch to start one") and the cloud enqueues a dispatch (cold start) instead.

## New Components

### `desktop/src/main/pty-session.ts` (or `packages/local-runtime/src/pty-session.ts`)

Owns the lifecycle of one agent session:

```ts
class PtySession {
  constructor(opts: { runId: string; projectPath: string; adapter: "claude" | "codex" | "gemini" | "cursor"; model?: string });
  start(): void;                      // spawns the agent CLI with node-pty
  send(input: string): void;          // writes to PTY stdin (chunked, backpressure-aware)
  onData(cb: (chunk: string) => void): Unsubscribe;
  resize(cols: number, rows: number): void;
  kill(): void;
  status(): "starting" | "running" | "exited" | "crashed";
}
```

Backpressure-aware writes (chunk + drain) prevent the same class of bug zellij has — large prompts never overwhelm the PTY buffer.

### `desktop/src/main/session-registry.ts`

Maps `projectKey` → active `PtySession`. Replays from the event log on Fleet Runner boot so crashed-and-recovered sessions reconnect. Cleans up zombies on `exit`.

### SSE stream: `GET /api/control/session/:projectKey/stream`

Fleet Runner exposes a Server-Sent Events stream of PTY output. The `/control` page subscribes when a project tile is expanded.

### `<AgentTerminal>` component (renderer)

Wraps `xterm.js`. Subscribes to the SSE stream, sends input back through a small POST endpoint (`POST /api/control/session/:projectKey/input`). Resize events propagate to the PtySession.

## Onboarding Flow (Before / After)

**Before (today)**:
1. Install zellij
2. Run `zellij` from a terminal
3. Create tabs named exactly after each project
4. Launch `claude` / `codex` / etc. in each tab
5. Open Loki in browser
6. Now dispatch works

**After (Fleet Runner v2)**:
1. Download Fleet Runner desktop app
2. Sign in with GitHub
3. Connect a project (point at a repo path)
4. Click "Launch agent" → agent CLI spawns inside Fleet Runner → live terminal appears in browser
5. Done

Zero multiplexer install. Zero terminal-of-choice constraint. Zero tab-naming convention.

## Phased Migration (history)

The plan kept the zellij path alive during the migration — no flag day.

- **Phase A** — Build `PtySession` + xterm.js panel + SSE stream as a parallel execution mode behind an env flag. Ship and dogfood with the founder + 1-2 friendly users. (Shipped as `LocalPtyExecutor`, 2026-06.)
- **Phase B** — Flip the default for desktop installs to the owned PTY. (Shipped.)
- **Phase C** — Remove the zellij code path entirely and drop the ZSH typing-hooks installer. (Shipped 2026-09-11 in Fleet Runner 0.8.19: no attach mode, no `LOKI_RUNNER_PTY` flag, no bundled zellij binary — the code was deleted, not demoted.)

Each phase was ship-on-green: the entire test suite, smoke tests, and home/ self-tests had to pass.

## Tradeoffs and Risks

| Risk | Mitigation |
|------|------------|
| `node-pty` is a native module — Electron build matrix gets heavier | Already required for any real terminal anyway; electron-builder handles prebuilt binaries. Worst case, ship per-platform installers — we're doing that already (AppImage / deb). |
| Agent CLIs may behave differently outside an "interactive" TTY (color codes, paging) | node-pty *is* a real PTY (allocates `/dev/pts/N`). Agents see a real terminal, not a pipe. Empirically Claude Code and Codex run identically in tmux/zellij/node-pty. |
| xterm.js doesn't render exactly like the user's preferred terminal (fonts, ligatures, key bindings) | True. Acceptable cost for the onboarding win. |
| Browser-side terminal feels less native than a real terminal | Mitigated by Fleet Runner's own renderer window also showing the xterm.js panel — power users get a native-app feel without a browser. |
| Streaming output over SSE adds latency vs zellij's direct PTY rendering | Negligible (<10ms localhost). Web users already accept this for VS Code Server, Replit, Codespaces. |
| Losing the "I can see and interact in my actual terminal" UX | The web terminal is fully interactive against the owned PTY (see `docs/terminal-parity.md`); the multiplexer is not coming back. |
| Web users on a different machine than Fleet Runner can't see the terminal | Already true for any local-execution model. The remote-control-plane work (`desktop-6-remote-plumbing`) routes events back through the hosted control plane — terminal streams can ride the same channel later. |

## Where This Sits in the Existing Plan

The original `desktop-0` through `desktop-6` migration plan is preserved in `docs/archive/desktop-app-migration-plan.md`; those phase statuses are historical. Current PTY ownership is:

- **Not** a deferred polish item. Every day it's not shipped, new users hit the zellij wall.
- **Parallel-shippable** with `desktop-4` / `-5` / `-6`. The packaging and installer work is unrelated to the execution mode.
- **A prerequisite** for cloud-hosted Fleet Runner instances (`desktop-7+` territory) — you can't run a zellij multiplexer in a stateless serverless function, but you can run a node-pty.

Suggested designation: **`desktop-7-pty-ownership`**, started in parallel with `desktop-4`, blocking nothing.

## Open Questions

1. **Where does PtySession live?** `desktop/src/main/` (Electron-only) or `packages/local-runtime/` (shared with `home/` headless mode)? Lean: extract to `packages/local-runtime` so headless daemon users also get PTY ownership.
2. **Multi-session per project?** Current model is one active session per project key. Should we allow parallel sessions (e.g. two Claude tasks against the same repo)? Probably no for v2 — adds queueing complexity.
3. **Persistence across Fleet Runner restarts?** Today the agent dies when zellij dies. With PTY ownership, the agent dies when Fleet Runner dies. Acceptable for v2; the persistent-runtime answer is "use a headless `loki-runner` daemon mode."
4. **Cloud terminal streaming.** Once remote-plumbing is live, do we stream PTY output back through the hosted control plane to other devices (phone, second laptop)? Defer to remote-plumbing phase.
5. **TUI handling.** Some agents may launch sub-TUIs (e.g. `claude` triggering an editor). xterm.js handles ANSI / alternate screen correctly, but we should verify with each adapter's edge cases before flipping the default.

## Success Criteria

Fleet Runner v2 ships when:

- A fresh Linux/macOS user with no zellij, no tmux, no pre-existing terminal setup can: install Fleet Runner → sign in → connect a project → see a running agent in the browser within 5 minutes of download click.
- The `home/` event model continues to work unchanged (existing tests pass).
- The WouldBlock panic class is impossible by construction — Fleet Runner backpressures writes; we own the buffer.

All three hold on main as of 2026-09-11.

---

This is the architecture move that turns Loki from "tool the founder built for themselves" into "tool a stranger can sign up for." Everything else — packaging, marketing, mobile, remote control — gets easier once execution is detached from the user's terminal-of-choice.
