/**
 * Fleet Runner main-process poller.
 *
 * Long-polls the Loki control plane for commands queued by the web
 * (`pending_commands` rows from `executeInject`'s remote branch) and executes
 * them locally into the agent's owned PTY.
 * This is the cable that closes the loop: a user dispatches from any browser
 * or phone, the row lands in Postgres, this poller drains it in <1s, the prompt
 * fires into the user's Zellij pane.
 *
 * Protocol (already proven by scripts/loki-daemon.sh):
 *   GET   /api/control/commands?wait=25   →  { command: { id, type, payload } | null }
 *   PATCH /api/control/commands/<id>      ←  { ok: boolean, error?, text? }
 *
 * Auth: Bearer <token> where <token> is the ck_… string created from
 * Settings → Agent tokens (and saved here at ~/.config/loki/fleet-runner-token).
 *
 * The desktop poller handles the same core command set as the bash daemon:
 * inject, focus/close tab, launch/switch agent, auto-continue, and install
 * CLI. This is what makes the hosted web app and phone UI a real remote for
 * the local Zellij workspace instead of just an inject-only transport.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { APP_URL } from '@/config/brand'
import { APP_SLUG } from '@/config/brand'
import { startPeek, stopPeek } from './peek-streamer'
import { detectAuthFailure } from './agent-auth'
import { startRunProgress } from './run-progress'
import { getAgentInstallCommand, listAgentRegistry, type AgentOption } from '@/lib/agent-registry'
import { executor } from '@/lib/agent-execution'
import { resolveRunnerWorkspaceDir } from '@/lib/agent-execution/box-workspace-path'
import { readClaudeLiveSessions, claudeLiveSessionForDir } from '@/lib/control-fast-state'
import {
  runnerWorkspaceId,
  isPtyBacked,
  launchAgentPty,
  injectPty,
  isPtyBusy,
  waitForPtyOutput,
  explainPtyDispatchFailure,
  terminatePty,
  waitForPtyReady,
  peekPtyBuffer,
  writeRawKey,
  resizePty,
} from './pty-runtime'
import { pushNow } from './pusher'
import { trackRunUsage } from './usage-reporter'
import { claudeProjectSlug } from '@/lib/usage/claude-transcript-usage'
import { startBridgeSubscriber } from './bridge-subscriber'
import {
  WORKTREE_DISPATCH_ENABLED,
  ensureWorktreeWorkspace,
  pruneWorktrees,
  worktreePromptNote,
} from '@/lib/agent-execution/worktree-workspace'
import { isDerivedRunTab } from '@/lib/run-tab'

/** Commands that change the open-tab / agent set → trigger an immediate
 *  runtime-state push so the UI reflects them in ~1s, not at the next heartbeat. */
const PUSH_AFTER = new Set(['launch_agent', 'dispatch', 'switch_agent', 'close_tab'])
import { validateCommand } from './command-validator'
import { loadToken, clearToken, isDevBaseOverride } from './token-store'
import { fleetSessionsDir } from '@/lib/session-paths'
import { FLEET_RUNNER_COMMAND_TYPES_PARAM } from '@/lib/pending-command-contract'

/** Where Claude (and our handoff parser) writes the per-tab session file.
 *  Used by post-flight verification: if the file's mtime advances within a
 *  few seconds of an inject, we know the agent received and reacted. */
const SESSIONS_DIR = fleetSessionsDir()


/** Worktree-per-agent bookkeeping (see @/lib/agent-execution/worktree-workspace).
 *  Tracks, per tab, the primary checkout and the dir the last dispatch actually
 *  launched in — so (a) verification (transcript lookup is cwd-keyed) follows
 *  the agent into its worktree, and (b) close_tab knows where to prune. Runner
 *  restart empties the map; the next dispatch re-prunes, so nothing leaks. */
const worktreeByTab = new Map<string, { primaryDir: string; launchDir: string }>()

const COMMAND_DEDUP_DIR = path.join(os.tmpdir())
function dedupSentinelPath(commandId: string): string {
  return path.join(COMMAND_DEDUP_DIR, `fc-cmd-${commandId}.done`)
}

export type PollerState = 'idle' | 'connecting' | 'connected' | 'error'

