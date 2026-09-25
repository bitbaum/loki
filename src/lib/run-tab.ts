/**
 * Derived run-tabs — the identity primitive for same-project parallel dispatch.
 *
 * The whole dispatch loop is keyed by TAB: PTY workspace (`runner:<tab>`),
 * session handoff (`~/.loki/sessions/<tab>.md`), /tmp sentinels, the
 * owned PTY, and (phase 1) the per-run git worktree. So the cheapest correct way to
 * run TWO agents on one project is to mint each extra concurrent run a unique
 * tab alias — `<project>~<runId8>` — and let every tab-keyed mechanism compose
 * unchanged, instead of re-keying the loop by runId.
 *
 * `~` is the reserved separator: project names never legitimately contain it
 * (registry names come from repo/tab names), and it is filesystem- and
 * shell-safe. The runId suffix (not a counter) makes aliases collision-free
 * without coordination.
 *
 * SSOT: base/derive/detect live ONLY here — both the server (dispatch route,
 * ingestion, close-sweep) and the desktop runner import this module, so the
 * two sides can never disagree about what an alias means.
 */

/** Reserved separator between project key and run suffix. */
export const RUN_TAB_SEPARATOR = "~";

/** Mint the alias tab for an extra concurrent run of a project. */
export function deriveRunTab(projectKey: string, runId: string): string {
  const suffix = runId.replace(/-/g, "").slice(0, 8) || "run";
  return `${projectKey}${RUN_TAB_SEPARATOR}${suffix}`;
}

/** True when a tab is a derived run alias (contains the reserved separator). */
export function isDerivedRunTab(tab: string): boolean {
  return tab.includes(RUN_TAB_SEPARATOR);
}

/** For a derived tab, the project it belongs to and the run-id prefix that
 *  names its run; null for a plain tab or a suffix that is not a run id (so a
 *  malformed alias can never widen a query into a wildcard). */
export function runLaneOfTab(tab: string): { project: string; runPrefix: string } | null {
  const i = tab.indexOf(RUN_TAB_SEPARATOR);
  if (i === -1) return null;
  const runPrefix = tab.slice(i + 1).toLowerCase();
  if (!/^[0-9a-f]{4,32}$/.test(runPrefix)) return null;
  return { project: tab.slice(0, i), runPrefix };
}

/** The base project key for any tab — identity for plain tabs, prefix for
 *  derived ones. Everything that attributes work to a PROJECT (cards,
 *  analytics, busy checks) must aggregate under this. */
export function baseProjectKey(tab: string): string {
  const i = tab.indexOf(RUN_TAB_SEPARATOR);
  return i === -1 ? tab : tab.slice(0, i);
}
