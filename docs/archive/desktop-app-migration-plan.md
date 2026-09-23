> **Historical archive:** This migration plan describes proposals and implementation phases from 2026-06. It is not current architecture or an operational guide. For current behavior, see [Cloud vs Local Workflows](../development/cloud-local-workflows.md) and [Fleet Runner](../../desktop/README.md).

# Desktop App (Local Fleet Runner) — Execution Plan

> **Status (2026-09-11): shipped in Fleet Runner 0.8.19 / on main.** The
> phases below are history; the zellij-driven execution model described here
> was replaced by Fleet Runner owning every agent PTY (node-pty), and the
> zellij attach mode once proposed as an escape hatch never shipped and is not
> planned. Superseded by `docs/architecture/box-owned-pty-executor.md` and
> `docs/development/cloud-local-workflows.md`.
>
> **Status (2026-06-03): SHIPPED through v0.4.0.** This document is kept as
> historical context for the original migration plan from the daemon to the
> Electron app. Where the doc references `@cockpit/*` packages,
> `cockpit-daemon.sh`, `~/.cockpit/` paths, or the 0.1.0 artifact name —
> those are pre-rebrand naming and pre-release filenames. The shipped state
> is documented in:
> - `desktop/src/main/index.ts` — the actual Electron main process
> - `home/README.md` — the local runtime that's now embedded in the desktop app
> - `src/config/marketing-content.ts` — the user-facing download story
> - `scripts/mirror-desktop-release.sh` — the release flow

**Date**: 2026-06 (post debt reduction push)
**Status**: Starting implementation of the "NEXT" phase from the public roadmap.
**References**:
- `content/thoughts/the-local-fleet-runner-and-remote-control-plane-architecture.md` (the deep "why" and target architecture)
- `src/config/marketing-content.ts` (ROADMAP — "The local fleet runner" is explicitly NEXT)
- `docs/development/cloud-local-workflows.md` (current transitional daemon reality)
- `home/README.md` (the prototype local logic we will package)
- `CLAUDE.md` + debt-reduction-roadmap.md (engineering standards + unification priorities)

## Vision Recap (Why This Matters)

The current model (hosted web + background daemon that polls `pending_commands` or uses the `home/` event log) was the right bootstrap. It let us deliver a real multi-user SaaS + local execution quickly.

The target (converging with Cursor, Claude Code, Grok Build):

- A **first-class local desktop application** ("the fleet runner") is the authoritative owner of execution on the user's machine.
- It directly owns the agent PTYs (node-pty), agent CLIs, session watching, handoff files, git, etc. — no multiplexer between the runner and the agent.
- The web portal (and later mobile) are excellent **remote control surfaces** that talk to the local app(s) via a clean authenticated channel (outbound WebSocket + fallback queue).
- The app can run fully standalone.
- Cloud execution remains a complementary mode for scale + when the laptop is closed, with explicit handoff.

Product story: "Install the fleet runner on your machines. Control everything from the web or your phone."

This is not a UI skin. It is the fundamental ownership shift called for in the architecture essay. It also makes the seed-stage narrative credible ("local app owns execution...").

The essay's pragmatic path:
1. Build the local Electron app as the new primary runtime (start by packaging the best of `home/` + daemon logic).
2. Add the authenticated outbound connection as an optional feature.
3. Evolve cloud agents into the complementary path.
4. Keep the daemon working as a transition path for users who don't want the desktop app.

## Stack Decision (Locked)

**Primary runtime + shell**: Electron (explicitly named in every official plan and marketing copy) + **electron-vite** (modern DX: Vite for renderer, fast HMR, esbuild for main/preload).

**UI layer in renderer**: React 19 + TypeScript + Tailwind (exact match to the web app).
- Reuse design tokens (`globals.css` custom properties), `ui-*` classes, and as many components/logic as possible (control cards, intent dispatch, project state, etc.).
- This maximizes DRY, keeps the visual language consistent, and lets us share types from `src/lib/orchestration`, `src/config/`, etc.

