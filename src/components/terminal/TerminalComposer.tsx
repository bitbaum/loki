"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpen, X } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { PromptPicker } from "@/components/prompts/PromptPicker";
import { Composer, type ComposerMode } from "@/components/composer/Composer";
import type { Attachment, ModelChoice } from "@/components/loki/types";
import type { SessionAsk } from "@/hooks/use-session-ask";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { dispatchToneDotClass } from "@/lib/dispatch-status";
import { SuggestionChips } from "./SuggestionChips";
import { terminalComposerModes, type SessionComposerMode } from "./terminal-composer-modes";

const SCREENSHOT_ONLY = "Look at the attached screenshot and fix what is wrong.";

export type InjectAck = { commandId: string | null; runId: string | null };

/**
 * Writing to a session — the terminal's use of THE composer
 * (components/composer/Composer.tsx).
 *
 * One component for every place that sends words at a terminal session:
 *   • the Loki rail beside the terminal — Ask (a chat-only question about the
 *     project, on the rail's own thread: see useSessionAsk) or Inject (a task
 *     into the attached session);
 *   • the Prompt-mode box under the terminal and in the phone dock — Inject;
 *   • Control's quick send to any open tab — Inject.
 * They used to be three components with three looks and three feature sets;
 * the rail's was a bare textarea with no attachments and no voice.
 *
 * Inject goes through `/api/control/tab-inject`, which assembles the words with
 * the project's context (mission, conventions, definition of done) and QUEUES
 * them when the builder is offline — that is the difference from typing the
 * same words into the PTY. `/` at the start of an empty draft opens the prompt
 * library inline.
 */
