"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollTranscriptionResult } from "@/hooks/use-whisper-mic";
import { plainTextForSpeech } from "@/lib/loki/speech-text";
import { createSynthSpeaker, type Speaker } from "@/lib/voice/speaker";
import {
  decideVoiceTurn,
  newVoiceTurn,
  sampleVoiceTurn,
  speechThreshold,
  type VoiceTurnState,
} from "@/lib/loki/voice-turn";

/** Same server leg as the composer's mic: Groq Whisper behind the session. */
const TRANSCRIBE_URL = "/api/control/transcribe";

export type VoicePhase =
  "off" | "starting" | "listening" | "transcribing" | "thinking" | "speaking" | "paused";

export type VoiceAnswer = { id: string; text: string } | null;

/**
 * A hands-free conversation: listen until the speaker pauses, send what they
 * said, read the answer aloud, listen again — until they end it.
 *
 * The microphone is open only while it is OUR turn to listen: never while the
 * answer is being read (the phone's speaker would answer itself), never while
 * waiting on the model. Endpointing is lib/loki/voice-turn.ts (pure, tested);
 * this hook is the plumbing around it.
 *
 * The caller hands in the newest answer and whether the turn failed; the hook
 * speaks the first answer that arrives after it sent something, and goes
 * back to listening on a failure — a dead end in a conversation you cannot see
 * would be silence forever.
 *
 * Two things no-screen mode added, both off by default so the Loki page's
 * Talk button is unchanged:
 *   - `say(text)`: read something UNASKED — a run finishing, an approval
 *     arriving. While listening it takes the turn at once (the take in
 *     progress is dropped: nobody was mid-sentence, or the level would have
 *     ended it); while busy it queues and is read after the answer.
 *   - `idle: "listen"`: twenty seconds of silence re-arms the microphone
 *     instead of pausing. With the screen off, "paused" is a dead end: the
 *     one tap that would resume it is on a screen nobody is looking at.
 *   - `speaker`: who reads the words (lib/voice/speaker). Default is the
 *     browser's own voice, as before; no-screen mode hands in the studio
 *     voice, which plays through its soundscape.
 *   - `bargeIn`: keep the analyser running while Loki speaks, and treat a
 *     burst of speech as "stop, I'm talking" — the phone's echo cancellation
 *     (and headphones, which are the whole point) keep Loki's own voice from
 *     counting. The first third of a second is spent deciding, so the
 *     person's first syllable is lost; "Loki, …" as a lead-in costs nothing.
 */
