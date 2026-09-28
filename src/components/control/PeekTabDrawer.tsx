"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Loader2, RefreshCw, X } from "lucide-react";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { useKickoffRunForTab } from "@/lib/kickoff-run";
import { KICKOFF_STEP_LABEL } from "@/lib/project-kickoff";
import { Drawer } from "@/components/ui/modal";
import { TerminalView } from "../terminal/TerminalView";
import { runnerTransport } from "../terminal/terminal-transport";
import { ActivityTimeline } from "./ActivityTimeline";
import { peekTabOnce } from "@/lib/peek-tab-client";

// Per-project drawer with three views of one project:
//   • activity  — the unified activity SSOT timeline (default): every prompt,
//                 run outcome, and lifecycle signal, newest first. The "what
//                 happened" half of the cockpit; readable regardless of agent.
//   • live      — stream the owned PTY via xterm (real PTY bytes)
//   • snapshot  — one-shot capture of the owned PTY buffer, the pre-v0.7.2 fallback
//
// Live/snapshot read the owned PTY Fleet Runner holds for the tab; activity
// reads the DB, so it's the view that always renders cleanly. See docs/architecture/embedded-terminal.md.

type View = "activity" | "live" | "snapshot";

/** The runner's own words when there is no PTY for the tab (agent-execution/owned). */
const NO_AGENT_RE = /^No running agent for /;

export function PeekTabDrawer({
  tab,
  onClose,
  agentRunning = true,
}: {
  tab: string;
  onClose: () => void;
  /** False when Control already knows nothing is running for this tab — the
   *  Live and Snapshot views then say so instead of streaming an empty box. */
  agentRunning?: boolean;
}) {
  const [view, setView] = useState<View>("activity");
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const requestSeq = useRef(0);

  const applyContent = (nextContent: string) => {
    setContent(nextContent);
    setLastFetchedAt(Date.now());
    requestAnimationFrame(() => {
      if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
    });
  };

  // Starts a capture without touching state synchronously — every setState
  // lives in a promise callback, so the snapshot effect can call this directly.
  const runPeek = () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const work = peekTabOnce(tab, () => seq === requestSeq.current).then((peeked) => {
      if (peeked !== null && seq === requestSeq.current) applyContent(peeked);
    });
    return work
      .catch((e: unknown) => {
        if (seq !== requestSeq.current) return;
        setError((e as Error).message || "Peek failed");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  };

  // Event-context wrapper (refresh button, auto-refresh timer): prime the
  // spinner, then capture.
  const fetchPeek = () => {
    setLoading(true);
    setError(null);
    return runPeek();
  };

  // Entering snapshot view (or the tab changing while in it) primes the
  // spinner via a guarded render-time adjustment; the effect below only kicks
  // off the async capture.
  const snapshotKey = view === "snapshot" ? tab : null;
  const [prevSnapshotKey, setPrevSnapshotKey] = useState<string | null>(null);
  if (snapshotKey !== prevSnapshotKey) {
    setPrevSnapshotKey(snapshotKey);
    if (snapshotKey !== null) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    // live streams via TerminalView; activity reads the DB; nothing to capture
    // when Control already knows no agent is running.
    if (view !== "snapshot" || !agentRunning) return;
    void runPeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runPeek is recreated each render; tab/view are its real inputs
  }, [tab, view, agentRunning]);

  useEffect(() => {
    if (!autoRefresh || view !== "snapshot") return;
    // 3s cadence — fast enough to feel live during a working agent, slow
    // enough not to hammer the runner's peek path with buffer reads.
    const id = setInterval(() => {
      void fetchPeek();
    }, 3_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchPeek is recreated each render; autoRefresh/view/tab are its real inputs
  }, [autoRefresh, view, tab]);

  const subtitle =
    view === "activity"
      ? "Activity timeline"
      : view === "live"
        ? "Live terminal"
        : lastFetchedAt
          ? `Snapshot captured ${new Date(lastFetchedAt).toLocaleTimeString()}${autoRefresh ? " · auto-refresh on" : ""}`
          : "Capturing screen…";

  const VIEWS: { id: View; label: string }[] = [
    { id: "activity", label: "Activity" },
    { id: "live", label: "Live" },
    { id: "snapshot", label: "Snapshot" },
  ];

  return (
    <Drawer onClose={onClose} size="xl">
      {/* Wraps instead of squeezing: in Snapshot mode the controls alone are
          wider than a phone, and a shrink-0 row crushed the title block to
          zero width so its subtitle painted over the Activity button. */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
          <Eye className="h-4 w-4 text-accent-text" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-primary">{tab}</h2>
            <p className="truncate text-micro text-text-tertiary">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={view === v.id ? "ui-btn-primary ui-btn-xs" : "ui-btn-ghost ui-btn-xs"}
            >
              {v.label}
            </button>
          ))}
          {view === "snapshot" && (
            <>
              <button
                type="button"
                onClick={() => setAutoRefresh((v) => !v)}
                className={autoRefresh ? "ui-btn-primary ui-btn-xs" : "ui-btn-ghost ui-btn-xs"}
                title={autoRefresh ? "Stop auto-refresh" : "Re-peek every 3s"}
              >
                {autoRefresh ? "Auto-refresh on" : "Auto-refresh"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void fetchPeek();
                }}
                disabled={loading}
                className="ui-btn-ghost ui-btn-xs"
                title="Re-capture"
              >
                <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              </button>
            </>
          )}
          <button type="button" onClick={onClose} className="ui-btn-ghost ui-btn-xs" title="Close">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="ui-control-terminal-surface">
        {view === "activity" ? (
          <div className="h-full p-3">
            <ActivityTimeline tab={tab} />
          </div>
        ) : !agentRunning || (content !== null && NO_AGENT_RE.test(content.trim())) ? (
          <NoAgentState tab={tab} />
        ) : view === "live" ? (
          <div className="p-3">
            <TerminalView transport={runnerTransport(tab, "local")} interactive fill />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-text-secondary">
            <p className="font-medium text-status-warning">Couldn&apos;t peek this tab</p>
            <p className="mt-2 text-text-tertiary">{error}</p>
            <p className="mt-4 text-xs text-text-muted">
              Common reasons: no agent is running for this project on the builder (dispatch to start
              one), or neither Fleet Runner nor the cloud builder is online.
            </p>
          </div>
        ) : content === null ? (
          <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> Capturing screen…
          </div>
        ) : (
          <pre ref={preRef} className="ui-control-terminal-frame">
            {content}
          </pre>
        )}
      </div>
    </Drawer>
  );
}

