/**
 * The wire between a running Loki turn and the operator watching it.
 *
 * SSOT for both ends: the messages route writes these, `useLokiStream` reads
 * them, and there is no second copy of the shape to drift.
 *
 * ── Why a stream at all ──────────────────────────────────────────────────────
 * A turn is not one call. It is up to three model rounds with real tool work in
 * between — searching people, listing projects, reading the knowledge graph —
 * and it can run for tens of seconds. All of that used to happen behind a
 * static "Loki is thinking" line, so the surface that does the most work in the
 * app was the one that showed the least. `runLokiTurn` even returned
 * `toolsUsed` with the comment "surfaced so the UI can show work"; nothing ever
 * surfaced it.
 *
 * ── The one invariant that matters ───────────────────────────────────────────
 * **`delta` is a preview. `message` is the record.**
 *
 * Deltas are released at line boundaries while the model is still writing, so
 * they can differ from what is finally persisted — a tool call the model
 * narrated in prose is stripped before it is saved, and the grounding repair
 * pass can delete unsupported claims from a finished answer. When `message`
 * arrives the client REPLACES the preview with it. Appending instead would
 * leave a fabrication on screen that the database does not contain.
 *
 * `reset` is the other half of that honesty: the loop replaces its answer at
 * every round, so prose from an earlier round is superseded, not continued.
 */
import type { ConversationMessage } from "@/db/schema/conversations";
import type { WorkStep } from "@/lib/loki/work";
export type { WorkStep };

/** A persisted turn as it goes over the wire (dates serialize to ISO strings). */
export type WireMessage = Omit<ConversationMessage, "createdAt" | "meta"> & {
  createdAt: string;
  meta: Record<string, unknown> | null;
};

export type LokiStreamEvent =
  /** A new model round began. Everything streamed before it is void. */
  | { type: "round"; round: number }
  /** Prose, safe to show. Never contains tool-protocol lines. */
  | { type: "delta"; text: string }
  /** Discard the preview so far — a round boundary, or a link that died mid-answer. */
  | { type: "reset" }
  /** What the model said in a gathering round. Not superseded by the `reset`
   *  that follows — it moves from the preview into the work trail as a note
   *  (lib/loki/work.ts), the narration between groups of tools. */
  | { type: "note"; text: string }
  /** One tool, as it runs. `facts` is how many records it actually returned. */
  | {
      type: "tool";
      name: string;
      phase: "start" | "end" | "fail";
      facts?: number;
      /** The call's arguments as one line (lib/loki/work.ts describeArgs). */
      detail?: string;
    }
  /** Named waiting — what the turn is doing while no prose is arriving. */
  | { type: "status"; label: LokiStatusLabel }
  /** The authoritative persisted turn. Replaces the preview; ends the stream. */
  | { type: "message"; message: WireMessage }
  /** The turn failed. `status` mirrors the HTTP status it would have been. */
  | { type: "error"; error: string; status?: number };

export type LokiStatusLabel =
  "reading-images" | "thinking" | "dispatching" | "verifying" | "saving";

/** What each status says to the operator. SSOT so the client renders no copy of its own. */
export const LOKI_STATUS_COPY: Record<LokiStatusLabel, string> = {
  "reading-images": "Reading your screenshot",
  thinking: "Working on it",
  dispatching: "Sending this to your project",
  verifying: "Checking the answer against your records",
  saving: "Saving",
};

/** Frame one event. Exported so the route and any test format identically. */
export function encodeLokiEvent(event: LokiStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
