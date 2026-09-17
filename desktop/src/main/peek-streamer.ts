// Live-terminal frame streamer (runner side) — PTY-only, non-blocking.
//
// On peek_start the runner streams a tab's owned-PTY output to the cloud
// (/api/control/peek-frame → SSE viewer); on peek_stop it tears down. Streaming
// runs only while a viewer is watching (the cloud ref-counts viewers), so an
// unwatched fleet costs nothing.
//
// CRITICAL: peek must NEVER block the Node event loop. The runner's poller, the
// command acks, and every PTY all share one event loop. The old zellij path
// polled `dump-screen` via SYNCHRONOUS execSync (a focus-dance) on a 1s timer;
// on a detached/slow zellij session each call blocked the loop for seconds,
// starving the ack fetch until its 5s timeout fired → the command was never
// marked done → re-served forever → the whole runner wedged (every dispatch
// silently queued). That is removed. We stream ONLY owned PTYs, via
// executor.subscribe (pure in-memory, async) — the product direction anyway
// (agents run in Loki-owned PTYs since v0.8.3). A tab with no owned PTY
// gets one informational frame and no polling loop.

import { executor } from '@/lib/agent-execution'
import { isPtyBacked, peekPtyBuffer, runnerWorkspaceId } from './pty-runtime'

const MAX_FRAME = 256_000    // matches the cloud route's cap

type Stream = { stop: () => void }
const streams = new Map<string, Stream>()

const key = (tab: string) => tab.toLowerCase()
const runnerChannel = (): 'cloud' | 'local' | undefined => {
  const raw = (process.env.LOKI_RUNNER_PRESENCE_CHANNEL ?? 'local').trim()
  return raw === 'cloud' || raw === 'local' ? raw : undefined
}

async function postFrame(
  base: string,
  token: string,
  tab: string,
  seq: number,
  frame: string,
  append: boolean,
): Promise<void> {
  const channel = runnerChannel()
  await fetch(`${base}/api/control/peek-frame`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab, seq, frame, append, ...(channel ? { channel } : {}) }),
  }).catch(() => { /* transient — drop this delta; the stream self-heals */ })
}

export function startPeek(base: string, token: string, tab: string): void {
  if (streams.has(key(tab))) {
    // A new SSE viewer joined an already-streamed tab. The cloud fanout does
    // not retain frames, so replay the current screen for this viewer instead
    // of waiting forever for the next byte from a quiet agent.
    const snapshot = peekPtyBuffer(tab);
    if (snapshot !== null) {
      void postFrame(base, token, tab, 0, snapshot.slice(-MAX_FRAME), false)
    }
    return
  }
  if (isPtyBacked(tab)) {
    startPtyStream(base, token, tab)
  } else {
    // No owned PTY for this tab. Do NOT run a synchronous zellij dump-screen
    // peek — it blocks the event loop and wedges the poller (see header). Send
    // one async info frame and register a no-op stream so repeated peek_starts
    // don't pile up. peek_start still acks instantly.
    void postFrame(base, token, tab, 0, `\r\n\x1b[2m[no live agent in "${tab}" — launch one from Control to watch it here]\x1b[0m\r\n`, true)
    streams.set(key(tab), { stop: () => {} })
  }
}

/** True byte stream from the owned PTY. Replays the retained buffer as one
 *  initial frame (so the viewer sees current state), then streams live deltas. */
function startPtyStream(base: string, token: string, tab: string): void {
  const id = runnerWorkspaceId(tab)
  let seq = 0
  // Serialize POSTs so byte deltas arrive in generation order — out-of-order
  // appends would corrupt the viewer's terminal. Each frame chains on the prev.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (frame: string, append: boolean): void => {
    const n = seq++
    chain = chain.then(() => postFrame(base, token, tab, n, frame, append))
  }
  // executor.subscribe replays the buffer synchronously first (pure in-memory,
  // no I/O); coalesce that into ONE initial frame (keep the tail if it exceeds
  // the cap), then stream live output deltas individually.
  let initial = ''
  let replaying = true
  const unsub = executor.subscribe(id, 0, (e) => {
    if (e.kind !== 'output' || !e.data) return
    if (replaying) { initial += e.data; return }
    enqueue(e.data, true)
  })
  replaying = false
  if (initial) enqueue(initial.length > MAX_FRAME ? initial.slice(initial.length - MAX_FRAME) : initial, false)
  streams.set(key(tab), { stop: unsub })
}

export function stopPeek(tab: string): void {
  const s = streams.get(key(tab))
  if (!s) return
  s.stop()
  streams.delete(key(tab))
}

/** Clear every stream — called on app shutdown / token loss. */
export function stopAllPeek(): void {
  for (const s of streams.values()) s.stop()
  streams.clear()
}
