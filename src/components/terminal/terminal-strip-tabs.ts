import type { TerminalContext } from "@/app/api/terminal/context/route";
import { baseProjectKey, isDerivedRunTab } from "@/lib/run-tab";
import { isShellTab } from "@/lib/shell-session";

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
import { SESSION_STATUS_DOT } from "./session-status-dot";
import { SESSION_STATUS_WORDS, type SessionStatus } from "@/lib/terminal-session-status";

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
  statuses: Readonly<Record<string, SessionStatus>> = {},
): TerminalTab[] {
  const projectOf = (tab: string) =>
    context?.tabs.find((t) => t.tab === tab)?.projectName ?? baseProjectKey(tab);
  const pinned = new Set(layout.pinned);
  // A plain shell is not a project's session: it reads "Shell", numbered when
  // there is more than one, in the order the builder reports them.
  const shells = tabs.filter(isShellTab);
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
    const shellLabel = shells.length > 1 ? `Shell ${shells.indexOf(tab) + 1}` : "Shell";
    const label = aliases[tab] ?? (isShellTab(tab) ? shellLabel : derived);
    return {
      id: tab,
      label,
      original: derived,
      badge,
      title:
        [
          label !== tab ? tab : null,
          badge,
          statuses[tab] ? SESSION_STATUS_WORDS[statuses[tab]] : null,
        ]
          .filter(Boolean)
          .join(" — ") || undefined,
      // Every tab says what its session is doing; without a status yet, the
      // one you are in keeps the plain "this one" dot it always had.
      dot: statuses[tab]
        ? SESSION_STATUS_DOT[statuses[tab]]
        : tab === activeTab
          ? "ui-dot-positive"
          : undefined,
      status: statuses[tab] ?? null,
      pinned: pinned.has(tab),
      group: layout.groupByProject ? project : undefined,
    };
  });
}

/**
 * A tab's badge holds agent IDS ("claude", "claude+codex"); the person reads
 * NAMES. The id reached the view switch and the box ("Message claude…")
 * beside "Terminal" and "Message Claude…" elsewhere (owner, 2026-10-18).
 */
export function badgeNames(
  badge: string | null | undefined,
  roster: readonly { id: string; label: string }[] | undefined,
): string | null {
  if (!badge) return null;
  return badge
    .split("+")
    .map((id) => roster?.find((a) => a.id === id)?.label ?? id)
    .join(" + ");
}

/** The agent a session's header and box name: the live process's badge, or —
 *  before a process is seen — the agent the tab resolves to, so they say
 *  "Claude" rather than nothing and "the agent" (owner, 2026-10-19). */
export function agentName(
  badge: string | null | undefined,
  roster: readonly { id: string; label: string }[] | undefined,
  resolved: string | null,
): string | null {
  return (
    badgeNames(badge, roster) ??
    (resolved ? (roster?.find((a) => a.id === resolved)?.label ?? null) : null)
  );
}
