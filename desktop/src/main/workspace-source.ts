/**
 * Ask the control plane what this project is made of — its repository and a
 * token that may write to it — with the runner's own token. The box-runner
 * used to read the database for this (and so carried its password); now it
 * asks like any other runner call (usage-reporter.ts). Null when the control
 * plane does not know the project or cannot be reached: the caller then
 * works with what is on disk, exactly as before.
 */
import { APP_URL } from '@/config/brand'
import type { WorkspaceSource } from '@/lib/agent-execution/box-workspace'
import { loadToken } from './token-store'

const BASE_URL = (process.env.LOKI_WEB_URL || '').trim() || APP_URL
const TIMEOUT_MS = 15_000

export async function fetchWorkspaceSource(tab: string): Promise<WorkspaceSource | null> {
  const token = loadToken()
  if (!token) return null
  try {
    const resp = await fetch(
      `${BASE_URL}/api/control/workspace-source?tab=${encodeURIComponent(tab)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    if (!resp.ok) return null
    const body = (await resp.json()) as { gitUrl?: unknown; token?: unknown }
    return {
      gitUrl: typeof body.gitUrl === 'string' ? body.gitUrl : null,
      token: typeof body.token === 'string' ? body.token : null,
    }
  } catch (e) {
    console.warn(`[workspace-source] ${tab}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** The environment the agent run gets for its pushes: the run's own token. */
export function repoTokenEnv(source: WorkspaceSource | null): Record<string, string> {
  return source?.token ? { GITHUB_TOKEN: source.token, GH_TOKEN: source.token } : {}
}
