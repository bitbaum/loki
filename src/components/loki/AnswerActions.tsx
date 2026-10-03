"use client";

import { useSyncExternalStore } from "react";
import { Check, Copy, RotateCcw, Share2, Square, Volume2 } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";
import { useSpeech } from "@/hooks/use-speech";

const noSubscribe = () => () => {};

/**
 * The row under an answer — Copy, Listen, Share, Try again — shared by Loki's
 * own chat and the Claude Code conversation on /terminal, so an answer is
 * handled the same way wherever it was written.
 *
 * Every button is one that works here: Listen only where the browser can
 * speak, Share only where the system share sheet exists (phones), Try again
 * only when the caller can actually re-ask. A button that does nothing is
 * worse than a missing one.
 */
export function AnswerActions({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { copied, copy } = useClipboard();
  const speech = useSpeech();
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );

  return (
    <div className="ui-loki-turn-actions">
      <button
        type="button"
        className="ui-loki-turn-action"
        onClick={() => copy(text)}
        aria-label={copied ? "Copied" : "Copy answer"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-status-positive" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="max-sm:sr-only">{copied ? "Copied" : "Copy"}</span>
      </button>
      {speech.supported && (
        <button
          type="button"
          className="ui-loki-turn-action"
          onClick={() => speech.toggle(text)}
          aria-label={speech.speaking ? "Stop reading" : "Read aloud"}
          aria-pressed={speech.speaking}
        >
          {speech.speaking ? (
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          ) : (
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="max-sm:sr-only">{speech.speaking ? "Stop" : "Listen"}</span>
        </button>
      )}
      {canShare && (
        <button
          type="button"
          className="ui-loki-turn-action"
          // A dismissed share sheet rejects; that is the person changing their
          // mind, not an error to report.
          onClick={() => void navigator.share({ text }).catch(() => {})}
          aria-label="Share answer"
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden />
          <span className="max-sm:sr-only">Share</span>
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          className="ui-loki-turn-action"
          onClick={onRetry}
          aria-label="Ask again"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span className="max-sm:sr-only">Try again</span>
        </button>
      )}
    </div>
  );
}
