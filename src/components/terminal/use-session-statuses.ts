"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useControlProjectStream } from "@/hooks/use-control-project-stream";
import type { FastProjectState } from "@/lib/control-fast-state";
import { isNewsworthy, sessionStatusOf, type SessionStatus } from "@/lib/terminal-session-status";

/** A session the person is not looking at just finished or started waiting on them. */
export type SessionNotice = { tab: string; status: SessionStatus };

const NOTICE_MS = 10_000;

/**
 * The status of every open session, live — so each tab can say whether it is
 * working, finished or waiting on you without being opened — and the one piece
 * of news worth interrupting for: another session finished, or needs you.
 *
 * Fed by the same stream Control uses. A tab the stream has not reported yet
 * has no status rather than a guessed one.
 */
export function useSessionStatuses(activeTab: string | null) {
  const [byTab, setByTab] = useState<Record<string, SessionStatus>>({});
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  const previous = useRef<Record<string, SessionStatus>>({});
  const active = useRef(activeTab);
  useEffect(() => {
    active.current = activeTab;
  }, [activeTab]);

  const onPatches = useCallback((patches: FastProjectState[]) => {
    const next: Record<string, SessionStatus> = {};
    let news: SessionNotice | null = null;
    for (const patch of patches) {
      const status = sessionStatusOf(patch);
      if (!status) continue;
      next[patch.tab] = status;
      if (patch.tab !== active.current && isNewsworthy(previous.current[patch.tab], status)) {
        // "Needs you" outranks "finished" when both arrive in one patch.
        if (!news || status === "needs-you") news = { tab: patch.tab, status };
      }
    }
    previous.current = { ...previous.current, ...next };
    setByTab((prev) => ({ ...prev, ...next }));
    if (news) setNotice(news);
  }, []);
  const ignore = useCallback(() => {}, []);
  useControlProjectStream({ onPatches, onPresence: ignore, onRunnerConnected: ignore });

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // The news is about somewhere else; once you are there, it has been read.
  const visible = notice && notice.tab !== activeTab ? notice : null;
  return { statuses: byTab, notice: visible, dismissNotice: () => setNotice(null) };
}
