"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, BookOpen, X } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { Composer } from "@/components/composer/Composer";
import { PromptPicker } from "@/components/prompts/PromptPicker";
import type { Attachment } from "@/components/loki/types";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { dispatchToneDotClass } from "@/lib/dispatch-status";
import { commandIn } from "@/lib/terminal-commands";
import { ESC, typeMessage } from "@/lib/session-keystrokes";
import { SuggestionChips } from "./SuggestionChips";
import { TerminalCommandList } from "./TerminalActions";

const SCREENSHOT_ONLY = "Look at the attached screenshot and fix what is wrong.";

type Sent =
  | { kind: "typed"; what: string }
  | { kind: "queued"; commandId: string | null; runId: string | null };

/**
 * THE box for talking to the agent in a session — in the terminal view and
 * the conversation view alike, on a phone and on a computer.
 *
 * It replaced a switch between "Type" (keystrokes, no microphone) and
 * "Prompt" (a task wrapped in project context, with a microphone), which made
 * a person choose a delivery mechanism before saying anything (operator,
 * 2026-10-15: "isn't prompt supposed to be the same thing as type?"). Now
 * there is one box with the microphone, screenshots and the prompt library,
 * and the box picks the path:
 *
 *   • one of the agent's own commands ("/model opus") → typed as keystrokes;
 *   • a screenshot → /api/control/chat-send (the runner turns it into a file);
 *   • the session is live → typed into it, exactly as if typed in the terminal;
 *   • nothing is running → /api/control/tab-inject, which starts the agent and
 *     queues the task if the builder is offline.
 *
 * "/" in an empty box opens the agent's commands and the prompt library.
 */
