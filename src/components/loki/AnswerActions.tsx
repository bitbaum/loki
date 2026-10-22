"use client";

import { useState } from "react";
import { ThumbsDown } from "lucide-react";
import { AnswerActions as ChatkitAnswerActions } from "@bitbaum/chatkit/react";
import type { Speaker } from "@bitbaum/chatkit";
import { NO_SCREEN_DEFAULT_VOICE } from "@/config/no-screen";
import { createServerSpeaker, createSynthSpeaker } from "@/lib/voice/speaker";
import { ReportAnswer } from "./ReportAnswer";

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
 * The row under an answer — Copy, Listen, Share, Try again — chatkit's, the
 * same in every product, shared by Loki's own chat and the Claude Code
 * conversation on /terminal. Listen reads in the studio voice. Thumbs-down
 * shows only where the caller passes `report` (Loki's own answers): it files
 * a feedback report, and a Claude Code answer on /terminal is not Loki's to
 * be judged in Loki's inbox.
 */
export function AnswerActions({
  text,
  onRetry,
  report,
}: {
  text: string;
  onRetry?: () => void;
  /** Offer thumbs-down; `question` is what the answer was answering. */
  report?: { question: string | null };
}) {
  const [reporting, setReporting] = useState(false);
  const [speaker] = useState(makeStudioSpeaker);

  return (
    <>
      <ChatkitAnswerActions text={text} onRetry={onRetry} speaker={speaker}>
        {report && (
          <button
            type="button"
            className="ck-action"
            onClick={() => setReporting((v) => !v)}
            aria-label="Bad answer — file feedback"
            aria-expanded={reporting}
            aria-pressed={reporting}
          >
            <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
            <span>Bad answer</span>
          </button>
        )}
      </ChatkitAnswerActions>
      {report && reporting && (
        <ReportAnswer
          answer={text}
          question={report.question}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
