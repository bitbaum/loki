"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readTtsFailure, type TtsFailure } from "@/lib/voice/tts-failure";

const KEY = "loki.voice.studio-off";

/**
 * Whether the studio voice works, as far as this browser tab has seen —
 * and if not, why (lib/voice/tts-failure). Kept for the tab's session, so the
 * start screen still says it after End or a reload, and cleared the moment a
 * studio voice plays again (someone accepted Groq's terms in the meantime).
 *
 * `report` returns true only the FIRST time a failure is seen in the
 * session: the page says it aloud once, and shows it for as long as it holds.
 */
export function useStudioVoiceStatus() {
  const [failure, setFailure] = useState<TtsFailure | null>(null);
  const ref = useRef<TtsFailure | null>(null);

  useEffect(() => {
    // Deferred, like the settings: storage is an external store, and the
    // first paint without the notice is fine for a screen read once.
    const t = window.setTimeout(() => {
      try {
        const raw = window.sessionStorage.getItem(KEY);
        if (!raw) return;
        const f = readTtsFailure(JSON.parse(raw));
        if (f.reason === "unreachable") return;
        ref.current = f;
        setFailure(f);
      } catch {
        /* nothing remembered */
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const report = useCallback((f: TtsFailure): boolean => {
    const first = ref.current === null;
    ref.current = f;
    setFailure(f);
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ reason: f.reason }));
    } catch {
      /* the notice lasts this page */
    }
    return first;
  }, []);

  const clear = useCallback(() => {
    if (ref.current === null) return;
    ref.current = null;
    setFailure(null);
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to forget */
    }
  }, []);

  return { failure, failureRef: ref, report, clear };
}
