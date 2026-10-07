"use client";

/**
 * Next instructions that fit what the session shows (lib/terminal-suggestions),
 * as one-tap chips: a tap SENDS it — the person asked for one tap to start the
 * work, with their own prompt still one keyboard away in the box below.
 */
export function SuggestionChips({
  suggestions,
  onPick,
  disabled = false,
}: {
  suggestions: readonly string[];
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="ui-term-suggests" aria-label="Suggested next steps — tap to send">
      {suggestions.map((s) => (
        <li key={s}>
          <button
            type="button"
            className="ui-term-suggest"
            disabled={disabled}
            onClick={() => onPick(s)}
          >
            {/* Two lines, not one: a step is a sentence you are about to SEND,
                and "Continue with the next most valuable st…" asked you to
                guess the rest before tapping it. Text in its own span: an
                inline-flex button does not clamp its bare text. */}
            <span className="line-clamp-2">{s}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
