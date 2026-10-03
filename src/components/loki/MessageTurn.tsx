"use client";

import { MarkdownText } from "@/components/ui/markdown-text";
import { readWork } from "@/lib/loki/work";
import { AnswerActions } from "./AnswerActions";
import { ProvenanceFooter } from "./ProvenanceFooter";
import { WorkTrail } from "./WorkTrail";
import {
  DispatchFooter,
  NeedsProjectPicker,
  QueuedActionFooter,
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
  onRetry,
  question = null,
}: {
  message: LokiMessage;
  /** The user message this answer replies to — carried into a thumbs-down
   *  report so it reads on its own in the feedback inbox. */
  question?: string | null;
  onPickProject?: (project: string, pendingText: string) => void;
  onAnswerAnyway?: (pendingText: string) => void;
  /** Only passed for the last assistant turn — retrying an older one would
   *  fork the thread, which this transcript has no way to represent. */
  onRetry?: () => void;
}) {
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

  // What the turn did, above what it said — collapsed, the way it was live
  // once the answer landed. Reopening a thread used to show an answer that
  // had apparently cost nothing.
  const work = readWork(message.meta);

  return (
    <div className="ui-loki-turn group/turn">
      {kind && <span className="ui-loki-kind">{kind}</span>}

      {work.length > 0 && <WorkTrail work={work} live={false} />}

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
      {message.kind === "chat" && onPickProject && (
        <RunOnProjectOffer meta={message.meta} onPick={onPickProject} />
      )}

      <AnswerActions text={message.content} onRetry={onRetry} report={{ question }} />
    </div>
  );
}