export function useVoiceConversation({
  onUtterance,
  latestAnswer,
  turnFailed,
  idle = "pause",
  speaker,
  bargeIn = false,
}: {
  onUtterance: (text: string) => void;
  latestAnswer: VoiceAnswer;
  turnFailed: boolean;
  idle?: "pause" | "listen";
  speaker?: Speaker;
  bargeIn?: boolean;
}) {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  /** What Loki is reading aloud right now, for the screen to show. */
  const [saying, setSaying] = useState("");
  const [error, setError] = useState("");

  const phaseRef = useRef<VoicePhase>("off");
  const setPhase = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number | null>(null);
  const noiseRef = useRef(0.01);
  const answerAtSendRef = useRef<string | null>(null);
  /** What the current take becomes when its recorder stops. */
  const outcomeRef = useRef<"send" | "discard">("discard");
  /** Unasked lines waiting for the voice to be free, each with the cue
   *  (an earcon) to play right before it. */
  const sayQueueRef = useRef<{ text: string; cue?: () => void }[]>([]);
  const synthRef = useRef<Speaker | null>(null);
  const speakerRef = useRef<Speaker | null>(speaker ?? null);
  useEffect(() => {
    speakerRef.current = speaker ?? null;
  }, [speaker]);
  const currentSpeaker = () => {
    if (speakerRef.current) return speakerRef.current;
    if (!synthRef.current) synthRef.current = createSynthSpeaker();
    return synthRef.current;
  };
  /** Which speak() is current; a cancelled one must not call listen(). */
  const speakTokenRef = useRef(0);
  const bargeInRef = useRef(bargeIn);
  useEffect(() => {
    bargeInRef.current = bargeIn;
  }, [bargeIn]);
  const bargeRafRef = useRef<number | null>(null);
  /** The person interrupted to talk: the next listen is theirs, the queue
   *  waits for the one after. */
  const holdQueueRef = useRef(false);
  const idleRef = useRef(idle);
  useEffect(() => {
    idleRef.current = idle;
  }, [idle]);
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);
  const listenRef = useRef<() => void>(() => {});
  const speakRef = useRef<(text: string) => void>(() => {});

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setLevel(0);
  }, []);

  /** Drop the take in progress without sending it. */
  const dropTake = useCallback(() => {
    stopLoop();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
  }, [stopLoop]);

  const end = useCallback(() => {
    dropTake();
    sayQueueRef.current = [];
    holdQueueRef.current = false;
    if (bargeRafRef.current !== null) cancelAnimationFrame(bargeRafRef.current);
    bargeRafRef.current = null;
    speakTokenRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    currentSpeaker().cancel();
    setPhase("off");
  }, [dropTake]);

  useEffect(() => end, [end]);

  const transcribe = useCallback(async (blob: Blob, mimeType: string) => {
    setPhase("transcribing");
    const stoppedAt = Date.now();
    const form = new FormData();
    form.append("audio", new File([blob], "turn.webm", { type: mimeType }));
    let text = "";
    try {
      const res = await fetch(TRANSCRIBE_URL, { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        transcriptionId?: string;
        error?: string;
      };
      if (!res.ok) setError(data.error ?? "Couldn't transcribe that.");
      else if (data.text) text = data.text;
      else if (data.transcriptionId)
        text = (await pollTranscriptionResult(data.transcriptionId, stoppedAt)) ?? "";
    } catch {
      setError("Couldn't reach the transcriber.");
    }
    if (phaseRef.current === "off") return;
    text = text.trim();
    if (!text) {
      listenRef.current();
      return;
    }
    setError("");
    setHeard(text);
    setPhase("thinking");
    onUtteranceRef.current(text);
  }, []);

  const listen = useCallback(() => {
    const stream = streamRef.current;
    const analyser = analyserRef.current;
    if (!stream || phaseRef.current === "off") return;
    // Something arrived while the voice was busy: say it before listening —
    // unless the person just cut in, in which case this listen is theirs.
    if (holdQueueRef.current) holdQueueRef.current = false;
    else {
      const queued = sayQueueRef.current.shift();
      if (queued) {
        queued.cue?.();
        speakRef.current(queued.text);
        return;
      }
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    outcomeRef.current = "discard";
    recorder.onstop = () => {
      if (phaseRef.current === "off") return;
      if (outcomeRef.current === "send")
        void transcribe(new Blob(chunks, { type: mimeType }), mimeType);
      else listenRef.current();
    };
    recorderRef.current = recorder;
    recorder.start(100);
    setPhase("listening");

    let turn: VoiceTurnState = newVoiceTurn(performance.now());
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    let frame = 0;
    const tick = () => {
      if (phaseRef.current !== "listening") return;
      const now = performance.now();
      let rms = 0;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        rms = Math.sqrt(sum / buf.length);
      }
      const threshold = speechThreshold(noiseRef.current);
      // The floor learns only from quiet, so a long sentence never teaches it
      // that speech is the room.
      if (rms < threshold) noiseRef.current = noiseRef.current * 0.97 + rms * 0.03;
      turn = sampleVoiceTurn(turn, rms, now, threshold);
      if (++frame % 3 === 0) setLevel(Math.min(1, rms / (threshold * 3)));
      // No analyser (no AudioContext): the person ends the turn by tapping.
      const decision = analyser ? decideVoiceTurn(turn, now) : "continue";
      if (decision === "continue") {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      stopLoop();
      if (decision === "idle") {
        recorder.onstop = null;
        recorder.stop();
        // A fresh take: the recorder's buffer of silence is dropped, the
        // microphone stays open. Or the old behaviour: wait for a tap.
        if (idleRef.current === "listen") listenRef.current();
        else setPhase("paused");
        return;
      }
      outcomeRef.current = decision;
      recorder.stop();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [transcribe, stopLoop]);
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  /**
   * While Loki speaks, watch the microphone for the person cutting in. A
   * burst above twice the room's speech bar for a third of a second is a
   * person, not a breath; the voice stops and the microphone is theirs.
   */
  const watchBargeIn = useCallback(
    (token: number) => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      const buf = new Uint8Array(analyser.fftSize);
      let loudSince: number | null = null;
      const tick = () => {
        if (speakTokenRef.current !== token || phaseRef.current !== "speaking") {
          bargeRafRef.current = null;
          return;
        }
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        const bar = speechThreshold(noiseRef.current) * 2.5;
        const now = performance.now();
        if (rms > bar) loudSince ??= now;
        else loudSince = null;
        if (loudSince !== null && now - loudSince > 350) {
          bargeRafRef.current = null;
          speakTokenRef.current++;
          currentSpeaker().cancel();
          holdQueueRef.current = true;
          listen();
          return;
        }
        bargeRafRef.current = requestAnimationFrame(tick);
      };
      bargeRafRef.current = requestAnimationFrame(tick);
    },
    [listen],
  );

  /** Read text aloud, then listen again (which also drains the say queue). */
  const speakThenListen = useCallback(
    (markdown: string) => {
      const text = plainTextForSpeech(markdown);
      if (!text) {
        listen();
        return;
      }
      setSaying(text);
      setPhase("speaking");
      const token = ++speakTokenRef.current;
      if (bargeInRef.current) watchBargeIn(token);
      void currentSpeaker()
        .speak(text)
        .finally(() => {
          if (speakTokenRef.current === token && phaseRef.current === "speaking") listen();
        });
    },
    [listen, watchBargeIn],
  );
  useEffect(() => {
    speakRef.current = speakThenListen;
  }, [speakThenListen]);

  const start = useCallback(
    async (opening?: string) => {
      if (phaseRef.current !== "off" && phaseRef.current !== "paused") return;
      setError("");
      setHeard("");
      if (!streamRef.current) {
        setPhase("starting");
        // iOS only lets a page speak after it has spoken inside a tap. The
        // real opening line comes after an await, so an empty utterance
        // here, still inside the gesture, is what unlocks it.
        if (opening && "speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          streamRef.current = stream;
          try {
            const ctx = new AudioContext();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaStreamSource(stream).connect(analyser);
            ctxRef.current = ctx;
            analyserRef.current = analyser;
          } catch {
            /* no analyser: listening still works, the person taps to send */
          }
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          setError(
            name === "NotAllowedError"
              ? "Microphone blocked — allow it in the browser's site settings, then tap Talk again."
              : "No microphone available.",
          );
          setPhase("off");
          return;
        }
      }
      if (opening) {
        setPhase("listening");
        speakRef.current(opening);
        return;
      }
      setPhase("listening");
      listen();
    },
    [listen],
  );

  /** Tap the orb: finish talking now, or cut the answer short and reply. */
  const tap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "speaking") {
      // Interrupting means "I want to talk": whatever else was queued waits
      // for the next free moment, after the reply.
      speakTokenRef.current++;
      currentSpeaker().cancel();
      holdQueueRef.current = true;
      listen();
    } else if (p === "listening") {
      // A tap means "I'm done": whatever was said goes.
      stopLoop();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        outcomeRef.current = "send";
        rec.stop();
      }
    } else if (p === "paused") {
      void start();
    }
  }, [listen, start, stopLoop]);

  /**
   * Say something the person did not ask for. Listening: now, dropping the
   * silent take. Busy or speaking: after the current answer. Off: never.
   */
  const say = useCallback(
    (text: string, cue?: () => void) => {
      const p = phaseRef.current;
      if (p === "off" || !text.trim()) return;
      if (p === "listening" || p === "paused") {
        dropTake();
        cue?.();
        speakThenListen(text);
        return;
      }
      sayQueueRef.current.push({ text, cue });
    },
    [speakThenListen, dropTake],
  );

  // Remember which answer was newest when we sent, so only a NEW one is read.
  useEffect(() => {
    if (phase === "thinking" && answerAtSendRef.current === null) {
      answerAtSendRef.current = latestAnswer?.id ?? "";
    }
    if (phase !== "thinking") answerAtSendRef.current = null;
  }, [phase, latestAnswer?.id]);

  useEffect(() => {
    if (phase !== "thinking") return;
    const fresh =
      !turnFailed &&
      latestAnswer !== null &&
      answerAtSendRef.current !== null &&
      latestAnswer.id !== answerAtSendRef.current;
    if (!turnFailed && !fresh) return;
    // Deferred one tick: the answer is an event from outside (the stream),
    // and the phase change it causes belongs in a callback, not the effect
    // body (react-hooks/set-state-in-effect).
    const t = window.setTimeout(() => {
      if (turnFailed) listen();
      else if (latestAnswer) speakThenListen(latestAnswer.text);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to a new answer or a failure only
  }, [phase, latestAnswer?.id, turnFailed]);

  return { phase, level, heard, saying, error, start, end, tap, say };
}
