"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { usePressVerb } from "@/hooks/use-press-verb";
import { postJson } from "@/lib/api/fetch";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { BuilderChannel } from "@/lib/constants/statuses";

type SendState = "idle" | "sending" | "sent" | "error";

const CONFIRM_MS = 2500;

/**
 * Voice control-input for the terminal page: record → transcribe → auto-dispatch
 * the transcript as a task into the given tab. Zero composer, zero preview — the
 * user taps once, speaks, taps to stop, and the phrase lands in the tab's agent.
 *
 * Reuses the greenfield `useVoiceInput` primitive (MediaRecorder → Whisper) and
 * the same `/api/control/tab-inject` path the Control panel dispatches through,
 * so the tab is addressed purely by name string — terminal/runner-neutral.
 */
export function TabVoiceMic({
  tab,
  compact = false,
}: {
  tab: string | null;
  /** Passed through for symmetry with the terminal surface; tab-inject keys off
   *  the tab name + caller runtime, so no per-channel branch is needed today. */
  channel?: BuilderChannel;
  compact?: boolean;
}) {
  const [send, setSend] = useState<SendState>("idle");
  const press = usePressVerb();
  const [sendError, setSendError] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  // Latest tab in a ref so the stable onTranscript callback always dispatches to
  // the currently-selected tab, not the one bound when recording started.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const flash = useCallback((state: SendState, err?: string) => {
    setSend(state);
    setSendError(err ?? null);
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      setSend("idle");
      setSendError(null);
    }, CONFIRM_MS);
  }, []);

  const handleTranscript = useCallback(
    async (text: string) => {
      const target = tabRef.current;
      if (!target) return;
      setSend("sending");
      setSendError(null);
      try {
        const res = await postJson("/api/control/tab-inject", { tab: target, prompt: text });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          flash("error", typeof data.error === "string" ? data.error : `Failed (${res.status}).`);
          return;
        }
        haptic();
        flash("sent");
      } catch (err) {
        flash("error", err instanceof Error ? err.message : "Network error.");
      }
    },
    [flash],
  );

  const {
    status,
    error: voiceError,
    isSupported,
    start,
    stop,
  } = useVoiceInput({
    onTranscript: handleTranscript,
  });

  // SSR renders nothing (server snapshot is false); client hides on unsupported
  // browsers rather than showing a dead button.
  if (!isSupported) return null;

  const recording = status === "recording";
  const transcribing = status === "transcribing";
  const busy = transcribing || send === "sending";
  const disabled = !tab || busy;

  const label = voiceError
    ? voiceError
    : sendError
      ? sendError
      : recording
        ? `Recording — ${press.verb} to send`
        : transcribing
          ? "Transcribing…"
          : send === "sending"
            ? `Sending to ${tab}…`
            : send === "sent"
              ? `Sent → ${tab}`
              : tab
                ? `Talk to ${tab}`
                : "No tab selected";

  const isError = !!voiceError || !!sendError;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => (recording ? stop() : start())}
        disabled={disabled}
        title={recording ? "Stop recording and send" : `Voice input → ${tab ?? "tab"}`}
        aria-label={recording ? "Stop recording and send" : "Record voice command"}
        className={cn(
          "inline-flex ui-tap-icon shrink-0 items-center justify-center rounded-lg p-1.5 transition-colors",
          recording
            ? "animate-pulse text-status-negative hover:bg-status-negative/10"
            : busy
              ? "text-text-muted opacity-50"
              : disabled
                ? "text-text-muted opacity-40"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
        )}
      >
        {busy ? (
          <Loader2 className="ui-spinner-sm" />
        ) : recording ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-3.5 w-3.5"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
      </button>
      {!compact && (
        <span
          className={cn(
            "min-w-0 truncate text-xs",
            isError
              ? "text-status-negative"
              : recording
                ? "text-status-negative"
                : "text-text-muted",
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
