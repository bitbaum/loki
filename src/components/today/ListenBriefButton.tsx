"use client";

import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { getJson } from "@/lib/api/fetch";
import { composeBriefing, type FleetSnapshot } from "@/lib/voice/briefing";
import { createServerSpeaker, createSynthSpeaker, type Speaker } from "@/lib/voice/speaker";
import { NO_SCREEN_DEFAULT_VOICE } from "@/config/no-screen";

type Phase = "idle" | "loading" | "playing";

/**
 * "Listen to the brief": the fleet read aloud, for a morning with the phone
 * in one hand and a coffee in the other. The words are no-screen mode's
 * (lib/voice/briefing) minus its spoken commands, and the voice is the same
 * studio voice with the phone's own as the fallback (lib/voice/speaker) — so
 * a box without a voice key still speaks, just less well.
 *
 * Last night's note, when the server passed one, is read first: it is the
 * news the person was asleep for.
 */
export function ListenBriefButton({ nightNote }: { nightNote?: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const speakerRef = useRef<Speaker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const stop = () => {
    speakerRef.current?.cancel();
    speakerRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setPhase("idle");
  };

  // Leaving the page ends the reading; refs only, so no state is set after unmount.
  useEffect(
    () => () => {
      speakerRef.current?.cancel();
      void ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  const listen = async () => {
    if (phase !== "idle") return stop();
    setPhase("loading");
    // The audio context must be made inside the tap, or a phone keeps it muted.
    const synth = createSynthSpeaker();
    let speaker: Speaker = synth;
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      speaker = createServerSpeaker({
        voice: NO_SCREEN_DEFAULT_VOICE,
        ctx,
        out: ctx.destination,
        fallback: synth,
      });
    } catch {
      /* no Web Audio: the phone's own voice reads it */
    }
    speakerRef.current = speaker;

    let text: string;
    try {
      const snapshot = await getJson<FleetSnapshot>("/api/voice/snapshot");
      text = composeBriefing(snapshot, { hints: false });
    } catch {
      text = "I couldn't reach the fleet just now. Pull down to refresh and try again.";
    }
    const night = nightNote ? `${nightNote.replace(/\s·\s/g, ", ")} ` : "";
    if (speakerRef.current !== speaker) return; // stopped while loading
    setPhase("playing");
    await speaker.speak(`${night}${text}`);
    if (speakerRef.current === speaker) stop();
  };

  const label =
    phase === "playing"
      ? "Stop"
      : phase === "loading"
        ? "Getting the brief…"
        : "Listen to the brief";
  return (
    <button
      type="button"
      className="ui-btn-secondary min-h-11"
      onClick={() => void listen()}
      aria-pressed={phase === "playing"}
    >
      {phase === "playing" ? (
        <Square className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
