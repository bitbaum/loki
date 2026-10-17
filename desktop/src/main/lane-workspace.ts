import { runLaneOfTab } from '@/lib/run-tab'

/**
 * Where a second session of a project runs when a person starts it by hand —
 * the terminal's "+" on a project that already has a session.
 *
 * Such a session is a lane tab, `<project>~<id8>`, the same identity parallel
 * dispatch mints. Dispatch already forces a worktree for lanes; `launch_agent`
 * did not, so two hand-started agents would have shared one checkout — the
 * `git add -A` swallow of 2026-07-17 that lanes exist to prevent. This gives
 * the lane its own worktree of the project's checkout, and REFUSES when it
 * cannot: a second session in the same checkout is worse than none.
 *
 * Pure apart from its two injected steps, so the rules are tested without git.
 */
export type LaneDirDeps = {
  /** The project's own checkout on this builder (the box clones on demand). */
  baseDir: (projectKey: string, requestedDir: string) => Promise<string>
  /** A worktree of `primaryDir` for this lane; returns `primaryDir` on failure. */
  worktree: (tab: string, primaryDir: string, runKey: string) => string
}

export type LaneDir =
  | { kind: 'plain'; dir: string }
  | { kind: 'lane'; dir: string; primaryDir: string }
  | { kind: 'refused'; error: string }

export async function laneLaunchDir(tab: string, dir: string, deps: LaneDirDeps): Promise<LaneDir> {
  const lane = runLaneOfTab(tab)
  if (!lane) return { kind: 'plain', dir }
  const primaryDir = await deps.baseDir(lane.project, dir)
  const wt = deps.worktree(tab, primaryDir, lane.runPrefix)
  if (!wt || wt === primaryDir) {
    return {
      kind: 'refused',
      error: `could not give the second "${lane.project}" session its own copy of the project (no git worktree at ${primaryDir}); nothing was launched, so the first session is untouched`,
    }
  }
  return { kind: 'lane', dir: wt, primaryDir }
}