export function SessionComposer({
  tab,
  channel,
  onKey,
  live,
  agent = null,
  agentLabel = "the agent",
  suggestions = [],
  onExplain,
  draft,
  focusRequest = 0,
  working = false,
  tools,
  onShowTerminal,
  onSent,
  density = "comfortable",
}: {
  /** Something went out (the conversation view scrolls to the newest). */
  onSent?: () => void;
  tab: string;
  channel: BuilderChannel;
  /** Verbatim bytes into the session's PTY. */
  onKey: (bytes: string) => void | Promise<void>;
  /** The session is attached and answering: words are typed into it. */
  live: boolean;
  /** The CLI in the tab — whose commands a message may be. */
  agent?: string | null;
  agentLabel?: string;
  /** Next steps, held still (useStableSteps). One press sends it. */
  suggestions?: readonly string[];
  /** "What's going on?" — Loki explains the session. Shown as the first chip. */
  onExplain?: () => void;
  /** Words to put in the box for the person to check (a summary's step). */
  draft?: { text: string; nonce: number } | null;
  /** A new value takes the cursor (the screen above was pressed). */
  focusRequest?: number;
  /** The agent is mid-turn: the send slot becomes Stop (Esc) while empty. */
  working?: boolean;
  /** Extra controls in the tool row (the Keys toggle, Claude Code's mode). */
  tools?: ReactNode;
  /** Offered beside a send error: look at the raw terminal before retrying. */
  onShowTerminal?: () => void;
  density?: "comfortable" | "compact";
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [appliedDraft, setAppliedDraft] = useState<number | null>(null);
  if (draft && draft.nonce !== appliedDraft) {
    setAppliedDraft(draft.nonce);
    setText(draft.text);
  }
  useEffect(() => {
    if (draft || focusRequest > 0) inputRef.current?.focus();
  }, [draft, focusRequest]);

  const queued = sent?.kind === "queued" ? sent : null;
  const dispatch = useDispatchLiveStatus(queued?.commandId ?? null, queued?.runId ?? null);
  useEffect(() => {
    if (sent?.kind === "typed") {
      const t = window.setTimeout(() => setSent(null), 3000);
      return () => window.clearTimeout(t);
    }
    if (!dispatch?.terminal || dispatch.tone === "negative" || dispatch.tone === "warning") return;
    const t = window.setTimeout(() => setSent(null), 4000);
    return () => window.clearTimeout(t);
  }, [sent, dispatch]);

  const post = async (url: string, body: object): Promise<Record<string, unknown> | null> => {
    const res = await postJson(url, body);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : `Not sent (HTTP ${res.status}).`);
      return null;
    }
    if (data.blocked) {
      setError(`Not sent — someone is typing in “${tab}” right now. Try again in a moment.`);
      return null;
    }
    return data;
  };

  const send = async (message: string, attachments: Attachment[]): Promise<boolean> => {
    const ok = await deliver(message, attachments);
    if (ok) onSent?.();
    return ok;
  };

  const deliver = async (message: string, attachments: Attachment[]): Promise<boolean> => {
    setError(null);
    try {
      const command = attachments.length === 0 ? commandIn(message, agent) : null;
      if (command) {
        await onKey(`${command}\r`);
        setSent({ kind: "typed", what: command });
        return true;
      }
      if (attachments.length > 0) {
        return Boolean(
          await post("/api/control/chat-send", { tab, text: message, attachments, channel }),
        );
      }
      if (live) {
        try {
          await typeMessage(onKey, message);
        } catch {
          setError(
            "Send was not confirmed. Your words are still here; check the terminal before retrying.",
          );
          return false;
        }
        return true;
      }
      const data = await post("/api/control/tab-inject", { tab, prompt: message });
      if (!data) return false;
      setSent({
        kind: "queued",
        commandId: typeof data.commandId === "string" ? data.commandId : null,
        runId: typeof data.runId === "string" ? data.runId : null,
      });
      return true;
    } catch (e) {
      // The draft stays (return false) so a failed send is retryable.
      setError(e instanceof Error ? e.message : "Not sent. Your words are still in the box.");
      return false;
    }
  };

  const header = (
    <>
      {!text.trim() && (onExplain || suggestions.length > 0) && (
        <SuggestionChips
          suggestions={suggestions}
          onPick={(s) => void send(s, [])}
          onExplain={onExplain}
        />
      )}
      {error && (
        <div className="ui-loki-composer-error" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{error}</p>
          {onShowTerminal && (
            <button type="button" className="ui-btn-ghost ui-tap shrink-0" onClick={onShowTerminal}>
              Check terminal
            </button>
          )}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="ui-icon-action shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </>
  );

  const footer = sent ? (
    <div className="ui-loki-composer-status" role="status">
      <span
        className={dispatchToneDotClass(
          sent.kind === "typed" ? "positive" : (dispatch?.tone ?? "neutral"),
        )}
      />
      <span className="min-w-0 flex-1">
        {sent.kind === "typed"
          ? `Typed ${sent.what} into the terminal.`
          : (dispatch?.label ??
            `Sent as a task — it starts ${agentLabel} in ${tab}, or waits for the builder.`)}
      </span>
      <button
        type="button"
        onClick={() => setSent(null)}
        aria-label="Dismiss"
        className="ui-icon-action shrink-0"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  ) : null;

  return (
    <div className="relative shrink-0">
      {pickerOpen && (
        <div className="absolute bottom-full left-0 right-0 z-40 mb-1.5 flex flex-col gap-1.5">
          <TerminalCommandList
            agent={agent}
            open
            onKey={(bytes) => {
              void onKey(bytes);
              setSent({ kind: "typed", what: bytes.replace(/\r$/, "") });
              setPickerOpen(false);
            }}
          />
          <PromptPicker
            projectName={tab}
            projectScopedOnly
            onPick={(resolved) => {
              setText(resolved);
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
        placeholder={
          working
            ? `Queue a message for ${agentLabel}…`
            : live
              ? `Message ${agentLabel}…`
              : `Describe a task for ${tab}…`
        }
        ariaLabel={`Message ${agentLabel} in ${tab}`}
        attachmentOnlyText={SCREENSHOT_ONLY}
        sending={working && !text.trim()}
        onStop={working ? () => void Promise.resolve(onKey(ESC)).catch(() => {}) : undefined}
        onEmptySlash={() => setPickerOpen(true)}
        density={density}
        header={header}
        footer={footer}
        tools={
          <>
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              title="Prompt library and the agent's commands (or type /)"
              aria-label="Prompt library"
              aria-expanded={pickerOpen}
              className="ui-btn-icon shrink-0"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </button>
            {tools}
          </>
        }
        onSend={(message, _choice, attachments) => send(message, attachments)}
      />
    </div>
  );
}