**Why Electron (not Tauri or pure native) for v1 of this phase**:
- Plans and public roadmap say "Native Electron application" repeatedly. Changing the name now would require updating marketing, essays, etc.
- Full Node.js in main process makes porting the existing `home/` (pure Node/TS) and daemon logic trivial (PTY spawning via node-pty, file watching, event log, etc.). No immediate Rust rewrite needed.
- Chromium + web tech means we can literally run large parts of the existing web UI (or share components) inside the desktop shell. Huge leverage.
- electron-vite + builder gives us fast iteration + cross-platform distributables quickly.
- Tradeoffs accepted: Larger binary size (we'll measure and optimize; can consider Tauri migration or using a lighter runtime later if it becomes painful). We accept this to move fast on the *product* and architecture validation.

**Longer term options** (documented here for future):
- Tauri (Rust core + web frontend) if we want dramatically smaller binaries and better native integration later.
- Headless "runtime only" mode (the app can run without the window for power users who prefer their own terminal).
- The runtime logic itself should be extractable (see below) so it isn't locked to one shell.

**Monorepo placement**: `desktop/` at root (alongside `home/`, `src/`, `scripts/`). Not under `packages/` for now (to keep it self-contained like the web app). It can depend on shared packages we extract (e.g., `@cockpit/local-runtime`, `@cockpit/ui`).

**Shared code strategy**:
- Runtime core (`home/` logic + orchestration) → extract to `packages/local-runtime` (or similar) so both the desktop app and (for transition) the old daemon can consume it.
- Types, intents, decide logic, event models → already in `src/lib/orchestration` and `src/config/` — desktop will import (or we make a published/internal package).
- UI primitives + design tokens → we will make `packages/ui` or allow desktop to import from the web's `src/components/ui` + globals (via workspace or copy strategy initially).
- This follows SSOT + DRY from CLAUDE.md.

**Why this over alternatives**:
- Starting with a beautiful but empty UI shell would be theater. The hard/important part is **owning execution**.
- Rewriting the runtime from scratch in Rust on day 1 violates YAGNI and "leverage existing work". `home/` is small, has inline self-test suites (`pnpm run test:home`), and was literally built as the modern local model.
- Ignoring the web stack for the desktop UI would create two divergent design systems and double the maintenance.

## High-Level Target Architecture (Desktop App)

```
Desktop (Electron App)
├── Main process (Node)
│   ├── Local runtime core (ported home/ + daemon logic)
│   │   ├── Event log (~/.cockpit/events.jsonl)
│   │   ├── State projection (applyEvent)
│   │   ├── decide() + autonomy gates
│   │   ├── Watcher (session.md changes → worker.idle)
│   │   ├── PTY runtime (spawn agents in owned node-pty PTYs, write prompts)
│   │   └── Projects config loader
│   ├── Agent CLI control (direct, authoritative — no multiplexer)
│   ├── Optional: authenticated outbound WebSocket to hosted backend
│   └── IPC server (expose to renderer + future TUIs/MCP)
│
├── Renderer (React + Tailwind)
│   ├── Local-first UI (project list, dispatch, live status, autonomy controls)
│   ├── Reuses web components/types where possible
│   └── Tray / native menus / notifications
│
└── Preload / secure bridge (minimal)
```

The app can run completely offline/local. When remote control is enabled, it opens the WS and the hosted web can route commands to *this specific machine*.

## Transition & Compatibility Rules (Non-Negotiable)

- The existing daemon (`cockpit-daemon.sh`, `home-start.sh`, install scripts) **must continue to work** for the entire transition period.
- Users who don't want a GUI can keep using the headless daemon.
- The desktop app becomes the *recommended* / default path in installers and docs.
- We evolve the hosted installer (`/api/agent/install`) and `scripts/cockpit` CLI to offer the desktop app.
- No breaking changes to the agent token system or project config format without migration path.

## Prioritized Execution Order (and Why)

This order is chosen for maximum leverage, minimum risk, and fastest path to a shippable artifact that proves the architecture.

**Why this specific order (first-principles + product reasoning)**:
- **Correctness & ownership first**: The local app must *actually own* execution before we add remote features or polish. Building on the already-modern `home/` stack (instead of the older daemon polling) ensures we carry the better model forward. Relevant because the debt-reduction work and the fleet-runner essay both emphasize one event/state model and local truth.
- **Leverage existing tested code**: `home/` is small, has inline self-tests (`pnpm run test:home`), and was designed for exactly the local responsibilities we want. Porting it gives us decide(), autonomy, handoff rendering, etc., for "free." Rewriting would be waste.
- **Small, reviewable, valuable slices**: We get a *runnable desktop app that can actually run agents* very early. This is 10x more useful for feedback and credibility than a pretty empty window.
- **Ship the "local fleet runner" story ASAP**: The public roadmap calls this "NEXT". A downloadable app changes the user experience and the external narrative immediately ("install the fleet runner").
- **Safety / transition**: Everything is additive/parallel to the daemon. We don't force migration.
- **"Etc" sequencing**: Remote control channel, mobile, cloud handoff, etc. all become much easier (and make more sense) *after* the local app exists and owns execution. Doing remote first would mean building on the old daemon model we're trying to escape.
- **Risk reduction**: Early validation of packaging, process model (main vs renderer), IPC, file paths, permissions. These are the things that bite desktop apps. UI polish can come after the engine works.
- **Momentum fit**: We just finished a big tranche of foundation cleanup (design, private zone, orchestration slices, Beacon deprecation). The codebase is in a better state to build the *destination* on top of.
- **Investor / long-term product fit**: As the essay notes, having a clear "local app owns execution, web is remote control" answer is dramatically more credible.

Detailed order (with the todo ids we are tracking):

1. **desktop-0-decision-doc** (this file + any updates to the architecture essay)
2. **desktop-1-scaffold** — get a buildable Electron app with main + renderer running.
3. **desktop-2-port-home-runtime** — the highest-leverage step. Make the app a real local executor using the home/ logic.
4. **desktop-3-basic-ui** — minimal but usable local control surface (so people can actually use the app).
5. **desktop-4-packaging** — distributables + one-command experience.
6. **desktop-5-installer-transition** — make it the default path in our existing onboarding/install flows (daemon remains as opt-out).
7. **desktop-6-remote-plumbing** — start the authenticated connection + basic relay (this is the bridge to the "Remote control channel" phase).

Cross-cutting: Every step runs the quality bar (lint, tsc, relevant tests, design check). Small commits. Update this doc and the main plan.md. Keep the daemon 100% working.

## Open Decisions (to resolve in the first 1-2 steps)

- Exact folder: `desktop/` (top level, like `home/`) vs `packages/desktop/`.
- How aggressively to extract shared packages in step 2 (minimal for speed, or do a small `packages/local-runtime` extraction early?).
- Auto-update strategy (electron-updater?).
- Code signing / notarization path for macOS (we'll need it for a real product).
- Whether the desktop app should also be able to run the *web* UI locally (for `RUNTIME_AVAILABLE=true` users) or focus purely on the native fleet runner experience.

## Success Criteria for "MVP Local Fleet Runner"

- User can install/run the desktop app.
- It discovers projects from the existing `~/.config/agent-projects.conf` (or the new name).
- It can dispatch intents and actually drive agent sessions in PTYs it owns, using the home/ logic.
- It feels like a real app (not "just the old scripts in a window").
- Existing daemon users are unaffected.
- We have a clear path to the remote control channel.

---

This doc will be updated as we execute. The goal is to treat the architecture essay's "pragmatic path" as the actual plan, not theater.

*Started after the June 2026 debt reduction + private zone + small orchestration unification push, which strengthened the foundation we are now building the destination on.*

## Readiness update (as of this execution)

- Packaged binaries now produced: `desktop/dist/Loki Fleet Runner-0.1.0.AppImage` (104 MB, runnable on Linux) and `.deb`.
- Users can follow the instructions on `/download` (and the updated component) to clone + `npm run dist:linux` (or equivalent for their OS) and immediately run a native x.ai-styled Fleet Runner that integrates the real home/ runtime logic.
- Dispatch now renders real prompts (via orchestration renderers). At the time it injected into a running zellij tab matching the project key via `injectIntoTab`; since 0.8.19 that code is deleted and the runner writes into the PTY it spawned.
- "Sync to Web" + auto-sync on token connect: posts projects + observed runtime state to the hosted `/api/control/runtime-state` using the ck_* token. Web /control then treats this desktop as the live local runner for those projects.
- Project selection + custom free-text prompts: the UI lets you pick a project and type arbitrary instructions; they are forwarded as `queueHead` for `custom` intent and rendered end-to-end.
- The desktop app is the local runtime you can start using today for your projects (reads your existing config, owns decide + render, attempts execution, surfaces results).
- Web download section and /download page updated with concrete steps. Settings + landing promote the desktop as the preferred local runtime.
- Still early (no signed releases/auto-update yet, full watcher/worker loop + real event log projection inside the app not yet wired — see gaps below). But it is downloadable (via build), builds clean, and functional enough to run real dispatches locally from both the native UI and the web when synced.

**Known gaps (current prototype — desktop-2/3 dispatch + idle paths complete)**:
- Desktop main owns the core local loop for runs it originates:
  - Real appendEvent for bridge.dispatch + worker.started/crashed (with runId + /tmp sentinel for stop-hook correlation).
  - Embedded `home/watcher` (startWatcher): fs.watch on ~/.loki/sessions for registered projects, debounced `worker.idle` + parsed handoff on change. No external watcher process needed for full event emission when the Fleet Runner is the runtime.
- Local UI + "Sync to Web" snapshots are still lightweight (eager apply of events seen by this process). A full in-process Brain (tail the log, serve rich state) is a smaller follow-on slice.
- No tray/notifications, signed distributables with auto-update, or packaged "run as background runtime only" mode yet.

This is the Fleet Runner becoming real. See "Execution Log" for precise phase status. (The legacy daemon, `home/worker.ts` and every zellij code path were deleted on 2026-09-11.)

## Execution Log (immediate actions taken)

**desktop-0 + desktop-1 (scaffold + decision doc)**: Completed.
- Created `docs/desktop-app.md` with full rationale, stack choice (Electron + electron-vite + React/TS/Tailwind to share design system), architecture, transition rules, and this prioritized list.
- Scaffolded `desktop/`:
  - package.json, electron.vite.config, tsconfig, tailwind/postcss.
  - Main + preload + renderer (React + Tailwind).
  - Added root scripts: `npm run desktop:dev`, `desktop:build`, `desktop:preview`.
  - Basic window + IPC.
- Build succeeds (`npm run desktop:build`).

**desktop-2 first slice (home/ runtime integration)**: In progress, core milestone achieved.
- Created/expanded `desktop/src/main/runtime.ts`:
  - Imports and exercises pure `home/` core: state, decide, emit, projects loader (via temporary @home/@ aliases in electron.vite.config.ts pointing to ../home and ../src).
  - `getLocalRuntimeStatus()`, `getProjects()`, stub `dispatchIntent()` that calls into decide logic.
  - Returns real data (project count from your config, etc.).
- Wired in `src/main/index.ts`: more IPC handlers (get-runtime-status, get-projects, dispatch-intent).
- Updated preload to expose them.
- Enhanced renderer `App.tsx`: live status panel, project list (first 10), per-project dispatch buttons for next_best / test_and_fix / close_session. Results and status refresh from main process.
- Verified: `npm run desktop:build` succeeds, `npm run test:home` still 89/89 (no breakage to home/).
- This proves the desktop main process can *own* the modern local execution logic. Next in this todo: fuller watcher/worker loop, real Zellij injection, state machine in main, extraction of shared package.

Current state (advanced prototype):
- Packaged native apps (AppImage + deb) via `npm run dist:*` — ready to run after build.
- x.ai-style UI: black, massive typography, minimal, powerful.
- Full token connect: paste ck_* token, saves to ~/.config/loki/fleet-runner-token, "CONNECTED" badge. Auto-syncs projects to web on successful connect.
- Project selection: click to select (ring highlight), dispatch buttons only for selected, custom command bar (free text) targets selected or first.
- Runtime: loads projects from your config, uses real home/ decide + renderTaskForAdapter (SSOT), *canonical* `injectIntoTab` (go-to + focus guard + write + Enter + restore; same as daemon/worker; throws on fail so callers can surface crashes).
- Sync to Web: button (and auto on connect) in UI that, using the token as Bearer, POSTs the current projects + observed state to the hosted /api/control/runtime-state so the web control plane immediately sees this desktop app as the active local runtime for those projects. Web dispatches then target the desktop.
- Site: polished x.ai-style /download page + homepage section with exact clone+build+run+connect+sync instructions. Settings page copy promotes desktop as preferred.
- Quality: tsc clean for desktop, builds succeed, root lint passes on changed files (pre-existing warnings ignored as before).
- No breaking changes to daemon path.

Users can now: follow /download, build on their machine, run the native app, connect with token from web, sync once, and have the web see/control the local fleet via the desktop (plus local dispatches from the app itself).

The alias hacks remain (for prototype); next logical is the packages/local-runtime extraction + fuller watcher integration + CI for hosted binaries.

All changes keep daemon untouched, follow quality (tsc clean, builds pass), and advance the plan.

**desktop-2 + desktop-3 (home/ runtime + basic usable UI, first full slice shipped)**: Landed in 2d98638 + follow-ups.

- Full project selection in renderer, custom prompt bar that forwards `queueHead` for `custom` intent (free-text commands work end-to-end with renderTaskForAdapter).
- Canonical `injectIntoTab` wired (same as worker/daemon); graceful fallback shows the rendered prompt in the UI when zellij not reachable.
- "Sync to Web" + auto-sync: posts to `/api/control/runtime-state` (Bearer ck_* token) so the hosted control plane sees this desktop instance as the authoritative local runtime. Web dispatches then flow through the normal orchestration path and hit the desktop's local Zellij.
- Rebrand + polish pass: cockpit → loki everywhere in desktop, scripts, docs, marketing, home/, packages/agent, legal, thoughts. New `ui-public-download-*` classes + `--public-accent` token to eliminate design violations in the web download surface (zero raw hex / arbitrary text sizes / opacity hacks left in DesktopDownload.tsx).
- Desktop README and `docs/desktop-app.md` updated with capabilities + explicit known gaps (in-memory vs real emit + watcher).
- Quality: `npm run desktop:build` clean, root `npx tsc --noEmit` clean, `npm run lint` clean on changed files, `npm run test:home` 89/89, design audit clean for the public surfaces touched.
- 70+ file follow-up (rebrand + desktop + docs + marketing) prepared for commit as "feat(desktop) + fix(design,lint): ...".
- During this session: hardened `src/lib/zellij.ts` (session resolution via findSessionForTab + --session qualified actions + `--` separator for write-chars to match legacy robustness). Advanced runtime.ts dispatch to real appendEvent path (with started/crashed + sentinel). Wired embedded watcher: refactored home/watcher.ts for library use (startWatcher() export, no auto-exit on import, conditional signal handlers), started from desktop main/index.ts on app ready, closed on before-quit. Desktop now emits the full local event lifecycle (dispatch + idle from session.md handoffs) without external home/ processes. This largely closes the "real worker idle path" for desktop-2/3.

**Current prototype summary (post-landing, June 2026)**:
The app was usable for real work on a machine with zellij + claude running: build it, run it, connect token from web Settings, sync, dispatch from either surface. The "local authoritative runtime" story was demonstrable. Today (0.8.19) zellij is not required or supported: the runner spawns the agent itself.

The remaining desktop-2/3 work is the deeper port: make the Electron main process the actual host of the append-only log + watcher + worker so that desktop UI state, web /control (when this is the selected runtime), and the agent sessions are all projections of the *same* event source with no "fake" in-memory layer.

All changes at the time kept the daemon + home/ trio untouched and working. Both have since been retired (the daemon in June, `home/worker.ts` with the zellij removal on 2026-09-11).
