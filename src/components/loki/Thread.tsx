"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Loader2, Square } from "lucide-react";
import { MarkdownText } from "@/components/ui/markdown-text";
import { LOKI_STATUS_COPY } from "@/lib/loki/stream";
import type { LiveTurn } from "@/hooks/use-loki-stream";
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
export function Thread({
  messages,
  live,
  loading,
  sending,
  stopped,
  onStop,
  onPickProject,
  onAnswerAnyway,
  onRetry,
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
  onRetry?: () => void;
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

  return (
    <div className="ui-loki-thread-wrap">
      <div ref={scrollRef} className="ui-loki-thread" onScroll={onScroll}>
        {/* `mt-auto` keeps a short conversation sitting on the composer instead
            of stranding it at the top of the pane; it is inert once the content
            is tall enough to scroll. */}
        <div className="ui-loki-thread-inner">
          {messages.map((m) => (
            <MessageTurn
              key={m.id}
              message={m}
              onPickProject={onPickProject}
              onAnswerAnyway={onAnswerAnyway}
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
