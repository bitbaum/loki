/**
 * Runner side of the plain shell (src/lib/shell-session.ts).
 *
 * A shell is a bash LOGIN shell in a PTY this runner owns — the same owned-PTY
 * executor every agent uses, keyed `runner:<tab>`, so peek-stream shows it,
 * the bridge's rawkey lane types into it, close_tab ends it, and tab-memory
 * brings it back after a restart. What differs from an agent is only what is
 * NOT there: no project, no agent CLI, no inject wrapper, no engine keys.
 *
 * Refusals live here too, not only on the server: a runner whose unit says
 * LOKI_SHELL=off (tenant units) or that runs sealed builds never opens one,
 * and no queued command except open/close/peek may name a shell tab.
 */
import os from 'os'
import { executor } from '@/lib/agent-execution'
import {
  SHELL_MAX_OPEN,
  SHELL_REFUSALS,
  isShellTab,
  runnerOffersShell,
} from '@/lib/shell-session'
import { APP_URL } from '@/config/brand'
import { loadToken } from './token-store'
import { EXIT_SETTLE_MS, forgetTab, rememberTab } from './tab-memory'
import { listPtyTabs, runnerWorkspaceId } from './pty-runtime'

const exitWatch = new Map<string, () => void>()

/** Where a shell starts: LOKI_SHELL_DIR, else the runner user's home. */
export function shellStartDir(): string {
  return (process.env.LOKI_SHELL_DIR ?? '').trim() || os.homedir()
}

function channel(): 'cloud' | 'local' {
  return (process.env.LOKI_RUNNER_PRESENCE_CHANNEL ?? 'local').trim() === 'cloud' ? 'cloud' : 'local'
}

/** Tell the web app a shell started or ended — host and exit code, no content. */
export async function reportShellEvent(
  tab: string,
  event: 'started' | 'ended',
  extra: { exitCode?: number | null } = {},
): Promise<void> {
  const token = loadToken()
  if (!token) return
  const base = (process.env.LOKI_WEB_URL || '').trim() || APP_URL
  await fetch(`${base}/api/shell/event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tab,
      event,
      channel: channel(),
      host: os.hostname(),
      user: os.userInfo().username,
      ...(extra.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
    }),
  }).catch(() => {
    /* the web side's own rows are the authoritative ones */
  })
}

/** How many shells this runner holds open right now. */
export function openShellCount(): number {
  return listPtyTabs().filter(isShellTab).length
}

/**
 * Open (or re-attach to) a shell. Throws with the reason when this runner will
 * not: switched off, sealed, not a shell tab name, or already at the cap.
 */
export async function openShellPty(
  tab: string,
  opts: { cols?: number; rows?: number; restored?: boolean } = {},
): Promise<void> {
  if (!isShellTab(tab)) throw new Error('not a shell tab')
  if (!runnerOffersShell(process.env)) throw new Error(SHELL_REFUSALS.sandboxed)
  const id = runnerWorkspaceId(tab)
  const live = executor.get(id)
  if (live && live.status !== 'exited') return
  if (openShellCount() >= SHELL_MAX_OPEN) throw new Error(SHELL_REFUSALS['too-many'])
  const dir = shellStartDir()
  await executor.provision({
    id,
    cwd: dir,
    command: 'bash',
    // Login shell: the profile loads, so PATH (nvm, ~/.local/bin) is what the
    // operator expects. Not -i -c: there is no command, only a prompt.
    args: ['-l'],
    plainShell: true,
    cols: opts.cols,
    rows: opts.rows,
  })
  // Written down so a restart brings it back (tab-memory); crossed off only
  // when the shell really ended and the runner stayed up.
  const gen = rememberTab({ tab, dir, agent: 'shell' })
  exitWatch.get(tab)?.()
  exitWatch.set(
    tab,
    executor.subscribe(id, 0, (e) => {
      if (e.kind !== 'exit') return
      setTimeout(() => forgetTab(tab, gen), EXIT_SETTLE_MS).unref()
      void reportShellEvent(tab, 'ended', { exitCode: e.exitCode ?? null })
    }),
  )
  if (!opts.restored) void reportShellEvent(tab, 'started')
}
