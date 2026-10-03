"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { ChatThread } from "@bitbaum/chatkit/react";
import { useSessionAsk } from "@/hooks/use-session-ask";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { presentTerminalRun, type TerminalRunView } from "@/lib/terminal-run-view";
import { screenText } from "@/lib/terminal-screen";
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_REQUEST,
  SUMMARY_WINDOW_ROWS,
  screenAttachment,
  splitActions,
  summaryPrompt,
} from "@/lib/terminal-summary";
import { TerminalComposer } from "./TerminalComposer";

type RunPayload = { ok?: boolean; view: TerminalRunView | null; error?: string };

/**
 * Right-rail commentary for Terminal: phase / stall / next action from the
 * same run Watch follows, an AI summary of what the session shows with its
 * next steps one tap from Inject, and Ask vs Inject into this session — the
 * conversation in chatkit's thread, like every chat in the fleet.
 */
export function TerminalLokiRail({
  project,
  tab,
  runId,
  ptyLive,
  projectId,
  canSwitchAgent,
  onSwitchAgent,
  readScreenRef,
}: {
  project: string | null;
  tab: string | null;
  runId: string | null;
  ptyLive: boolean;
  /** user_projects id — lets the chooser exclude the agent that just died. */
  projectId: string | null;
  canSwitchAgent: boolean;
  onSwitchAgent: (agentId: string) => void;
  /** Reads the session's rendered screen; empty when no session is mounted. */
  readScreenRef?: MutableRefObject<((rows: number) => string[]) | null>;
}) {
  const [view, setView] = useState<TerminalRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSessionAsk(project);
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(null);
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

  const screenLines = () => readScreenRef?.current?.(SUMMARY_WINDOW_ROWS) ?? [];
  const summarize = () => {
    if (!project) return;
    const screen = screenText(screenLines(), SUMMARY_MAX_CHARS);
    const run = view ? presentTerminalRun(view, ptyLive) : null;
    void session.ask(summaryPrompt(project), {
      attachments: [screenAttachment(screen || "(the terminal is empty)", run)],
      shown: SUMMARY_REQUEST,
    });
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
        <div className="flex items-center gap-2">
          {presented && <span className="ui-badge">{presented.label}</span>}
          <button
            type="button"
            onClick={summarize}
            disabled={session.sending}
            title="Summarize what this session shows, with next steps you can send"
            className="ui-term-pane-btn"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Summarize
          </button>
          <Link
            href={fleetSurfaceHref("chat", project)}
            className="inline-flex items-center gap-0.5 text-micro text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
          >
            Full chat
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
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
      </div>

      {/* The conversation, in the fleet's thread: Ask answers and summaries
          stay readable (it used to show only the latest answer). A summary's
          "→" lines become chips that put the step into Inject to check and send. */}
      {(session.messages.length > 0 || session.live) && (
        <div className="ui-term-loki-thread">
          <ChatThread
            messages={session.messages.map((m) =>
              m.role === "assistant" ? { ...m, content: splitActions(m.content).body } : m,
            )}
            live={session.live ? { text: session.live.preview } : null}
            stopped={session.stopped}
            onStop={session.stop}
            renderFooter={(m) => {
              const original = session.messages.find((x) => x.id === m.id);
              const actions = original ? splitActions(original.content).actions : [];
              if (!actions.length) return null;
              return (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Next steps">
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => setDraft({ text: action, nonce: Date.now() })}
                      title="Put this in Inject to check and send"
                      className="ui-chip-toggle-compact text-left"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              );
            }}
          />
        </div>
      )}

      {/* THE composer, in Ask/Inject form — the same component (and the
          same attach, voice and model controls) as Loki chat and the
          Prompt-mode box. It used to be a bare textarea of its own. */}
      <div className="ui-term-loki-composer">
        <TerminalComposer
          project={project}
          tab={tab}
          modes={["ask", "inject"]}
          defaultMode="inject"
          ask={session}
          draft={draft}
          ptyLive={ptyLive || Boolean(view?.lastProgressAt)}
          density="compact"
        />
      </div>
    </aside>
  );
}
