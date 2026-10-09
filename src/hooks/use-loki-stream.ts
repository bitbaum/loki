"use client";

import { useCallback, useRef, useState } from "react";
import { extractReplies } from "@bitbaum/chatkit";
import { readEventStream } from "@/lib/api/read-event-stream";
import type { LokiStatusLabel, LokiStreamEvent, WireMessage } from "@/lib/loki/stream";
import { applyNote, applyToolStep, type WorkStep } from "@/lib/loki/work";

/** One tool the turn ran, as the operator sees it happen. */
export type LiveTool = {
  name: string;
  phase: "start" | "end" | "fail";
  /** Records it returned. Only meaningful once `phase` is "end". */
  facts?: number;
};

/**
 * Everything known about the turn currently running. Null when nothing is.
 *
 * `preview` is explicitly NOT the answer — it is the answer being written. The
 * persisted message replaces it the moment it arrives (see lib/loki/stream.ts).
 */
export type LiveTurn = {
  preview: string;
  tools: LiveTool[];
  /** The turn's work in order — notes said while gathering and tools run —
   *  the same list the server persists (lib/loki/work.ts), so the thread
   *  reads identically live and reopened. */
  work: WorkStep[];
  status: LokiStatusLabel | null;
  round: number;
  /** When the turn was sent (ms epoch), for the elapsed counter. */
  startedAt: number;
};

const EMPTY: LiveTurn = {
  preview: "",
  tools: [],
  work: [],
  status: null,
  round: 0,
  startedAt: 0,
};

export type UseLokiStream = {
  /** The turn in flight, or null. */
  live: LiveTurn | null;
  sending: boolean;
  error: string | null;
  /** True when the operator stopped the last turn themselves. */
  stopped: boolean;
  /** Resolves true when a persisted turn landed; false on error or stop. */
  send: (url: string, body: unknown) => Promise<boolean>;
  stop: () => void;
  clearError: () => void;
};

/**
 * Run one Loki turn and report it as it happens.
 *
 * ── Stopping ─────────────────────────────────────────────────────────────────
 * Aborting discards the preview rather than keeping it. That is not timidity:
 * this server persists a turn only when it COMPLETES, so a kept preview would
 * be text the database does not contain — it would survive on screen until the
 * next reload and then silently vanish. The UI says "stopped, nothing saved",
 * which is what actually happened.
 */
export function useLokiStream({
  onMessage,
}: {
  /** The persisted turn. This is the record; the preview was never it. */
  onMessage: (message: WireMessage) => void;
}): UseLokiStream {
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback(
    async (url: string, body: unknown) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setSending(true);
      setStopped(false);
      setError(null);
      setLive({ ...EMPTY, startedAt: Date.now() });

      // Accumulated outside React state: deltas arrive far faster than renders,
      // and reading the previous value out of a setState callback for every
      // token makes the reducer the hot path.
      let preview = "";

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Message failed (HTTP ${res.status}).`);
        }
        if (!res.body) throw new Error("Message failed — no response body.");

        let landed = false;
        await readEventStream<LokiStreamEvent>(res.body, (event) => {
          switch (event.type) {
            case "delta":
              preview += event.text;
              // The answer may end in a suggested-replies block. It is taken
              // out here, once, for every surface that shows the preview —
              // including while it is still half-written — so nobody watches
              // raw JSON appear under an answer. The persisted turn carries
              // the replies separately (meta.replies).
              setLive((prev) => ({
                ...(prev ?? EMPTY),
                preview: extractReplies(preview).text,
                status: null,
              }));
              break;
            case "reset":
              preview = "";
              setLive((prev) => ({ ...(prev ?? EMPTY), preview }));
              break;
            case "note":
              // The prose of a gathering round moves from the preview into the
              // trail, where it stays — the `reset` that follows clears only
              // the preview.
              setLive((prev) => {
                const base = prev ?? EMPTY;
                return { ...base, work: applyNote(base.work, event.text) };
              });
              break;
            case "round":
              setLive((prev) => ({ ...(prev ?? EMPTY), round: event.round }));
              break;
            case "tool":
              setLive((prev) => {
                const base = prev ?? EMPTY;
                // Merge on name so a tool moves running → done in place rather
                // than appearing twice.
                const idx = base.tools.findIndex(
                  (t) => t.name === event.name && t.phase === "start",
                );
                const next: LiveTool = { name: event.name, phase: event.phase, facts: event.facts };
                const tools =
                  event.phase === "start"
                    ? [...base.tools, next]
                    : idx === -1
                      ? [...base.tools, next]
                      : base.tools.map((t, i) => (i === idx ? next : t));
                return {
                  ...base,
                  tools,
                  work: applyToolStep(base.work, {
                    kind: "tool",
                    name: event.name,
                    phase: event.phase,
                    facts: event.facts,
                    detail: event.detail,
                  }),
                };
              });
              break;
            case "status":
              setLive((prev) => ({ ...(prev ?? EMPTY), status: event.label }));
              break;
            case "message":
              landed = true;
              onMessage(event.message);
              setLive(null);
              break;
            case "error":
              // Thrown, not returned — it must escape readEventStream and land
              // in the catch below, or a failed turn would read as a finished
              // one with an empty answer.
              throw new Error(event.error);
          }
        });

        // The stream ended without delivering a turn. Silence is not an answer:
        // say so rather than leaving a spinner that never resolves.
        if (!landed) throw new Error("Loki stopped responding before finishing this turn.");
        return true;
      } catch (e) {
        if (controller.signal.aborted) setStopped(true);
        else setError(e instanceof Error ? e.message : "Message failed.");
        setLive(null);
        return false;
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [onMessage],
  );

  return { live, sending, error, stopped, send, stop, clearError };
}
