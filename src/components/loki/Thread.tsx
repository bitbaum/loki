"use client";

import { Fragment, type ReactNode } from "react";
import { ArrowDown, Loader2, Square } from "lucide-react";
import {
  ChatReplies,
  DEFAULT_THREAD_LABELS,
  ThinkingRow,
  useStickToBottom,
} from "@bitbaum/chatkit/react";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { readReplies } from "@/lib/loki/replies";
import { projectSwitches } from "@/lib/loki/project-switches";
import type { LiveTurn } from "@/hooks/use-loki-stream";
import { useLiveStatus } from "@/hooks/use-live-status";
import { FollowUps } from "./FollowUps";
import { MessageTurn } from "./MessageTurn";
import { WorkTrail } from "./WorkTrail";
import type { LokiMessage } from "./types";

/**
 * The conversation.
 *
 * Two behaviours here are the difference between a chat that reads well and one
 * that fights you, and the old surface had neither:
 *
 * 1. **Autoscroll only while you are at the bottom.** The previous transcript
 *    called `scrollIntoView` on every message change unconditionally. Scroll up
 *    to re-read something during a long answer and it hauled you back down.
 * 2. **A way back down.** Once you have scrolled away, following again is a
 *    button, not a guess.
 */
export function Thread({
  messages,
  live,
  loading,
  sending,
  stopped,
  onStop,
  onPickProject,
  onContinue,
  onAnswerAnyway,
  onAnswerFree,
  onRetry,
  onFollowUp,
  tail,
}: {
  messages: LokiMessage[];
  /** The turn in flight, or null. */
  live: LiveTurn | null;
  loading: boolean;
  sending: boolean;
  /** The operator stopped the last turn themselves. */
  stopped: boolean;
  onStop: () => void;
  onPickProject?: (project: string, pendingText: string) => void;
  /** A finished run's next step was tapped: send it, on that project. */
  onContinue?: (text: string, project: string) => void;
  onAnswerAnyway?: (pendingText: string) => void;
  /** Under a turn the person's own model failed: the free chain, same words. */
  onAnswerFree?: (pendingText: string) => void;
  onRetry?: () => void;
  /** Send a suggested follow-up as the next message. Omit to show none. */
  onFollowUp?: (text: string) => void;
  /** Rendered after the last turn, inside the scroll (e.g. "save to project"). */
  tail?: ReactNode;
}) {
  // chatkit's follow-the-bottom: pinned while the reader is at the bottom,
  // through new tokens AND size changes (the floating composer growing, its
  // height measured after the first paint), re-armed by every new turn.
  const { scrollRef, endRef, following, onScroll, jumpToBottom } = useStickToBottom(
    [messages.length, live?.preview, live?.work.length, live?.steps.length, sending],
    messages.length,
  );
  // "12s · Working on it" — the clock matters: without it forty seconds and
  // four minutes read as the same three dots (hooks/use-live-status).
  const liveStatus = useLiveStatus(live);

  if (loading) {
    return (
      <div className="ui-loki-thread-loading" role="status">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading conversation
      </div>
    );
  }

  if (messages.length === 0 && !sending && !stopped) return null;

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastMessage = messages[messages.length - 1];
  // Suggestions only follow an ordinary answer that ends the thread — never a
  // dispatch receipt or a "which project?" question, which have their own
  // next step, and never while the next turn is already on its way.
  const lastQuestion =
    lastMessage === lastAssistant
      ? [...messages].reverse().find((m) => m.role === "user")?.content
      : undefined;
  const showFollowUps =
    !!onFollowUp &&
    !live &&
    !sending &&
    !!lastAssistant &&
    lastMessage === lastAssistant &&
    (lastAssistant.kind ?? "chat") === "chat" &&
    !!lastQuestion;
  // The answer's own suggested replies (asked for in the same turn — see
  // REPLIES_INSTRUCTION) win. The separate follow-ups call is the fallback for
  // an answer that came without them: an older turn, or a brain that ignored
  // the instruction. Never both — two rows of "what next" is a menu.
  const replies = showFollowUps ? readReplies(lastAssistant.meta) : [];
  // Where this one chat moved to another project (lib/loki/project-switches).
  const switches = projectSwitches(messages);

  return (
    <div className="ui-loki-thread-wrap">
      <div ref={scrollRef} className="ui-loki-thread" onScroll={onScroll}>
        {/* `mt-auto` keeps a short conversation sitting on the composer instead
            of stranding it at the top of the pane; it is inert once the content
            is tall enough to scroll. */}
        <div className="ui-loki-thread-inner">
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {switches.has(i) && (
                <div className="ui-loki-project-switch" role="separator">
                  <span>Now on {switches.get(i)}</span>
                </div>
              )}
              <MessageTurn
                message={m}
                question={
                  m.role === "assistant"
                    ? (messages
                        .slice(0, i)
                        .reverse()
                        .find((p) => p.role === "user")?.content ?? null)
                    : null
                }
                onReply={!live && !sending && m.id === lastAssistant?.id ? onFollowUp : undefined}
                onPickProject={onPickProject}
                onContinue={onContinue}
                onAnswerAnyway={onAnswerAnyway}
                onAnswerFree={onAnswerFree}
                onRetry={onRetry && m.id === lastAssistant?.id ? onRetry : undefined}
              />
            </Fragment>
          ))}

          {live && (
            <div className="ui-loki-turn">
              <WorkTrail work={live.work} live />
              {/* chatkit's "Thinking" row, open while the turn runs: the clock
                  and what it is doing now in the title, every step it named
                  under it, the newest marked. It stays above the answer as
                  the words arrive, then closes into "Thought for 42s ›". */}
              <ThinkingRow
                thinking={{ steps: live.steps }}
                live
                labels={liveStatus ? { ...DEFAULT_THREAD_LABELS, thinking: liveStatus } : undefined}
              />
              {live.preview && (
                <div className="ui-loki-answer">
                  <AnswerMarkdown text={live.preview} />
                </div>
              )}
              <button type="button" className="ui-loki-stop" onClick={onStop}>
                <Square className="h-3 w-3 fill-current" aria-hidden />
                Stop
              </button>
            </div>
          )}

          {/* A turn that produced nothing because the operator stopped it is
              said plainly. The preview is NOT kept: this server persists a turn
              only when it finishes, so keeping it would leave text on screen
              that vanishes on the next reload. */}
          {stopped && !live && (
            <p className="ui-loki-stopped" role="status">
              Stopped. Nothing was saved — send it again to retry.
            </p>
          )}

          {showFollowUps && replies.length > 0 && (
            <ChatReplies replies={replies} onPick={onFollowUp} />
          )}

          {showFollowUps && replies.length === 0 && (
            <FollowUps
              answerId={lastAssistant.id}
              question={lastQuestion}
              answer={lastAssistant.content}
              onPick={onFollowUp}
            />
          )}

          {!live && tail}

          <div ref={endRef} />
        </div>
      </div>

      {!following && (
        <button
          type="button"
          className="ui-loki-jump"
          onClick={jumpToBottom}
          aria-label="Jump to the latest message"
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
