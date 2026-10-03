"use client";

import { Loader2, Mic, X } from "lucide-react";
import { Drawer } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { useVoiceConversation, VoicePhase } from "@/hooks/use-voice-conversation";

const PHASE_COPY: Record<VoicePhase, { label: string; hint: string }> = {
  off: { label: "", hint: "" },
  starting: { label: "Starting…", hint: "Allow the microphone if your browser asks." },
  listening: { label: "Listening", hint: "Talk, then pause. Tap the circle to send now." },
  transcribing: { label: "Got it", hint: "Writing down what you said…" },
  thinking: { label: "Thinking", hint: "" },
  speaking: { label: "Speaking", hint: "Tap the circle to interrupt and reply." },
  paused: { label: "Paused", hint: "Nothing heard for a while. Tap the circle to talk again." },
};

/**
 * The hands-free conversation screen: one circle that shows whose turn it is
 * (it breathes with your voice while listening), what was last heard, and one
 * way out. Everything said here lands in the open conversation as ordinary
 * messages, so closing this screen leaves the full transcript behind it.
 */
export function VoiceConversation({ voice }: { voice: ReturnType<typeof useVoiceConversation> }) {
  const { phase, level, heard, error, tap: onTap, end: onEnd } = voice;
  // Closed, the only thing to say is why it closed: a microphone that could
  // not be opened, next to the button that tried.
  if (phase === "off") return error ? <p className="ui-error px-1">{error}</p> : null;
  const copy = PHASE_COPY[phase];
  const busy = phase === "starting" || phase === "transcribing" || phase === "thinking";
  return (
    <Drawer onClose={onEnd} size="2xl" surface="background">
      <div className="ui-voice">
        <div className="ui-voice-top">
          <button
            type="button"
            className="ui-voice-end"
            onClick={onEnd}
            aria-label="End voice chat"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="ui-voice-stage">
          <button
            type="button"
            className={cn("ui-voice-orb", `ui-voice-orb-${phase}`)}
            onClick={onTap}
            disabled={busy}
            aria-label={copy.hint || copy.label}
            // The circle grows with the voice while listening — feedback that
            // the microphone hears you, without a waveform to read.
            style={{ transform: `scale(${phase === "listening" ? 1 + level * 0.25 : 1})` }}
          >
            {busy ? (
              <Loader2 className="ui-spinner h-8 w-8" aria-hidden />
            ) : (
              <Mic className="h-8 w-8" aria-hidden />
            )}
          </button>
          <p className="ui-voice-label" role="status" aria-live="polite">
            {copy.label}
          </p>
          {copy.hint && <p className="ui-voice-hint">{copy.hint}</p>}
          {heard && <p className="ui-voice-heard">“{heard}”</p>}
          {error && <p className="ui-error text-center">{error}</p>}
        </div>

        <div className="ui-voice-bottom">
          <button type="button" className="ui-btn-secondary" onClick={onEnd}>
            End
          </button>
        </div>
      </div>
    </Drawer>
  );
}
