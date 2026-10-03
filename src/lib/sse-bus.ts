import { EventEmitter } from "events";
import { APP_SLUG } from "@/config/brand";
import type { BuilderChannel } from "@/lib/constants/statuses";
import { mergeTranscriptItems, type TranscriptItem } from "@/lib/claude-transcript";

// Global singleton keyed on globalThis — survives Next.js hot-reload in dev.
const KEY = `$$${APP_SLUG}_sse_bus`;
if (!(globalThis as Record<string, unknown>)[KEY]) {
  const e = new EventEmitter();
  e.setMaxListeners(500);
  (globalThis as Record<string, unknown>)[KEY] = e;
}
export const sseBus: EventEmitter = (globalThis as Record<string, unknown>)[KEY] as EventEmitter;

// Called after any DB write to project_states so SSE subscribers wake immediately.
export function emitStateChanged(userId: string) {
  sseBus.emit(`state:${userId}`);
}

// Live-terminal frame fanout (docs/architecture/embedded-terminal.md). The
// runner POSTs a changed frame to /api/control/peek-frame, which
// emits it here; the /api/control/peek-stream SSE for the same (user, tab)
// forwards it to the viewer. In-process only — fine on a single box instance;
// frames are too big/frequent for the Postgres-NOTIFY bridge.
// `append: true` marks a raw-PTY byte delta (the viewer xterm.write()s it onto
// the existing buffer). Absent/false = a full snapshot of the PTY buffer (the
// viewer reset()s then writes). One channel, two producers.
export type PeekFrame = { seq: number; frame: string; at: number; append?: boolean };
/** Alias of the shared BuilderChannel union — kept for existing importers. */
export type PeekBuilderChannel = BuilderChannel;

export function peekChannel(userId: string, tab: string, channel?: PeekBuilderChannel): string {
  return `peek:${channel ?? "any"}:${userId}:${tab.toLowerCase()}`;
}

export function emitPeekFrame(
  userId: string,
  tab: string,
  payload: PeekFrame,
  channel?: PeekBuilderChannel,
): void {
  sseBus.emit(peekChannel(userId, tab, channel), payload);
  if (channel) sseBus.emit(peekChannel(userId, tab), payload);
}

// Viewer ref-count per (user, tab): the first viewer triggers peek_start, the
// last triggers peek_stop, so the runner only streams a pane while watched.
const VKEY = `$$${APP_SLUG}_peek_viewers`;
if (!(globalThis as Record<string, unknown>)[VKEY]) {
  (globalThis as Record<string, unknown>)[VKEY] = new Map<string, number>();
}
const peekViewers = (globalThis as Record<string, unknown>)[VKEY] as Map<string, number>;

/** Register a viewer; returns true if this is the FIRST viewer (→ peek_start). */
export function addPeekViewer(userId: string, tab: string, channel?: PeekBuilderChannel): boolean {
  const key = peekChannel(userId, tab, channel);
  const n = (peekViewers.get(key) ?? 0) + 1;
  peekViewers.set(key, n);
  return n === 1;
}

/** Deregister a viewer; returns true if this was the LAST viewer (→ peek_stop). */
export function removePeekViewer(
  userId: string,
  tab: string,
  channel?: PeekBuilderChannel,
): boolean {
  const key = peekChannel(userId, tab, channel);
  const n = (peekViewers.get(key) ?? 1) - 1;
  if (n <= 0) {
    peekViewers.delete(key);
    return true;
  }
  peekViewers.set(key, n);
  return false;
}

// ── Claude Code conversation fanout ─────────────────────────────────────────
// The runner tails the session log (desktop/src/main/transcript-streamer.ts)
// and POSTs structured items to /api/control/transcript-frame; viewers of
// /api/control/transcript-stream receive them. Unlike the PTY frames, the
// conversation is small and keyed by id, so the server keeps the latest copy
// per (user, tab): a viewer who joins — or a phone that reconnects after the
// screen slept — paints the conversation at once instead of waiting for the
// runner's next snapshot. Same single-instance caveat as the frames above.
export type TranscriptFrame = {
  reset: boolean;
  sessionId: string | null;
  items: TranscriptItem[];
  at: number;
};

export function transcriptChannel(
  userId: string,
  tab: string,
  channel?: PeekBuilderChannel,
): string {
  return `transcript:${channel ?? "any"}:${userId}:${tab.toLowerCase()}`;
}

const TKEY = `$$${APP_SLUG}_transcripts`;
if (!(globalThis as Record<string, unknown>)[TKEY]) {
  (globalThis as Record<string, unknown>)[TKEY] = new Map<string, TranscriptFrame>();
}
const lastTranscripts = (globalThis as Record<string, unknown>)[TKEY] as Map<
  string,
  TranscriptFrame
>;
/** Items kept per conversation — the tail a phone scrolls back through. */
const KEEP_ITEMS = 400;

function remember(key: string, frame: TranscriptFrame): void {
  const prior = frame.reset ? undefined : lastTranscripts.get(key);
  const items = prior ? mergeTranscriptItems(prior.items, frame.items) : frame.items;
  lastTranscripts.set(key, {
    reset: true,
    sessionId: frame.sessionId ?? prior?.sessionId ?? null,
    items: items.slice(-KEEP_ITEMS),
    at: frame.at,
  });
}

export function emitTranscriptFrame(
  userId: string,
  tab: string,
  frame: TranscriptFrame,
  channel?: PeekBuilderChannel,
): void {
  const keys = [transcriptChannel(userId, tab, channel)];
  if (channel) keys.push(transcriptChannel(userId, tab));
  for (const key of keys) {
    remember(key, frame);
    sseBus.emit(key, frame);
  }
}

/** The latest full conversation for a viewer that has just joined. */
export function lastTranscript(
  userId: string,
  tab: string,
  channel?: PeekBuilderChannel,
): TranscriptFrame | null {
  return lastTranscripts.get(transcriptChannel(userId, tab, channel)) ?? null;
}
