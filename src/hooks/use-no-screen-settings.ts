"use client";

import { useCallback, useEffect, useState } from "react";
import {
  NO_SCREEN_DEFAULT_SETTINGS,
  NO_SCREEN_SETTINGS_KEY,
  NO_SCREEN_VOICES,
  type NoScreenSettings,
} from "@/config/no-screen";

/**
 * Per-device choices for no-screen mode — which voice, music on or off,
 * talk-over, what gets announced — kept in the browser. They are
 * conveniences of this phone, not account state: the same person on a
 * different phone starts from the defaults, which is fine, and a read that
 * fails (private window, cleared storage) just means the defaults.
 */
export function useNoScreenSettings() {
  const [settings, setSettings] = useState<NoScreenSettings>(NO_SCREEN_DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NO_SCREEN_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<NoScreenSettings>;
      const voice = NO_SCREEN_VOICES.some((v) => v.id === parsed.voice)
        ? (parsed.voice as NoScreenSettings["voice"])
        : NO_SCREEN_DEFAULT_SETTINGS.voice;
      // Deferred: reading storage is synchronising with an external store,
      // and the first paint with defaults is fine for a screen read once.
      const t = window.setTimeout(() => {
        setSettings({
          voice,
          music: parsed.music ?? NO_SCREEN_DEFAULT_SETTINGS.music,
          bargeIn: parsed.bargeIn ?? NO_SCREEN_DEFAULT_SETTINGS.bargeIn,
          mode: parsed.mode === "important" ? "important" : "everything",
        });
      }, 0);
      return () => window.clearTimeout(t);
    } catch {
      /* defaults */
    }
  }, []);

  const update = useCallback((patch: Partial<NoScreenSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(NO_SCREEN_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: the choice lasts the session */
      }
      return next;
    });
  }, []);

  return { settings, update };
}
