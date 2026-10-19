"use client";
import { useCallback, useRef, useState } from "react";
import { INSTANT_PREVIEW, INSTANT_PREVIEW_COPY } from "@/config/instant-preview";
import type { InstantEvent } from "@/lib/instant-preview/render";

export type InstantState =
  | { status: "idle" }
  /** Loki is opening the site; `now` arrives within seconds. */
  | { status: "working"; key: string; now: string | null }
  | {
      status: "done";
      key: string;
      now: string | null;
      before: string | null;
      after: string | null;
      summary: string | null;
      /** Why there is no "with the change" picture, in the visitor's words. */
      message: string | null;
    };

const jpeg = (base64: string) => `data:image/jpeg;base64,${base64}`;

/**
 * The instant preview's request: read the newline-delimited answer as it
 * arrives, so the visitor sees their own site the moment Loki has it and the
 * change when it is drawn. `key` is what was asked (site + words): a result
 * for other words is shown as stale, with a button to ask again.
 */
export function useInstantPreview() {
  const [state, setState] = useState<InstantState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (website: string, ask: string) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const key = `${website}\n${ask}`;
    let now: string | null = null;
    const finish = (rest: Partial<Extract<InstantState, { status: "done" }>>) =>
      setState({
        status: "done",
        key,
        now,
        before: null,
        after: null,
        summary: null,
        message: null,
        ...rest,
      });
    setState({ status: "working", key, now: null });
    try {
      const response = await fetch(INSTANT_PREVIEW.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website, ask }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        return finish({ message: body.error ?? INSTANT_PREVIEW_COPY.failed });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let settled = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as InstantEvent | { type: "error"; message: string };
          if (event.type === "now") {
            now = jpeg(event.image);
            setState({ status: "working", key, now });
          } else if (event.type === "after") {
            settled = true;
            finish({
              before: jpeg(event.before),
              after: jpeg(event.after),
              summary: event.summary,
            });
          } else if (event.type === "no-change") {
            settled = true;
            finish({ summary: event.summary, message: INSTANT_PREVIEW_COPY.noChange });
          } else if (event.type === "no-picture") {
            settled = true;
            finish({ message: INSTANT_PREVIEW_COPY.noPicture });
          } else if (event.type === "error") {
            settled = true;
            finish({ message: event.message });
          }
        }
        if (done) break;
      }
      if (!settled) finish({ message: INSTANT_PREVIEW_COPY.failed });
    } catch {
      if (!abort.signal.aborted) finish({ message: INSTANT_PREVIEW_COPY.failed });
    }
  }, []);

  return { state, run };
}
