"use client";

import { useState } from "react";
import { AnswerActions as ChatkitAnswerActions } from "@bitbaum/chatkit/react";
import type { Speaker } from "@bitbaum/chatkit";
import { NO_SCREEN_DEFAULT_VOICE } from "@/config/no-screen";
import { createServerSpeaker, createSynthSpeaker } from "@/lib/voice/speaker";
import { postChatFeedback } from "@/lib/loki/post-chat-feedback";

/**
 * The studio voice for Listen, made on the first tap: the audio context must
 * be created inside a tap or a phone keeps it muted, and chatkit calls
 * `speak` from the button itself. Falls back to the phone's own voice the
 * way every other reading here does (lib/voice/speaker).
 */
function makeStudioSpeaker(): Speaker {
  let inner: Speaker | null = null;
  return {
    speak(text) {
      if (!inner) {
        const synth = createSynthSpeaker();
        try {
          const ctx = new AudioContext();
          inner = createServerSpeaker({
            voice: NO_SCREEN_DEFAULT_VOICE,
            ctx,
            out: ctx.destination,
            fallback: synth,
          });
        } catch {
          inner = synth;
        }
      }
      return inner.speak(text);
    },
    cancel() {
      inner?.cancel();
    },
  };
}

/**
 * The row under an answer — Copy, Listen, Share, Try again, and the thumbs —
 * chatkit's, the same in every product, shared by Loki's own chat and the
 * Claude Code conversation on /terminal. Listen reads in the studio voice.
 * The thumbs show only where the caller passes `feedback` (Loki's own
 * answers, by conversation and message): a thumb goes to /api/chat/feedback
 * and a thumb down is also filed as a report in Loki's inbox. A Claude Code
 * answer on /terminal is not Loki's to be judged in Loki's inbox.
 */
export function AnswerActions({
  text,
  onRetry,
  feedback,
}: {
  text: string;
  onRetry?: () => void;
  /** Offer the thumbs; where the answer lives, so the thumb is kept with it. */
  feedback?: { conversationId: string; messageId: string };
}) {
  const [speaker] = useState(makeStudioSpeaker);

  return (
    <ChatkitAnswerActions
      text={text}
      onRetry={onRetry}
      speaker={speaker}
      messageId={feedback?.messageId}
      onFeedback={feedback ? (f) => postChatFeedback(feedback.conversationId, f) : undefined}
    />
  );
}
