"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { useDispatchLiveStatus } from "@/hooks/use-dispatch-live-status";
import type { StatusTone } from "@/lib/constants/statuses";
import type { ActivityEvent } from "@/lib/activity-events";

/** The dispatch pipeline caps a custom prompt at 4000 chars (see the zod
 *  schema on /api/inject). Trim here so a long replay fails visibly at the
 *  edge rather than as a 400 the operator has to decode. */
const CUSTOM_PROMPT_MAX = 4000;

/**
 * Run the failed work again, from the page where you found out it failed.
 *
 * This replaces a link that said "Retry from Control" and did not retry. It
 * navigated to /control, where the Attention bar's retry acts on
 * `pending_commands` — a different table from the `orchestration_runs` this
 * feed shows. So the failure you clicked from was frequently not in that list
 * at all, and the button was a promise the app could not keep.
 *
 * What it does instead is what the words say: POST the same project + the same
 * instruction back through /api/inject (the identical path Control and Loki
 * dispatch on), then poll the real lifecycle so "queued behind an offline
 * builder" never looks like "running".
 *
 * Two replay shapes, and the difference matters:
 *   intent dispatch → send the intent ID and let the pipeline re-assemble the
 *     envelope from current project context. Replaying the stored envelope
 *     would hand the pipeline its own preamble to wrap a second time.
 *   custom prompt   → send the UNWRAPPED, untruncated task (PromptDisplay.task),
 *     never the preview, which is shortened for display and would silently
 *     re-run a truncated instruction.
 */
export function ActivityRetryButton({ event }: { event: ActivityEvent }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [commandId, setCommandId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const live = useDispatchLiveStatus(commandId, runId);

  const isCustom = event.intentId === "custom";
  const replayTask = event.ask?.task?.trim() ?? "";
  // A custom dispatch whose prompt text was never recorded cannot be replayed:
  // there is literally nothing to send. Offering the button anyway would be
  // the same broken promise in a new place.
  const canRetry = !event.isLocalChat && (!isCustom || replayTask.length > 0);
  if (!canRetry) return null;

  const run = async () => {
    setState("sending");
    setMessage(null);
    try {
      const res = await postJson("/api/inject", {
        tab: event.projectKey,
        ...(isCustom
          ? { customPrompt: replayTask.slice(0, CUSTOM_PROMPT_MAX) }
          : { promptKey: event.intentId }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blocked?: boolean;
        reason?: string;
        commandId?: string;
        runId?: string;
        mode?: string;
        message?: string;
      };
      if (!res.ok) {
        setState("error");
        setMessage(body.error ?? `Failed (${res.status})`);
        return;
      }
      // The runner reports "you are typing in this session right now" as a
      // successful no-op. Saying "Sent" over that would be a lie.
      if (body.blocked) {
        setState("error");
        setMessage(
          body.reason === "user-typing"
            ? "Not sent — you're typing in that session right now."
            : `Not sent — ${body.reason ?? "blocked"}.`,
        );
        return;
      }
      setCommandId(body.commandId ?? null);
      setRunId(body.runId ?? null);
      setState("sent");
      // A queue with no live builder is the case people most need told.
      if (body.message) setMessage(body.message);
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  };

  // Errors and refusals come from the POST itself. Once a dispatch is
  // accepted the polled lifecycle is more current than the message stamped at
  // accept time, so it takes over — same tone vocabulary the Loki transcript,
  // the terminal composer and the prompt Run modal already render, because a
  // retry watched from Activity is the same dispatch watched from anywhere.
  const note: { tone: StatusTone; text: string } | null =
    state === "error" && message
      ? { tone: "warning", text: message }
      : state === "sent" && live
        ? { tone: live.tone, text: live.detail ? `${live.label} — ${live.detail}` : live.label }
        : state === "sent"
          ? { tone: "neutral", text: message ?? "Checking status…" }
          : null;

  // At the end of a list row: one small button whose word is the state —
  // "Run again", "Sending…", "Sent", "Running", "Try again". The line of
  // status words that used to sit beside it does not fit a row; it is the
  // button's title instead.
  const word =
    state === "sending"
      ? "Sending…"
      : state === "error"
        ? "Try again"
        : state === "sent"
          ? live?.status === "failed"
            ? "Try again"
            : live?.status === "working" || live?.status === "delivered"
              ? "Running"
              : live?.terminal
                ? "Done"
                : "Sent"
          : "Run again";
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === "sending" || (state === "sent" && live?.status !== "failed")}
      title={note?.text}
      aria-label={`${word}: ${event.projectKey}`}
      className="ui-row-verb"
    >
      {state === "sending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : state === "idle" || state === "error" ? (
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      ) : null}
      {word}
    </button>
  );
}
