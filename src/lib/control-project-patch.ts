import type { ControlData } from "@/lib/control-types";
import type { FastProjectState } from "@/lib/control-fast-state";

/**
 * Fold a burst of fast-state patches from /api/control/stream into the control
 * snapshot, without waiting for the next full /api/control refetch.
 *
 * Pure on purpose: this is the one place where the pushed view and the fetched
 * view have to agree, and it is the only part of the SSE path that can be
 * tested without a browser.
 *
 * A patch is matched by LIVE tab first, then by registry tab — a project
 * running as "Loki Claude" is still the "Loki" row. Fields the patch omits
 * (promptQueue, autoContinueEnabled…) are left alone rather than blanked: the
 * stream carries what CHANGED, and treating "absent" as "now empty" wiped
 * queues that nobody had touched.
 */
export function applyProjectPatches(prev: ControlData, patches: FastProjectState[]): ControlData {
  const projects = prev.projects.map((p) => {
    const patch = patches.find((pp) => pp.tab === p.liveTab || pp.tab === p.tab);
    if (!patch) return p;
    return {
      ...p,
      agentRunning: patch.agentRunning,
      activeAgents: patch.activeAgents,
      session: patch.session,
      currentPrompt: patch.currentPrompt,
      readyAt: patch.readyAt,
      lockAt: patch.lockAt,
      closingAt: patch.closingAt,
      closedAt: patch.closedAt,
      ...(patch.promptQueue !== undefined ? { promptQueue: patch.promptQueue } : {}),
      ...(patch.promptQueueRevision !== undefined
        ? { promptQueueRevision: patch.promptQueueRevision }
        : {}),
      ...(patch.autoContinueEnabled !== undefined
        ? { autoContinueEnabled: patch.autoContinueEnabled }
        : {}),
    };
  });

  // Sync liveTabs from tabOpen patches so active/idle categorisation stays live
  // without waiting for the next full poll.
  let liveTabs = prev.liveTabs;
  for (const patch of patches) {
    const tab = patch.tab.toLowerCase();
    if (patch.tabOpen && !liveTabs.some((t) => t.toLowerCase() === tab)) {
      liveTabs = [...liveTabs, patch.tab];
    } else if (!patch.tabOpen && liveTabs.some((t) => t.toLowerCase() === tab)) {
      liveTabs = liveTabs.filter((t) => t.toLowerCase() !== tab);
    }
  }

  return { ...prev, projects, liveTabs };
}
