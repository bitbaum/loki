/**
 * Fleet Runner runtime-state pusher.
 *
 * The cloud control plane shows "Local daemon offline" until somebody POSTs
 * to /api/control/runtime-state with this user's bearer token. v0.4.0 — v0.4.3
 * shipped the poller (cloud → local commands) but not the pusher (local →
 * cloud heartbeat), so the web UI rendered the daemon as offline even when
 * Fleet Runner was running and the poller was happily long-polling. Dispatch
 * still worked, but the user couldn't tell the daemon was alive.
 *
 * This pusher fixes that. Every PUSH_INTERVAL_MS it sends:
 *   - openTabs: live list of owned-PTY tab names (so /control's per-project
 *     "tab open" badges stay accurate)
 *   - projects: empty array (per-project session details are written by
 *     the embedded watcher to its own table; this pusher only signals
 *     daemon presence)
 *   - observedAt: ms epoch
 *
 * On 401/403 we stop — token is invalid and retrying is pointless until the
 * user pastes a new one (which calls restartPusher via the same hook the
 * poller uses). All other transient errors swallow silently and continue —
 * the daemon's "offline" UI label is the worst case, no data is lost.
 *
 * Why not piggyback on the poller? Conceptual: poller is reactive (waits for
 * commands), pusher is active (announces presence). Coupling them means a
 * dispatch-light user with no queued work would never push because the
 * poller blocks on the long-poll for 25s at a time, and during that block
 * the pusher's 30s cadence would slip. Two timers, two responsibilities.
 */

import { readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { APP_URL } from '@/config/brand'
import { readPowerSource } from './power-source'
import { DAEMON_HEARTBEAT_MS } from '@/lib/constants/daemon'
import { parseProjectsConf, resolveEffectiveTab } from '@/lib/agent-config'
import { getAgentProcesses, readFastState } from '@/lib/control-fast-state'
import { listAgentRegistry } from '@/lib/agent-registry'
import type { PaneRecord } from '@/db/schema/runtime-snapshots'
import { loadToken, clearToken, isDevBaseOverride } from './token-store'
import { listPtyTabs, runnerWorkspaceId } from './pty-runtime'
import { fleetSessionsDir, legacyClaudeSessionsDir } from '@/lib/session-paths'

// Runner version is reported in the runtime-state heartbeat. The desktop sets
// LOKI_RUNNER_VERSION from app.getVersion() inside app.whenReady() (so
// this module stays Electron-free and importable by the headless box-runner);
// the box-runner derives it from its deployed package at startup.
// Read lazily so hosts that set the version after this module is imported
// still win over a stale value. Both failure modes were observed: every
// packaged desktop reported "dev" (whenReady runs after the static import),
// and the box unit carried a hardcoded box-0.8.9 for three releases — both
// because this was a load-time const.
const runnerVersion = (): string => process.env.LOKI_RUNNER_VERSION ?? 'dev'


// v0.6 — liveness heartbeat ONLY. Actual state changes are pushed via
// pushNow() the moment the watcher detects an agent file change (wired
// from index.ts's onIdle hook). So the steady-state cadence is one
// heartbeat every five minutes plus N pushes per real event. For an
// idle fleet (most minutes), the total drops from one push per minute
// (v0.5) to one push per five minutes (v0.6) — 5× reduction on the
// always-on heartbeat path.
//
// The web's daemon-offline threshold is now derived from this cadence in
// lib/constants/daemon.ts — see DAEMON_OFFLINE_THRESHOLD_MS. Pre-2026-06-06
// they were edited independently and disagreed (90s threshold against a
// 5min heartbeat), causing flicker. Bumping THIS constant auto-bumps the
// threshold to the right multiple.
const PUSH_INTERVAL_MS = DAEMON_HEARTBEAT_MS

const BASE_URL = (process.env.LOKI_WEB_URL || '').trim() || APP_URL

// When THIS process started — captured once, at module load. Every agent PTY
// this runner owns lives and dies with the process, so a boot time newer than
// a run's last session event is proof that session is gone. The server closes
// those runs from it instead of leaving them "waiting" for the hourly reaper
// (src/lib/orchestration/runner-restart.ts).
const BOOTED_AT = Date.now()

let timer: NodeJS.Timeout | null = null
let stopped = false

async function pushOnce(): Promise<void> {
  const token = loadToken()
  if (!token) return

  let openTabs: string[] = []
  let projects: ReturnType<typeof buildProjectRuntimePayload> = []
  let installedAgents: string[] = []
  let panes: PaneRecord[] = []
  // "Open tabs" = tabs backed by a live owned PTY. Nothing else hosts an agent
  // on this runner, so nothing else is a tab.
  try {
    openTabs = listPtyTabs()
  } catch { /* executor not ready — push an empty list so presence still lands */ }
  try {
    installedAgents = listAgentRegistry()
      .filter((entry) => entry.available)
      .map((entry) => entry.id)
    projects = buildProjectRuntimePayload(openTabs)
    panes = buildPaneTopology(openTabs)
  } catch (err) {
    // Rich project state is best-effort. Keep the openTabs heartbeat flowing
    // so the web UI can still show the daemon as connected.
    console.warn('[pusher] project runtime snapshot failed:', (err as Error).message)
  }

  // Deliberately outside the try above: a power probe must not be able to take
  // the project payload down with it, and readPowerSource never throws anyway.
  const powerSource = readPowerSource()

  try {
    const resp = await fetch(`${BASE_URL}/api/control/runtime-state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        openTabs,
        installedAgents,
        projects,
        panes,
        runnerVersion: runnerVersion(),
        bootedAt: BOOTED_AT,
        // Rides the heartbeat so it expires with it: a stale "ac" must never
        // vouch for a laptop that has since gone to sleep. Omitted entirely
        // when undeterminable — the server reads absence as UNKNOWN, and
        // routing only ever acts on positive knowledge.
        ...(powerSource ? { powerSource } : {}),
        observedAt: Date.now(),
      }),
      // Bound the push. Without this, a single hung runtime-state request never
      // resolves → pushOnce never returns → the heartbeat silently dies and the
      // dashboard freezes on stale state (agents stop appearing). Same lesson as
      // the command ack: every runner→cloud fetch must be time-boxed.
      signal: AbortSignal.timeout(12_000),
    })
    if (resp.status === 401 || resp.status === 403) {
      // Token is dead — the server doesn't recognize it. Delete the file
      // so FleetRunnerAutoMint can mint a fresh one next time /control loads
      // (its bail check is "if (existing) return", which used to keep the
      // user stuck with a permanently-rejected token).
      // Dev/preview instances must not delete the SHARED token on 401 — that
      // would log out the production runner sharing this file. See poller.ts.
      if (isDevBaseOverride()) {
        console.warn(`[pusher] runtime-state token rejected against dev override ${BASE_URL}; NOT clearing the shared production token`)
      } else {
        console.warn('[pusher] runtime-state token rejected; clearing stale token + stopping pusher')
        clearToken()
      }
      stopPusher()
      return
    }
    if (!resp.ok) {
      // Transient — log once, keep going on next tick.
      console.warn(`[pusher] runtime-state POST ${resp.status}`)
    }
  } catch (err) {
    // Network blip, DNS failure, etc. — non-fatal, retry next tick.
    console.warn('[pusher] runtime-state push failed:', (err as Error).message)
  }
}

type ProjectRuntimePayload = {
  tab: string
  workspaceId?: string
  observedAt: number
  agentRunning: boolean
  tabOpen: boolean
  activeAgents: string[]
  currentPromptKey?: string | null
  currentPromptLabel?: string | null
  currentPromptStartedAt?: number | null
  readyAt?: number | null
  lockAt?: number | null
  closingAt?: number | null
  closedAt?: number | null
  sessionDone?: string
  sessionStatus?: string
  sessionNext?: string
  sessionTests?: string
  sessionTodos?: string
  sessionHealth?: string
  /** Structured loop-control fields written by the agent itself. See
   *  src/lib/orchestration/contract.ts and the OC 2026-06-08 incident.
   *  Sourced from `block-reason:` and `no-op-count:` lines in session.md;
   *  optional because pre-2026-06-08 sessions don't emit them. */
  sessionBlockReason?: string
  sessionNoOpCount?: number
  sessionUpdatedAt?: number | null
}

/**
 * Build the per-pane topology: for every live agent process, emit one
 * PaneRecord naming the tab it belongs to and the agent CLI running in it.
 * This is what lets the UI label a tab "claude" vs "grok" instead of guessing.
 * paneIndex is the array position within the tab — stable for sort but doesn't
 * correspond to any terminal's pane index (there is no multiplexer; panes are
 * panes with no cwd or command, so there is nothing cheaper to read).
 * Stable order is the contract.
 *
 * Tab resolution walks two sources, in order:
 *   1. agent-projects.conf, which names the tab for a dir explicitly.
 *   2. the process's own cwd basename — because conf is a LEGACY laptop
 *      dotfile. The headless box never had one (it clones on demand), and
 *      laptops have stopped maintaining it, so a conf-only walk emitted ZERO
 *      panes on both channels and the agent badge could never populate. This
 *      is the same trap projectEntries() below already learned; the running
 *      processes are the ground truth this payload exists to report.
 *
 * A process we cannot tie to an open tab by either is dropped.
 * Emitting a guess would be worse than emitting nothing: the UI would
 * confidently name the wrong agent.
 */
function buildPaneTopology(openTabs: string[]): PaneRecord[] {
  const registry = listAgentRegistry()
  const agentProcesses = getAgentProcesses(registry)
  const conf = parseProjectsConf()

  const byTab = new Map<string, typeof agentProcesses>()
  for (const p of agentProcesses) {
    const confEntry = conf.find(({ dir }) => p.cwd === dir || p.cwd.startsWith(`${dir}/`))
    const rawTab = confEntry?.tab ?? (p.cwd.split('/').filter(Boolean).pop() ?? p.cwd)
    const resolvedTab = resolveEffectiveTab(rawTab, openTabs)
    const openTab = openTabs.find((t) => t.toLowerCase() === resolvedTab.toLowerCase())
    if (!openTab) continue
    // Key on the tab name as the UI knows it, so records join cleanly.
    const list = byTab.get(openTab) ?? []
    list.push(p)
    byTab.set(openTab, list)
  }

  const records: PaneRecord[] = []
  for (const [tab, matches] of byTab) {
    // Stable sort by (agentId, cwd) so paneIndex doesn't churn between
    // heartbeats. AgentProcess has no pid field; this is the next best key.
    matches
      .sort((a, b) => (a.agentId + a.cwd).localeCompare(b.agentId + b.cwd))
      .forEach((p, i) => {
        records.push({
          tab,
          paneIndex: i,
          agentCli: p.agentId,
          cwd: p.cwd,
        })
      })
  }
  return records
}

/**
 * Project registry for the runtime payload. The desktop reads the user's
 * claude-projects.conf; the HEADLESS BOX has no such dotfile — it clones
 * repos on demand (box-prepare) under a dev root. With an empty conf the
 * pusher used to push ZERO project entries, so project_states was only ever
 * fed by the laptop runner: when the laptop slept, the cloud UI froze on a
 * days-old snapshot while real PTY agents ran unseen (2026-07-02 incident).
 * Fallback: derive {tab, dir} from the agent processes actually running —
 * the PTYs are the ground truth the payload exists to report.
 *
 * Session-handoff merge (2026-07-14): process-derived entries vanish the moment
 * the agent EXITS — which is exactly when its final `status: ready` handoff is
 * written. On the conf-less box the finished project dropped out of the payload
 * before its handoff was ever pushed, so runs never closed and the reaper
 * stamped every completed autopilot run `timeout` (14 days, zero recorded
 * successes). A project with a session handoff on disk is therefore always
 * included, agent running or not.
 */
/** Map a process cwd inside a `.claude/worktrees/<name>` checkout back to the
 *  repo root that owns it. A worktree is an execution detail of its project,
 *  never a project of its own. */
function resolveProjectRoot(cwd: string): string {
  const marker = '/.claude/worktrees/'
  const i = cwd.indexOf(marker)
  return i === -1 ? cwd : cwd.slice(0, i)
}

function projectEntries(agentProcesses: ReturnType<typeof getAgentProcesses>): { tab: string; dir: string }[] {
  const seen = new Set<string>()
  const out: { tab: string; dir: string }[] = []
  const add = (tab: string, dir: string) => {
    if (!tab || seen.has(tab.toLowerCase())) return
    seen.add(tab.toLowerCase())
    out.push({ tab, dir })
  }
  for (const entry of parseProjectsConf()) add(entry.tab, entry.dir)
  // Sessions auto-enter isolated worktrees (<repo>/.claude/worktrees/<name>),
  // so a process's cwd basename is the WORKTREE name, not the project. Keying
  // by it pushed ghost rows ("control-truth") while the real project's row
  // froze and expired — loki read "Not running" with an agent actively
  // working in it (2026-08-13). Resolve the repo root before deriving the tab.
  for (const p of agentProcesses) {
    const root = resolveProjectRoot(p.cwd)
    add(root.split('/').filter(Boolean).pop() ?? root, root)
  }
  // Projects whose agent already exited but whose handoff awaits pushing.
  // parseSession reads by tab name, so the dir here is only used for process
  // matching — the dev-root convention path is correct on both box and laptop,
  // and for an exited agent nothing matches it, which is the truth.
  for (const sessionsDir of [fleetSessionsDir(), legacyClaudeSessionsDir()]) {
    try {
      for (const f of readdirSync(sessionsDir)) {
        if (!f.endsWith('.md')) continue
        const tab = f.slice(0, -3)
        add(tab, join(homedir(), 'dev', tab))
      }
    } catch { /* no sessions dir yet — nothing to merge */ }
  }
  return out
}

function buildProjectRuntimePayload(openTabs: string[]): ProjectRuntimePayload[] {
  const agentRegistry = listAgentRegistry()
  const agentProcesses = getAgentProcesses(agentRegistry)
  const projects = projectEntries(agentProcesses).map(({ tab, dir }) => {
    const resolvedTab = resolveEffectiveTab(tab, openTabs)
    const projectProcesses = agentProcesses.filter((p) => p.cwd === dir || p.cwd.startsWith(`${dir}/`))
    const activeAgents = [...new Set(projectProcesses.map((p) => p.agentId))]
    const agentId = activeAgents[0]
    const registryEntry = agentId ? agentRegistry.find((entry) => entry.id === agentId) : null
    return {
      canonicalTab: tab,
      tab: resolvedTab,
      dir,
      activeAgents,
      sessionLifecycleSignals: projectProcesses.length > 0
        ? projectProcesses.some((p) => p.sessionLifecycleSignals)
        : registryEntry?.capabilities.sessionLifecycleSignals ?? true,
      tabOpen: openTabs.some((openTab) => openTab.toLowerCase() === resolvedTab.toLowerCase()),
    }
  })
  const agentCwds = agentProcesses.map((p) => p.cwd)
  const observedAt = Date.now()
  return readFastState(projects, agentCwds).map((state, index) => ({
    tab: projects[index]?.canonicalTab ?? state.tab,
    workspaceId: runnerWorkspaceId(projects[index]?.canonicalTab ?? state.tab),
    observedAt,
    agentRunning: state.agentRunning,
    tabOpen: state.tabOpen,
    activeAgents: state.activeAgents,
    currentPromptKey: state.currentPrompt?.key ?? null,
    currentPromptLabel: state.currentPrompt?.label ?? null,
    currentPromptStartedAt: state.currentPrompt?.startedAt ?? null,
    readyAt: state.readyAt,
    lockAt: state.lockAt,
    closingAt: state.closingAt,
    closedAt: state.closedAt,
    sessionStatus: state.session?.status,
    sessionDone: state.session?.done,
    sessionNext: state.session?.next,
    sessionTests: state.session?.tests,
    sessionTodos: state.session?.todos,
    sessionHealth: state.session?.health,
    sessionTsc: state.session?.tsc,
    sessionLint: state.session?.lint,
    sessionCommit: state.session?.commit,
    sessionBlockReason: state.session?.blockReason,
    sessionNoOpCount: state.session?.noOpCount,
    sessionUpdatedAt: state.session?.mtime ? Math.floor(state.session.mtime / 1000) : null,
  }))
}

/**
 * Start the runtime-state pusher. Idempotent — calling while already running
 * is a no-op. Fires once immediately (so the daemon shows online within
 * seconds of launch, not after the first 30s tick) then every
 * PUSH_INTERVAL_MS.
 */
export function startPusher(): void {
  if (timer) return
  stopped = false
  // Fire-and-forget: don't await on launch so we don't delay the rest of
  // whenReady. Subsequent pushes are also fire-and-forget.
  void pushOnce()
  timer = setInterval(() => {
    if (!stopped) void pushOnce()
  }, PUSH_INTERVAL_MS)
}

export function stopPusher(): void {
  stopped = true
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/**
 * Force an immediate push outside the heartbeat schedule. Called when
 * a local event occurred that the cloud should learn about NOW — e.g.,
 * an agent went idle (worker.idle from the embedded watcher), a Zellij
 * tab opened or closed, or a deep-link auth just landed a new token.
 *
 * Coalesced via a tiny lock: if a push is already in-flight, the next
 * call skips. The next event after the in-flight one finishes triggers
 * a fresh push. This stops a burst (e.g., three handoffs in two seconds)
 * from queuing three round-trips to the cloud — one is enough because
 * the payload sends the whole openTabs list anyway.
 */
let pushNowInFlight = false
export async function pushNow(): Promise<void> {
  if (stopped || pushNowInFlight) return
  pushNowInFlight = true
  try {
    await pushOnce()
  } finally {
    pushNowInFlight = false
  }
}

/** Called when a new token is saved (paste flow, deep-link auth). */
export function restartPusher(): void {
  stopPusher()
  startPusher()
}