export type PollerStatus = {
  state: PollerState
  baseUrl: string
  /** ms epoch of the last successful poll response (command or empty) */
  lastPollAt: number | null
  /** ms epoch of the most recent error */
  lastErrorAt: number | null
  /** Human-readable error message — never include the token */
  lastError: string | null
  /** First 12 chars + "…" so the UI can show which token is in use, never the full secret */
  tokenPrefix: string | null
  /** Number of commands successfully executed in this run */
  commandsHandled: number
  /** Number of commands rejected (unsupported type, etc.) */
  commandsRejected: number
}

type StatusListener = (s: PollerStatus) => void

const listeners = new Set<StatusListener>()
const COMMAND_POLL_IDLE_MS = 2_000
// Hard ceiling on a single wait=0 command poll. With wait=0 the server returns
// immediately, so this only ever fires on a stuck/half-open socket — bounding
// it stops the poller from wedging silently when the backend restarts.
const POLL_FETCH_TIMEOUT_MS = 20_000
let currentStatus: PollerStatus = {
  state: 'idle',
  baseUrl: (process.env.LOKI_WEB_URL || '').trim() || APP_URL,
  lastPollAt: null,
  lastErrorAt: null,
  lastError: null,
  tokenPrefix: null,
  commandsHandled: 0,
  commandsRejected: 0,
}
// Two abort controllers, two scopes:
//   - lifetimeCtrl: outer — aborts on stopPoller(). Cancels everything.
//   - currentFetchCtrl: inner — per-iteration. Bridge-wake aborts THIS one
//     so the loop continues with a fresh fast-drain fetch.
let lifetimeCtrl: AbortController | null = null
let currentFetchCtrl: AbortController | null = null
let running = false
let bridgeHandle: { stop: () => void } | null = null
// Set by the bridge subscriber when a pending_commands INSERT arrives. The
// loop drops the next wait=25 and uses wait=0 to drain immediately.
let pendingWake = false

function runnerPresenceChannel(): 'cloud' | 'local' | null {
  const raw = (process.env.LOKI_RUNNER_PRESENCE_CHANNEL ?? 'local').trim()
  return raw === 'cloud' || raw === 'local' ? raw : null
}

export function onPollerStatus(cb: StatusListener): () => void {
  listeners.add(cb)
  // Fire immediately so subscribers don't wait for the next change.
  try { cb(currentStatus) } catch { /* listener should not throw */ }
  return () => { listeners.delete(cb) }
}

export function getPollerStatus(): PollerStatus {
  return { ...currentStatus }
}

function updateStatus(patch: Partial<PollerStatus>): void {
  currentStatus = { ...currentStatus, ...patch }
  for (const cb of listeners) {
    try { cb(currentStatus) } catch { /* listener should not throw */ }
  }
}


/**
 * Start the poller. Idempotent — calling while already running is a no-op.
 * If no token is saved, transitions to `idle` and waits for `restartPoller()`
 * (called when the user pastes a token or the auto-mint flow saves one).
 */
export function startPoller(): void {
  if (running) return
  const token = loadToken()
  if (!token) {
    console.warn('[poller] not started: no saved token')
    updateStatus({ state: 'idle', tokenPrefix: null, lastError: null, lastErrorAt: null })
    return
  }
  console.log(`[poller] starting against ${currentStatus.baseUrl} with token ${token.slice(0, 12)}…`)
  running = true
  lifetimeCtrl = new AbortController()
  updateStatus({
    state: 'connecting',
    tokenPrefix: token.slice(0, 12) + '…',
    lastError: null,
    lastErrorAt: null,
  })
  // Open the bridge SSE subscription alongside the long-poll loop. The
  // bridge is the fast path (<500ms after INSERT); the long-poll is the
  // safety net. Both drain the same /api/control/commands endpoint with
  // FOR UPDATE SKIP LOCKED, so commands go to exactly one consumer.
  bridgeHandle = startBridgeSubscriber(token, {
    onCommandPending: () => {
        // Wake the polling loop by aborting the in-flight request/sleep. The
        // loop always drains with wait=0; this just removes up to 2s of idle
        // delay when the bridge is healthy.
      pendingWake = true
      currentFetchCtrl?.abort()
    },
    // Interactive terminal fast lane — write keystrokes/resizes straight to the
    // tab's PTY. Independent of the command-drain path, so it cannot affect the
    // autopilot loop.
    onRawKey: ({ tab, b }) => writeRawKey(tab, b),
    onResize: ({ tab, c, r }) => resizePty(tab, c, r),
  })
  void runLoop(token, lifetimeCtrl.signal)
}

