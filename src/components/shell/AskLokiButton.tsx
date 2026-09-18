"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Loader2,
  MessageSquare,
  Play,
  Sparkles,
  Stethoscope,
  Wrench,
  X,
} from "lucide-react";
import { readPageContext } from "@fleet/ai-forms/react";
import {
  readAssistantContext,
  subscribeAssistantContext,
  type AssistantProjectContext,
} from "@/lib/assistant-context";
import { readActiveForm, subscribeActiveForm } from "@/lib/active-form";
import { LOKI_PROACTIVE_STARTERS } from "@/config/loki-suggested-actions";
import {
  useProjectDispatch,
  DispatchedNote,
  type ProjectDispatchKind,
} from "@/components/projects/ProjectActionButtons";
import { postJson } from "@/lib/api/fetch";
import { LOKI_OPEN_EVENT } from "@/lib/client-events";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { ProvenanceFooter } from "@/components/loki/ProvenanceFooter";
import { pickProvenance } from "@/lib/loki/provenance";

/** Prior turns sent with an ask, and how much of each. Matches the loop's own trim. */
const HISTORY_TURNS = 8;
const HISTORY_CHARS = 600;

type Turn = {
  role: "user" | "loki";
  text: string;
  /** Provenance for a Loki turn — which model, what it read, whether it verified. */
  meta?: Record<string, unknown>;
};

/** Ceiling for the drawer composer's auto-grow. Smaller than the full-page
 *  composer's 240px: this one floats over the page it is asking about. */
const MAX_ASK_INPUT_PX = 160;

function subscribeContext(onChange: () => void) {
  return subscribeAssistantContext(onChange);
}

