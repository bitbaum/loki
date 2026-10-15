"use client";

import { Sparkles } from "lucide-react";

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
  disabled = false,
}: {
  suggestions: readonly string[];
  onPick: (prompt: string) => void;
  /** Loki explains the session. Always first, so the row has a fixed start. */
  onExplain?: () => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0 && !onExplain) return null;
  return (
    <ul className="ui-term-suggests" aria-label="Next steps — each one sends when chosen">
      {onExplain && (
        <li>
          <button
            type="button"
            className="ui-term-suggest ui-term-suggest-explain"
            onClick={onExplain}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            What&apos;s going on?
          </button>
        </li>
      )}
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