export function stopPoller(): void {
  if (!running && !lifetimeCtrl && !bridgeHandle) return
  running = false
  lifetimeCtrl?.abort()
  lifetimeCtrl = null
  currentFetchCtrl?.abort()
  currentFetchCtrl = null
  bridgeHandle?.stop()
  bridgeHandle = null
  pendingWake = false
  updateStatus({ state: 'idle' })
}

export function restartPoller(): void {
  stopPoller()
  startPoller()
}

async function runLoop(token: string, lifetimeSignal: AbortSignal): Promise<void> {
  const base = currentStatus.baseUrl
  console.log(`[poller] loop started; short-poll idle=${COMMAND_POLL_IDLE_MS}ms`)
  // Backoff for connection errors — successful polls reset it. The long-poll
  // already paces normal traffic to ~one request per 25s when there's no work.
  let backoffMs = 1_000

  while (!lifetimeSignal.aborted && running) {
    // Fresh per-iteration controller so a bridge-wake aborts only this fetch,
    // not the loop. pendingWake collapses the next wait=25 to wait=0 — the
    // bridge already told us there's a row to drain.
    currentFetchCtrl = new AbortController()
    const wakeRequested = pendingWake
    pendingWake = false
    try {
      // Use wait=0 short polling. The production long-poll/SSE path is the
      // right architecture eventually, but dogfood showed it can leave desktop
      // commands claimed without visible progress under cloud/bridge edge
      // conditions. A 2s deterministic poll is cheap and makes phone/web
      // control reliable today.
      // Bridge-wake can abort this fetch; the timeout guarantees the loop can
      // NEVER hang forever on a half-open connection (e.g. the backend restarts
      // mid-request during a deploy). Previously the poll had no timeout, so a
      // hung socket left the poller silently wedged with the process still
      // alive — supervision couldn't see it, and the autopilot loop stalled.
      // A timeout aborts only the .any signal (not currentFetchCtrl), so the
      // catch falls through to backoff+retry instead of the bridge-wake `continue`.
      const params = new URLSearchParams({ wait: '0', types: FLEET_RUNNER_COMMAND_TYPES_PARAM })
      const channel = runnerPresenceChannel()
      if (channel) params.set('channel', channel)
      const resp = await fetch(`${base}/api/control/commands?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([currentFetchCtrl.signal, AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS)]),
      })

      if (resp.status === 401 || resp.status === 403) {
        // Token is dead — clear the stale file so the next auto-mint cycle
        // (FleetRunnerAutoMint, which gates on "no existing token") can
        // issue a fresh one from the user's signed-in session instead of
        // leaving them permanently offline. Pre-fix: poller stopped but the
        // bad token persisted, and auto-mint's "if (existing) return" guard
        // kept it stuck. The same fix landed in pusher.ts.
        // Never delete the SHARED token from a dev/preview instance — a 401
        // there means "wrong server", not "dead credential", and would log out
        // the user's real production runner. See isDevBaseOverride.
        if (isDevBaseOverride()) {
          console.warn(`[poller] token rejected (${resp.status}) against dev override ${base}; NOT clearing the shared production token`)
        } else {
          console.warn(`[poller] token rejected (${resp.status}); clearing stale token + stopping`)
          clearToken()
        }
        updateStatus({
          state: 'error',
          lastError: `Token rejected (${resp.status}). Reload the app — auto-mint will issue a fresh token from your signed-in session.`,
          lastErrorAt: Date.now(),
        })
        running = false
        return
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from /api/control/commands`)
      }

      // Successful connection — clear any prior error state.
      updateStatus({
        state: 'connected',
        lastPollAt: Date.now(),
        lastError: null,
        lastErrorAt: null,
      })
      backoffMs = 1_000

      const data = (await resp.json()) as { command: { id: string; type: string; payload: unknown } | null }
      if (data.command) {
        console.log(`[poller] claimed ${data.command.type} command ${data.command.id}`)
        await handleCommand(base, token, data.command)
        // State-changing commands alter the open-tab / agent set. Push the new
        // runtime state immediately (coalesced) so the dashboard + /terminal "My
        // machine" reflect it in ~1s, instead of waiting up to RUNNER_HEARTBEAT_MS
        // (5 min) for the next heartbeat. This is why a freshly-launched agent
        // didn't appear until much later.
        if (PUSH_AFTER.has(data.command.type)) {
          void pushNow().catch(() => { /* next heartbeat picks it up */ })
        }
      } else if (!wakeRequested) {
        await new Promise<void>((r) => setTimeout(r, COMMAND_POLL_IDLE_MS))
      }
    } catch (err) {
      // Two abort sources: lifetimeSignal (stopPoller — exit) vs.
      // currentFetchCtrl (bridge-wake — continue with wait=0 next iter).
      if (lifetimeSignal.aborted) return
      if (currentFetchCtrl?.signal.aborted) continue
      const msg = (err as Error).message || 'unknown error'
      console.warn('[poller] loop error:', msg)
      updateStatus({
        state: 'error',
        lastError: msg,
        lastErrorAt: Date.now(),
      })
      await new Promise<void>((r) => setTimeout(r, backoffMs))
      backoffMs = Math.min(backoffMs * 2, 30_000)
    }
  }
}

