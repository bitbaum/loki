// Can this agent actually run, or is it sitting at a sign-in?
//
// Extracted from poller.ts so the progress heartbeat can ask the same question
// the dispatch path already asks. Importing it back from the poller would be a
// cycle: the poller starts the heartbeat.
import fs from 'fs'
import { claudeProjectSlug } from '@/lib/usage/claude-transcript-usage'

const CLAUDE_AUTH_RE = /401 Invalid authentication|Please run \/login/i
// What a CLI other than Claude prints when it is not signed in. Read from its
// own terminal output since the prompt, never from a Claude transcript.
const OTHER_AUTH_RE =
  /\b401\b[^\n]{0,80}(unauthori[sz]ed|authenticat)|not (logged|signed) in|login required|please (run )?`?\/?(log ?in|auth login)\b|authentication (failed|required)|invalid api key/i

export type AuthCheck = {
  /** The agent the run launched. Only Claude keeps the transcripts read here. */
  agent?: string
  /** Epoch ms the prompt was sent. A transcript last written before this is
   *  an older session's, not evidence about this run. */
  since?: number
  /** What the agent printed since the prompt (non-Claude agents). */
  screen?: string
  /** The prompt itself, so its own words never count as the agent's answer. */
  prompt?: string
}

/**
 * Auth canary: after a dispatch, check whether the agent is refused for
 * credentials. Dead box credentials caused two silent fleet outages
 * (2026-07-02/03): every run just timed out with nothing naming the cause.
 *
 * Only THIS run's evidence counts (2026-11-12): a fresh `solon` tab's newest
 * Claude transcript was a two-day-old session that ended "Please run /login".
 * The new Claude had not written its own log yet, so the canary read the old
 * one and failed the run as "not authenticated" while the runner's sign-in
 * was fine — and a Grok run a minute later was failed the same way, because
 * the canary read Claude's folder for an agent that never writes there.
 */
export function detectAuthFailure(dir: string, check: AuthCheck = {}): boolean {
  const agent = check.agent ?? 'claude'
  if (agent !== 'claude') {
    let said = check.screen ?? ''
    if (check.prompt) said = said.split(check.prompt).join('')
    return OTHER_AUTH_RE.test(said)
  }
  try {
    // claudeProjectSlug replaces "." as well as "/" — the old inline
    // `replace(/\//g,'-')` silently missed dotted paths, so worktree
    // dispatches (under .claude/worktrees/) never matched their transcript
    // dir and auth failures there were undetectable.
    const projDir = `${process.env.HOME}/.claude/projects/${claudeProjectSlug(dir)}`
    const newest = fs.readdirSync(projDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(`${projDir}/${f}`).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0]
    if (!newest) return false
    // A log nobody wrote since the prompt says nothing about this run.
    if (check.since != null && newest.m < check.since - 1000) return false
    const tail = fs.readFileSync(`${projDir}/${newest.f}`, 'utf-8').slice(-4000)
    return CLAUDE_AUTH_RE.test(tail)
  } catch { return false }
}

/** What to tell the operator, naming the agent that was refused and its own fix. */
export function authFailureMessage(agent: string): string {
  const head = `${agent} is not authenticated (401 / login required) — the prompt was delivered but the agent can't run. `
  if (agent === 'claude') {
    return head + `On the runner host, remove any stale ~/.claude/.credentials.json and set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token).`
  }
  if (agent === 'grok' || agent === 'cursor') {
    return head + `Sign ${agent} in on the runner with its own login (the "Builder agent login" workflow, agent=${agent}).`
  }
  return head + `Sign ${agent} in on the runner, or add its API key to the runner's env.`
}
