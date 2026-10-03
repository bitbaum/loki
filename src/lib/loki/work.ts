/**
 * What Loki did on the way to an answer — the work, as a record.
 *
 * A turn is up to three model rounds. In a gathering round the model usually
 * says something ("Found it — the two failing runs are both on sink. Checking
 * who owns them.") and then calls tools. Until now that sentence was DISCARDED
 * at the next round (`reset`), and the tools it ran survived only as a list of
 * names in provenance and a live spinner that vanished on reload. So a reopened
 * thread showed an answer that had, apparently, cost nothing — and a running
 * one showed a spinner where the Claude Code app shows the agent thinking out
 * loud between collapsed groups of commands. That rhythm is the one the
 * operator uses all day; this is the shape that lets Loki keep it.
 *
 * `WorkStep` is ONE list in turn order: notes (what Loki said while working)
 * and tools (what it ran, with the outcome). `groupWork` folds consecutive
 * tools into one collapsible group, so the thread reads
 *
 *     note · [3 steps] · note · [1 step] · answer
 *
 * A note is not the answer and is never verified as one: it is the model
 * thinking aloud, rendered in the trail's voice. The answer stays the only
 * thing grounding checks and the only thing Copy copies.
 *
 * Pure and client-safe: written by the loop, streamed live, persisted in
 * provenance, read by the thread.
 */

export type WorkTool = {
  kind: "tool";
  name: string;
  /** `start` exists only live; a persisted step is `end` or `fail`. */
  phase: "start" | "end" | "fail";
  /** Records it returned. Only meaningful once `phase` is "end". */
  facts?: number;
  /** The call's arguments, one short line (`query: "Elena"`) — what the
   *  reference chat shows as the command under each step. */
  detail?: string;
};
export type WorkNote = { kind: "note"; text: string };
export type WorkStep = WorkTool | WorkNote;

export type WorkSegment = { kind: "note"; text: string } | { kind: "tools"; tools: WorkTool[] };

/** Fold consecutive tool steps into one group; notes stand alone. */
export function groupWork(work: readonly WorkStep[]): WorkSegment[] {
  const out: WorkSegment[] = [];
  for (const step of work) {
    if (step.kind === "note") {
      if (step.text.trim()) out.push({ kind: "note", text: step.text });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === "tools") last.tools.push(step);
    else out.push({ kind: "tools", tools: [step] });
  }
  return out;
}

/**
 * Apply one tool event to the list: a tool moves running → done in place
 * rather than appearing twice. Only the LAST running step with that name is
 * matched, so two calls to the same tool in one round each close their own.
 */
export function applyToolStep(work: readonly WorkStep[], next: WorkTool): WorkStep[] {
  if (next.phase === "start") return [...work, next];
  let idx = -1;
  for (let i = work.length - 1; i >= 0; i--) {
    const s = work[i];
    if (s.kind === "tool" && s.name === next.name && s.phase === "start") {
      idx = i;
      break;
    }
  }
  if (idx === -1) return [...work, next];
  return work.map((s, i) => (i === idx ? next : s));
}

/** A note that arrives while the model is writing it: replace the open note
 *  rather than append a second one per flushed line. */
export function applyNote(work: readonly WorkStep[], text: string): WorkStep[] {
  const last = work[work.length - 1];
  if (last && last.kind === "note") return [...work.slice(0, -1), { kind: "note", text }];
  return [...work, { kind: "note", text }];
}

/** How long a step's detail line may be. One line on a phone. */
export const DETAIL_MAX_CHARS = 80;

/**
 * A tool call's arguments as one short line: `query: "Elena", limit: 5`.
 * Strings are quoted, nested values flattened to JSON, the whole thing cut
 * to one line — it is the command under the step, not the record of it.
 * Empty arguments are no detail at all rather than `{}`.
 */
export function describeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const parts = Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`);
  if (parts.length === 0) return undefined;
  const line = parts.join(", ").replace(/\s+/g, " ");
  return line.length > DETAIL_MAX_CHARS ? `${line.slice(0, DETAIL_MAX_CHARS - 1)}…` : line;
}

/** The one-line summary of a finished tool group. "0 records" is a real and
 *  useful answer — it is how an operator learns the tool ran and their data is
 *  genuinely empty, rather than assuming it never ran. */
export function summarizeTools(tools: readonly WorkTool[]): string {
  const failed = tools.filter((t) => t.phase === "fail").length;
  const records = tools.reduce((n, t) => n + (t.phase === "end" ? (t.facts ?? 0) : 0), 0);
  return [
    `${tools.length} ${tools.length === 1 ? "step" : "steps"}`,
    `${records} ${records === 1 ? "record" : "records"}`,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Read persisted work back from opaque meta. Older messages have none. */
export function readWork(meta: Record<string, unknown> | null | undefined): WorkStep[] {
  const raw = meta?.work;
  if (!Array.isArray(raw)) return [];
  const out: WorkStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.kind === "note" && typeof e.text === "string" && e.text.trim()) {
      out.push({ kind: "note", text: e.text });
    } else if (
      e.kind === "tool" &&
      typeof e.name === "string" &&
      (e.phase === "end" || e.phase === "fail")
    ) {
      out.push({
        kind: "tool",
        name: e.name,
        phase: e.phase,
        ...(typeof e.facts === "number" ? { facts: e.facts } : {}),
        ...(typeof e.detail === "string" && e.detail ? { detail: e.detail } : {}),
      });
    }
  }
  return out;
}
