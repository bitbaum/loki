"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import {
  NO_SCREEN_DIGEST_MS,
  NO_SCREEN_POLL_MS,
  NO_SCREEN_VOICES,
  type NoScreenVoice,
} from "@/config/no-screen";
import { useVoiceConversation, type VoicePhase } from "@/hooks/use-voice-conversation";
import { useMediaSession } from "@/hooks/use-media-session";
import { useSoundscape } from "@/hooks/use-soundscape";
import { useNoScreenSettings } from "@/hooks/use-no-screen-settings";
import { useImmersiveChat } from "@/hooks/use-immersive-chat";
import { useStudioVoiceStatus } from "@/hooks/use-studio-voice-status";
import { getJson, postJson } from "@/lib/api/fetch";
import { parseVoiceCommand } from "@/lib/voice/commands";
import { composeBriefing, diffSnapshots, type FleetSnapshot } from "@/lib/voice/briefing";
import {
  detailsFor,
  phraseChanges,
  phraseHeld,
  splitByMode,
  type FleetChange,
} from "@/lib/voice/announce";
import { createServerSpeaker, createSynthSpeaker, type Speaker } from "@/lib/voice/speaker";
import {
  composeVoiceList,
  composeVoiceSwitched,
  resolveVoiceChoice,
  type VoiceModeState,
} from "@/lib/voice/self";
import { studioVoiceOffSentence } from "@/lib/voice/tts-failure";
import type { VoiceTurnResult } from "@/lib/voice/turn";
import { cn } from "@/lib/utils";
import { NoScreenStart } from "@/components/voice/NoScreenStart";
import { StudioVoiceNotice } from "@/components/voice/StudioVoiceNotice";

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
/** Two failed polls in a row is a dropped line, not a slow one. */
const OFFLINE_AFTER_FAILURES = 2;
/** Said once per session, the first time the studio voice is refused. */
const STUDIO_OFF_SPOKEN =
  "Studio voices are off right now, so I'm reading with your phone's voice. The screen says how to turn them on.";

type Turn = { role: "user" | "assistant"; content: string };
type Armed = { ctx: AudioContext; speech: AudioNode };

/**
 * No-screen mode: the fleet in your ear, your voice as the only control.
 *
 * One tap starts it. From then on the loop is listen → send → speak → listen,
 * and between turns the phone polls the fleet and reads out what changed —
 * each announcement behind its earcon, coalesced and varied so an hour of
 * it does not grate (lib/voice/announce). A music bed the phone composes
 * itself fills the silence and ducks under the voice; the voice is a studio
 * one when the box has it, the phone's own when it does not — and then the
 * screen says why (StudioVoiceNotice), once aloud.
 *
 * The commands that are about the conversation itself (quiet, say that
 * again, end, details) and the voice ("use Troy") are answered here without
 * a round trip; everything else is one POST to /api/voice/turn, whose answer
 * is read aloud. A question goes with this screen's state, so Loki can answer
 * one about itself truthfully (lib/voice/self).
 */
