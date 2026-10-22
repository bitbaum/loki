"use client";

import { ThinkingRow } from "@bitbaum/chatkit/react";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { userMessageDisplay } from "@/lib/loki/message-display";
import { readWork } from "@/lib/loki/work";
import { readProgressUpdate } from "@/lib/loki/progress-update";
import { ProgressUpdateCard } from "./ProgressUpdateCard";
import { MessageImages } from "./MessageImages";
import { readMessageImages } from "@/lib/loki/message-images";
import { AnswerActions } from "./AnswerActions";
import { ProvenanceFooter } from "./ProvenanceFooter";
import { WorkTrail } from "./WorkTrail";
import { QueuedActionCard } from "./QueuedActionCard";
import {
  DispatchFooter,
  NeedsProjectPicker,
  OwnModelFallbackOffer,
  RunOnProjectOffer,
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
 * Actions sit under the answer (AnswerActions) and stay quiet until the turn
 * is hovered or focused; on a touch screen they are always there.
 */
export function MessageTurn({
  message,
  onPickProject,
  onAnswerAnyway,
  onAnswerFree,
  onRetry,
  onReply,
  onContinue,
  conversationId = null,
}: {
  message: LokiMessage;
  /** The thread this turn is in: with it, an answer carries the thumbs
   *  (AnswerActions), kept with the conversation for the nightly review. */
  conversationId?: string | null;
  onPickProject?: (project: string, pendingText: string) => void;
  onAnswerAnyway?: (pendingText: string) => void;
  /** Under a turn the person's own model failed: the free chain, same words. */
  onAnswerFree?: (pendingText: string) => void;
  /** Only passed for the last assistant turn — retrying an older one would
   *  fork the thread, which this transcript has no way to represent. */
  onRetry?: () => void;
  onReply?: (text: string) => void;
  /** Under a finished dispatch: one of its next steps, sent on its project. */
  onContinue?: (text: string, project: string) => void;
}) {
  if (message.role === "user") {
    const images = readMessageImages(message.meta);
    const displayed = userMessageDisplay(message.content, message.meta);
    return (
      <div className="ui-loki-turn-user">
        <div className="ui-loki-turn-user-stack">
          <MessageImages images={images} />
          {message.content.trim() && (
            <div className="ui-loki-bubble ui-loki-bubble-user">{displayed}</div>
          )}
          {displayed !== message.content && (
            <details className="max-w-full text-xs text-text-secondary">
              <summary className="ui-tap cursor-pointer">Request details</summary>
              <div className="whitespace-pre-wrap break-words pt-2">{message.content}</div>
            </details>
          )}
        </div>
      </div>
    );
  }

  // "chat" is the ordinary case and needs no label — naming it just adds a word
  // above every answer. Dispatch and command are genuinely different things
  // happening and do.
  const kind = message.kind && message.kind !== "chat" ? KIND_LABEL[message.kind] : null;

  // What the turn did, above what it said — collapsed, the way it was live
  // once the answer landed. Reopening a thread used to show an answer that
  // had apparently cost nothing.
  const work = readWork(message.meta);

  // An update Loki posted when work moved (a PR opened, a fix went live):
  // the structured card, not its plain-text twin in `content`.
  const update = readProgressUpdate(message.meta);

  return (
    <div className="ui-loki-turn group/turn">
      {kind && <span className="ui-loki-kind">{kind}</span>}

      {work.length > 0 && <WorkTrail work={work} live={false} />}

      {/* "Thought for 42s ›" — the turn this session watched, closed, with
          the steps it named under it. Not stored: a reopened thread has the
          work trail above instead, so the row never appears twice. */}
      {message.thinking && <ThinkingRow thinking={message.thinking} />}

      {update ? (
        <ProgressUpdateCard update={update} />
      ) : (
        <div className="ui-loki-answer">
          <AnswerMarkdown
            text={message.content}
            citations={citationsFrom(message.meta)}
            onReply={onReply}
          />
        </div>
      )}

      {message.kind === "command" && onPickProject && (
        <NeedsProjectPicker
          meta={message.meta}
          onPick={onPickProject}
          onAnswerAnyway={onAnswerAnyway}
        />
      )}
      {message.kind === "dispatch" && (
        <DispatchFooter meta={message.meta} onContinue={onContinue} />
      )}
      {message.kind === "chat" && <ProvenanceFooter meta={message.meta} />}
      {message.kind === "chat" && <QueuedActionCard meta={message.meta} />}
      {message.kind === "chat" && onPickProject && (
        <RunOnProjectOffer meta={message.meta} onPick={onPickProject} />
      )}
      {message.kind === "chat" && onAnswerFree && (
        <OwnModelFallbackOffer meta={message.meta} onAnswerFree={onAnswerFree} />
      )}

      <AnswerActions
        text={message.content}
        onRetry={onRetry}
        feedback={conversationId ? { conversationId, messageId: message.id } : undefined}
      />
    </div>
  );
}
