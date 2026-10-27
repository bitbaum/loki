/**
 * The environment an agent is born with.
 *
 * Until 2026-10-20 every agent PTY inherited the runner's whole environment
 * (`{ ...process.env }`): on the box that was the production DATABASE_URL,
 * the org GITHUB_TOKEN and whatever else the unit file loaded — in the
 * environment of a process that reads text visitors wrote. A tricked agent
 * could `env` its way to the database. The box units now set
 * `LOKI_AGENT_ENV=allowlist` and an agent gets only what a shell needs, the
 * engine keys the unit holds for it, the names in LOKI_AGENT_ENV_EXTRA, and
 * what its own spec passes (a per-run repository token).
 *
 * Opt-in on purpose: the same executor runs the laptop Fleet Runner and the
 * web app's own terminals, where SSH agents, proxies and nvm live in the
 * environment and are expected to. Nothing changes there.
 */

/** Switched on by the box units; anything else keeps today's inheritance. */
export const AGENT_ENV_MODE_VAR = "LOKI_AGENT_ENV";
export const AGENT_ENV_ALLOWLIST = "allowlist";
/** Comma-separated names a box may add (a proxy, a browser path). */
export const AGENT_ENV_EXTRA_VAR = "LOKI_AGENT_ENV_EXTRA";

/** What a login shell and the agent CLIs need to come up at all. */
const SHELL_NAMES = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LANGUAGE", "TZ"];
const SHELL_PREFIXES = ["LC_"];

/** An engine the unit holds for THIS tenant: their own key, in their own
 *  unit's environment (Settings → Your engine writes it there). */
export const ENGINE_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "CURSOR_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

export function agentEnvAllowlisted(processEnv: NodeJS.ProcessEnv): boolean {
  return processEnv[AGENT_ENV_MODE_VAR]?.trim() === AGENT_ENV_ALLOWLIST;
}

/**
 * The environment for one agent process. `specEnv` always wins: it is what
 * the launch itself decided (a repository token for this run).
 */
export function agentEnvironment(
  processEnv: NodeJS.ProcessEnv,
  specEnv: Record<string, string> | undefined,
  /** A plain shell is a person at a prompt, not an agent: on the box it gets
   *  a shell's environment and NOT the engine keys the unit holds for agents. */
  opts: { plainShell?: boolean } = {},
): Record<string, string> {
  if (!agentEnvAllowlisted(processEnv)) {
    return { ...processEnv, ...(specEnv ?? {}) } as Record<string, string>;
  }
  const extra = (processEnv[AGENT_ENV_EXTRA_VAR] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keep = new Set<string>([
    ...SHELL_NAMES,
    ...(opts.plainShell ? [] : ENGINE_KEY_NAMES),
    ...extra,
  ]);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    if (keep.has(name) || SHELL_PREFIXES.some((p) => name.startsWith(p))) out[name] = value;
  }
  return { ...out, ...(specEnv ?? {}) };
}
