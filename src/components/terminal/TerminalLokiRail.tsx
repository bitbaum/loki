"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { ChatThread } from "@bitbaum/chatkit/react";
import { useSessionAsk } from "@/hooks/use-session-ask";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import {
  presentTerminalRun,
  railStatusLines,
  SESSION_LOST_LABEL,
  type TerminalPtyState,
  type TerminalRunView,
} from "@/lib/terminal-run-view";
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
  ptyState,
  projectId,
  canSwitchAgent,
  onSwitchAgent,
  readScreenRef,
  askOnly = false,
  explain,
}: {
  /** "What's going on?" asked outside the rail (the phone button, a Watch
   *  deep link). Each new `pending` value is answered once, as soon as the
   *  session's screen is attached — asking before that would explain an empty
   *  box — and reported back, so a sheet that remounts the rail does not ask
   *  the same question again. */
  explain?: { pending: number; onAnswered: (request: number) => void };
  /** The page already has a box that writes into the session (the
   *  conversation view's composer): this panel then only asks Loki, so the
   *  screen never shows two composers for the same session. */
  askOnly?: boolean;
  project: string | null;
  tab: string | null;
  runId: string | null;
  ptyState: TerminalPtyState;
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
    const run = view ? presentTerminalRun(view, ptyState) : null;
    void session.ask(summaryPrompt(project), {
      attachments: [screenAttachment(screen || "(the terminal is empty)", run)],
      shown: SUMMARY_REQUEST,
    });
  };

  const explainRequest = explain?.pending ?? 0;
  const onExplained = explain?.onAnswered;
  const answered = useRef(0);
  useEffect(() => {
    if (!project || explainRequest <= answered.current) return;
    const go = () => {
      answered.current = explainRequest;
      summarize();
      onExplained?.(explainRequest);
    };
    if (ptyState !== "connecting") {
      go();
      return;
    }
    // Still attaching (or the conversation view, which never reports live):
    // give the screen a moment, then answer with what there is.
    const t = window.setTimeout(go, 4_000);
    return () => window.clearTimeout(t);
    // summarize reads refs and the latest view; re-running on its identity
    // would ask again on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainRequest, ptyState, project]);

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

  const presented = view ? presentTerminalRun(view, ptyState) : null;
  const lines = presented ? railStatusLines(presented) : { summary: null, next: null };
  const diagnostic =
    view?.stalled && view.diagnostic && view.diagnostic !== view.nextAction
      ? view.diagnostic
      : null;
  const hasStatusBody = Boolean(
    (loading && !view) || error || !view || lines.summary || lines.next || diagnostic,
  );
  const hasBody = hasStatusBody || Boolean(view?.quotaDeath && canSwitchAgent);

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
            title="What the agent is doing, in plain words — and what you can do next"
            aria-label="What's going on?"
            className="ui-term-pane-btn"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {/* Icon-only on the narrowest phones, where the label beside the
                run badge and the open-chat button would push the header wide. */}
            <span className="max-[400px]:sr-only">What&apos;s going on?</span>
          </button>
          <Link
            href={fleetSurfaceHref("chat", project)}
            className="ui-term-pane-btn"
            title="Open the full Loki chat"
            aria-label="Open the full Loki chat"
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {hasBody && (
        <div className="ui-term-loki-body">
          {loading && !view && (
            <p className="flex items-center gap-1 text-xs text-text-muted">
              <Loader2 className="ui-spinner-xs" /> Checking this run…
            </p>
          )}
          {error && <p className="text-xs text-status-warning">{error}</p>}
          {!loading && !view && !error && (
            <p className="text-xs text-text-muted">
              Nothing running on {project}. Send a task below and its progress shows here.
            </p>
          )}
          {view && (lines.summary || lines.next || diagnostic) && (
            <div className="flex flex-col gap-1">
              {lines.summary && (
                <p className="text-sm font-medium text-text-primary">{lines.summary}</p>
              )}
              {lines.next && <p className="text-xs text-text-secondary">{lines.next}</p>}
              {presented?.label === SESSION_LOST_LABEL && (
                <Link
                  href={fleetSurfaceHref("profile", project)}
                  className="ui-btn-secondary mt-1 self-start"
                >
                  Open the project
                </Link>
              )}
              {diagnostic && <p className="text-micro text-text-tertiary">{diagnostic}</p>}
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
      )}

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
          modes={askOnly ? ["ask"] : ["ask", "inject"]}
          defaultMode={askOnly ? "ask" : "inject"}
          ask={session}
          draft={draft}
          ptyLive={ptyState === "live" || Boolean(view?.lastProgressAt)}
          density="compact"
        />
      </div>
    </aside>
  );
}
