"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Loader2, Mic } from "lucide-react";
import { NO_SCREEN_COMMANDS, NO_SCREEN_POLL_MS } from "@/config/no-screen";
import { useVoiceConversation, type VoicePhase } from "@/hooks/use-voice-conversation";
import { useMediaSession } from "@/hooks/use-media-session";
import { useImmersiveChat } from "@/hooks/use-immersive-chat";
import { getJson, postJson } from "@/lib/api/fetch";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { composeBriefing, diffSnapshots, type FleetSnapshot } from "@/lib/voice/briefing";
import type { VoiceTurnResult } from "@/lib/voice/turn";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<VoicePhase, string> = {
  off: "Off",
  starting: "Starting",
  listening: "Listening",
  transcribing: "Got it",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "Paused",
};

const OPENING = "Loki here. Reading your fleet.";
const HISTORY_MAX = 8;

type Turn = { role: "user" | "assistant"; content: string };

/**
 * No-screen mode: the fleet in your ear, your voice as the only control.
 *
 * One tap starts it. From then on the loop is listen → send → speak → listen,
 * and between turns the phone polls the fleet and reads out what changed.
 * The screen shows the phase in large type and the last two lines, for the
 * glance the person takes before they stop looking — nothing on it is needed
 * to run the fleet.
 *
 * The three commands that are about the conversation itself (quiet, say that
 * again, end) are answered here without a round trip; everything else is one
 * POST to /api/voice/turn, whose answer is read aloud.
 */
export function NoScreenMode() {
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<{ id: string; text: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastSaid, setLastSaid] = useState("");
  const snapshotRef = useRef<FleetSnapshot | null>(null);
  const historyRef = useRef<Turn[]>([]);
  const lastSaidRef = useRef("");
  const sayRef = useRef<(text: string) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const said = (text: string) => {
    lastSaidRef.current = text;
    setLastSaid(text);
  };

  /** Take a snapshot as the new baseline; announce what differs from the old one. */
  const absorb = useCallback((next: FleetSnapshot) => {
    const prev = snapshotRef.current;
    snapshotRef.current = next;
    if (!prev) return;
    for (const line of diffSnapshots(prev, next)) {
      sayRef.current(line);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const projects = snapshotRef.current?.projects ?? [];
      const cmd = parseVoiceCommand(text, projects);
      setFailed(false);
      if (cmd.kind === "quiet") {
        setAnswer({ id: crypto.randomUUID(), text: "" });
        return;
      }
      if (cmd.kind === "repeat") {
        setAnswer({
          id: crypto.randomUUID(),
          text: lastSaidRef.current || "I haven't said anything yet.",
        });
        return;
      }
      if (cmd.kind === "end") {
        // The microphone closes first, then the farewell: it is the one line
        // spoken outside the loop, because the loop is what is ending.
        stopRef.current();
        if ("speechSynthesis" in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance("Ending no-screen mode. Bye."));
        }
        return;
      }
      try {
        const res = await postJson("/api/voice/turn", { text, history: historyRef.current });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const result = (await res.json()) as VoiceTurnResult;
        if (result.kind === "ask") {
          const next: Turn[] = [
            ...historyRef.current,
            { role: "user", content: text },
            { role: "assistant", content: result.say },
          ];
          historyRef.current = next.slice(-HISTORY_MAX);
        }
        said(result.say);
        setAnswer({ id: crypto.randomUUID(), text: result.say });
        absorb(result.snapshot);
      } catch (err) {
        const why = err instanceof Error ? err.message : "unknown error";
        const text = `That didn't go through: ${why}. Say it again.`;
        said(text);
        setAnswer({ id: crypto.randomUUID(), text });
      }
    },
    [absorb],
  );

  const voice = useVoiceConversation({
    onUtterance: (text) => void send(text),
    latestAnswer: answer,
    turnFailed: failed,
    idle: "listen",
  });
  useEffect(() => {
    sayRef.current = voice.say;
  }, [voice.say]);

  const media = useMediaSession({
    title: "Loki — no-screen mode",
    phase: PHASE_LABEL[voice.phase],
    onToggle: voice.tap,
    onNext: () => {
      const s = snapshotRef.current;
      if (s) sayRef.current(composeBriefing(s));
    },
  });

  const stop = useCallback(() => {
    voice.end();
    media.disarm();
    setOn(false);
  }, [voice, media]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = () => {
    media.arm();
    setOn(true);
    void voice.start(OPENING);
    getJson<FleetSnapshot>("/api/voice/snapshot")
      .then((s) => {
        snapshotRef.current = s;
        const briefing = composeBriefing(s);
        said(briefing);
        sayRef.current(briefing);
      })
      .catch(() => sayRef.current("I couldn't read the fleet. Say status to try again."));
  };

  // Between turns: what changed, read aloud.
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => {
      getJson<FleetSnapshot>("/api/voice/snapshot")
        .then(absorb)
        .catch(() => {});
    }, NO_SCREEN_POLL_MS);
    return () => window.clearInterval(t);
  }, [on, absorb]);

  // A phone gives the whole screen to the one circle.
  useImmersiveChat(on);

  if (!on) {
    return (
      <div className="ui-voice-start">
        <Headphones className="h-10 w-10 text-text-tertiary" aria-hidden />
        <h1 className="ui-page-title">No-screen mode</h1>
        <p className="ui-page-subtitle max-w-sm">
          Put the headphones in, press Start, and put the phone away. Loki reads your fleet aloud,
          listens for what you say, and tells you when something finishes or needs you.
        </p>
        {voice.error && <p className="ui-error text-center">{voice.error}</p>}
        <button type="button" className="ui-voice-start-btn" onClick={start}>
          <Mic className="h-6 w-6" aria-hidden />
          Start
        </button>
        <ul className="ui-voice-commands" aria-label="What you can say">
          {NO_SCREEN_COMMANDS.map((c) => (
            <li key={c.kind} className="ui-voice-command">
              <span className="ui-voice-command-say">“{c.say[0]}”</span>
              <span className="ui-voice-command-does">{c.does}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const busy =
    voice.phase === "starting" || voice.phase === "transcribing" || voice.phase === "thinking";
  return (
    <div className="ui-voice">
      <div className="ui-voice-stage">
        <button
          type="button"
          className={cn("ui-voice-orb", `ui-voice-orb-${voice.phase}`)}
          onClick={voice.tap}
          disabled={busy}
          aria-label={voice.phase === "listening" ? "Send what you said now" : "Interrupt and talk"}
          style={{
            transform: `scale(${voice.phase === "listening" ? 1 + voice.level * 0.25 : 1})`,
          }}
        >
          {busy ? (
            <Loader2 className="ui-spinner h-8 w-8" aria-hidden />
          ) : (
            <Mic className="h-8 w-8" aria-hidden />
          )}
        </button>
        <p className="ui-voice-label ui-voice-label-lg" role="status" aria-live="polite">
          {PHASE_LABEL[voice.phase]}
        </p>
        {voice.heard && <p className="ui-voice-heard">“{voice.heard}”</p>}
        {lastSaid && <p className="ui-voice-said">{lastSaid}</p>}
        {voice.error && <p className="ui-error text-center">{voice.error}</p>}
      </div>
      <div className="ui-voice-bottom">
        <button type="button" className="ui-btn-secondary" onClick={stop}>
          End
        </button>
      </div>
    </div>
  );
}
