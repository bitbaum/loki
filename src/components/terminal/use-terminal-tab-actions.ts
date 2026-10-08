"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api/fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { parseTabAliases, withTabAlias, type TabAliases } from "./terminal-agent";

/**
 * What the operator can DO to the tab strip: name a session, close one, start
 * another — plus the one error line those actions (and the agent switcher) share.
 *
 * Tab names are the operator's to choose while the session id never changes, so
 * they are kept per builder: "docs" on this computer is not renamed on the cloud
 * one. A failed action used to vanish (`catch {}`), which made a dead control
 * and a working one look identical; the error is held here so it can be shown.
 */
export function useTerminalTabActions(
  channel: BuilderChannel,
  tabCount: number,
  /** The attached session, for the agent switcher. `dir` is its project
   *  directory: without one Loki cannot know where to relaunch the agent. */
  active: { tab: string | null; dir: string | null; activeAgentId: string | null },
) {
  const { tab: activeTab, dir: activeDir, activeAgentId } = active;
  const [aliases, setAliases] = useLocalStorageState<TabAliases>(
    `loki:terminal-tab-names:${channel}`,
    {},
    (v) => JSON.stringify(v),
    parseTabAliases,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);

  const rename = useCallback(
    (tab: string, name: string, original: string) =>
      setAliases((prev) => withTabAlias(prev, tab, name, original)),
    [setAliases],
  );

  const [switchingAgent, setSwitchingAgent] = useState(false);
  const switchAgent = useCallback(
    async (agentId: string) => {
      if (!activeTab || !activeDir) return;
      setSwitchingAgent(true);
      setActionError(null);
      try {
        await postJson("/api/control/switch-agent", {
          tab: activeTab,
          dir: activeDir,
          toAgent: agentId,
          ...(activeAgentId ? { fromAgent: activeAgentId } : {}),
        });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Could not switch the agent");
      } finally {
        setSwitchingAgent(false);
      }
    },
    [activeTab, activeDir, activeAgentId],
  );

  const closeTab = useCallback(
    async (tab: string) => {
      setActionError(null);
      try {
        await postJson("/api/control/close-tab", { tab, channel });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : `Could not close “${tab}”`);
      }
    },
    [channel],
  );

  // A new session appearing is the launcher's answer; get it out of the way.
  const lastTabCount = useRef(tabCount);
  useEffect(() => {
    if (tabCount > lastTabCount.current) setLaunchOpen(false);
    lastTabCount.current = tabCount;
  }, [tabCount]);

  return {
    aliases,
    rename,
    closeTab,
    actionError,
    switchingAgent,
    switchAgent,
    launchOpen,
    setLaunchOpen,
  };
}
