import { baseProjectKey, isDerivedRunTab, runLaneOfTab } from '@/lib/run-tab'

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

/**
 * Where a DISPATCH that has to start an agent runs on this builder.
 *
 * A dispatch carries the directory the project has on the machine that
 * registered it (`/home/g/dev/orangecat`). The cloud builder keeps its own
 * checkout under its own dev root, found by the PROJECT's name. A parallel
 * run's tab is `<project>~<run>`, and the runner used to look the checkout up
 * by that tab: no such project, nothing to clone, and the laptop path went on
 * to the sandbox ("Sandbox cwd does not exist: /home/g/dev/orangecat",
 * 2026-11-12). The worktree step before it had already given up quietly,
 * because the laptop path is not a repository on the box.
 *
 * So the order is fixed here: the project's own checkout on THIS builder
 * first, by project name; then the run's worktree of that checkout. A lane
 * that cannot get its own worktree is refused, as for the terminal's "+": two
 * agents in one checkout is what lanes exist to prevent. A checkout that
 * cannot be found or made is refused with the reason, so a path from another
 * machine is never handed to the agent.
 */
export type DispatchDirDeps = LaneDirDeps & {
  /** Every run gets a worktree, not only lanes (LOKI_WORKTREE_DISPATCH). */
  worktreeEveryRun: boolean
}

export type DispatchDir =
  | { kind: 'ready'; dir: string; primaryDir: string; isolated: boolean }
  | { kind: 'refused'; error: string }

export async function dispatchLaunchDir(
  tab: string,
  dir: string,
  runId: string | null | undefined,
  deps: DispatchDirDeps,
): Promise<DispatchDir> {
  const project = baseProjectKey(tab)
  const lane = isDerivedRunTab(tab)
  let primaryDir: string
  try {
    primaryDir = await deps.baseDir(project, dir)
  } catch (e) {
    return {
      kind: 'refused',
      error: `no checkout of "${project}" on this builder: ${e instanceof Error ? e.message : String(e)}; nothing was launched`,
    }
  }
  const runKey = runId || runLaneOfTab(tab)?.runPrefix || ''
  if (!(lane || deps.worktreeEveryRun) || !runKey) {
    if (lane) {
      return {
        kind: 'refused',
        error: `the parallel "${project}" run has no run id to name its own copy of the project; nothing was launched, so the session already open is untouched`,
      }
    }
    return { kind: 'ready', dir: primaryDir, primaryDir, isolated: false }
  }
  const wt = deps.worktree(tab, primaryDir, runKey)
  const isolated = Boolean(wt) && wt !== primaryDir
  if (lane && !isolated) {
    return {
      kind: 'refused',
      error: `could not give the parallel "${project}" run its own copy of the project (no git worktree at ${primaryDir}); nothing was launched, so the session already open is untouched`,
    }
  }
  return { kind: 'ready', dir: isolated ? wt : primaryDir, primaryDir, isolated }
}
