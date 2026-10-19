/**
 * AgentAdapter — the port that every agent CLI plugs into.
 *
 * Pre-2026-06-07 (v0.7.4) "agent" was data in src/lib/agent-registry.ts +
 * behavior scattered across `buildAgentOptionLaunchCommand`, `syncAgentSettings`,
 * and per-agent availability functions in the same file. Adding a new agent
 * (Cline, Aider, opencode, etc.) meant hunting through 5+ files and adding
 * branches to switch statements.
 *
 * The adapter pattern unifies all per-agent knowledge into ONE module per
 * agent. Adding a new agent is now: write `src/lib/agents/<name>.ts`,
 * import it in `index.ts`. No switch statements. No registry edits beyond
 * the one new line.
 *
 * Why this matters strategically: Loki's value isn't owning the model
 * — it's owning the COORDINATION LAYER where any model plugs in. Linear,
 * Cursor, and similar tools each lock you into one vendor; the adapter pattern is how
 * we stay vendor-neutral as agents proliferate.
 *
 * The interface is intentionally minimal. Anything that's the SAME across
 * agents (process detection, capability flags, model resolution from a
 * config file) is exposed via helpers in ./helpers.ts so each adapter can
 * pick what it needs without re-implementing.
 */

/** Per-agent capability flags. Used by UI surfaces to gate features:
 *  e.g. the agent-switcher only lists agents with tabSwitching=true,
 *  the autopilot only fires on agents with autonomousPromptLoop=true. */
export interface AgentCapabilities {
  /** Can Loki launch this agent in a fresh owned PTY and switch the project to it? */
  tabSwitching: boolean;
  /** Does the agent accept prompts typed into its PTY stdin? */
  manualPromptInjection: boolean;
  /** Does the agent loop on its own once given a queue? */
  autonomousPromptLoop: boolean;
  /** Does the agent write session.md handoff files on idle? */
  sessionLifecycleSignals: boolean;
}

/** Runtime knobs the launch-command builder needs from the caller. */
export interface AgentRuntimeConfig {
  /** Working directory the agent should `cd` into before starting. */
  dir: string;
  /** User-selected model override. When omitted, adapter uses defaultModel. */
  model?: string;
  /** Native provider session id. Only adapters that support resume use it. */
  sessionId?: string;
  /** Continue the newest conversation in `dir`, for an agent whose CLI can
   *  find it itself (`codex resume --last`). Claude's is found by Loki and
   *  passed as `sessionId` instead. */
  resumeLatest?: boolean;
}

/** Availability detection result. Both fields exist so the UI can show
 *  "Codex CLI is not installed, run `npm i -g @openai/codex` to fix"
 *  instead of just "unavailable". */
export interface AgentAvailability {
  available: boolean;
  availabilityReason?: string;
}

/** The contract every agent implements. */
export interface AgentAdapter {
  /** Unique identifier (matches the existing string IDs in agent-labels.ts). */
  readonly id: string;
  /** Display name shown in the UI ("Claude", "Codex", "Grok"). */
  readonly label: string;
  /** Process names that identify this agent running via `ps`. */
  readonly processMatchers: readonly string[];
  /** Model used when no user-selected model exists. */
  readonly defaultModel: string;
  /** Suggested models shown in the dropdown. */
  readonly modelSuggestions: readonly string[];
  /** True if user can switch to this agent from the agent-switcher UI. */
  readonly switchable: boolean;
  /** Per-agent capability flags. */
  readonly capabilities: AgentCapabilities;
  /** Chars to type into the running CLI to quit it gracefully. */
  readonly quitCommand: string;
  /** Bash command to install this CLI (used by the in-app install button). */
  readonly installCommand?: string;
  /** Native session directory if the CLI manages its own. */
  readonly sessionDir?: string;
  /** Where prompt history comes from when the user types directly in the CLI. */
  readonly directActivitySource?: "hooks" | "native-session-log";

  /** Detect whether the CLI is installed on this machine. Synchronous so
   *  it can run inside server components without async overhead — every
   *  /control GET runs this for every adapter. */
  detectAvailable(): AgentAvailability;

  /** Read the user's currently-configured model from the CLI's own config
   *  file(s). Returns null when no config found. The agent-registry uses
   *  this so Loki's defaultModel for the adapter reflects whatever
   *  the user already set (e.g. claude `~/.claude/settings.json` model). */
  readConfiguredModel(): string | null;

  /** Build the shell command that opens the agent in `config.dir`. */
  buildLaunchCommand(config: AgentRuntimeConfig): string;

  /** Optional — persist the user-selected model to the CLI's config file
   *  so the next direct invocation outside Loki uses the same model.
   *  Only Claude needs this today (writes to ~/.claude/settings.json). */
  syncSelectedModel?(model: string): void;
}
