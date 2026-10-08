import type { TerminalContext } from "@/app/api/terminal/context/route";
import { baseProjectKey, isDerivedRunTab } from "@/lib/run-tab";
import type { TabAliases } from "./terminal-agent";
import type { TerminalTab } from "./TerminalTabStrip";

/**
 * The strip tells the truth about each tab: the project it resolves to (by
 * name, or by pane cwd for generically named tabs) and the agent CLI actually
 * running in it — so "Tab #1 · claude" and "Tab #2 · grok" are distinguishable
 * without clicking through. An operator-chosen name wins over the derived one.
 */
export function buildStripTabs(
  tabs: readonly string[],
  context: TerminalContext | null | undefined,
  activeTab: string | null,
  aliases: TabAliases,
): TerminalTab[] {
  return tabs.map((tab) => {
    const ctx = context?.tabs.find((t) => t.tab === tab);
    const badge = ctx?.liveAgents.length ? ctx.liveAgents.join("+") : undefined;
    // A parallel run's tab is `<project>~<runId8>`; read it as its project,
    // with a marker so two lanes of one project stay distinguishable. The
    // raw alias stays in the tooltip for whoever needs it.
    const project = ctx?.projectName ?? baseProjectKey(tab);
    const derived = isDerivedRunTab(tab) ? `${project} · parallel` : project;
    const label = aliases[tab] ?? derived;
    return {
      id: tab,
      label,
      original: derived,
      badge,
      title: [label !== tab ? tab : null, badge].filter(Boolean).join(" — ") || undefined,
      dot: tab === activeTab ? "ui-dot-positive" : undefined,
    };
  });
}
