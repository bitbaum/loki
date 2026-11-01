"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Plus, X } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { Composer } from "@/components/composer/Composer";
import type { Attachment } from "@/components/loki/types";
import type { BuilderChannel } from "@/lib/event-stream-types";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import { dispatchToneDotClass } from "@/lib/dispatch-status";
import { commandIn } from "@/lib/terminal-commands";
import { stepLabel } from "@/lib/terminal-suggestions";
import { ESC, typeCommand, typeMessage } from "@/lib/session-keystrokes";
import { SuggestionChips } from "./SuggestionChips";
import { LokiFiles } from "./LokiFiles";
import { SessionPicker } from "./SessionPicker";
import { useLokiAttachments } from "./use-loki-attachments";

const SCREENSHOT_ONLY = "Look at the attached screenshot and fix what is wrong.";
/** chatkit's own attach button. Hidden in this box (globals.css) — "+" is the
 *  one way in — but kept mounted, so its Camera / Photos / Files sheet, paste
 *  and the attachment strip stay chatkit's, and "Photo or screenshot" in the
 *  "+" sheet presses it. */
const ATTACH_TRIGGER = '.ck-tools > .ck-icon-btn[aria-haspopup="dialog"]:not(.ui-box-plus)';

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
 * "+" (or "/" in an empty box) opens one sheet: a photo or screenshot, the
 * agent's commands, Loki's records and the prompt library — and the keys a
 * phone lacks, in the terminal view. It replaced a paperclip and a slash
 * button side by side, two ways into two halves of the same question ("what
 * can I add?"), which left the model's name three letters wide.
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
  project = null,
  offerFeedback = false,
  onOpenKeys,
  sendRequest = null,
}: {
  /** Opens the key deck (terminal view); offered in the "+" sheet on phones. */
  onOpenKeys?: () => void;
  /** Words to SEND, chosen outside the box (a reply row under the answer).
   *  Each new nonce goes out once, by the same path as a typed message. */
  sendRequest?: { text: string; nonce: number } | null;
  /** The project's name in Loki — whose records (feedback) can be attached. */
  project?: string | null;
  /** The agent just asked for feedback it cannot reach: offer Loki's reports
   *  as a chip, not only from the library. */
  offerFeedback?: boolean;
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
  const boxRef = useRef<HTMLDivElement>(null);
  const loki = useLokiAttachments(project);

  const openPicker = () => {
    loki.clearNote();
    setPickerOpen(true);
  };

  const attachFeedback = async () => {
    const attached = await loki.attachFeedback();
    // A file alone cannot be sent: the box needs words. Say what the file is
    // for, ready to edit, rather than leave Send greyed out with no reason.
    if (attached && !text.trim()) {
      setText(`The attached file holds the feedback reports Loki has for ${project}. Use it.`);
    }
    if (attached) window.setTimeout(() => inputRef.current?.focus(), 0);
  };

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
    const withLoki = loki.files.length > 0 ? [...attachments, ...loki.files] : attachments;
    const ok = await deliver(message, withLoki);
    if (ok) {
      loki.clear();
      onSent?.();
    }
    return ok;
  };

  const deliver = async (message: string, attachments: Attachment[]): Promise<boolean> => {
    setError(null);
    try {
      const command = attachments.length === 0 ? commandIn(message, agent) : null;
      if (command) {
        await typeCommand(onKey, command);
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

  const sentRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!sendRequest || sentRequest.current === sendRequest.nonce) return;
    sentRequest.current = sendRequest.nonce;
    void send(sendRequest.text, []);
    // send is recreated each render; the nonce alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendRequest]);

  // The agent cannot read Loki's database, so when it is stuck on feedback it
  // proposes workarounds ("request access to the widget's storage path and
  // dump its submissions", substrata, 2026-10-16). The answer is one press:
  // attach the reports. Such a suggestion is replaced by that action.
  const canAttachFeedback =
    offerFeedback && Boolean(project) && loki.files.length === 0 && !loki.knownEmpty;
  const shownSuggestions = canAttachFeedback
    ? suggestions.filter((s) => !asksForFeedbackAccess(s))
    : suggestions;

  const status = sent ? (
    <div className="ui-session-status" role="status">
      <span
        className={dispatchToneDotClass(
          sent.kind === "typed" ? "positive" : (dispatch?.tone ?? "neutral"),
        )}
      />
      <span className="min-w-0 flex-1">
        {sent.kind === "typed"
          ? `Typed ${sent.what} into the terminal.`
          : (dispatch?.label ??
            `Sent as a task — it starts ${agentLabel} in ${tab}, or waits for the runner.`)}
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

  // Everything that is not the message itself — the next-step chips, an
  // error, what the last send did — sits ABOVE the box, so the box holds only
  // the input and its Send. They used to render inside it, and the box read
  // as a log with a text field somewhere in it (owner, 2026-10-20).
  const above = (
    <>
      {/* Hidden while the panel is open: on a short phone they took the room
          the prompt list needed, and the panel is the choice being made. */}
      {!pickerOpen &&
        !text.trim() &&
        (onExplain || shownSuggestions.length > 0 || offerFeedback) && (
          <SuggestionChips
            suggestions={shownSuggestions}
            onPick={(s) => void send(s, [])}
            label={(s) => stepLabel(s, agent)}
            onExplain={onExplain}
            actions={
              canAttachFeedback
                ? [
                    {
                      key: "feedback",
                      label: `Attach ${project}'s feedback`,
                      onClick: () => void attachFeedback(),
                    },
                  ]
                : undefined
            }
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
      {status}
    </>
  );

  // Attached files ARE part of the message, so they stay inside the box.
  const header = <LokiFiles loki={loki} />;

  return (
    <div ref={boxRef} className="ui-session-box relative shrink-0">
      {pickerOpen && (
        <SessionPicker
          agent={agent}
          project={project}
          tab={tab}
          feedbackEmpty={loki.knownEmpty}
          onKey={(bytes) => {
            void onKey(bytes);
            setSent({ kind: "typed", what: bytes.replace(/\r$/, "") });
            setPickerOpen(false);
          }}
          onPhoto={() => {
            setPickerOpen(false);
            // After the sheet has gone, so its focus restore does not close
            // chatkit's sheet the moment it opens.
            window.setTimeout(
              () => boxRef.current?.querySelector<HTMLButtonElement>(ATTACH_TRIGGER)?.click(),
              0,
            );
          }}
          onKeys={
            onOpenKeys
              ? () => {
                  setPickerOpen(false);
                  onOpenKeys();
                }
              : undefined
          }
          onAttachFeedback={() => {
            setPickerOpen(false);
            void attachFeedback();
          }}
          onPick={(resolved, template) => {
            setText(resolved);
            if (template.attach?.includes("feedback")) void loki.attachFeedback(true);
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
          onClose={() => setPickerOpen(false)}
        />
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
        onEmptySlash={openPicker}
        density={density}
        above={above}
        header={header}
        tools={
          <>
            <button
              type="button"
              onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
              title="Add a photo, a command or a prompt (or type /)"
              aria-label="Add a photo, a command or a prompt"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              // chatkit's own round 44px tool button, like the microphone.
              className="ck-icon-btn ui-box-plus"
            >
              <Plus className="h-5 w-5" />
            </button>
            {tools}
          </>
        }
        onSend={(message, _choice, attachments) => send(message, attachments)}
      />
    </div>
  );
}

/** A next step that is really "get me the feedback reports" in other words. */
function asksForFeedbackAccess(suggestion: string): boolean {
  return (
    /\b(feedback|submissions?|reports?)\b/i.test(suggestion) &&
    /\b(access|dump|export|storage|read|readable|fetch|download)\b/i.test(suggestion)
  );
}