export function NoScreenMode() {
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<{ id: string; text: string } | null>(null);
  const [lastSaid, setLastSaid] = useState("");
  const [line, setLine] = useState<"online" | "offline">("online");
  const [speaker, setSpeaker] = useState<Speaker | undefined>(undefined);
  const { settings, update } = useNoScreenSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const studio = useStudioVoiceStatus();
  const { report: reportStudioOff, clear: clearStudioOff } = studio;

  const snapshotRef = useRef<FleetSnapshot | null>(null);
  const historyRef = useRef<Turn[]>([]);
  const lastSaidRef = useRef("");
  const lastChangesRef = useRef<FleetChange[]>([]);
  const heldRef = useRef<FleetChange[]>([]);
  const variantRef = useRef(0);
  const failuresRef = useRef(0);
  const armedRef = useRef<Armed | null>(null);
  const sayRef = useRef<(text: string, cue?: () => void) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const sound = useSoundscape();

  const said = (text: string) => {
    lastSaidRef.current = text;
    setLastSaid(text);
  };
  const reply = (text: string) => {
    said(text);
    setAnswer({ id: crypto.randomUUID(), text });
  };

  /** Who reads in `voice`: the studio voice through the soundscape, or the phone's. */
  const makeSpeaker = useCallback(
    (voice: NoScreenVoice): Speaker => {
      const synth = createSynthSpeaker();
      const armed = armedRef.current;
      if (!armed || voice === "phone") return synth;
      return createServerSpeaker({
        voice,
        ctx: armed.ctx,
        out: armed.speech,
        fallback: synth,
        onUnavailable: (failure) => {
          if (reportStudioOff(failure)) sayRef.current(STUDIO_OFF_SPOKEN);
        },
        onAvailable: clearStudioOff,
      });
    },
    [reportStudioOff, clearStudioOff],
  );

  /** Read a batch of changes: earcon, then the sentence, in urgency order. */
  const announce = useCallback(
    (changes: FleetChange[]) => {
      if (changes.length === 0) return;
      lastChangesRef.current = changes;
      const { now, held } = splitByMode(changes, settingsRef.current.mode);
      heldRef.current = [...heldRef.current, ...held];
      for (const a of phraseChanges(now, variantRef.current++)) {
        sayRef.current(a.text, () => sound.earcon(a.earcon));
      }
    },
    [sound],
  );

  /** Take a snapshot as the new baseline; announce what differs from the old one. */
  const absorb = useCallback(
    (next: FleetSnapshot) => {
      const prev = snapshotRef.current;
      snapshotRef.current = next;
      if (prev) announce(diffSnapshots(prev, next));
    },
    [announce],
  );

  /** "Use Troy", "other voice", "change your voice": switched here, kept like the picker. */
  const changeVoice = (choice: Parameters<typeof resolveVoiceChoice>[0]) => {
    const current = settingsRef.current.voice;
    const next = resolveVoiceChoice(choice, current);
    if (!next) return reply(composeVoiceList(current));
    settingsRef.current = { ...settingsRef.current, voice: next };
    update({ voice: next });
    // The new speaker is in place before the answer is read, so the answer
    // is the first thing heard in the new voice.
    setSpeaker(makeSpeaker(next));
    const off = studio.failureRef.current;
    reply(composeVoiceSwitched(next, off && next !== "phone" ? studioVoiceOffSentence(off) : null));
  };

  const send = async (text: string) => {
    const projects = snapshotRef.current?.projects ?? [];
    const cmd = parseVoiceCommand(text, projects);
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
    if (cmd.kind === "details")
      return reply(detailsFor([...lastChangesRef.current, ...heldRef.current]));
    if (cmd.kind === "voice") return changeVoice(cmd.voice);
    if (cmd.kind === "end") {
      // The microphone closes first, then the farewell: it is the one line
      // spoken outside the loop, because the loop is what is ending.
      stopRef.current();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("Ending no-screen mode. Bye."));
      }
      return;
    }
    const s = settingsRef.current;
    const off = studio.failureRef.current;
    const mode: VoiceModeState = {
      voice: s.voice,
      music: s.music,
      bargeIn: s.bargeIn,
      mode: s.mode,
      studioOff: off && s.voice !== "phone" ? studioVoiceOffSentence(off) : null,
    };
    try {
      const res = await postJson("/api/voice/turn", { text, history: historyRef.current, mode });
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
      // A briefing already covers everything held for the digest.
      if (result.kind === "status") heldRef.current = [];
      reply(result.say);
      absorb(result.snapshot);
    } catch (err) {
      const why = err instanceof Error ? err.message : "unknown error";
      reply(`That didn't go through: ${why}. Say it again.`);
    }
  };
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const voice = useVoiceConversation({
    onUtterance: (text) => void sendRef.current(text),
    latestAnswer: answer,
    turnFailed: false,
    idle: "listen",
    speaker,
    bargeIn: settings.bargeIn,
  });
  useEffect(() => {
    sayRef.current = voice.say;
  }, [voice.say]);

  const media = useMediaSession({
    title: "Loki — no-screen mode",
    phase: PHASE_LABEL[voice.phase],
    onToggle: () => {
      sound.resume();
      voice.tap();
    },
    onNext: () => {
      const s = snapshotRef.current;
      if (s) sayRef.current(composeBriefing(s));
    },
  });

  const stop = useCallback(() => {
    voice.end();
    sound.stopMusic();
    media.disarm();
    setOn(false);
  }, [voice, sound, media]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = () => {
    // Everything that needs the tap happens here, before the first await:
    // the audio context starts (and resumes) inside it, and so does the
    // media element that carries the music.
    const armed = sound.arm();
    sound.resume();
    armedRef.current = armed ? { ctx: armed.ctx, speech: armed.speech } : null;
    media.arm(armed?.stream ?? null, sound.connectDirect);
    setSpeaker(makeSpeaker(settings.voice));
    if (settings.music) sound.startMusic();
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

  // The music steps back under the voice; "got it" gets its blip.
  useEffect(() => {
    sound.duck(voice.phase === "speaking");
    if (voice.phase === "transcribing") sound.earcon("heard");
  }, [voice.phase, sound]);

  // Between turns: what changed, read aloud. A line that drops is said once,
  // and once when it is back — the music keeps playing either way, which is
  // the point of it: silence must never be mistakable for a dead phone.
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => {
      getJson<FleetSnapshot>("/api/voice/snapshot")
        .then((s) => {
          if (failuresRef.current >= OFFLINE_AFTER_FAILURES) {
            setLine("online");
            sayRef.current("The connection is back.", () => sound.earcon("online"));
          }
          failuresRef.current = 0;
          absorb(s);
        })
        .catch(() => {
          failuresRef.current++;
          if (failuresRef.current === OFFLINE_AFTER_FAILURES) {
            setLine("offline");
            sayRef.current("I lost the connection to Loki. I'll keep trying.", () =>
              sound.earcon("offline"),
            );
          }
        });
    }, NO_SCREEN_POLL_MS);
    return () => window.clearInterval(t);
  }, [on, absorb, sound]);

  // In "important" mode, finished runs are read as one sentence every few minutes.
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => {
      const held = heldRef.current;
      if (held.length === 0) return;
      heldRef.current = [];
      lastChangesRef.current = held;
      const a = phraseHeld(held, variantRef.current++);
      if (a) sayRef.current(a.text, () => sound.earcon(a.earcon));
    }, NO_SCREEN_DIGEST_MS);
    return () => window.clearInterval(t);
  }, [on, sound]);

  // A phone gives the whole screen to the one circle.
  useImmersiveChat(on);

  const voiceLabel = useMemo(
    () => NO_SCREEN_VOICES.find((v) => v.id === settings.voice)?.label ?? settings.voice,
    [settings.voice],
  );

  if (!on) {
    return (
      <NoScreenStart
        settings={settings}
        update={update}
        studioOff={studio.failure}
        error={voice.error}
        onStart={start}
      />
    );
  }

  const busy =
    voice.phase === "starting" || voice.phase === "transcribing" || voice.phase === "thinking";
  return (
    // data-fc-place="tab": the feedback launcher's corner is where End is,
    // and its "Watching" pill sat on top of it (owner, 2026-10-20). Here it
    // is the slim handle on the side edge instead, still one tap away.
    <div className="ui-voice" data-fc-place="tab">
      <h1 className="ui-voice-title">Voice</h1>
      {/* Scrolls rather than pushing End off a short screen when the
          studio-voice notice is showing; centred only while it fits. */}
      <div className="ui-voice-stage ui-voice-stage-scroll">
        <button
          type="button"
          className={cn("ui-voice-orb", `ui-voice-orb-${voice.phase}`)}
          onClick={() => {
            // A tap is the one moment the phone lets a page wake its sound.
            sound.resume();
            voice.tap();
          }}
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
          {line === "offline" ? "Reconnecting" : PHASE_LABEL[voice.phase]}
        </p>
        <p className="ui-voice-hint">
          {studio.failure && settings.voice !== "phone" ? "Phone voice" : voiceLabel}
          {settings.music ? " · music on" : ""}
          {settings.bargeIn ? " · talk to interrupt" : " · press to interrupt"}
        </p>
        {voice.heard && <p className="ui-voice-heard">“{voice.heard}”</p>}
        {lastSaid && <p className="ui-voice-said">{lastSaid}</p>}
        {voice.error && <p className="ui-error text-center">{voice.error}</p>}
        {studio.failure && settings.voice !== "phone" && (
          <div className="mt-2 w-full max-w-sm">
            <StudioVoiceNotice failure={studio.failure} />
          </div>
        )}
      </div>
      <div className="ui-voice-ending">
        <button type="button" className="ui-btn-secondary min-h-12 min-w-32" onClick={stop}>
          End
        </button>
      </div>
    </div>
  );
}
