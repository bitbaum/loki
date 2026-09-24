"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, Check, Loader2, Mic, Square, X } from "lucide-react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useAttachments } from "@/hooks/use-attachments";
import { AttachButton, AttachmentStrip } from "@/components/ui/attachment-strip";
import { ModelPicker } from "@/components/loki/ModelPicker";
import type { Attachment, ModelChoice } from "@/components/loki/types";
import { cn } from "@/lib/utils";
import {
  composerCanSend,
  composerOutgoingText,
  shouldClearDraft,
  type ComposerMode,
  type ComposerSendResult,
} from "./composer-logic";

/** Matches the `max-h` in `ui-loki-composer-input`; both must move together. */
const MAX_INPUT_PX = 240;

export type { ComposerMode, ComposerSendResult };

export type ComposerProps = {
  /** Deliver what was written. Return `false` (or resolve to it) to keep the
   *  draft — a failed send must be retryable from the same box, not retyped.
   *  Anything else clears it. */
  onSend: (
    text: string,
    choice: ModelChoice,
    attachments: Attachment[],
  ) => ComposerSendResult | Promise<ComposerSendResult>;
  placeholder: string;
  ariaLabel?: string;
  /** Nothing can be typed or sent. */
  disabled?: boolean;
  /** Typing is fine, sending is not (e.g. inject with no session attached).
   *  Shown as the send button's title so the reason is one hover away. */
  sendBlockedReason?: string | null;
  /** A send is in flight. */
  sending?: boolean;
  /** When given, the send slot becomes Stop while `sending` — a turn you cannot
   *  cancel is what makes a slow answer feel broken. Without it the slot shows
   *  a spinner. */
  onStop?: () => void;
  /** What an attachments-only send says. Omit and an empty text cannot send. */
  attachmentOnlyText?: string;
  attach?: boolean;
  voice?: boolean;
  /** Offer the Loki model picker (chat turns). Off where the model is the
   *  session's own CLI, which the composer cannot change. */
  modelPicker?: boolean;
  /** Mutually exclusive destinations for the same words (Ask vs Inject). */
  modes?: readonly ComposerMode[];
  mode?: string;
  onModeChange?: (id: string) => void;
  /** "/" typed into an empty composer — opens a library instead of typing. */
  onEmptySlash?: () => void;
  /** Controlled draft, for a caller that inserts text (a prefill, a picked
   *  template). Omit both to let the composer own it. */
  value?: string;
  onValueChange?: (text: string) => void;
  /** Initial draft when uncontrolled. */
  defaultValue?: string;
  /** Controlled model choice, for a caller that sends on the composer's behalf
   *  (a suggestion chip). Omit to let the composer own it. */
  model?: string;
  onModelChange?: (model: string | undefined) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** `compact` for a side rail or a phone dock: tighter padding, same parts. */
  density?: "comfortable" | "compact";
  /** Outside the box, above it (suggestion chips). */
  above?: ReactNode;
  /** Inside the box, above the text (scope pills, an error). */
  header?: ReactNode;
  /** Extra tools after attach/voice/model (prompt library). */
  tools?: ReactNode;
  /** Just before the send button (an honesty chip). */
  trailing?: ReactNode;
  /** Inside the box, under the controls (what the last send actually did). */
  footer?: ReactNode;
  /** Quiet hint in the controls row ("Enter sends · Shift+Enter …"). */
  hint?: string;
};

/**
 * THE composer. Loki chat, the terminal's Ask / Inject rail, the terminal's
 * Prompt-mode box and Control's quick send are the same job — write words,
 * maybe a screenshot or a dictated note, and send them somewhere — so they are
 * one component with one look, and a call site only says where the words go.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Until 2026-09-24 there were four. The Loki chat composer had attachments,
 * voice and a model picker; the terminal rail's "Inject into <project>" box was
 * a bare textarea with none of them and a different look; the Prompt-mode box
 * had attachments but no voice; Control's quick send was a single-line input
 * that sent on ⌘Enter. The owner's note was that the rail was "a second, worse
 * composer" — and the fix is not to bolt attach and voice onto it, which only
 * makes a fifth thing to keep in step. Multiple designs for one job is the bug.
 *
 * Deliberately NOT this component: TerminalRawComposer, which types verbatim
 * bytes into a PTY (autocorrect off, monospace, an Enter-or-not toggle). That
 * is a keyboard for a shell, not a message to an agent.
 *
 * Enter sends, Shift+Enter is a new line — everywhere.
 */
