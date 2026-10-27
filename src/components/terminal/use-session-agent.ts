"use client";

import { useMemo } from "react";
import type { TerminalContext } from "@/app/api/terminal/context/route";
import { activeAgentFor } from "./terminal-agent";
import { useTerminalView } from "./use-terminal-view";

/**
 * What the attached session is, from the page's context: the roster of agents
 * that can be switched to, the tab's project context, and the agent RUNNING in
 * it — not the one the project prefers (see terminal-agent.ts). The switcher
 * label, the Claude | Terminal toggle and the chat view all hang off this.
 */
export function useSessionAgent(
  context: TerminalContext | null | undefined,
  activeTab: string | null,
) {
  const agents = useMemo(
    () => (context?.agents.agents ?? []).filter((a) => a.switchable),
    [context],
  );
  const tabContext = context?.tabs.find((t) => t.tab === activeTab) ?? null;
  const activeAgentId = activeAgentFor({
    liveAgents: tabContext?.liveAgents ?? [],
    rosterIds: (context?.agents.agents ?? []).map((a) => a.id),
    pref: tabContext?.agentPref,
    fallback: context?.agents.defaultAgent,
  });
  const termView = useTerminalView(activeAgentId);
  return { agents, tabContext, activeAgentId, termView };
}
