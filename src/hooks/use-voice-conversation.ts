"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollTranscriptionResult } from "@/hooks/use-whisper-mic";
import { guessSpeechLang, plainTextForSpeech } from "@/lib/loki/speech-text";
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
 */
export function useVoiceConversation({
  onUtterance,
  latestAnswer,
  turnFailed,
}: {
  onUtterance: (text: string) => void;
  latestAnswer: VoiceAnswer;
  turnFailed: boolean;
}) {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
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
  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);
  const listenRef = useRef<() => void>(() => {});

  const stopLoop = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setLevel(0);
  };

  const end = useCallback(() => {
    stopLoop();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPhase("off");
  }, []);

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
        setPhase("paused");
        return;
      }
      outcomeRef.current = decision;
      recorder.stop();
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [transcribe]);
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "off" && phaseRef.current !== "paused") return;
    setError("");
    setHeard("");
    if (!streamRef.current) {
      setPhase("starting");
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
    setPhase("listening");
    listen();
  }, [listen]);

  /** Tap the orb: finish talking now, or cut the answer short and reply. */
  const tap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "speaking") {
      window.speechSynthesis.cancel();
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
  }, [listen, start]);

  // Remember which answer was newest when we sent, so only a NEW one is read.
  useEffect(() => {
    if (phase === "thinking" && answerAtSendRef.current === null) {
      answerAtSendRef.current = latestAnswer?.id ?? "";
    }
    if (phase !== "thinking") answerAtSendRef.current = null;
  }, [phase, latestAnswer?.id]);

  useEffect(() => {
    if (phase !== "thinking") return;
    if (turnFailed) {
      listen();
      return;
    }
    if (!latestAnswer || latestAnswer.id === answerAtSendRef.current) return;
    if (answerAtSendRef.current === null) return;
    const text = plainTextForSpeech(latestAnswer.text);
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) {
      listen();
      return;
    }
    setPhase("speaking");
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = guessSpeechLang(text, document.documentElement.lang || "en");
    u.onend = () => {
      if (phaseRef.current === "speaking") listen();
    };
    u.onerror = u.onend;
    window.speechSynthesis.speak(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to a new answer or a failure only
  }, [phase, latestAnswer?.id, turnFailed]);

  return { phase, level, heard, error, start, end, tap };
}
