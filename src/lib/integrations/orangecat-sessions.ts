/**
 * What OrangeCat may read about one person's agent sessions
 * (/api/orangecat/sessions): the contract, and the pure shaping behind it.
 *
 * A bot on OrangeCat steers the person's Claude Code sessions through the
 * signed rail. To do that it has to read what a person reads on Control and
 * Watch: which sessions exist, what each is doing, where its last run is on
 * the road to live, and what the agent actually said. Until this file the
 * conversation was only readable over a cookie-only SSE
 * (/api/control/transcript-stream), so a bot could send a prompt and never
 * see the answer.
 *
 * Nothing here derives a status. The state is the canonical one
 * (lib/feedback/canonical-status) that the run-track loader already returns;
 * the road is the track's own summary sentence. This file only decides what
 * crosses to OrangeCat, and clips it.
 */
import { APP_URL } from "@/config/brand";
import type { TranscriptItem } from "@/lib/claude-transcript";

/** Projects listed in one answer; the same ceiling as actor-status. */
export const SESSIONS_MAX_PROJECTS = 25;
/** Transcript items in one answer. */
export const SESSIONS_MAX_ITEMS = 40;
export const SESSIONS_DEFAULT_ITEMS = 12;
/** One item's text. A whole file read must not cross the rail. */
export const SESSIONS_ITEM_CHARS = 1200;
const TASK_CHARS = 200;

/** A session with no run on record is idle; every other state is canonical. */
export type SessionState =
  "idle" | "queued" | "starting" | "working" | "needs_you" | "done" | "failed";

export interface SessionRow {
  project: string;
  /** The builder the project prefers ("cloud" | "local"), or null when unset. */
  builder: string | null;
  /** That builder (or, when unset, any builder) can take work right now. */
  online: boolean;
  state: SessionState;
  label: string;
  /** Why, in a sentence, on Needs you and Failed; null otherwise. */
  reason: string | null;
  /** What was asked, in one line. */
  task: string | null;
  /** ISO time of the newest transcript frame, else the runner's last progress. */
  lastActivityAt: string | null;
  runId: string | null;
  /** The road to live in one sentence (lib/run-track). */
  track: string | null;
  prUrl: string | null;
  /** Where a person watches this run. */
  statusUrl: string | null;
}

export interface SessionRowInput {
  project: string;
  builderPref: string | null;
  presence: { cloud: boolean; local: boolean; any: boolean };
  /** Null when the project has never had a run. */
  run: {
    id: string;
    state: string;
    label: string;
    reason: string | null;
    task: string | null;
    track: string | null;
    prUrl: string | null;
    lastProgressAt: string | null;
  } | null;
  /** Epoch ms of the newest cached transcript frame for the session. */
  transcriptAt: number | null;
}

const STATES: ReadonlySet<string> = new Set([
  "queued",
  "starting",
  "working",
  "needs_you",
  "done",
  "failed",
]);

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One line: the first non-empty line of what was asked. */
export function oneLine(text: string | null | undefined): string | null {
  const line = (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return line ? clip(line, TASK_CHARS) : null;
}

/** Only an http(s) URL crosses the boundary. */
function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** Where a person follows one run: the same address the API serves it at. */
export function runStatusUrl(runId: string): string {
  return `${APP_URL}/api/orchestration/runs/${runId}`;
}

export function shapeSessionRow(input: SessionRowInput): SessionRow {
  const { run, presence } = input;
  const builder =
    input.builderPref === "cloud" || input.builderPref === "local" ? input.builderPref : null;
  const online = builder ? presence[builder] : presence.any;
  const state: SessionState = run && STATES.has(run.state) ? (run.state as SessionState) : "idle";
  const lastActivityAt =
    input.transcriptAt != null
      ? new Date(input.transcriptAt).toISOString()
      : (run?.lastProgressAt ?? null);
  return {
    project: input.project,
    builder,
    online,
    state,
    label: run && state !== "idle" ? run.label : "Idle",
    reason: run?.reason ?? null,
    task: oneLine(run?.task),
    lastActivityAt,
    runId: run?.id ?? null,
    track: run?.track ?? null,
    prUrl: safeUrl(run?.prUrl),
    statusUrl: run ? runStatusUrl(run.id) : null,
  };
}

/** Sessions that need the person lead, then working ones, then the rest in list order. */
export function orderSessions(rows: SessionRow[]): SessionRow[] {
  const rank = (r: SessionRow) =>
    r.state === "needs_you" || r.state === "failed"
      ? 0
      : r.state === "working" || r.state === "starting" || r.state === "queued"
        ? 1
        : 2;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i)
    .map((x) => x.row);
}

export interface SessionTranscriptItem {
  kind: "user" | "assistant" | "tool" | "note";
  at: string | null;
  text: string;
}

/**
 * The last `count` items of a conversation, as text a model can quote.
 * A tool row reads "name: what it touched", then its result preview.
 */
export function shapeTranscriptItems(
  items: readonly TranscriptItem[],
  count: number = SESSIONS_DEFAULT_ITEMS,
): SessionTranscriptItem[] {
  const n = Math.max(1, Math.min(SESSIONS_MAX_ITEMS, Math.floor(count) || SESSIONS_DEFAULT_ITEMS));
  return items.slice(-n).flatMap((item): SessionTranscriptItem[] => {
    if (item.kind === "user" || item.kind === "assistant") {
      const text = clip(item.text ?? "", SESSIONS_ITEM_CHARS);
      return text ? [{ kind: item.kind, at: item.at, text }] : [];
    }
    if (item.kind === "tool") {
      const head = `${item.name}: ${item.summary}`.trim();
      const tail = item.result ? `\n${item.result}` : "";
      const mark =
        item.status === "error" ? " (failed)" : item.status === "running" ? " (running)" : "";
      return [
        { kind: "tool", at: item.at, text: clip(`${head}${mark}${tail}`, SESSIONS_ITEM_CHARS) },
      ];
    }
    const text = clip((item as { text?: string }).text ?? "", SESSIONS_ITEM_CHARS);
    return text ? [{ kind: "note", at: item.at, text }] : [];
  });
}
