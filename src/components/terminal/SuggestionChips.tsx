"use client";

import { CornerDownRight, Paperclip, Sparkles } from "lucide-react";

/**
 * The row above the session box: "What's going on?" first, then the next
 * steps that fit what the session shows. A step SENDS when chosen; your own
 * words are one keyboard (or microphone) away in the box below.
 *
 * Each step is shown whole. They used to be clamped to two lines in a
 * sideways-scrolling strip, so "Continue with the next most…" asked you to
 * guess the rest — and they reshuffled while you read (now held still by
 * useStableSteps).
 */
export function SuggestionChips({
  suggestions,
  onPick,
  onExplain,
  actions,
  disabled = false,
}: {
  /** Things Loki can do itself, offered before the steps (attach a file). */
  actions?: readonly { key: string; label: string; onClick: () => void }[];
  suggestions: readonly string[];
  onPick: (prompt: string) => void;
  /** Loki explains the session. Always first, so the row has a fixed start. */
  onExplain?: () => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0 && !onExplain && !actions?.length) return null;
  return (
    <ul className="ui-term-suggests" aria-label="Next steps — each one sends when chosen">
      {onExplain && (
        <li>
          <button
            type="button"
            className="ui-term-suggest ui-term-suggest-explain ui-term-suggest-why"
            onClick={onExplain}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            What&apos;s going on?
          </button>
        </li>
      )}
      {actions?.map((a) => (
        <li key={a.key}>
          <button
            type="button"
            className="ui-term-suggest ui-term-suggest-explain"
            onClick={a.onClick}
          >
            <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {a.label}
          </button>
        </li>
      ))}
      {suggestions.map((s) => (
        <li key={s}>
          <button
            type="button"
            className="ui-term-suggest"
            disabled={disabled}
            onClick={() => onPick(s)}
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The conversation view's next steps: replies under the answer they answer,
 * the way a chat app offers them — not chips stacked over the box, where they
 * read as part of the composer and pushed it up the screen. One press sends.
 */
export function ReplySteps({
  steps,
  onPick,
}: {
  steps: readonly string[];
  onPick: (step: string) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <ul className="ui-reply-steps" aria-label="Replies — each one sends when chosen">
      {steps.map((s) => (
        <li key={s}>
          <button type="button" className="ui-reply-step" onClick={() => onPick(s)}>
            <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{s}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
