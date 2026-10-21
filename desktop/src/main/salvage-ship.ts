// When an agent's process ends with work left in its workspace, Loki ships it
// itself: commit what is uncommitted, push the branch, open a draft PR. The
// fix ledger then follows that PR like any other. Plan: src/lib/salvage-plan.ts.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { salvagePlan } from '@/lib/salvage-plan'
import { fetchWorkspaceSource } from './workspace-source'

const run = promisify(execFile)

export async function salvageShip(tab: string, dir: string, runId: string): Promise<string | null> {
  const source = await fetchWorkspaceSource(tab).catch(() => null)
  const token = source?.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? ''
  const env = {
    ...process.env,
    ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}),
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'Loki builder',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'loki-builder@users.noreply.github.com',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'Loki builder',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'loki-builder@users.noreply.github.com',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
    GIT_CONFIG_VALUE_0:
      '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=${GH_TOKEN:-$GITHUB_TOKEN}"; }; f',
    GIT_TERMINAL_PROMPT: '0',
  }
  const git = async (...args: string[]) =>
    (await run('git', ['-C', dir, ...args], { env, timeout: 60_000 })).stdout.trim()
  try {
    const status = await git('status', '--porcelain', '--', '.', ':(exclude).claude')
    const branch = (await git('branch', '--show-current')) || null
    const def =
      (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => 'origin/main')).replace(
        /^origin\//,
        '',
      ) || 'main'
    const ahead = Number(await git('rev-list', '--count', `origin/${def}..HEAD`).catch(() => '0')) || 0
    let hasOpenPr = false
    if (branch && branch !== def) {
      const out = await run('gh', ['pr', 'view', branch, '--json', 'state,url', '-q', 'select(.state=="OPEN").url'], {
        cwd: dir,
        env,
        timeout: 30_000,
      }).catch(() => ({ stdout: '' }))
      hasOpenPr = out.stdout.trim().length > 0
      if (hasOpenPr && !status && ahead === 0) return null
    }
    const steps = salvagePlan({ dirty: status.length > 0, branch, defaultBranch: def, ahead, hasOpenPr })
    if (steps.length === 0) return null
    let head = branch
    for (const step of steps) {
      if (step === 'branch') {
        head = `loki/run-${runId.slice(0, 8)}`
        await git('checkout', '-B', head)
      } else if (step === 'commit') {
        await git('add', '-A', '--', '.', ':(exclude).claude')
        await git('commit', '-m', `Loki: the agent's changes for run ${runId.slice(0, 8)} (it stopped before committing)`)
      } else if (step === 'push') {
        await git('push', '-u', 'origin', `HEAD:${head}`)
      } else if (step === 'open_pr') {
        const out = await run(
          'gh',
          ['pr', 'create', '--draft', '--fill', '--head', head!, '--base', def],
          { cwd: dir, env, timeout: 60_000 },
        )
        const url = out.stdout.trim().split('\n').pop() ?? ''
        console.log(`[salvage] ${tab} run ${runId}: opened ${url}`)
        return url || null
      }
    }
    return null
  } catch (e) {
    console.warn(`[salvage] ${tab} run ${runId}: ${(e as Error).message.split('\n')[0]}`)
    return null
  }
}
