---
created_date: 2026-07-01
last_modified_date: 2026-09-23
last_modified_summary: Updates the execution flow and Terminal wording to the current cloud-builder and Fleet Runner model.
---

# Effective Loop Operations

Loki can run real project loops today when three conditions are true:

1. The project has an executable `user_projects` row with a `dir_path`.
2. A builder is connected for that user:
   - eligible accounts: the shared Cloud builder can claim `cloud` commands
   - other accounts or local projects: Fleet Runner on the configured computer must be connected
3. Fleet/project autopilot is on and the project is not busy, blocked, over the concurrency cap, or already pending.

If any of those are false, the product must say why instead of pretending work started.

## Current Loop Entrypoints

- **Control Start building / Build selected:** `/api/control/fleet-kick` -> `kickFleet()` -> `injectPrompt(next_best)`.
- **Loki "develop all / build fleet":** same `kickFleet()` path.
- **Loki "move forward" with one project:** `injectPrompt(next_best)`.
- **Agent finishes and reports ready:** Fleet Runner asks `/api/control/dispatch`; safety gates return `queue`, `nextbest`, or `off`.
- **Idle cron:** `/api/crons/nudge-idle` -> `injectPrompt(next_best)` after idle/cooldown/pending checks.

`injectPrompt()` is the SSOT dispatch spine. It assembles project context/RAG, opens run tracking, applies tenant execution policy, and queues the runner's self-healing `dispatch` command when a project has `dir_path`.

## What Changed

The idle cron no longer inserts `pending_commands` directly. Direct insertion skipped:

- tenant execution policy
- project context/RAG assembly parity
- prompt history
- run tracking
- runner self-healing launch behavior

It now uses the same `injectPrompt(next_best)` path as Control and Loki.

`kickFleet()` now skips projects without `dir_path` with reason `no_path`. A project profile without a path is still useful strategy context, but it is not an executable loop target.

## How To Use It Effectively Now

1. Open `/control`.
2. Make sure the header shows a connected builder.
3. Register each loop target with a real local/box path:
   - existing repo: import from local or register with `dir_path`
   - new project: create it, then ensure it has a path before expecting Control to run it
4. Add project context:
   - mission / brief / goals
   - Git URL when available
   - prompt queue for specific next actions
5. Press **Build all** or select projects and press **Build selected**.
6. Watch:
   - Control for truth state and activity
   - Terminal → Cloud builder or Your computer for live sessions; this view selector does not change the project's `Runs on` setting
   - Activity for outcomes and commits

## Public Release Boundary

This is ready for founder dogfood and controlled beta users. Eligible accounts can use the shared cloud builder; other execution uses Fleet Runner on the configured computer.

It is not ready for broad public hosted-agent release until Cloud execution is per-tenant sandboxed. The shared box-runner is intentionally private because it owns real filesystem, PTYs, CLI auth, and agent credentials.

## Next Reliability Improvements

- Make `no_path` visible as a first-class Control chip/CTA.
- Add a Loop Readiness panel: executable path, builder channel, context fullness, recent outcome, pending command.
- Build hosted per-tenant sandbox execution before enabling Cloud for arbitrary users.
