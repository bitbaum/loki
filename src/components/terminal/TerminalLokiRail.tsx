"use client";

import { useMemo, useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { singleFlight } from "@/lib/single-flight";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { ChatThread } from "@bitbaum/chatkit/react";
import { postChatFeedback } from "@/lib/loki/post-chat-feedback";
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
  ASK_SCREEN_CHARS,
  SUMMARY_MAX_CHARS,
  SUMMARY_REQUEST,
  SUMMARY_WINDOW_ROWS,
  screenAttachment,
  splitActions,
  summaryPrompt,
  terminalContextAttachment,
} from "@/lib/terminal-summary";
import { useLiveStatus } from "@/hooks/use-live-status";
import { commandIn } from "@/lib/terminal-commands";
import { typeCommand } from "@/lib/session-keystrokes";
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
  initialDraft = null,
  onStep,
  agent = null,
  onKey,
  presentation = "rail",
}: {
  /** The CLI running in the tab — which commands a step may type. */
  agent?: string | null;
  /** `rail`: the panel beside the session on a wide screen — run status,
   *  the conversation, its own Ask box. `sheet`: what "What's going on?"
   *  opens on a phone — the ANSWER, its next steps, and a way to Loki chat;
   *  no second composer, no second model picker, no run-status filler.
   *  The phone's sheet used to be the whole rail: "Nothing running on Xhiva
   *  Art. Send a task below…" over an answer, under a box of its own with
   *  Loki's model picker reading "Auto" beside the session box's "Opus 5.5"
   *  (owner, 2026-10-19: "spaghetti UI"). */
  presentation?: "rail" | "sheet";
  /** Types into the session (the keyboard's path). A step that is the agent's
   *  own command ("/model opus") goes here: Inject would wrap it in project
   *  context and the agent would read a sentence about a model. */
  onKey?: (bytes: string) => void;
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
  /** Words to start the composer with (`?q=`), in Inject, unsent. */
  initialDraft?: string | null;
  /** Where a summary's step goes to be checked and sent — the session box,
   *  when the page has one. Without it the step lands in this panel's Inject. */
  onStep?: (text: string) => void;
}) {
  const [view, setView] = useState<TerminalRunView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useSessionAsk(project);
  const liveStatus = useLiveStatus(session.live);
  const [draft, setDraft] = useState<{ text: string; nonce: number } | null>(() =>
    initialDraft ? { text: initialDraft, nonce: 1 } : null,
  );
  const [switching, setSwitching] = useState(false);

  const load = useMemo(
    () =>
      singleFlight(async () => {
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
          const res = await fetch(`/api/terminal/run?${qs.toString()}`, {
            signal: AbortSignal.timeout(15_000),
          });
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
      }),
    [project, runId],
  );

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 8_000);
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
  // Every Ask from this panel is about THIS session, so it carries the screen
  // and the agent's commands: "switch to Opus" can then be answered with the
  // step that does it ("→ /model opus", a button below) instead of an essay.
  // Read at send time, not render time — the screen is a ref.
  const askContext = () => [
    terminalContextAttachment(agent, screenText(screenLines(), ASK_SCREEN_CHARS)),
  ];
  const summarize = () => {
    if (!project) return;
    const screen = screenText(screenLines(), SUMMARY_MAX_CHARS);
    const run = view ? presentTerminalRun(view, ptyState) : null;
    void session.ask(summaryPrompt(project, agent), {
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
  const sheet = presentation === "sheet";
  // The sheet says nothing about the run unless there is something to say:
  // a tracked run's status, a stall, or a dead provider. "Checking this
  // run…" and "Nothing running…" are the rail's, where there is room.
  const filler = !sheet && ((loading && !view) || (!loading && !view && !error));
  const hasStatusBody = Boolean(filler || error || lines.summary || lines.next || diagnostic);
  const hasBody = hasStatusBody || Boolean(view?.quotaDeath && canSwitchAgent);
  const quiet = sheet && !hasBody && session.messages.length === 0 && !session.live;

  return (
    <aside className={sheet ? "ui-term-loki ui-term-loki-insheet" : "ui-term-loki"}>
      <header className="ui-term-loki-head">
        <h2 className="ui-term-loki-title">{sheet ? `Loki on ${project}` : "Loki"}</h2>
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
            {/* Icon-only on the narrowest phones in the rail, where the label
                beside the run badge and the open-chat button would push the
                header wide. The sheet has no open-chat button up here. */}
            <span className={sheet ? undefined : "max-[400px]:sr-only"}>What&apos;s going on?</span>
          </button>
          {!sheet && (
            <Link
              href={fleetSurfaceHref("chat", project)}
              className="ui-term-pane-btn"
              title="Open the full Loki chat"
              aria-label="Open the full Loki chat"
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>

      {quiet && (
        <p className="px-3 py-3 text-sm text-text-secondary">
          Loki reads the session&apos;s screen and says what the agent is doing, in plain words,
          with what you can tell it next.
        </p>
      )}

      {hasBody && (
        <div className="ui-term-loki-body">
          {loading && !view && !sheet && (
            <p className="flex items-center gap-1 text-xs text-text-muted">
              <Loader2 className="ui-spinner-xs" /> Checking this run…
            </p>
          )}
          {error && <p className="text-xs text-status-warning">{error}</p>}
          {!loading && !view && !error && !sheet && (
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
            messages={session.messages.map((m) => {
              if (m.role !== "assistant") return m;
              const { body, actions } = splitActions(m.content);
              // A summary's own "→" steps already say what to do next, one
              // tap from Inject; a second row of replies under them would be
              // a menu. Ordinary answers keep their suggested replies.
              return actions.length > 0
                ? { ...m, content: body, replies: [] }
                : { ...m, content: body };
            })}
            onReply={(text) => void session.reply(text)}
            onFeedback={
              session.conversationId
                ? (f) => postChatFeedback(session.conversationId!, f)
                : undefined
            }
            live={
              session.live
                ? { text: session.live.preview, status: liveStatus, steps: session.live.steps }
                : null
            }
            labels={liveStatus ? { thinking: liveStatus } : undefined}
            stopped={session.stopped}
            onStop={session.stop}
            renderFooter={(m) => {
              const original = session.messages.find((x) => x.id === m.id);
              const actions = original ? splitActions(original.content).actions : [];
              if (!actions.length) return null;
              return (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Next steps">
                  {actions.map((action) => {
                    // The agent's own command is TYPED into the terminal, at
                    // once: it is what the person was told to do, and there is
                    // nothing to edit in "/login".
                    const command = onKey ? commandIn(action, agent) : null;
                    return command ? (
                      <button
                        key={action}
                        type="button"
                        onClick={() => void typeCommand(onKey!, command)}
                        title="Type this into the terminal and press Enter"
                        className="ui-term-action"
                      >
                        <span>Type it</span>
                        <kbd className="ui-term-action-kbd">{command}</kbd>
                      </button>
                    ) : (
                      <button
                        key={action}
                        type="button"
                        onClick={() =>
                          onStep ? onStep(action) : setDraft({ text: action, nonce: Date.now() })
                        }
                        title="Put this in the message box to check and send"
                        className="ui-chip-toggle-compact text-left"
                      >
                        {action}
                      </button>
                    );
                  })}
                </div>
              );
            }}
          />
        </div>
      )}

      {/* The phone's sheet has no box of its own: the session box under it is
          where words go, and a conversation with Loki is Loki chat, one tap
          away, where this thread already is. */}
      {sheet && (
        <div className="ui-sheet-foot flex-row gap-2">
          <Link href={fleetSurfaceHref("chat", project)} className="ui-btn-secondary flex-1">
            Continue in Loki chat
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* THE composer, in Ask/Inject form — the same component (and the
          same attach, voice and model controls) as Loki chat and the
          session box. It used to be a bare textarea of its own. */}
      {!sheet && (
        <div className="ui-term-loki-composer">
          <TerminalComposer
            agent={agent}
            onKey={onKey}
            askContext={askContext}
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
      )}
    </aside>
  );
}
