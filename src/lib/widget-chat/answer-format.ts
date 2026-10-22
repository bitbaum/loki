import { RICH_ANSWERS_INSTRUCTION } from "@bitbaum/chatkit";
import { stripEmphasis, stripMeta, trimToLastSentence } from "./concierge";

/** Older cached widgets still print plain text; rich clients opt into the protocol. */
export function visualAnswerInstruction(visual: boolean): string {
  return visual
    ? `\n\n${RICH_ANSWERS_INSTRUCTION}\nFor this client, the visual-answer formats replace the plain-text-only formatting rule above. Keep speaker labels Cat: and Loki: outside visual blocks. Keep the answer brief; a visual is useful only when it clarifies the question.`
    : "";
}

export function formatConciergeAnswer(text: string, visual: boolean): string {
  // Sentence trimming can cut a diagram at a full stop INSIDE its JSON.
  return visual ? text.trim() : trimToLastSentence(stripEmphasis(stripMeta(text)));
}
