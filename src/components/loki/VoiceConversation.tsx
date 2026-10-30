"use client";

import { X } from "lucide-react";
import { Drawer } from "@/components/ui/modal";
import { LokiMark } from "@/components/shell/LokiMark";
import { BRAND_MARK } from "@/config/brand-mark";
import type { useVoiceConversation, VoicePhase } from "@/hooks/use-voice-conversation";
import { usePressVerb } from "@/hooks/use-press-verb";
import type { PressVerb } from "@/lib/pointer-verb";

/** Hints name the gesture, so they follow the device: tap on a phone, click
 *  on a computer (lib/pointer-verb). */
const PHASE_COPY: Record<VoicePhase, { label: string; hint: (p: PressVerb) => string }> = {
  off: { label: "", hint: () => "" },
  starting: { label: "Starting…", hint: () => "Allow the microphone if your browser asks." },
  listening: { label: "Listening", hint: (p) => `Talk, then pause. ${p.Verb} Loki to send now.` },
  transcribing: { label: "Got it", hint: () => "" },
  thinking: { label: "Thinking", hint: () => "" },
  speaking: { label: "", hint: (p) => `${p.Verb} Loki to interrupt.` },
  paused: {
    label: "Paused",
    hint: (p) => `Nothing heard for a while. ${p.Verb} Loki to talk again.`,
  },
};

/** The orb's look per phase: literal names, so the design check can see them. */
const ORB_CLASS: Record<VoicePhase, string> = {
  off: "ui-voice-orb",
  starting: "ui-voice-orb ui-voice-orb-busy",
  listening: "ui-voice-orb ui-voice-orb-listening",
  transcribing: "ui-voice-orb ui-voice-orb-busy",
  thinking: "ui-voice-orb ui-voice-orb-busy",
  speaking: "ui-voice-orb ui-voice-orb-speaking",
  paused: "ui-voice-orb",
};

/**
 * The hands-free conversation screen: Loki's disc, one line of whose turn
 * it is, the words in play, and one way out.
 *
 * The disc IS the state. It turns clockwise, which reads as pouring inward,
 * while it listens (your voice deepens the tunnel) and fast while it thinks;
 * it reverses and flows out toward you while it speaks. So there is no
 * microphone glyph that reads "recording" while Loki is the one talking. While it speaks, the
 * screen shows what it is saying (you can read along, or stop it); while it
 * thinks, what it heard. One exit at the bottom, where the thumb is: the
 * corner × duplicated it.
 *
 * Everything said lands in the open conversation as ordinary messages, so
 * ending leaves the full transcript behind.
 */
export function VoiceConversation({ voice }: { voice: ReturnType<typeof useVoiceConversation> }) {
  const { phase, level, heard, saying, error, tap: onTap, end: onEnd } = voice;
  const press = usePressVerb();
  // Closed, the only thing to say is why it closed: a microphone that could
  // not be opened, next to the button that tried.
  if (phase === "off") return error ? <p className="ui-error px-1">{error}</p> : null;
  const phaseCopy = PHASE_COPY[phase];
  const copy = { label: phaseCopy.label, hint: phaseCopy.hint(press) };
  const busy = phase === "starting" || phase === "transcribing" || phase === "thinking";
  const words = phase === "speaking" ? saying : busy && heard ? `“${heard}”` : "";
  return (
    <Drawer onClose={onEnd} size="2xl" surface="background">
      <div className="ui-voice">
        <div className="ui-voice-stage">
          <button
            type="button"
            className={ORB_CLASS[phase]}
            onClick={onTap}
            disabled={busy}
            aria-label={copy.hint || copy.label || "Loki is speaking"}
            // Swells with the voice while listening — proof the microphone
            // hears you, without a waveform to read.
            style={{ transform: `scale(${phase === "listening" ? 1 + level * 0.25 : 1})` }}
          >
            <LokiMark
              turns="hero"
              className="ui-voice-spiral"
              // Loudness sets how deep the tunnel goes: the drift grows with
              // your voice, quantised so a level stream does not redraw the
              // path on every sample.
              depth={
                phase === "listening"
                  ? BRAND_MARK.depth * (0.6 + Math.round(level * 20) / 20)
                  : undefined
              }
            />
          </button>
          {copy.label && (
            <p className="ui-voice-label" role="status" aria-live="polite">
              {copy.label}
            </p>
          )}
          {words && (
            <p className={phase === "speaking" ? "ui-voice-saying" : "ui-voice-heard"}>{words}</p>
          )}
          {copy.hint && <p className="ui-voice-hint">{copy.hint}</p>}
          {error && <p className="ui-error text-center">{error}</p>}
        </div>

        <div className="ui-voice-bottom">
          <button
            type="button"
            className="ui-voice-end"
            onClick={onEnd}
            aria-label="End voice chat"
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
      </div>
    </Drawer>
  );
}