/**
 * Live and Snapshot with no agent behind them used to be an empty grey box and
 * a raw runner line ("No running agent for …") — true, but a dead end that
 * reads as "broken". Say what is known and give the one next action; if a
 * kickoff is setting this project up right now, show that instead.
 */
function NoAgentState({ tab }: { tab: string }) {
  const kickoff = useKickoffRunForTab(tab);
  const current = kickoff?.running ? kickoff.steps.find((s) => s.state === "running") : null;

  if (kickoff?.running) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-text-secondary" aria-hidden="true" />
        <p className="font-medium text-text-secondary">Setting up — the agent starts next</p>
        <p className="max-w-sm text-text-muted">
          {current ? `${KICKOFF_STEP_LABEL[current.id]}… ` : ""}Its terminal appears here as soon as
          it starts.
        </p>
      </div>
    );
  }

  const queued = kickoff?.dispatch === "queued-offline";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
      <p className="font-medium text-text-secondary">
        {queued ? "Queued — waiting for a builder" : "No agent is running for this project"}
      </p>
      <p className="max-w-sm text-text-muted">
        {queued
          ? "The work is saved and starts by itself the moment the cloud builder or your computer comes online."
          : "Nothing to watch yet. Start one from the project — its terminal shows up here while it works."}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link href={fleetSurfaceHref("profile", tab)} className="ui-btn-primary ui-btn-xs">
          {queued ? "Open the project" : "Start it from the project"}
        </Link>
        {queued && (
          <Link href="/download" className="ui-btn-ghost ui-btn-xs">
            Connect your computer
          </Link>
        )}
      </div>
    </div>
  );
}
