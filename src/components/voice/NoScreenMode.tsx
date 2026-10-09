"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Loader2, Mic } from "lucide-react";
import {
  NO_SCREEN_COMMANDS,
  NO_SCREEN_DIGEST_MS,
  NO_SCREEN_POLL_MS,
  NO_SCREEN_VOICES,
  type NoScreenSettings,
} from "@/config/no-screen";
import { useVoiceConversation, type VoicePhase } from "@/hooks/use-voice-conversation";
import { useMediaSession } from "@/hooks/use-media-session";
import { useSoundscape } from "@/hooks/use-soundscape";
import { useNoScreenSettings } from "@/hooks/use-no-screen-settings";
import { useImmersiveChat } from "@/hooks/use-immersive-chat";
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
/** Two failed polls in a row is a dropped line, not a slow one. */
const OFFLINE_AFTER_FAILURES = 2;

type Turn = { role: "user" | "assistant"; content: string };

/**
 * No-screen mode: the fleet in your ear, your voice as the only control.
 *
 * One tap starts it. From then on the loop is listen → send → speak → listen,
 * and between turns the phone polls the fleet and reads out what changed —
 * each announcement behind its earcon, coalesced and varied so an hour of
 * it does not grate (lib/voice/announce). A music bed the phone composes
 * itself fills the silence and ducks under the voice; the voice is a studio
 * one when the box has it, the phone's own when it does not.
 *
 * The three commands that are about the conversation itself (quiet, say that
 * again, end) and "details" are answered here without a round trip;
 * everything else is one POST to /api/voice/turn, whose answer is read aloud.
 */
export function NoScreenMode() {
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<{ id: string; text: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastSaid, setLastSaid] = useState("");
  const [line, setLine] = useState<"online" | "offline">("online");
  const [speaker, setSpeaker] = useState<Speaker | undefined>(undefined);
  const { settings, update } = useNoScreenSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const snapshotRef = useRef<FleetSnapshot | null>(null);
  const historyRef = useRef<Turn[]>([]);
  const lastSaidRef = useRef("");
  const lastChangesRef = useRef<FleetChange[]>([]);
  const heldRef = useRef<FleetChange[]>([]);
  const variantRef = useRef(0);
  const failuresRef = useRef(0);
  const sayRef = useRef<(text: string, cue?: () => void) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const sound = useSoundscape();

  const said = (text: string) => {
    lastSaidRef.current = text;
    setLastSaid(text);
  };

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
      if (cmd.kind === "details") {
        const all = [...lastChangesRef.current, ...heldRef.current];
        const d = detailsFor(all);
        said(d);
        setAnswer({ id: crypto.randomUUID(), text: d });
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
        // A briefing already covers everything held for the digest.
        if (result.kind === "status") heldRef.current = [];
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
    speaker,
    bargeIn: settings.bargeIn,
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
    sound.stopMusic();
    media.disarm();
    setOn(false);
  }, [voice, sound, media]);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = () => {
    const armed = sound.arm();
    media.arm(armed?.stream ?? null, sound.connectDirect);
    const synth = createSynthSpeaker();
    setSpeaker(
      armed && settings.voice !== "phone"
        ? createServerSpeaker({
            voice: settings.voice,
            ctx: armed.ctx,
            out: armed.speech,
            fallback: synth,
          })
        : synth,
    );
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

        <NoScreenSettingsRow settings={settings} update={update} />

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
          {line === "offline" ? "Reconnecting" : PHASE_LABEL[voice.phase]}
        </p>
        <p className="ui-voice-hint">
          {voiceLabel}
          {settings.music ? " · music on" : ""}
          {settings.bargeIn ? " · talk to interrupt" : " · press to interrupt"}
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

/**
 * The four choices, as chips, read once before the phone goes away. Voice
 * is a row of names; the other three are on/off.
 */
function NoScreenSettingsRow({
  settings,
  update,
}: {
  settings: NoScreenSettings;
  update: (patch: Partial<NoScreenSettings>) => void;
}) {
  return (
    <div className="ui-voice-settings">
      <div className="ui-voice-setting">
        <span className="ui-voice-setting-label">Voice</span>
        <div className="ui-voice-setting-chips" role="radiogroup" aria-label="Voice">
          {NO_SCREEN_VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={settings.voice === v.id}
              title={v.note}
              className={cn("ui-chip-toggle", settings.voice === v.id && "ui-chip-toggle-active")}
              onClick={() => update({ voice: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ui-voice-setting">
        <span className="ui-voice-setting-label">While you listen</span>
        <div className="ui-voice-setting-chips">
          <button
            type="button"
            aria-pressed={settings.music}
            className={cn("ui-chip-toggle", settings.music && "ui-chip-toggle-active")}
            onClick={() => update({ music: !settings.music })}
          >
            Music bed
          </button>
          <button
            type="button"
            aria-pressed={settings.bargeIn}
            className={cn("ui-chip-toggle", settings.bargeIn && "ui-chip-toggle-active")}
            onClick={() => update({ bargeIn: !settings.bargeIn })}
          >
            Talk to interrupt
          </button>
          <button
            type="button"
            aria-pressed={settings.mode === "important"}
            className={cn(
              "ui-chip-toggle",
              settings.mode === "important" && "ui-chip-toggle-active",
            )}
            onClick={() =>
              update({ mode: settings.mode === "important" ? "everything" : "important" })
            }
          >
            Only what needs me
          </button>
        </div>
      </div>
      <p className="ui-voice-setting-note">
        The music is made by the phone itself — no file, no licence. &ldquo;Only what needs
        me&rdquo; holds finished runs and reads them as one sentence every five minutes.
      </p>
    </div>
  );
}