/**
 * Post-flight verification for `inject`: did the agent actually receive
 * the prompt? Cheap heuristic — claude (and our session.md format) bump
 * the session file's mtime when an agent picks up a prompt. We snapshot
 * mtime before injection then poll for up to 5s. If it advances → the
 * agent received it. If not → injection landed in a shell, a stalled
 * agent, or zellij ate it.
 *
 * Returns the verification verdict; the caller decides what to do with it.
 */
function sessionFilePath(tab: string): string {
  return path.join(SESSIONS_DIR, `${tab}.md`)
}

function readMtimeMs(file: string): number {
  try { return fs.statSync(file).mtimeMs } catch { return 0 }
}

async function waitForSessionFileBump(tab: string, baselineMtime: number, timeoutMs = 5000): Promise<boolean> {
  const file = sessionFilePath(tab)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cur = readMtimeMs(file)
    if (cur > baselineMtime) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

/**
 * "Did the injected prompt actually submit?" — authoritative check against
 * the CLI's own live session status (~/.claude/sessions/<pid>.json flips off
 * "idle" the moment a prompt starts generating). Agents that don't write
 * live status files (hermes/codex/…) fall back to the output-activity
 * heuristic once, at the deadline.
 */

async function waitForAgentGenerating(dir: string, tab: string, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let sawLiveSession = false
  while (Date.now() < deadline) {
    const live = claudeLiveSessionForDir(readClaudeLiveSessions(), dir)
    if (live) {
      sawLiveSession = true
      // Only a genuinely generating status verifies the submit. "idle" = at
      // the composer; "waiting" = BLOCKED on user input (permission prompt,
      // /login notice) — an inject acked against a "waiting" agent goes
      // nowhere (2026-07-03: agent stuck at a 401 /login notice was acked
      // "injected to running claude" with no warning).
      if (live.status !== 'idle' && live.status !== 'waiting') return true
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return sawLiveSession ? false : isPtyBusy(tab)
}

/**
 * PATCH the pending_commands row done. Always called once per command
 * (success, error, or already-done dedup hit) so a claimed row never
 * lingers waiting for the 90s stale-claim reaper.
 */
type AckPayload = { ok: boolean; error?: string; text?: string; verified?: boolean; warning?: string; workspaceId?: string; deliveredAt?: string }

async function ackCommand(
  base: string,
  token: string,
  command: { id: string; type: string },
  body: AckPayload,
): Promise<void> {
  try {
    console.log(`[poller] acking ${command.type} command ${command.id}: ${body.ok ? 'ok' : 'error'}${body.warning ? ` (${body.warning})` : ''}`)
    await fetch(`${base}/api/control/commands/${command.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ok: body.ok,
        ...(body.error ? { error: body.error } : {}),
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.verified !== undefined ? { verified: body.verified } : {}),
        ...(body.warning ? { warning: body.warning } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (e) {
    // If we can't reach the server to mark done, the next poll will retry the
    // command — the dedup sentinel above keeps the agent from running it twice.
    console.warn('[poller] failed to PATCH command done:', (e as Error).message)
  }
}

/** Non-blocking delay. A blocking sleep here would starve the event loop and
 *  would freeze the event loop (and the bridge SSE) — never use it inside the
 *  async command handlers. */
const asleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function handleCommand(
  base: string,
  token: string,
  command: { id: string; type: string; payload: unknown },
): Promise<void> {
  let ok = false
  let error: string | undefined
  let verified: boolean | undefined
  let warning: string | undefined
  let text: string | undefined
  // Stage 2 (workspace addressing): the runner reports WHICH workspace served
  // the command — today derived from the tab, later an opaque id; consumers
  // address by this, not by name.
  let workspaceId: string | undefined
  let injectedAt: string | undefined
  // Token accounting: set by the dispatch case when a Claude run is delivered;
  // consumed after the ack so tracking only starts for commands that landed.
  let usageTrack: { runId: string; dir: string; deliveredAtMs: number } | null = null
  // Progress heartbeat opens once the prompt verifiably landed (see run-progress.ts).
  let progressTrack: { runId: string; tab: string; dir: string } | null = null

  // Idempotency dedup. If the PATCH ack timed out on a previous run, the
  // server will hand us the same command again. Without this, the prompt
  // fires twice — which CAN be data loss (the agent runs both copies).
  // The sentinel survives across poller restarts but not reboots; that's
  // the right window (after reboot, queued commands are stale enough that
  // re-dispatch is fine).
  const sentinel = dedupSentinelPath(command.id)
  if (fs.existsSync(sentinel)) {
    console.log(`[poller] dedup hit for ${command.type} ${command.id} — already done, acking only`)
    await ackCommand(base, token, command, { ok: true, warning: 'already-done' })
    return
  }

  // Validate at the IPC boundary BEFORE touching any executor. Pre-v0.7
  // the payload was an unchecked cast; once the autonomous scheduler (v0.7+)
  // starts queuing pending_commands unattended, an unchecked cast lets a
  // typo'd cron payload through to the PTY writer which would fail in a
  // less actionable place. See command-validator.ts for the contract.
  const validation = validateCommand(command)
  if (!validation.ok) {
    error = validation.error
  } else try {
    switch (validation.command.type) {
      case 'inject': {
        const { tab, prompt } = validation.command.payload
        const baseline = readMtimeMs(sessionFilePath(tab))
        // Owned PTY or nothing. A bare inject cannot start an agent; the cloud
        // enqueues a DISPATCH (cold start) for a project with no live session,
        // so a miss here is a real error, reported as one — never a keystroke
        // typed into a guessed terminal tab.
        if (!isPtyBacked(tab)) {
          throw new Error(`no running agent for "${tab}" on this runner — dispatch to start one`)
        }
        injectPty(tab, prompt)
        ok = true
        // Post-flight verification — best effort, doesn't block the ack on
        // failure (we still report ok:true because the keystrokes landed).
        verified = await waitForSessionFileBump(tab, baseline, 5000)
        if (!verified) {
          warning = 'delivered but agent did not pick up within 5s (agent may be hung or idle)'
        }
        break
      }
      case 'close_tab': {
        const { tab } = validation.command.payload
        if (isPtyBacked(tab)) {
          await terminatePty(tab)
          clearHandoffSentinel(tab)
        } else {
          text = `no running agent for "${tab}" — nothing to close`
        }
        // Worktree cleanup: sweep this tab's CLEAN worktrees (dirty ones are
        // never touched — an agent's unfinished work outlives its session).
        const wt = worktreeByTab.get(tab)
        if (wt) {
          try { pruneWorktrees(tab, wt.primaryDir) } catch { /* best-effort */ }
          worktreeByTab.delete(tab)
        }
        ok = true
        break
      }
      case 'launch_agent': {
        const { tab, dir, agent, model, initialPrompt } = validation.command.payload
        assertKnownLaunchAgent(agent)
        const prompt = initialPrompt?.trim()
        // Own the agent's PTY. A failed spawn is a failed launch, reported as
        // such — there is no other place for the agent to run.
        await launchAgentPty(tab, dir, agent as AgentOption, model)
        clearHandoffSentinel(tab)
        // Inject the initial prompt once the agent is actually up, not on a blind timer.
        if (prompt) {
          void waitForPtyReady(tab).then((ready) => setTimeout(() => {
            try { injectPty(tab, prompt) } catch (e) { console.warn('[poller] initial prompt after PTY launch failed:', (e as Error).message) }
          }, ready ? 1500 : 0))
        }
        ok = true
        break
      }
      case 'dispatch': {
        // The reliable product loop, done where we have ground truth (the
        // local machine): ensure the tab + agent, then inject — and VERIFY,
        // so the cloud/UI learns the real outcome instead of a fake ok.
        const { tab, dir, agent, model, prompt, runId, sessionId } = validation.command.payload
        assertKnownLaunchAgent(agent)
        // Worktree-per-agent (opt-in via LOKI_WORKTREE_DISPATCH): a FRESH
        // dispatch launch runs in its own git worktree so it can never collide
        // with the primary checkout or another agent on a shared index/HEAD
        // (the `git add -A` swallow, 2026-07-17). Injecting into an already-live
        // session never remaps — we follow wherever that session was launched
        // (worktreeByTab), because verification (transcript lookup) is cwd-keyed.
        const ptyAlreadyLive = isPtyBacked(tab)
        let effDir = ptyAlreadyLive ? (worktreeByTab.get(tab)?.launchDir ?? dir) : dir
        let effPrompt = prompt
        // Derived run-tabs ("<project>~<runId8>", same-project parallel dispatch)
        // FORCE worktree isolation regardless of the env flag — two agents in one
        // checkout is the incident this feature exists to kill.
        if ((WORKTREE_DISPATCH_ENABLED || isDerivedRunTab(tab)) && runId && !ptyAlreadyLive) {
          pruneWorktrees(tab, dir) // sweep clean leftovers before adding one
          effDir = ensureWorktreeWorkspace(tab, dir, runId)
          if (effDir !== dir) effPrompt = `${worktreePromptNote(runId)}\n\n${prompt}`
        }
        worktreeByTab.set(tab, { primaryDir: dir, launchDir: effDir })
        // A workspace that is not on this machine cannot be worked on here.
        // The box clones on demand (LOKI_BOX_PREPARE); a laptop runner
        // does not, and launching claude in a directory that does not exist
        // produced three "inject did not stick" failures for a box-rooted
        // project on 2026-09-10 while the box sat idle. Routing now keeps such
        // projects on the box; this is the runner's own refusal in case a
        // command still arrives, so the ack names the real cause.
        if (
          !ptyAlreadyLive &&
          process.env.LOKI_BOX_PREPARE !== 'true' &&
          !fs.existsSync(effDir)
        ) {
          error = `workspace ${effDir} does not exist on this machine — the project lives on another builder; nothing was launched here`
          break
        }
        // Token accounting window opens at delivery. Claude-only: the usage
        // collector reads ~/.claude transcripts, which other agents don't write.
        //
        // Track the dir the agent will REALLY run in. `effDir` is still the
        // dispatch's laptop path on the box; the box-local resolution happens
        // later inside launchAgentPty and never came back out, so this recorded
        // `/home/g/dev/<p>` → slug `-home-g-dev-<p>` → a transcript directory
        // that cannot exist on the box → every report silently skipped. That is
        // why the first day of token accounting wrote zero rows (#145).
        // Identity on the laptop, where the requested dir exists.
        if (runId) progressTrack = { runId, tab, dir: resolveRunnerWorkspaceDir(tab, effDir) }
        if (runId && agent === 'claude') {
          usageTrack = {
            runId,
            dir: resolveRunnerWorkspaceDir(tab, effDir),
            deliveredAtMs: Date.now(),
          }
        }
        // Own the agent's PTY. A failed spawn fails the dispatch; the cloud
        // closes the run and says so. Nothing else can host the agent here.
        {
          let launched = false
          if (!ptyAlreadyLive) {
            // A live PTY already is the current session: inject in place.
            // Resume is only for a fresh PTY, so runner restarts never kill a
            // session merely because process-local bookkeeping was lost.
            await launchAgentPty(tab, effDir, agent as AgentOption, model, sessionId)
            clearHandoffSentinel(tab)
            launched = true
            // Wait for the agent to show life, then settle before pasting.
            if (await waitForPtyReady(tab, 15000)) await asleep(1800)
          }
          {
            // Non-Claude CLIs do not expose Claude's session-status files.
            // Subscribe BEFORE writing so short output bursts cannot happen
            // between injection and verification setup.
            let outputAfterInject = agent === 'claude' ? null : waitForPtyOutput(tab, 8000)
            injectPty(tab, effPrompt)
            // The moment the prompt reached the agent — reported in the ack so the
            // server stamps delivery HERE, not after the up-to-8s generating check
            // below. A task that finishes inside that check would otherwise write
            // a handoff that "predates" its own delivery and never close its run.
            injectedAt = new Date().toISOString()
            // Verify against the CLI's OWN session status (~/.claude/sessions/
            // <pid>.json): a submitted prompt flips status off "idle". The
            // previous output-activity heuristic (isPtyBusy) was fooled by
            // boot-screen redraw — on a fresh clone the trust-folder dialog
            // ate the paste (the injected Enter accepted the dialog), the TUI
            // kept redrawing, and six agents were acked "injected" while
            // sitting idle at an empty composer (2026-07-02). isPtyBusy stays
            // as the fallback for agents that don't write live status files.
            verified = outputAfterInject
              ? await outputAfterInject
              : await waitForAgentGenerating(effDir, tab, 8000)
            if (!verified) {
              // Most likely failure: the prompt is SITTING in the composer
              // unsubmitted (paste landed, Enter got swallowed). A bare Enter
              // submits it without duplicating the text; verifiably-idle means
              // it can't interrupt a turn.
              outputAfterInject = agent === 'claude' ? null : waitForPtyOutput(tab, 6000)
              writeRawKey(tab, '\r')
              verified = outputAfterInject
                ? await outputAfterInject
                : await waitForAgentGenerating(effDir, tab, 6000)
            }
            if (!verified) {
              // Composer was actually empty (boot dialog ate the paste) —
              // re-inject the full prompt once.
              outputAfterInject = agent === 'claude' ? null : waitForPtyOutput(tab, 8000)
              injectPty(tab, effPrompt)
              verified = outputAfterInject
                ? await outputAfterInject
                : await waitForAgentGenerating(effDir, tab, 8000)
            }
            ok = true
            workspaceId = runnerWorkspaceId(tab)
            text = launched ? `launched ${agent} (pty) + injected` : `injected to running ${agent} (pty)`
            // Auth failure is a HARD failure, and it must WIN over a "verified"
            // success: a 401 emits the "/login" error, which counts as output
            // and can false-positive waitForAgentGenerating — so a dispatch that
            // never ran was being acked ok/verified with the UI cheerfully
            // saying "starting shortly" (dogfood 2026-07-10: dispatches 401'd
            // while every layer reported success). The 401 also lands in the
            // transcript slightly AFTER the generate-verify window, so a single
            // check races it. Poll for ~12s REGARDLESS of verify (a verified 401
            // is exactly the false-positive we must catch). This runs on the
            // background ack, not the operator's initial feedback, so the wait
            // never delays the person; on a real success every check is false.
            let authFailed = false
            // Resolved dir, not the dispatch's: on the box `effDir` is still the
            // laptop path, whose transcript slug can't exist there — so this
            // canary silently never fired on the very runner whose dead
            // credentials it was written for (2026-07-02/03).
            const transcriptDir = resolveRunnerWorkspaceDir(tab, effDir)
            for (let i = 0; i < 6 && !authFailed; i++) {
              authFailed = detectAuthFailure(transcriptDir)
              if (!authFailed && i < 5) await asleep(2000)
            }
            if (authFailed) {
              ok = false
              verified = false
              warning = undefined
              error =
                `${agent} is not authenticated (401 / login required) — the prompt was delivered but the agent can't run. ` +
                `On the runner host, remove any stale ~/.claude/.credentials.json and set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token).`
            } else if (!verified) {
              // Unverified inject is a soft failure for the captain loop: "Install
              // dispatched" with no generation is how botsmann stayed Not live
              // while Activity looked busy. Prefer Failed over fake success.
              ok = false
              warning = undefined
              error = `${text}, but Loki could not verify generation. ${explainPtyDispatchFailure(tab, agent as AgentOption)}`
            }
            break
          }
        }
        break
      }
      case 'switch_agent': {
        const { tab, dir, toAgent, fromAgent, model } = validation.command.payload
        assertKnownLaunchAgent(toAgent)
        // Switching = replacing the owned process: terminate, settle, respawn.
        void fromAgent
        if (isPtyBacked(tab)) {
          await terminatePty(tab)
          await asleep(400)
        }
        await launchAgentPty(tab, dir, toAgent as AgentOption, model)
        clearHandoffSentinel(tab)
        ok = true
        break
      }
      case 'auto_continue': {
        applyAutoContinue(validation.command.payload.tab, validation.command.payload.enabled)
        ok = true
        break
      }
      case 'install_cli': {
        await openInstallerPty(validation.command.payload.agent)
        ok = true
        break
      }
      case 'peek_tab': {
        const { tab } = validation.command.payload
        // Owned PTY → its in-memory buffer (non-blocking). No PTY, no screen:
        // there is no other terminal on this machine to dump.
        const content = peekPtyBuffer(tab) ?? `No running agent for "${tab}" on this runner.`
        ok = true
        await ackCommand(base, token, command, { ok, text: content })
        console.log(`[poller] handled ${command.type} command ${command.id}`)
        updateStatus({ commandsHandled: currentStatus.commandsHandled + 1 })
        return
      }
      case 'peek_start': {
        // Live terminal: start streaming this tab's screen to the cloud until a
        // peek_stop (last viewer left). See docs/architecture/embedded-terminal.md.
        // Stop first so a stream started before the PTY launch upgrades to the
        // owned-PTY byte stream once the agent is up.
        stopPeek(validation.command.payload.tab)
        startPeek(base, token, validation.command.payload.tab)
        ok = true
        break
      }
      case 'peek_stop': {
        stopPeek(validation.command.payload.tab)
        ok = true
        break
      }
    }
  } catch (e) {
    ok = false
    error = (e as Error).message ?? 'unknown error'
  }

  // Drop the dedup sentinel on success so a re-served command (PATCH ack
  // race) doesn't get re-executed. Skip for error paths because retry is
  // the right behavior there.
  if (ok) {
    try { fs.writeFileSync(sentinel, '1', 'utf-8') } catch { /* tmpdir unwritable — fall back to "best effort" */ }
  }

  await ackCommand(base, token, command, { ok, error, verified, warning, text, workspaceId, deliveredAt: injectedAt })

  // Only start metering runs whose prompt actually landed — a nacked dispatch
  // is closed server-side and would never answer done:true.
  if (ok && usageTrack) trackRunUsage(usageTrack)
  // Same bar for the heartbeat: only a run whose prompt landed can make progress.
  if (ok && !warning && progressTrack)
    startRunProgress(base, token, progressTrack.runId, progressTrack.tab, progressTrack.dir)

  if (ok) {
    console.log(`[poller] handled ${command.type} command ${command.id}`)
    updateStatus({ commandsHandled: currentStatus.commandsHandled + 1 })
  } else {
    console.warn(`[poller] rejected ${command.type} command ${command.id}: ${error ?? 'unknown error'}`)
    updateStatus({ commandsRejected: currentStatus.commandsRejected + 1 })
  }
}

