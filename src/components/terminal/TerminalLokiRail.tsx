"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { presentTerminalRun, type TerminalRunView } from "@/lib/terminal-run-view";
import { TerminalComposer } from "./TerminalComposer";

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
  projectId,
  canSwitchAgent,
  onSwitchAgent,
}: {
  project: string | null;
  tab: string | null;
  runId: string | null;
  ptyLive: boolean;
  /** user_projects id — lets the chooser exclude the agent that just died. */
  projectId: string | null;
  canSwitchAgent: boolean;
  onSwitchAgent: (agentId: string) => void;
}) {
  const [view, setView] = useState<TerminalRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

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

  const switchTo = (agentId: string) => {
    setSwitching(true);
    try {
      onSwitchAgent(agentId);
    } finally {
      window.setTimeout(() => setSwitching(false), 800);
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

        {/* The rail used to list every alternative agent in config order,
            whether or not the connected builder had it installed and whether or
            not it had hit its own limit ten minutes earlier. Now it is the same
            ranked, filtered chooser Feedback and Control show — one tap, the
            operator's preferred order, only providers that can answer. */}
        {view?.quotaDeath && canSwitchAgent && (
          <div className="mt-3 flex flex-col gap-1.5">
            <p className="text-xs font-medium text-text-primary">Try another provider</p>
            <ProviderSwitch
              projectId={projectId}
              busy={switching}
              hint="Quits the current CLI in this tab and launches the one you pick."
              onSwitch={switchTo}
            />
          </div>
        )}

        {comment && (
          <div className="mt-3">
            <p className="ui-micro-label">Loki</p>
            <MarkdownText text={comment} className="text-xs leading-relaxed text-text-secondary" />
          </div>
        )}
      </div>

      {/* THE composer, in Ask/Inject form — the same component (and the
          same attach, voice and model controls) as Loki chat and the
          Prompt-mode box. It used to be a bare textarea of its own. */}
      <div className="ui-term-loki-composer">
        <TerminalComposer
          project={project}
          tab={tab}
          modes={["ask", "inject"]}
          defaultMode="inject"
          onComment={setComment}
          ptyLive={ptyLive || Boolean(view?.lastProgressAt)}
          density="compact"
        />
      </div>
    </aside>
  );
}
