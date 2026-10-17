import type { TerminalContext } from "@/app/api/terminal/context/route";
import { baseProjectKey, isDerivedRunTab } from "@/lib/run-tab";

/** 2 for a project's first extra session, 3 for the next, in the order the
 *  runner reports them (oldest first), so a number does not jump when the
 *  operator rearranges the strip. */
export function laneNumber(tabs: readonly string[], tab: string): number {
  const base = baseProjectKey(tab);
  const lanes = tabs.filter((t) => isDerivedRunTab(t) && baseProjectKey(t) === base);
  return lanes.indexOf(tab) + 2;
}
import type { TabAliases } from "./terminal-agent";
import { arrangeTabs, readableTabName, type TabLayout } from "./terminal-tab-order";
import type { TerminalTab } from "./TerminalTabStrip";

/**
 * The strip tells the truth about each tab: the project it resolves to (by
 * name, or by pane cwd for generically named tabs) and the agent CLI actually
 * running in it — so "Tab #1 · claude" and "Tab #2 · grok" are distinguishable
 * without clicking through. An operator-chosen name wins over the derived one,
 * and the operator's arrangement (order, pins, grouping) decides the sequence.
 */
export function buildStripTabs(
  tabs: readonly string[],
  context: TerminalContext | null | undefined,
  activeTab: string | null,
  aliases: TabAliases,
  layout: TabLayout,
): TerminalTab[] {
  const projectOf = (tab: string) =>
    context?.tabs.find((t) => t.tab === tab)?.projectName ?? baseProjectKey(tab);
  const pinned = new Set(layout.pinned);
  return arrangeTabs(tabs, layout, projectOf).map((tab) => {
    const ctx = context?.tabs.find((t) => t.tab === tab);
    const badge = ctx?.liveAgents.length ? ctx.liveAgents.join("+") : undefined;
    const project = projectOf(tab);
    // A second session of a project — a parallel run, or one started with "+"
    // — is `<project>~<id8>`. It reads as its project and a number, "substrata
    // 2", the way a terminal names a second tab: a run-id fragment told nobody
    // anything. The full alias stays in the tooltip.
    const name = readableTabName(project);
    const derived = isDerivedRunTab(tab) ? `${name} ${laneNumber(tabs, tab)}` : name;
    const label = aliases[tab] ?? derived;
    return {
      id: tab,
      label,
      original: derived,
      badge,
      title: [label !== tab ? tab : null, badge].filter(Boolean).join(" — ") || undefined,
      dot: tab === activeTab ? "ui-dot-positive" : undefined,
      pinned: pinned.has(tab),
      group: layout.groupByProject ? project : undefined,
    };
  });
}
