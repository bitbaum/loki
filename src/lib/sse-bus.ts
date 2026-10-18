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
  rememberScreen(peekChannel(userId, tab, channel), payload);
  sseBus.emit(peekChannel(userId, tab, channel), payload);
  if (channel) {
    rememberScreen(peekChannel(userId, tab), payload);
    sseBus.emit(peekChannel(userId, tab), payload);
  }
}

// The last screen per (user, tab): a viewer who opens a session paints it at
// once, marked as not yet live, instead of a black pane for the seconds the
// runner takes to pick up peek_start (owner, 2026-10-18: "the first thing I
// see is this screen, and only then, a little bit later, the terminal
// appears"). The runner's own replay always arrives as a snapshot (a reset),
// so it replaces this copy rather than appending to it. Kept as the tail of
// the byte stream since the last snapshot — the same cap the runner applies
// to its own replay — and only from a snapshot on, so a delta is never
// replayed without the screen it applies to.
const SCREEN_KEY = `$$${APP_SLUG}_peek_screens`;
if (!(globalThis as Record<string, unknown>)[SCREEN_KEY]) {
  (globalThis as Record<string, unknown>)[SCREEN_KEY] = new Map<string, PeekFrame>();
}
const lastScreens = (globalThis as Record<string, unknown>)[SCREEN_KEY] as Map<string, PeekFrame>;
const SCREEN_CHARS = 256_000;
/** Older than this, a remembered screen says more about then than now. */
const SCREEN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function rememberScreen(key: string, frame: PeekFrame): void {
  const prior = lastScreens.get(key);
  if (!frame.append) {
    lastScreens.set(key, { seq: frame.seq, frame: frame.frame.slice(-SCREEN_CHARS), at: frame.at });
  } else if (prior) {
    const bytes = prior.frame + frame.frame;
    lastScreens.set(key, { seq: frame.seq, frame: bytes.slice(-SCREEN_CHARS), at: frame.at });
  }
}

/** A closed session's screen is not shown again under its name. */
export function forgetScreen(userId: string, tab: string): void {
  const suffix = `:${userId}:${tab.toLowerCase()}`;
  for (const key of lastScreens.keys()) if (key.endsWith(suffix)) lastScreens.delete(key);
}

/** The last screen of a session, as one snapshot frame, or null. */
export function lastScreen(
  userId: string,
  tab: string,
  channel?: PeekBuilderChannel,
  now = Date.now(),
): PeekFrame | null {
  const screen = lastScreens.get(peekChannel(userId, tab, channel));
  return screen && now - screen.at < SCREEN_MAX_AGE_MS ? screen : null;
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
