"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { Composer as ChatkitComposer } from "@bitbaum/chatkit/react";
import { ModelPicker } from "@/components/loki/ModelPicker";
import type { Attachment, ModelChoice } from "@/components/loki/types";
import type { ComposerMode, ComposerSendResult } from "./composer-logic";

export type { ComposerMode, ComposerSendResult };

/** Loki's server leg for dictation: Groq Whisper behind the operator's session. */
const TRANSCRIBE_URL = "/api/control/transcribe";

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
  /** When given, the send slot becomes Stop while `sending`. */
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
  value?: string;
  onValueChange?: (text: string) => void;
  defaultValue?: string;
  /** Controlled model choice, for a caller that sends on the composer's behalf
   *  (a suggestion chip). Omit to let the composer own it. */
  model?: string;
  onModelChange?: (model: string | undefined) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  density?: "comfortable" | "compact";
  above?: ReactNode;
  header?: ReactNode;
  tools?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  hint?: string;
};

/**
 * THE composer — now the fleet's: `@bitbaum/chatkit`'s Composer, with Loki's
 * model picker in its `tools` slot and Loki's Whisper route as the mic's
 * server leg. Every call site (Loki chat, the terminal's Ask / Inject rail and
 * Prompt box, Control's quick send) keeps this exact API.
 *
 * Until 2026-09-24 there were four composers in this app; until 2026-09-25
 * there were thirteen chats in the fleet. A fix to composing — the mic, text
 * size, the keyboard — belongs in bitbaum/chatkit, where every product gets
 * it, never here. Only Loki-specific wiring lives in this file.
 *
 * Voice prefers the server: dictation here is often mixed German and English,
 * which one Whisper model handles better than a browser recogniser locked to
 * a single language. chatkit still falls back to the browser recogniser, and
 * says why in words when neither can work.
 */
export function Composer({
  onSend,
  voice = true,
  attach = true,
  modelPicker = false,
  model: modelProp,
  onModelChange,
  tools,
  disabled = false,
  ...rest
}: ComposerProps) {
  const [ownModel, setOwnModel] = useState<string | undefined>(undefined);
  const model = onModelChange ? modelProp : ownModel;
  const setModel = (next: string | undefined) => {
    if (onModelChange) onModelChange(next);
    else setOwnModel(next);
  };

  return (
    <ChatkitComposer
      {...rest}
      disabled={disabled}
      attach={attach}
      onSend={(text, attachments) => onSend(text, model ? { model } : {}, attachments)}
      voice={voice ? { transcribeUrl: TRANSCRIBE_URL, prefer: "server" } : false}
      tools={
        <>
          {modelPicker && <ModelPicker value={model} onChange={setModel} disabled={disabled} />}
          {tools}
        </>
      }
    />
  );
}