/** One page-derived proposal: a concrete dispatch, one click, inline result. */
function ProposalChip({
  context,
  kind,
  signalKey,
  icon: Icon,
  label,
}: {
  context: AssistantProjectContext;
  kind: ProjectDispatchKind;
  signalKey?: string;
  icon: typeof Wrench;
  label: string;
}) {
  const { state, dispatch } = useProjectDispatch(context.projectId);

  if (state.phase === "done") {
    return (
      <span className="inline-flex min-h-8 items-center px-1">
        <DispatchedNote workspaceKey={context.workspaceKey} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => dispatch(kind, signalKey)}
        disabled={state.phase === "sending"}
        className="ui-btn-secondary min-h-8 gap-1.5 px-2.5 text-xs"
        title={label}
      >
        {state.phase === "sending" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="max-w-56 truncate">
          {state.phase === "sending" ? "Dispatching…" : label}
        </span>
      </button>
      {state.phase === "error" && <span className="ui-error text-xs">{state.message}</span>}
    </span>
  );
}

/**
 * The floating assistant. Not a link — a context-aware panel: on a project
 * page it knows the project and proposes the concrete actions its profile
 * calls out (fix an open issue, run the queued next step, diagnose a timeout
 * streak), plus a project-scoped Loki thread inline. Elsewhere it offers the
 * fleet-wide starters. `?` toggles it; `loki:open` opens it prefilled.
 */
export function AskLokiButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const sentContextRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The transcript, for the history the next ask sends. A ref, not a dep: the
  // ask callback must not be rebuilt on every turn, and reading the latest
  // value at call time is exactly what is wanted here.
  const turnsRef = useRef<Turn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const context = useSyncExternalStore(subscribeContext, readAssistantContext, () => null);
  // When a form is open, the assistant edits it instead of answering about it.
  const activeForm = useSyncExternalStore(subscribeActiveForm, readActiveForm, () => null);

  // A dialog you can open with a key and not close with one. `?` toggles this
  // panel open, and Escape did nothing — the same gap the command palette was
  // fixed for once already.
  useEscapeToClose(
    useCallback(() => setOpen(false), []),
    !open,
  );

  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  useEffect(() => {
    const eventHandler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt ?? "";
      setOpen(true);
      if (prompt.trim()) setInput(prompt.trim());
    };
    window.addEventListener(LOKI_OPEN_EVENT, eventHandler);
    return () => window.removeEventListener(LOKI_OPEN_EVENT, eventHandler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /** Grow with the text, to a ceiling — a drawer that swallows the page is its
   *  own problem. Matches loki/Composer.tsx rather than inventing a second
   *  auto-grow. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ASK_INPUT_PX)}px`;
  }, [open]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns, asking]);

  // Capture the one field the callback needs as a local, so the closure
  // depends on `workspaceKey` — not the whole `context` object — and the
  // manual deps match what the compiler infers.
  const workspaceKey = context?.workspaceKey ?? null;
  const ask = useCallback(async () => {
    const message = input.trim();
    if (!message || asking) return;
    setInput("");
    setAskError(null);
    setTurns((prev) => [...prev, { role: "user", text: message }]);
    setAsking(true);

    // A form is open: write into it. Telling the user which fields to type in
    // would be a worse answer than just filling them.
    const form = activeForm?.getAssist();
    if (form) {
      try {
        const result = await form.ask(message);
        setTurns((prev) => [
          ...prev,
          { role: "loki", text: result.ok ? result.message : result.error },
        ]);
      } finally {
        setAsking(false);
      }
      return;
    }

    try {
      const projectKey = workspaceKey;
      // Send the heavy project context once per project thread per page life.
      const includeContext = projectKey != null && sentContextRef.current !== projectKey;
      // What the user can actually see, read from the rendered page — so the
      // answer is grounded in this screen rather than in route metadata.
      const pageContext = readPageContext();
      // The panel's own transcript, so a follow-up has something to follow.
      // These turns live in client state only — without sending them, "and the
      // second one?" reached the model with no first one.
      const history = turnsRef.current.slice(-HISTORY_TURNS).map((t) => ({
        role: t.role === "loki" ? ("assistant" as const) : ("user" as const),
        content: t.text.slice(0, HISTORY_CHARS),
      }));
      const res = await postJson("/api/loki", {
        message,
        ...(pageContext ? { pageContext } : {}),
        ...(projectKey ? { projectKey, includeContext } : {}),
        ...(history.length > 0 ? { history } : {}),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        text?: string;
        error?: string;
      } & Record<string, unknown>;
      if (!res.ok || !body.ok || !body.text) {
        setAskError(body.error ?? "Loki did not answer — try again.");
      } else {
        if (includeContext && projectKey) sentContextRef.current = projectKey;
        setTurns((prev) => [
          ...prev,
          { role: "loki", text: body.text!, meta: pickProvenance(body) },
        ]);
      }
    } catch {
      setAskError("Loki is unreachable — network error.");
    } finally {
      setAsking(false);
    }
  }, [input, asking, workspaceKey, activeForm]);

  if (pathname === "/loki") return null;

  const canAct = context != null && !context.readonly;

  // Modals render at z-[60]. While a form is open the assistant has to sit
  // above it — otherwise the one moment it can fill a form is the one moment
  // the user cannot reach it.
  const layer = activeForm ? "z-[70]" : "z-40";

  return (
    <>
      {open && (
        <div
          className={`fixed bottom-24 right-4 ${layer} flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border-default bg-surface-overlay shadow-panel-strong sm:right-7`}
          role="dialog"
          aria-label="Loki assistant"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <div className="min-w-0">
              <p className="ui-kicker">Loki</p>
              <p className="truncate text-sm font-medium text-text-primary">
                {context ? context.name : "Your fleet"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={
                  context ? `/loki?project=${encodeURIComponent(context.workspaceKey)}` : "/loki"
                }
                className="ui-btn-ghost min-h-8 gap-1 px-2 text-xs"
                title="Continue in the full Loki workspace"
              >
                Full Loki <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ui-btn-icon"
                aria-label="Close assistant"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div ref={transcriptRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {/* A form is open — say so, because what the assistant does next is
                edit that form rather than answer a question about the fleet. */}
            {activeForm && (
              <div className="ui-assist-row rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden="true" />
                <span className="min-w-0 grow truncate text-xs text-text-secondary">
                  Filling <span className="text-text-primary">{activeForm.title}</span>
                </span>
              </div>
            )}

            {/* Page-aware proposals: everything the page called out, one click each. */}
            <div className={activeForm ? "hidden" : "space-y-2"}>
              <p className="ui-micro-label">
                {context ? "Proposed for this project" : "Start somewhere"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {canAct &&
                  context.signals.map((signal) => (
                    <ProposalChip
                      key={signal.key}
                      context={context}
                      kind="fix_signal"
                      signalKey={signal.key}
                      icon={Wrench}
                      label={`Fix: ${signal.label.toLowerCase()}`}
                    />
                  ))}
                {canAct && context.nextStep && (
                  <ProposalChip
                    context={context}
                    kind="next_step"
                    icon={Play}
                    label="Run next step"
                  />
                )}
                {canAct && context.timeoutStreak >= 2 && (
                  <ProposalChip
                    context={context}
                    kind="diagnose_timeouts"
                    icon={Stethoscope}
                    label={`Diagnose ${context.timeoutStreak} timed-out runs`}
                  />
                )}
                {!context &&
                  LOKI_PROACTIVE_STARTERS.map((starter) => (
                    <button
                      key={starter.id}
                      type="button"
                      onClick={() => setInput(starter.prompt)}
                      className="ui-btn-secondary min-h-8 px-2.5 text-xs"
                    >
                      {starter.label}
                    </button>
                  ))}
                {context && !canAct && (
                  <p className="text-xs text-text-muted">
                    Team project — ask about it below; actions are owner-only.
                  </p>
                )}
                {canAct &&
                  context.signals.length === 0 &&
                  !context.nextStep &&
                  context.timeoutStreak < 2 && (
                    <p className="text-xs text-text-muted">
                      No open callouts — ask anything about this project below.
                    </p>
                  )}
              </div>
            </div>

            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "text-right" : ""}>
                <p
                  className={
                    turn.role === "user"
                      ? "inline-block max-w-[90%] rounded-lg bg-surface-raised px-3 py-2 text-left text-sm text-text-primary"
                      : "whitespace-pre-wrap text-sm leading-relaxed text-text-secondary"
                  }
                >
                  {turn.text}
                </p>
                {turn.role === "loki" && <ProvenanceFooter meta={turn.meta ?? null} />}
              </div>
            ))}
            {asking && (
              <p className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loki is
                thinking…
              </p>
            )}
            {askError && <p className="ui-error text-xs">{askError}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
            className="flex items-center gap-2 border-t border-border-subtle p-3"
          >
            {/*
              A TEXTAREA, not an input, and the difference is data loss rather
              than comfort.

              "Brief Loki" on /today prefills this control with a multi-line
              prompt built by SummaryBar — a heading, the day's counts, then the
              question — joined with "\n". An <input> cannot hold a newline, so
              the browser silently stripped every one and the value arrived as
              "Daily brief — Friday, 18 SeptemberWhat should I focus on today?".
              Measured live on 2026-09-18: newlineCount 0. The product generated
              a structured prompt and its own field destroyed the structure,
              with no error and nothing to notice.

              It is also the composer for the thing this product is FOR. A brief
              is multiple sentences by nature; a single-line box that scrolls
              horizontally shows about forty characters of it, so you cannot read
              back what you are about to dispatch.

              Enter sends and Shift+Enter breaks the line — the convention
              everywhere else in this app, including loki/Composer.tsx, whose
              auto-grow this mirrors.
            */}
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask();
                }
              }}
              placeholder={
                activeForm
                  ? `Describe or change ${activeForm.title}…`
                  : context
                    ? `Ask about ${context.name}…`
                    : "Ask across your fleet…"
              }
              className="ui-input-compact min-w-0 flex-1 resize-none"
              aria-label="Ask Loki"
            />
            <button
              type="submit"
              disabled={!input.trim() || asking}
              className="ui-btn-primary min-h-9 px-3 text-xs"
            >
              Ask
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`ui-fab fixed bottom-7 right-7 ${layer} hidden h-14 w-14 items-center justify-center active:scale-95 md:flex focus-visible:ring-2 focus-visible:ring-accent-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        title={open ? "Close Loki (press ?)" : "Open Loki (press ?)"}
        aria-label={open ? "Close Loki assistant" : "Open Loki assistant"}
        aria-expanded={open}
      >
        <MessageSquare className="h-6 w-6" />
      </button>
    </>
  );
}
