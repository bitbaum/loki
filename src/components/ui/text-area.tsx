"use client";

import { DictationField, type DictationFieldProps } from "@bitbaum/chatkit/react";
import { LOKI_VOICE, VISITOR_VOICE } from "@/components/composer/voice";
import { cn } from "@/lib/utils";

export type TextAreaProps = Omit<
  DictationFieldProps,
  "value" | "onValueChange" | "voice" | "improve"
> & {
  value: string;
  onChange: (next: string) => void;
  /** `"visitor"` on a page a signed-out person uses: the browser's own
   *  recogniser, since Loki's server leg answers them with 401 (the same
   *  choice as the Composer's `voice="visitor"`). */
  voice?: true | "visitor";
};

/**
 * Every text box in Loki that a person writes words into: the fleet's
 * DictationField (@bitbaum/chatkit), so it has the microphone, 16px text on
 * a phone and 44px controls, with Loki's own transcription as the server leg
 * (the same as the Composer's; the browser's recogniser for a signed-out
 * visitor). Not a hand-made <textarea>: fleet AGENTS.md,
 * "The experience belongs to the package".
 *
 * The frame is drawn to match `ui-input` (globals.css, next to the composer
 * overrides). A label drawn by <Field> needs `htmlFor` and the same `id`
 * here; a field with no visible label passes `ariaLabel`.
 *
 * Every other DictationField prop passes straight through (chatkit 0.27):
 * `name` for a native form post, `autoFocus`, `readOnly`, `invalid`/`error`,
 * `onKeyDown` (runs first), `onSubmit` (the package's submit keys: Cmd/Ctrl+
 * Enter here), `onFocus`/`onBlur` (the WHOLE field's: pressing the microphone
 * is not a blur, and a blur during a take waits for its words), `inputRef`,
 * and `inputProps` (`spellCheck`, `aria-*`, `data-*`, `onPaste`).
 *
 * Code, JSON, commands and URL lists stay a plain <textarea>, with the file
 * marked `experience-exempt`: dictated words would corrupt them.
 */
export function TextArea({ value, onChange, voice = true, className, ...rest }: TextAreaProps) {
  return (
    <DictationField
      {...rest}
      value={value}
      onValueChange={onChange}
      voice={voice === "visitor" ? VISITOR_VOICE : LOKI_VOICE}
      className={cn("ui-text-area", className)}
    />
  );
}