export function Composer({
  onSend,
  placeholder,
  ariaLabel,
  disabled = false,
  sendBlockedReason = null,
  sending = false,
  onStop,
  attachmentOnlyText,
  attach = true,
  voice: voiceEnabled = true,
  modelPicker = false,
  modes,
  mode,
  onModeChange,
  onEmptySlash,
  value,
  onValueChange,
  defaultValue = "",
  model: modelProp,
  onModelChange,
  inputRef,
  density = "comfortable",
  above,
  header,
  tools,
  trailing,
  footer,
  hint,
}: ComposerProps) {
  const [ownText, setOwnText] = useState(defaultValue);
  const controlled = value !== undefined;
  const text = controlled ? value : ownText;
  // Mirrored so an async send's completion compares against the CURRENT draft,
  // not the one its closure captured. Written in an effect, never in render.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  });
  const setText = (next: string | ((prev: string) => string)) => {
    const resolved = typeof next === "function" ? next(textRef.current) : next;
    textRef.current = resolved;
    if (!controlled) setOwnText(resolved);
    onValueChange?.(resolved);
  };

  const [ownModel, setOwnModel] = useState<string | undefined>(undefined);
  const model = onModelChange ? modelProp : ownModel;
  const setModel = (next: string | undefined) => {
    if (onModelChange) onModelChange(next);
    else setOwnModel(next);
  };
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = inputRef ?? localRef;
  const attachments = useAttachments();

  const voice = useVoiceInput({
    onTranscript: (t) => setText((prev) => (prev ? `${prev} ${t}` : t)),
  });
  const recording = voice.status === "recording";
  const transcribing = voice.status === "transcribing";

  const recStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!recording) return;
    recStartRef.current = Date.now();
    const t = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - recStartRef.current) / 1000)),
      250,
    );
    return () => window.clearInterval(t);
  }, [recording]);
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Keyed on the VALUE, not the keystroke, so programmatic changes — a chip
  // prefill, a dictated transcript, the clear after send — resize too.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [text, textareaRef]);

  const attachCount = attach ? attachments.attachments.length : 0;
  const canSend = composerCanSend({
    text,
    attachmentCount: attachCount,
    attachmentOnlyText,
    sending,
    disabled,
    blocked: Boolean(sendBlockedReason),
  });

  const submit = async () => {
    if (!canSend) return;
    const sent = text;
    const outgoing = composerOutgoingText(sent, attachCount, attachmentOnlyText);
    const wire = attach ? attachments.toWire() : [];
    const result = await onSend(outgoing, model ? { model } : {}, wire);
    if (!shouldClearDraft(result)) return;
    // Only clear what was sent: words typed while a slow send was in flight
    // are the next message, not this one.
    if (textRef.current === sent) setText("");
    attachments.clear();
  };

  const showModes = Boolean(modes && modes.length > 1);

  return (
    <div className="ui-loki-composer-wrap">
      {above}
      <div className="relative">
        {(recording || transcribing) && (
          <div className="ui-voice-bar" role="status" aria-live="polite">
            {recording ? (
              <>
                <span className="ui-voice-rec-dot" aria-hidden />
                <div className="ui-voice-wave" aria-hidden>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <span key={i} className="ui-voice-wave-bar" />
                  ))}
                </div>
                <span className="ui-voice-timer tabular-nums">{fmtTime(elapsed)}</span>
                <button
                  type="button"
                  className="ui-voice-cancel"
                  onClick={voice.cancel}
                  aria-label="Cancel recording"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="ui-voice-stop"
                  onClick={voice.stop}
                  aria-label="Stop and transcribe"
                >
                  <Check className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-secondary" />
                <span className="ui-voice-timer">Transcribing…</span>
              </>
            )}
          </div>
        )}

        <div
          className={cn("ui-loki-composer", density === "compact" && "ui-loki-composer-compact")}
        >
          {showModes && (
            <div className="ui-loki-composer-modes" role="group" aria-label="Send to">
              {modes!.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={
                    m.id === mode ? "ui-chip-toggle-compact-active" : "ui-chip-toggle-compact"
                  }
                  aria-pressed={m.id === mode}
                  title={m.hint}
                  onClick={() => onModeChange?.(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {header}

          <textarea
            ref={textareaRef}
            className="ui-loki-composer-input"
            rows={1}
            value={text}
            disabled={disabled || transcribing}
            placeholder={recording ? "Listening…" : placeholder}
            aria-label={ariaLabel ?? placeholder}
            onChange={(e) => {
              const next = e.target.value;
              if (onEmptySlash && next === "/" && text === "") {
                onEmptySlash();
                return;
              }
              setText(next);
            }}
            onPaste={(e) => {
              if (attach && attachments.addFromPaste(e)) e.preventDefault();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />

          {attach && <AttachmentStrip attachments={attachments} />}
          {attach && attachments.note && (
            <p className="ui-loki-attach-note" role="status">
              {attachments.note}
            </p>
          )}

          <div className="ui-loki-composer-actions">
            <div className="ui-loki-composer-tools">
              {attach && <AttachButton attachments={attachments} />}
              {voiceEnabled && voice.isSupported && (
                <button
                  type="button"
                  className={
                    recording ? "ui-loki-tool-btn ui-loki-tool-btn-rec" : "ui-loki-tool-btn"
                  }
                  disabled={disabled || transcribing}
                  onClick={recording ? voice.stop : () => void voice.start()}
                  aria-label={recording ? "Stop recording" : "Voice input"}
                >
                  {transcribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : recording ? (
                    <span className="ui-loki-rec-stop" aria-hidden />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              )}
              {modelPicker && <ModelPicker value={model} onChange={setModel} disabled={disabled} />}
              {tools}
              {hint && <span className="ui-loki-composer-hint">{hint}</span>}
            </div>

            <div className="ui-loki-composer-submit-row">
              {trailing}
              {/* Send and Stop occupy the SAME slot, so the button you want
                  never moves depending on state. */}
              {sending && onStop ? (
                <button
                  type="button"
                  className="ui-loki-send-btn ui-loki-send-btn-stop"
                  onClick={onStop}
                  aria-label="Stop generating"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                !recording && (
                  <button
                    type="button"
                    className="ui-loki-send-btn"
                    disabled={!canSend}
                    onClick={() => void submit()}
                    aria-label={ariaLabel ? `Send — ${ariaLabel}` : "Send"}
                    title={sendBlockedReason ?? undefined}
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </button>
                )
              )}
            </div>
          </div>
          {footer}
        </div>
      </div>
    </div>
  );
}