function assertKnownLaunchAgent(agent: string): void {
  if (!listAgentRegistry().some((entry) => entry.id === agent && entry.capabilities.tabSwitching)) {
    throw new Error(`unknown or non-launchable agent: ${agent}`)
  }
}

function clearHandoffSentinel(tab: string): void {
  try { fs.unlinkSync(`/tmp/agent-handoff-sent-${tab}`) } catch { /* absent */ }
}

function autoContinueSentinel(tab: string): string {
  return `/tmp/${APP_SLUG}-auto-continue-${tab.toLowerCase()}`
}

function applyAutoContinue(tab: string, enabled: boolean): void {
  if (enabled) {
    try { fs.unlinkSync(autoContinueSentinel(tab)) } catch { /* absent */ }
  } else {
    fs.writeFileSync(autoContinueSentinel(tab), 'off', 'utf8')
  }
}

/**
 * Run an agent CLI's installer in an owned PTY named `Install <label>`, so it
 * streams to the web terminal like any agent session. Login-interactive shell
 * for the same reason agent launches use one: PATH is only complete after the
 * profile/nvm chain loads.
 */
async function openInstallerPty(agent: string): Promise<void> {
  const command = getAgentInstallCommand(agent as AgentOption)
  if (!command) throw new Error(`unknown agent for install: ${agent}`)
  const label = listAgentRegistry().find((entry) => entry.id === agent)?.label ?? agent
  const tab = `Install ${label}`
  await executor.provision({
    id: runnerWorkspaceId(tab),
    cwd: os.homedir(),
    command: 'bash',
    args: ['-lic', command],
  })
}

/**
 * Format a tray tooltip from the live status. Pure function so the index/main
 * module can call it without re-implementing the UX shape.
 */
export function formatTrayTooltip(s: PollerStatus): string {
  const head = 'Fleet Runner'
  switch (s.state) {
    case 'idle':
      return `${head} · waiting for token (paste from Settings → Agent tokens)`
    case 'connecting':
      return `${head} · connecting…`
    case 'connected': {
      const ago = s.lastPollAt ? Math.max(0, Math.floor((Date.now() - s.lastPollAt) / 1000)) : null
      const counter = s.commandsHandled > 0 ? ` · ${s.commandsHandled} ran` : ''
      return `${head} · connected${ago !== null ? ` · last poll ${ago}s ago` : ''}${counter}`
    }
    case 'error':
      return `${head} · ${s.lastError ?? 'error'}`
  }
}
