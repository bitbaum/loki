# Worktree-per-agent dispatch isolation

**Status:** implemented, opt-in via `LOKI_WORKTREE_DISPATCH=true` on the runner.
**Module:** `src/lib/agent-execution/worktree-workspace.ts` · **wiring:** `desktop/src/main/poller.ts` (dispatch + close_tab) · **net:** `scripts/test/worktree-workspace.ts` (14 checks).

## The incident this kills

2026-07-17: an autopilot mid-run executed `git add -A` in a project's primary
checkout while a second agent had a feature branch checked out there. The
autopilot's commit swallowed the other agent's files *and* landed on the wrong
branch — two agents were sharing one worktree/index/HEAD. Prompt-level rules
("only stage your files") cannot survive `add -A`; only filesystem isolation can.

## How it works

```
dispatch(tab, dir, runId)                       primary checkout: <dir>
   └─ fresh launch only (never inject-into-live)
        ├─ pruneWorktrees(tab, dir)             sweep clean leftovers
        ├─ ensureWorktreeWorkspace(...)         ~/.loki/worktrees/<tab>/<runId>
        │     git worktree add -B fc/<runId> … HEAD
        │     symlink node_modules + .env* from the primary
        └─ prompt := worktreePromptNote(runId) + prompt
                     ("you are on branch fc/<runId>; land with
                       git pull --rebase origin main && git push origin HEAD:main")
```

- **Verification follows the agent.** Transcript/auth checks
  (`waitForAgentGenerating`, `detectAuthFailure`) are cwd-keyed, so the poller
  threads the *effective* dir everywhere (`worktreeByTab` map). The session
  handoff is tab-keyed (`~/.loki/sessions/<tab>.md`), so the close loop
  (`close-from-session.ts`) is unaffected by the cwd change.
- **Graceful degradation.** Any failure (not a git repo, git missing, disk
  full) logs and launches in the primary dir — the flag can only add isolation,
  never break a dispatch. Mirrors the `LOKI_BOX_PREPARE` precedent.
- **Cleanup never destroys work.** `close_tab` prunes only *clean* worktrees:
  no uncommitted changes AND no commits unreachable from every other ref
  (pushed/merged work counts as shared). Dirty worktrees outlive their session
  and are re-swept on the next dispatch. Artifact symlinks we created are
  disregarded when judging cleanliness.

## Semantics preserved

The loop's autonomous commit-to-main model is unchanged: the agent still lands
its work on `origin/main` (rebase-first push from its branch), the handoff still
carries the commit SHA, and `isProjectBusy` still serializes same-project
dispatches. What changed is only *where the agent's index lives*.

## Phase 2 — same-project parallel dispatch (implemented, opt-in)

**Flag:** `LOKI_PARALLEL_DISPATCH=true` on the SERVER (flip only after the
worktree flag has been dogfooded). **SSOT:** `src/lib/run-tab.ts`.

When a project is busy, a dispatch that asked for its own lane (`whenBusy:
"lane"`: feedback Implement, and the run route) fires immediately under a
**derived tab alias** `<project>~<runId8>` instead of queueing
(`queuedBehind`). Every other dispatch, including `POST /api/inject` and the
MCP `loki_dispatch`, is a message to the project's session and waits its turn
behind the open run (`src/lib/orchestration/busy-placement.ts`). Because the
whole loop is tab-keyed, every mechanism composes unchanged: own PTY workspace
(`runner:<alias>`), own session file (`<alias>.md`), own sentinels, own
worktree. The pieces that ARE alias-aware:

- **Dispatch route** (`run/route.ts`): mints the alias, bakes the Exit contract
  with the alias session path, stores `payload.sessionTab` on the run — the run
  row keeps the BASE `projectKey` so analytics/busy checks aggregate per project.
- **Runner guard** (`poller.ts`): a derived tab FORCES worktree isolation
  regardless of the env flag — parallel-without-isolation is impossible.
- **Ingestion** (`runtime-state`): alias tabs are never persisted as
  project_states rows (no ghost cards; no clobbering the base project's runtime
  facts). A READY alias handoff closes exactly the run whose
  `payload.sessionTab` matches (`closeOpenRunBySessionTab`), from the pushed
  session fields directly.
- **Close-sweep guard**: runs carrying a `sessionTab` are never closed from the
  base project's state row — run A's ready handoff can't close run B. The
  reaper remains the backstop for lost alias runs.

### A fresh one-off session (`session: "fresh"`)

`POST /api/inject` and the MCP `loki_dispatch` take `session: "fresh"`. The
prompt gets a lane of its own whether or not the project is busy: a new agent
in its own worktree, with no earlier conversation, told that this is a one-off.
When it reports ready on its own session file the run closes and Loki queues
`close_tab` for the lane, so the agent cannot go on to anything else. The
server flag does not apply (the caller asked by name); the lane limit does.
When no lane can be had the request is refused with
`fresh-session-unavailable` (409) and nothing is sent: a fresh session never
falls back to the project's shared tab. However the run closes (its report,
the reaper, a refused ack, a runner restart), `notifyRunClosed` queues
`close_tab` for the lane (`src/lib/orchestration/one-off-close.ts`).

Trade-off (deliberate): parallel alias runs have no live project card — they
surface in Activity/runs, not /control cards. Net: `scripts/test/run-tab.ts`.

## Deliberate limits

1. **Both flags default off** — worktree isolation first, then parallelism.
2. **Box runner:** `LOKI_BOX_PREPARE` resolves its clone first; combining
   both flags worktrees the box clone only when the box dir exists locally —
   fine, but the flags target the laptop runner first.
3. **`switch_agent` / manual `launch_agent` stay on the primary** — isolation is
   for dispatched runs, not the human's own session.
4. **Desktop runner needs a release** to pick up the poller changes; the box
   runner gets them on the next deploy from main.
