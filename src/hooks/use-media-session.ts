"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The headphone button as the only button.
 *
 * A phone hands its play/pause and track keys to whichever page is PLAYING
 * AUDIO, and to nothing otherwise — so a page that only ever listens and
 * speaks gets none of them. This hook plays a loop of generated silence
 * (one second of 8-bit nothing, built in memory, no asset) so the page holds
 * the media session, and routes the keys to the caller: play/pause is the
 * tap on the orb, next track asks for the briefing. The lock screen shows
 * the title and the phase as the "track", which is the one glance the mode
 * allows itself.
 *
 * `arm()` must be called inside a tap: a browser will not start audio
 * outside a gesture, and the whole point is to call it once and pocket the
 * phone.
 */
export function useMediaSession({
  title,
  phase,
  onToggle,
  onNext,
}: {
  title: string;
  phase: string;
  onToggle: () => void;
  onNext: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onToggleRef = useRef(onToggle);
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onToggleRef.current = onToggle;
    onNextRef.current = onNext;
  }, [onToggle, onNext]);

  const arm = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) {
      const a = new Audio(silentWavUrl());
      a.loop = true;
      audioRef.current = a;
    }
    void audioRef.current.play().catch(() => {
      /* no gesture, or autoplay refused: the orb still works by touch */
    });
  }, []);

  const disarm = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.removeAttribute("src");
    a.load();
    audioRef.current = null;
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: phase });
    navigator.mediaSession.playbackState = "playing";
  }, [title, phase]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    // The OS sends "pause" for the button; the silence must keep playing or
    // the session, and with it the button, is gone.
    const toggle = () => {
      onToggleRef.current();
      void audioRef.current?.play().catch(() => {});
      session.playbackState = "playing";
    };
    const next = () => onNextRef.current();
    const set = (action: MediaSessionAction, handler: (() => void) | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* an action the platform does not offer */
      }
    };
    set("play", toggle);
    set("pause", toggle);
    set("nexttrack", next);
    set("previoustrack", next);
    return () => {
      set("play", null);
      set("pause", null);
      set("nexttrack", null);
      set("previoustrack", null);
    };
  }, []);

  useEffect(() => disarm, [disarm]);

  return { arm, disarm };
}

/** One second of 8 kHz, 8-bit, mono silence as a WAV blob URL. 8044 bytes. */
function silentWavUrl(seconds = 1, rate = 8000): string {
  const samples = seconds * rate;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, "data");
  v.setUint32(40, samples, true);
  // 8-bit PCM is unsigned: silence is the midpoint, not zero.
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}
