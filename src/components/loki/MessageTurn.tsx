"use client";

import { Check, Copy, RotateCcw } from "lucide-react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { useClipboard } from "@/hooks/use-clipboard";
import { ProvenanceFooter } from "./ProvenanceFooter";
import {
  DispatchFooter,
  NeedsProjectPicker,
  QueuedActionFooter,
  citationsFrom,
  KIND_LABEL,
} from "./footers";
import type { LokiMessage } from "./types";

/**
 * One turn in the thread.
 *
 * The asymmetry is deliberate and is what every serious chat surface converged
 * on: the operator's own words get a pill, because they are a short aside they
 * already know the content of; the answer gets the full column and no
 * container, because it is the thing being READ. Boxing both sides equally
 * makes a long answer look like a quotation of itself.
 *
 * Actions sit under the answer and stay quiet until the turn is hovered or
 * focused. Copy is unconditional — the single most common thing anyone does
 * with an answer, and until now the only way to get one out of Loki was to
 * select it by hand.
 */
export function MessageTurn({
  message,
  onPickProject,
  onAnswerAnyway,
  onRetry,
}: {
  message: LokiMessage;
  onPickProject?: (project: string, pendingText: string) => void;
  onAnswerAnyway?: (pendingText: string) => void;
  /** Only passed for the last assistant turn — retrying an older one would
   *  fork the thread, which this transcript has no way to represent. */
  onRetry?: () => void;
}) {
  const { copied, copy } = useClipboard();

  if (message.role === "user") {
    return (
      <div className="ui-loki-turn-user">
        <div className="ui-loki-bubble ui-loki-bubble-user">{message.content}</div>
      </div>
    );
  }

  // "chat" is the ordinary case and needs no label — naming it just adds a word
  // above every answer. Dispatch and command are genuinely different things
  // happening and do.
  const kind = message.kind && message.kind !== "chat" ? KIND_LABEL[message.kind] : null;

  return (
    <div className="ui-loki-turn group/turn">
      {kind && <span className="ui-loki-kind">{kind}</span>}

      <div className="ui-loki-answer">
        <MarkdownText
          text={message.content}
          className="space-y-2"
          citations={citationsFrom(message.meta)}
        />
      </div>

      {message.kind === "command" && onPickProject && (
        <NeedsProjectPicker
          meta={message.meta}
          onPick={onPickProject}
          onAnswerAnyway={onAnswerAnyway}
        />
      )}
      {message.kind === "dispatch" && <DispatchFooter meta={message.meta} />}
      {message.kind === "chat" && <ProvenanceFooter meta={message.meta} />}
      {message.kind === "chat" && <QueuedActionFooter meta={message.meta} />}

      <div className="ui-loki-turn-actions">
        <button
          type="button"
          className="ui-loki-turn-action"
          onClick={() => copy(message.content)}
          aria-label={copied ? "Copied" : "Copy answer"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-status-positive" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="max-sm:sr-only">{copied ? "Copied" : "Copy"}</span>
        </button>
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
    </div>
  );
}
