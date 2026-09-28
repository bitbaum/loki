"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, RefreshCw, X } from "lucide-react";
import { Drawer } from "@/components/ui/modal";
import { TerminalView } from "../terminal/TerminalView";
import { runnerTransport } from "../terminal/terminal-transport";
import { ActivityTimeline } from "./ActivityTimeline";

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

export function PeekTabDrawer({ tab, onClose }: { tab: string; onClose: () => void }) {
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

  // Pure fetcher: resolves with the captured content, or null when a newer
  // request superseded this one. It never touches state itself — callers apply
  // the result from a .then callback, so effects can start it without setting
  // state synchronously.
  const fetchRemotePeek = async (seq: number): Promise<string | null> => {
    const enqueue = await fetch("/api/control/peek-tab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tab }),
    });
    if (!enqueue.ok) {
      const body = await enqueue.json().catch(() => ({}));
      throw new Error(body.error || `Peek request failed (${enqueue.status})`);
    }
    const { peekId } = (await enqueue.json()) as { peekId?: string };
    if (!peekId) throw new Error("Peek request did not return an id");

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (seq !== requestSeq.current) return null;
      const poll = await fetch(`/api/control/peek-tab/${peekId}`, { cache: "no-store" });
      if (!poll.ok) {
        const body = await poll.json().catch(() => ({}));
        throw new Error(body.error || `Peek poll failed (${poll.status})`);
      }
      const body = (await poll.json()) as {
        status: "pending" | "done" | "error";
        content?: string;
        error?: string;
      };
      if (body.status === "done") {
        return body.content ?? "";
      }
      if (body.status === "error") {
        throw new Error(body.error || "Peek failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Fleet Runner did not claim the peek request within 45s — is it running?");
  };

  // Starts a capture without touching state synchronously — every setState
  // lives in a promise callback, so the snapshot effect can call this directly.
  const runPeek = () => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const bridge = window.fleetRunner;
    const work =
      typeof bridge?.peekTab === "function"
        ? bridge.peekTab(tab).then((result) => {
            if (seq !== requestSeq.current) return;
            if (result.ok) {
              applyContent(result.content);
            } else {
              setError(result.error || "Peek failed");
            }
          })
        : fetchRemotePeek(seq).then((peeked) => {
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
    if (view !== "snapshot") return; // live streams via TerminalView; activity reads the DB
    void runPeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runPeek is recreated each render; tab/view are its real inputs
  }, [tab, view]);

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
