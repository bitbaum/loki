"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { guessSpeechLang, plainTextForSpeech } from "@/lib/loki/speech-text";

/**
 * Read an answer aloud with the browser's own voices — the play button under
 * every answer in the reference chat. No upload, no key, works offline; the
 * one thing it needs is a browser with `speechSynthesis`, and where there is
 * none the button is not shown rather than shown dead.
 *
 * One utterance at a time: pressing play on a second answer stops the first.
 * Unmounting stops it too — a voice that keeps reading a page you left is the
 * microphone bug's twin.
 */
const noSubscribe = () => () => {};

export function useSpeech() {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (markdown: string) => {
      if (!supported) return;
      const text = plainTextForSpeech(markdown);
      if (!text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = guessSpeechLang(text, document.documentElement.lang || "en");
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [supported],
  );

  const toggle = useCallback(
    (markdown: string) => {
      if (speaking) stop();
      else speak(markdown);
    },
    [speak, speaking, stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { supported, speaking, speak, stop, toggle };
}
