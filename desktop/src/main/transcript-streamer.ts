// Claude Code conversation streamer (runner side).
//
// Beside the raw PTY stream (peek-streamer.ts), stream the same session as
// structured chat: Claude Code appends every turn to
// ~/.claude/projects/<slug>/<sessionId>.jsonl, and src/lib/claude-transcript
// turns those lines into messages and tool rows. The phone renders those
// instead of 80-column TUI cells.
//
// Same lifecycle and the same rule as peek: it runs only while someone is
// watching (started from peek_start, stopped by peek_stop), and it NEVER
// blocks the event loop — every read is fs/promises, on a short timer, and
// only the bytes appended since the last read are parsed.

import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { claudeProjectSlug } from '@/lib/usage/claude-transcript-usage'
import {
  newTranscriptState,
  reduceTranscriptLine,
  type TranscriptItem,
} from '@/lib/claude-transcript'
import { ptyDirForTab } from './pty-runtime'

const POLL_MS = 1000
/** On (re)start, the conversation's tail — enough to read back, small enough to post. */
const SNAPSHOT_ITEMS = 200
/** Never read more than this from the end of a log on start. */
const SNAPSHOT_BYTES = 2_000_000
/** One POST stays well under the route's body cap. */
const MAX_BATCH = 100

type Stream = { stop: () => void }
const streams = new Map<string, Stream>()
const key = (tab: string) => tab.toLowerCase()

const runnerChannel = (): 'cloud' | 'local' | undefined => {
  const raw = (process.env.LOKI_RUNNER_PRESENCE_CHANNEL ?? 'local').trim()
  return raw === 'cloud' || raw === 'local' ? raw : undefined
}

async function post(
  base: string,
  token: string,
  tab: string,
  body: { reset: boolean; sessionId: string | null; items: TranscriptItem[] },
): Promise<void> {
  const channel = runnerChannel()
  for (let i = 0; i < Math.max(1, body.items.length); i += MAX_BATCH) {
    await fetch(`${base}/api/control/transcript-frame`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tab,
        reset: body.reset && i === 0,
        sessionId: body.sessionId,
        items: body.items.slice(i, i + MAX_BATCH),
        ...(channel ? { channel } : {}),
      }),
    }).catch(() => { /* transient — the next poll re-sends nothing lost: items upsert */ })
  }
}

/** The newest session log for a project directory, or null. */
async function newestLog(dir: string): Promise<{ file: string; size: number } | null> {
  const folder = path.join(os.homedir(), '.claude', 'projects', claudeProjectSlug(dir))
  let names: string[]
  try {
    names = (await fs.readdir(folder)).filter((n) => n.endsWith('.jsonl'))
  } catch {
    return null
  }
  let best: { file: string; size: number; mtime: number } | null = null
  for (const name of names) {
    const file = path.join(folder, name)
    const st = await fs.stat(file).catch(() => null)
    if (st && (!best || st.mtimeMs > best.mtime)) best = { file, size: st.size, mtime: st.mtimeMs }
  }
  return best ? { file: best.file, size: best.size } : null
}

async function readRange(file: string, start: number, end: number): Promise<string> {
  const fh = await fs.open(file, 'r')
  try {
    const length = Math.max(0, end - start)
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, start)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

export function startTranscript(base: string, token: string, tab: string): void {
  stopTranscript(tab)
  let stopped = false
  let file: string | null = null
  let offset = 0
  let partial = ''
  let state = newTranscriptState()
  let busy = false

  const tick = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const dir = ptyDirForTab(tab)
      if (!dir) return
      const log = await newestLog(dir)
      if (!log) return

      if (log.file !== file) {
        // New session (first look, /clear, or a fresh launch): send its tail
        // as a snapshot that REPLACES whatever the viewer has.
        file = log.file
        state = newTranscriptState()
        const start = Math.max(0, log.size - SNAPSHOT_BYTES)
        const text = await readRange(log.file, start, log.size)
        const lines = text.split('\n')
        // A cut mid-line at the start of a partial read is not a line.
        if (start > 0) lines.shift()
        partial = lines.pop() ?? ''
        offset = log.size - Buffer.byteLength(partial)
        const byId = new Map<string, TranscriptItem>()
        for (const line of lines) for (const item of reduceTranscriptLine(state, line)) byId.set(item.id, item)
        const items = [...byId.values()].slice(-SNAPSHOT_ITEMS)
        await post(base, token, tab, { reset: true, sessionId: path.basename(log.file, '.jsonl'), items })
        return
      }

      if (log.size <= offset) return
      const text = partial + (await readRange(log.file, offset, log.size))
      offset = log.size
      const lines = text.split('\n')
      partial = lines.pop() ?? ''
      const updates: TranscriptItem[] = []
      for (const line of lines) updates.push(...reduceTranscriptLine(state, line))
      if (updates.length) {
        await post(base, token, tab, { reset: false, sessionId: path.basename(log.file, '.jsonl'), items: updates })
      }
    } catch {
      /* a log mid-rotation or unreadable this tick — try again next tick */
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void tick(), POLL_MS)
  void tick()
  streams.set(key(tab), {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  })
}

export function stopTranscript(tab: string): void {
  const s = streams.get(key(tab))
  if (!s) return
  s.stop()
  streams.delete(key(tab))
}

export function stopAllTranscripts(): void {
  for (const s of streams.values()) s.stop()
  streams.clear()
}
