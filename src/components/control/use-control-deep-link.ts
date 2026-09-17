"use client";

import { useEffect, useRef, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { postJson } from "@/lib/api/fetch";
import type { ControlData } from "@/lib/control-types";
import type { LiveTabRow, ProjectOperationsSnapshot } from "./control-presenter";

type SwitchableEntry = { id: string; label: string };

/**
 * Push notification / palette deep-link: /control?focus=<tab>&switchTo=<agent>.
 *
 * Resolves the named project against the snapshots and the live tabs, selects
 * and highlights it, opens the Workspaces panel, optionally requests an agent
 * switch, then clears the params so a refresh does not replay the navigation.
 */
export function useControlDeepLink(args: {
  data: ControlData | null;
  snapshots: ProjectOperationsSnapshot[] | null;
  liveTabRows: LiveTabRow[];
  switchableRegistry: SwitchableEntry[];
  liveDetailsRef: RefObject<HTMLDetailsElement | null>;
  livePanelRef: RefObject<HTMLElement | null>;
  setSelectedTab: (tab: string) => void;
  setProjectOpenOnPhone: (open: boolean) => void;
  setHighlightTab: (tab: string) => void;
  setLiveTargetTab: (tab: string) => void;
  setSwitchNotice: (notice: string | null) => void;
}) {
  const {
    data,
    snapshots,
    liveTabRows,
    switchableRegistry,
    liveDetailsRef,
    livePanelRef,
    setSelectedTab,
    setProjectOpenOnPhone,
    setHighlightTab,
    setLiveTargetTab,
    setSwitchNotice,
  } = args;
  const handledFocusRef = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const focusParam = searchParams.get("focus")?.trim() ?? null;
  const switchToParam = searchParams.get("switchTo")?.trim() ?? null;

  useEffect(() => {
    if (!focusParam) {
      handledFocusRef.current = null;
      return;
    }
    if (!data) return;

    const tabLower = focusParam.toLowerCase();
    const snapshot = snapshots?.find((s) => s.project.tab.toLowerCase() === tabLower);
    const snapshotTab = snapshot?.project.tab;
    const liveTab = liveTabRows.find((r) => r.tabName.toLowerCase() === tabLower)?.tabName;
    const resolvedTab = snapshotTab ?? liveTab;
    if (!resolvedTab) return;
    const requestKey = `${tabLower}\u0000${switchToParam ?? ""}`;
    if (handledFocusRef.current === requestKey) return;
    handledFocusRef.current = requestKey;

    // Deep-link handler: an App Router param change only surfaces as a
    // re-render, so this effect IS the event handler for /control?focus=…. It
    // resolves the target once, atomically, then selects + highlights + scrolls
    // + clears the params; the requestKey ref already guarantees it runs once
    // per navigation. Splitting the setStates into render-time adjustments
    // would resolve the target twice against possibly-different data
    // mid-refresh.
    if (snapshotTab) setSelectedTab(snapshotTab);
    // A deep link names a project, so on a phone it must LAND on that project
    // rather than on the list — arriving from a push notification or the
    // failure banner's "Open on Control" and being shown the roster instead
    // would make the link useless exactly when it matters.
    setProjectOpenOnPhone(true);
    setHighlightTab(resolvedTab);
    setLiveTargetTab(resolvedTab);
    if (liveDetailsRef.current) liveDetailsRef.current.open = true;
    livePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (switchToParam && snapshot?.project.dir) {
      const label = switchableRegistry.find((e) => e.id === switchToParam)?.label ?? switchToParam;
      setSwitchNotice(`Switching ${snapshot.project.tab} to ${label}…`);
      postJson("/api/control/switch-agent", {
        tab: snapshot.project.liveTab ?? snapshot.project.tab,
        dir: snapshot.project.dir,
        toAgent: switchToParam,
        fromAgent: snapshot.project.activeAgents[0] ?? snapshot.project.agentPref ?? undefined,
      })
        .then(() => {
          setSwitchNotice(`Switched ${snapshot.project.tab} to ${label}`);
          setTimeout(() => setSwitchNotice(null), 6000);
        })
        .catch(() => {
          setSwitchNotice(`Could not switch ${snapshot.project.tab} to ${label}`);
          setTimeout(() => setSwitchNotice(null), 8000);
        });
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("focus");
    params.delete("switchTo");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [
    focusParam,
    switchToParam,
    data,
    snapshots,
    liveTabRows,
    pathname,
    router,
    searchParams,
    switchableRegistry,
    liveDetailsRef,
    livePanelRef,
    setHighlightTab,
    setLiveTargetTab,
    setProjectOpenOnPhone,
    setSelectedTab,
    setSwitchNotice,
  ]);
}
