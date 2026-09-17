"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { dispatchToneDotClass } from "@/lib/dispatch-status";
import { presentTerminalRun, type TerminalRunView } from "@/lib/terminal-run-view";
import { TerminalLokiComposer } from "./TerminalLokiComposer";

type RunPayload = { ok?: boolean; view: TerminalRunView | null; error?: string };

/**
 * Right-rail commentary for Terminal: phase / stall / next action from the
 * same run Watch follows, plus Ask vs Inject into this session.
 */
export function TerminalLokiRail({
  project,
  tab,
  runId,
  ptyLive,
  currentAgent,
  canSwitchAgent,
  onSwitchAgent,
}: {
  project: string | null;
  tab: string | null;
  runId: string | null;
  ptyLive: boolean;
  currentAgent: string | null;
  canSwitchAgent: boolean;
  onSwitchAgent: (agentId: string) => void;
}) {
  const [view, setView] = useState<TerminalRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [injectAck, setInjectAck] = useState<{
    commandId: string | null;
    runId: string | null;
  } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const liveDispatch = useDispatchLiveStatus(
    injectAck?.commandId ?? null,
    injectAck?.runId ?? null,
  );

  const load = useCallback(async () => {
    if (!project && !runId) {
      setView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (project) qs.set("project", project);
      if (runId) qs.set("run", runId);
      const res = await fetch(`/api/terminal/run?${qs.toString()}`);
      const body = (await res.json().catch(() => ({}))) as RunPayload;
      if (!res.ok) {
        setError(body.error ?? "Could not load run");
        setView(null);
        return;
      }
      setView(body.view ?? null);
    } catch {
      setError("Could not load run");
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [project, runId]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 8_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [load]);

  const switchTo = async (agentId: string) => {
    setSwitching(agentId);
    try {
      onSwitchAgent(agentId);
    } finally {
      window.setTimeout(() => setSwitching(null), 800);
    }
  };

  if (!project) {
    return (
      <aside className="ui-term-loki">
        <header className="ui-term-loki-head">
          <h2 className="ui-term-loki-title">Loki</h2>
        </header>
        <p className="px-3 py-2 text-xs text-text-muted">
          Open a project session to see phase, inject, and Ask.
        </p>
      </aside>
    );
  }

  const alternatives = view?.quotaDeath
    ? view.alternatives.filter((a) => a.id !== currentAgent)
    : [];
  const ptyAck =
    injectAck &&
    (ptyLive || view?.lastProgressAt ? "PTY is printing." : "Injected — waiting for PTY bytes.");
  const presented = view ? presentTerminalRun(view, ptyLive) : null;

  return (
    <aside className="ui-term-loki">
      <header className="ui-term-loki-head">
        <h2 className="ui-term-loki-title">Loki</h2>
        {presented && <span className="ui-badge">{presented.label}</span>}
      </header>

      <div className="ui-term-loki-body">
        {loading && !view && (
          <p className="flex items-center gap-1 text-xs text-text-muted">
            <Loader2 className="ui-spinner-xs" /> Checking this run…
          </p>
        )}
        {error && <p className="text-xs text-status-warning">{error}</p>}
        {!loading && !view && !error && (
          <p className="text-xs text-text-muted">
            No run on {project} yet. Implement a report or inject a task — this rail follows the
            same run id as Feedback Watch.
          </p>
        )}
        {view && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-text-primary">{presented?.stepSummary}</p>
            <p className="text-xs text-text-secondary">{presented?.nextAction}</p>
            {view.stalled && view.diagnostic && view.diagnostic !== view.nextAction && (
              <p className="text-micro text-text-tertiary">{view.diagnostic}</p>
            )}
          </div>
        )}

        {alternatives.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-xs font-medium text-text-primary">Try another provider</p>
            <div className="flex flex-wrap gap-1.5">
              {alternatives.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="ui-btn-secondary"
                  disabled={!canSwitchAgent || switching === a.id}
                  onClick={() => void switchTo(a.id)}
                >
                  {switching === a.id ? <Loader2 className="ui-spinner-xs" /> : null}
                  Try {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {comment && (
          <div className="mt-3">
            <p className="ui-micro-label">Loki</p>
            <MarkdownText text={comment} className="text-xs leading-relaxed text-text-secondary" />
          </div>
        )}

        {injectAck && (
          <div className="mt-2 flex items-start gap-2 text-micro">
            <span className={dispatchToneDotClass(liveDispatch?.tone ?? "neutral")} />
            <span className="min-w-0 text-text-secondary">
              {liveDispatch?.label ?? "Injected"}
              {liveDispatch?.detail ? ` — ${liveDispatch.detail}` : ""}
              {ptyAck ? ` ${ptyAck}` : ""}
            </span>
          </div>
        )}
      </div>

      <TerminalLokiComposer
        project={project}
        tab={tab}
        onInjected={setInjectAck}
        onComment={setComment}
      />
    </aside>
  );
}
