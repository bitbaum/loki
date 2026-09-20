"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api/fetch";

/**
 * Per-project continuation permission persisted by the control API. A browser
 * may render the setting, but does not own operational authorization.
 *
 * Reads come from the SSE control stream — pass `initialEnabled` sourced from
 * the streamed project state. The hook only falls back to a one-shot HTTP GET
 * when the prop is absent (local /proc-backed runtime that doesn't project
 * this field). Per-card polling is gone.
 */
export function useAutoContinue(tab: string, initialEnabled?: boolean) {
  const [enabled, setEnabled] = useState(initialEnabled ?? false);
  const [saving, setSaving] = useState(false);

  // Streamed value wins: mirror `initialEnabled` into state as a guarded
  // render-time adjustment (not an effect), so an SSE update lands in the same
  // render pass instead of one paint later.
  const [prevInitial, setPrevInitial] = useState(initialEnabled);
  if (initialEnabled !== prevInitial) {
    setPrevInitial(initialEnabled);
    if (initialEnabled !== undefined) setEnabled(initialEnabled);
  }

  // One-shot HTTP fallback only when the stream doesn't project this field.
  useEffect(() => {
    if (initialEnabled !== undefined) return;
    let cancelled = false;
    getJson<{ enabled: boolean }>(`/api/control/auto-continue?tab=${encodeURIComponent(tab)}`)
      .then((result) => {
        if (!cancelled) setEnabled(result.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab, initialEnabled]);

  const toggle = useCallback(async () => {
    if (saving) return;
    const previous = enabled;
    const next = !previous;
    setEnabled(next);
    setSaving(true);
    try {
      const response = await postJson("/api/control/auto-continue", { tab, enabled: next });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setEnabled(previous);
    } finally {
      setSaving(false);
    }
  }, [enabled, saving, tab]);

  return { enabled, toggle, saving };
}
