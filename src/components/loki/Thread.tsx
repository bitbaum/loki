"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Loader2, Square } from "lucide-react";
import { ChatReplies } from "@bitbaum/chatkit/react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { readReplies } from "@/lib/loki/replies";
import { LOKI_STATUS_COPY } from "@/lib/loki/stream";
import type { LiveTurn } from "@/hooks/use-loki-stream";
import { FollowUps } from "./FollowUps";
import { MessageTurn } from "./MessageTurn";
import { WorkTrail } from "./WorkTrail";
import type { LokiMessage } from "./types";

/**
 * How close to the bottom still counts as "following the conversation".
 * Above this, the operator is reading something older and the view must not be
 * yanked back every time a token arrives.
 */
const FOLLOW_THRESHOLD_PX = 120;

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
/** "2m 3s" since the turn was sent. A turn that has run for two minutes
 *  should say so: without the number, forty seconds and four minutes read as
 *  the same three dots, and the operator cannot tell patience from a hang. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span>{s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</span>;
}

export function Thread({
  messages,
  live,
  loading,
  sending,
  stopped,
  onStop,
  onPickProject,
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
  onAnswerAnyway?: (pendingText: string) => void;
  /** Under a turn the person's own model failed: the free chain, same words. */
  onAnswerFree?: (pendingText: string) => void;
  onRetry?: () => void;
  /** Send a suggested follow-up as the next message. Omit to show none. */
  onFollowUp?: (text: string) => void;
  /** Rendered after the last turn, inside the scroll (e.g. "save to project"). */
  tail?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setFollowing(distance < FOLLOW_THRESHOLD_PX);
  }, []);

  const jumpToBottom = useCallback(() => {
    setFollowing(true);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Layout effect so the view is pinned before the browser paints the new
  // token — in a passive effect the content lands first and the scroll catches
  // up, which reads as a shudder on every chunk.
  useLayoutEffect(() => {
    if (!following) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.preview, live?.work.length, live?.status, sending, following]);

  // A new turn always re-arms following: sending a message is an unambiguous
  // statement that you want to see the reply.
  const previousCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length > previousCount.current) setFollowing(true);
    previousCount.current = messages.length;
  }, [messages.length]);

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

  return (
    <div className="ui-loki-thread-wrap">
      <div ref={scrollRef} className="ui-loki-thread" onScroll={onScroll}>
        {/* `mt-auto` keeps a short conversation sitting on the composer instead
            of stranding it at the top of the pane; it is inert once the content
            is tall enough to scroll. */}
        <div className="ui-loki-thread-inner">
          {messages.map((m, i) => (
            <MessageTurn
              key={m.id}
              message={m}
              question={
                m.role === "assistant"
                  ? (messages
                      .slice(0, i)
                      .reverse()
                      .find((p) => p.role === "user")?.content ?? null)
                  : null
              }
              onPickProject={onPickProject}
              onAnswerAnyway={onAnswerAnyway}
              onAnswerFree={onAnswerFree}
              onRetry={onRetry && m.id === lastAssistant?.id ? onRetry : undefined}
            />
          ))}

          {live && (
            <div className="ui-loki-turn">
              <WorkTrail work={live.work} live />
              {live.preview ? (
                <div className="ui-loki-answer">
                  <MarkdownText text={live.preview} className="space-y-2" />
                </div>
              ) : (
                <p className="ui-loki-live-status" role="status" aria-live="polite">
                  <span className="ui-loki-live-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                  <Elapsed since={live.startedAt} />
                  <span aria-hidden>·</span>
                  {live.status ? LOKI_STATUS_COPY[live.status] : "Working on it"}
                </p>
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
