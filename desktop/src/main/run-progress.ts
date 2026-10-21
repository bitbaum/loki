// Run progress heartbeat — see src/lib/run-progress.ts for the contract.
//
// After a dispatch's prompt verifiably landed, this subscribes to the tab's
// owned PTY (same in-memory stream the peek streamer uses; pure, no I/O) and
// reports "still printing" to the cloud at most every RUN_PROGRESS_BEAT_MS.
// The cloud stamps payload.lastProgressAt on the run and appends a `progress`
// event, which is what turns Feedback's "Queued" into "Working · 12 min" and
// lets it call a silent agent stalled instead of guessing.
import { executor } from '@/lib/agent-execution'
import { peekPtyBuffer, runnerWorkspaceId } from './pty-runtime'
import { detectAuthFailure } from './agent-auth'
import { newestLog, readRange } from './transcript-streamer'
import { newTranscriptState, reduceTranscriptLine, type TranscriptItem } from '@/lib/claude-transcript'
import { latestRunStep } from '@/lib/run-step'
import {
  RUN_BLOCKED,
  RUN_PROGRESS_BEAT_MS,
  detectPermissionPrompt,
  shouldBeat,
  shouldDiagnoseSilence,
  type RunBlocked,
  type RunProgressBeat,
} from '@/lib/run-progress'

type Track = {
  runId: string
  tab: string
  bytesSinceBeat: number
  lastOutputAt: number
  lastBeatAt: number
  startedAt: number
  unsub: () => void
  timer: ReturnType<typeof setInterval>
  /** The workspace dir, so a silent agent can be asked WHY it is silent. */
  dir: string
  blocked: RunBlocked | null
  question: string | null
}

const tracks = new Map<string, Track>()

export function startRunProgress(
  base: string,
  token: string,
  runId: string,
  tab: string,
  dir: string,
): void {
  stopRunProgress(runId)
  // One agent per tab: a newer run on the same tab supersedes the old track,
  // otherwise the old run would keep looking alive on the new run's output.
  for (const t of tracks.values()) if (t.tab === tab) stopRunProgress(t.runId)
  const now = Date.now()
  const track: Track = {
    runId,
    tab,
    bytesSinceBeat: 0,
    lastOutputAt: now,
    lastBeatAt: now,
    startedAt: now,
    unsub: () => {},
    dir,
    blocked: null,
    question: null,
    timer: setInterval(() => void tick(base, token, runId), Math.min(RUN_PROGRESS_BEAT_MS, 15_000)),
  }
  // subscribe replays the retained buffer synchronously; skip it — the replay
  // is history, not progress.
  let replaying = true
  track.unsub = executor.subscribe(runnerWorkspaceId(tab), 0, (e) => {
    if (replaying) return
    if (e.kind === 'exit') { stopRunProgress(runId); return }
    if (e.kind !== 'output' || !e.data) return
    track.bytesSinceBeat += e.data.length
    track.lastOutputAt = Date.now()
  })
  replaying = false
  tracks.set(runId, track)
}

export function stopRunProgress(runId: string): void {
  const t = tracks.get(runId)
  if (!t) return
  clearInterval(t.timer)
  t.unsub()
  tracks.delete(runId)
}

async function tick(base: string, token: string, runId: string): Promise<void> {
  const t = tracks.get(runId)
  if (!t) return
  // Silence has two meanings and the operator can only act on one. Before
  // deciding whether to beat, work out whether this quiet agent is thinking or
  // waiting for a human — the runner is the only thing that can tell.
  // A tool-approval prompt is checked on every tick, not only after the long
  // silence: the agent is waiting on a human the moment it asks, and its
  // spinner may keep redrawing (Gemini 0.65 at "Allow execution of [Shell]?",
  // 2026-10-21, shown as Working).
  const asked = detectPermissionPrompt(peekPtyBuffer(t.tab) ?? '')
  if (asked) {
    const changed = t.blocked !== RUN_BLOCKED.PERMISSION || t.question !== asked
    t.blocked = RUN_BLOCKED.PERMISSION
    t.question = asked
    // Say it now, not at the next 45s beat.
    if (changed) t.lastBeatAt = 0
  } else if (shouldDiagnoseSilence(t)) {
    t.blocked = detectAuthFailure(t.dir) ? RUN_BLOCKED.AUTH : null
    t.question = null
  } else if (t.bytesSinceBeat > 0) {
    t.blocked = null
    t.question = null
  }
  const decision = shouldBeat(t)
  if (decision === 'stop') { stopRunProgress(runId); return }
  if (decision === 'wait') return
  const step = await currentStep(t.dir).catch(() => null)
  const beat: RunProgressBeat = {
    outputBytes: t.bytesSinceBeat,
    lastOutputAt: new Date(t.lastOutputAt).toISOString(),
    blocked: t.blocked,
    ...(t.question ? { question: t.question } : {}),
    ...(step ? { step } : {}),
  }
  t.bytesSinceBeat = 0
  t.lastBeatAt = Date.now()
  try {
    const res = await fetch(`${base}/api/control/runs/${runId}/progress`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(beat),
      signal: AbortSignal.timeout(5000),
    })
    // The cloud answers live:false once the run is closed — nothing left to
    // report on. A 404 means the same (run pruned).
    if (res.status === 404) { stopRunProgress(runId); return }
    const body = (await res.json().catch(() => null)) as { live?: boolean } | null
    if (body && body.live === false) stopRunProgress(runId)
  } catch (e) {
    // Telemetry: the next tick retries; bytes since then are counted again.
    console.warn('[run-progress] beat failed:', (e as Error).message)
  }
}

/** Only the end of the log is read: the newest step is all a beat carries. */
const STEP_TAIL_BYTES = 96_000

/**
 * What the agent is doing now, from the tail of its own session log — the
 * same log the conversation view reads, so a Control card can say "Editing
 * Header.tsx" with nobody watching. Null for agents that keep no Claude log.
 */
async function currentStep(dir: string): Promise<string | null> {
  const log = await newestLog(dir)
  if (!log) return null
  const start = Math.max(0, log.size - STEP_TAIL_BYTES)
  const lines = (await readRange(log.file, start, log.size)).split('\n')
  if (start > 0) lines.shift()
  const state = newTranscriptState()
  const items: TranscriptItem[] = []
  for (const line of lines) items.push(...reduceTranscriptLine(state, line))
  return latestRunStep(items)
}