export function TerminalComposer({
  tab,
  project = null,
  modes: modeIds = ["inject"],
  defaultMode = "inject",
  ask: session,
  draft,
  onInjected,
  ptyLive,
  density = "comfortable",
  injectPlaceholder,
  suggestions,
}: {
  /** The session Inject writes into. null → Inject says why it cannot send. */
  tab: string | null;
  /** The project Ask is about. Required for Ask to be offered. */
  project?: string | null;
  modes?: readonly SessionComposerMode[];
  defaultMode?: SessionComposerMode;
  /** The thread Ask writes to — owned by whoever shows it (the rail). Without
   *  it Ask is not offered. */
  ask?: SessionAsk;
  /** Put words in the box, in Inject, for the person to check and send (a
   *  summary's suggested next step). A new `nonce` re-applies the same text. */
  draft?: { text: string; nonce: number } | null;
  onInjected?: (ack: InjectAck) => void;
  /** Lets the status line say whether the PTY has started printing. */
  ptyLive?: boolean;
  density?: "comfortable" | "compact";
  injectPlaceholder?: string;
  /** Instructions that fit what the session shows (lib/terminal-suggestions).
   *  Shown while the box is empty; a tap sends it (SuggestionChips). */
  suggestions?: readonly string[];
}) {
  const modes: ComposerMode[] = terminalComposerModes(
    session ? modeIds : modeIds.filter((id) => id !== "ask"),
    { project, tab },
  );
  const [picked, setMode] = useState<SessionComposerMode>(defaultMode);
  // A mode that is not on offer (Ask with no project yet) falls back to the
  // first one that is, rather than rendering a destination that cannot exist.
  const mode: SessionComposerMode = modes.some((m) => m.id === picked)
    ? picked
    : ((modes[0]?.id as SessionComposerMode | undefined) ?? "inject");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Applied while rendering (React's "adjust state when a prop changes"), not
  // in an effect; only the focus, which touches the DOM, waits for one.
  const [appliedDraft, setAppliedDraft] = useState<number | null>(null);
  if (draft && draft.nonce !== appliedDraft) {
    setAppliedDraft(draft.nonce);
    setText(draft.text);
    setMode("inject");
  }
  useEffect(() => {
    if (draft) inputRef.current?.focus();
  }, [draft]);

  // ── Inject ────────────────────────────────────────────────────────────────
  const [injecting, setInjecting] = useState(false);
  // What THIS send actually did, kept on screen for the case that needs it —
  // queued or still working — and cleared on its own once a dispatch is
  // confirmed started. A bare "Sent ✓" that vanished after two seconds looked
  // identical for a prompt that ran and one that queued behind an offline
  // builder.
  const [tracked, setTracked] = useState<InjectAck | null>(null);
  const liveDispatch = useDispatchLiveStatus(tracked?.commandId ?? null, tracked?.runId ?? null);
  useEffect(() => {
    if (!liveDispatch?.terminal) return;
    if (liveDispatch.tone === "negative" || liveDispatch.tone === "warning") return;
    const t = window.setTimeout(() => setTracked(null), 4000);
    return () => window.clearTimeout(t);
  }, [liveDispatch]);

  const inject = async (prompt: string, attachments: Attachment[]): Promise<boolean> => {
    if (!tab) {
      setError("Open a session first — inject writes into the attached PTY.");
      return false;
    }
    setInjecting(true);
    setError(null);
    try {
      const res = await postJson("/api/control/tab-inject", {
        tab,
        prompt,
        ...(attachments.length ? { attachments } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: unknown;
        blocked?: boolean;
        commandId?: unknown;
        runId?: unknown;
      };
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : `Could not inject (HTTP ${res.status}).`,
        );
        return false;
      }
      // The runner saw someone typing in this exact session and refused to
      // interleave — nothing ran, though HTTP succeeded.
      if (data.blocked) {
        setError(`Not sent — someone is typing in “${tab}” right now. Try again in a moment.`);
        return false;
      }
      const ack: InjectAck = {
        commandId: typeof data.commandId === "string" ? data.commandId : null,
        runId: typeof data.runId === "string" ? data.runId : null,
      };
      setTracked(ack);
      onInjected?.(ack);
      return true;
    } catch (e) {
      // The draft is kept (return false) so a failed send is retryable.
      setError(e instanceof Error ? e.message : "Could not inject into this session.");
      return false;
    } finally {
      setInjecting(false);
    }
  };

  const ask = async (
    prompt: string,
    choice: ModelChoice,
    attachments: Attachment[],
  ): Promise<boolean> => (session ? session.ask(prompt, { choice, attachments }) : false);

  const asking = mode === "ask";
  const sending = asking ? Boolean(session?.sending) : injecting;
  const label = tab ?? project ?? "this session";
  const placeholder = asking
    ? `Ask Loki about ${project ?? label}…`
    : tab
      ? (injectPlaceholder ?? `Describe a task for ${tab} — “/” for the prompt library`)
      : "Open a session to inject";
  const shownError = error ?? (asking ? (session?.error ?? null) : null);

  const showSuggestions = !asking && Boolean(tab) && !text.trim() && Boolean(suggestions?.length);
  const header = (
    <>
      {showSuggestions && (
        <SuggestionChips
          suggestions={suggestions!}
          disabled={injecting}
          onPick={(s) => {
            setMode("inject");
            void inject(s, []);
          }}
        />
      )}
      {shownError && (
        <div className="ui-loki-composer-error" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{shownError}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              session?.clearError();
            }}
            aria-label="Dismiss error"
            className="ui-icon-action shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );

  const footer =
    !asking && tracked ? (
      <div className="ui-loki-composer-status" role="status">
        <span className={dispatchToneDotClass(liveDispatch?.tone ?? "neutral")} />
        <span className="min-w-0 flex-1 truncate">
          {liveDispatch?.label ?? "Sent — checking status…"}
          {liveDispatch?.detail ? ` — ${liveDispatch.detail}` : ""}
          {ptyLive === undefined
            ? ""
            : ptyLive
              ? " · PTY is printing."
              : " · waiting for PTY bytes."}
        </span>
        <button
          type="button"
          onClick={() => setTracked(null)}
          aria-label="Dismiss dispatch status"
          className="ui-icon-action shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    ) : null;

  return (
    <div className="relative shrink-0">
      {pickerOpen && tab && (
        <div className="absolute bottom-full left-0 right-0 z-40 mb-1.5">
          <PromptPicker
            projectName={tab}
            projectScopedOnly
            onPick={(resolved) => {
              setText(resolved);
              // Picking is not sending: focus returns so the template can be
              // edited before it goes.
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}
      <Composer
        value={text}
        onValueChange={setText}
        inputRef={inputRef}
        placeholder={placeholder}
        ariaLabel={asking ? `Ask Loki about ${project ?? label}` : `Inject into ${label}`}
        sending={sending}
        onStop={asking ? session?.stop : undefined}
        sendBlockedReason={
          !asking && !tab ? "Open a session first — inject writes into the attached PTY." : null
        }
        attachmentOnlyText={asking ? undefined : SCREENSHOT_ONLY}
        modelPicker={asking}
        modes={modes}
        mode={mode}
        onModeChange={(id) => {
          setMode(id as SessionComposerMode);
          setError(null);
        }}
        onEmptySlash={!asking && tab ? () => setPickerOpen(true) : undefined}
        density={density}
        hint={density === "comfortable" ? "Enter sends · Shift+Enter for a new line" : undefined}
        header={header}
        footer={footer}
        tools={
          !asking && tab ? (
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              title="Prompt library"
              aria-label="Prompt library"
              className="ui-btn-icon shrink-0"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </button>
          ) : null
        }
        onSend={(outgoing, choice, attachments) =>
          asking ? ask(outgoing, choice, attachments) : inject(outgoing, attachments)
        }
      />
    </div>
  );
}
