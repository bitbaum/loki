/**
 * The agent CLIs' own commands — what a person types INTO the terminal to sign
 * the agent in, change its model, or give it room to keep going.
 *
 * Loki used to know none of these. A session that printed "Please run /login"
 * got a summary saying "the agent is waiting on you" and three chips that sent
 * prose tasks, and a person who wanted Opus instead of the current model had no
 * way to learn that the answer is `/model opus` (operator, 2026-10-12: "when the
 * user looks at this terminal, the user doesn't know what to do"). Every place
 * that offers a command — the chips under the screen, the Loki panel's list,
 * the summary prompt — reads this list, so they cannot disagree.
 *
 * A command is typed as keystrokes, never sent as a task: the inject path wraps
 * text in project context, and `/model opus` inside a paragraph is a sentence
 * about a model, not a command (lib/terminal-commands).
 *
 * Only commands each CLI actually ships. An agent with no entry gets no
 * command help, which is honest; a guessed command that prints "unknown
 * command" in front of someone who is already lost is worse than nothing.
 */
import type { AdapterId } from "@/lib/orchestration/contract";

export type AgentCommandKind =
  "login" | "model" | "effort" | "compact" | "clear" | "status" | "help";

export type AgentCommand = {
  /** What it does, for the situations the screen detectors recognise. */
  kind: AgentCommandKind;
  /** Exactly what is typed. Enter is added when it is sent. */
  text: string;
  /** The button's words — what the person gets, not the syntax. */
  label: string;
  /** One line on when to use it. */
  hint: string;
};

const CLAUDE: readonly AgentCommand[] = [
  {
    kind: "login",
    text: "/login",
    label: "Sign in",
    hint: "Signs the agent in to its account. It prints a link; open it, approve, and paste the code back if it asks.",
  },
  {
    kind: "model",
    text: "/model",
    label: "Choose a model",
    hint: "Opens the list of models. Move with the arrow keys, then Enter.",
  },
  {
    kind: "model",
    text: "/model opus",
    label: "Use Opus",
    hint: "The most capable model. Slower and uses more of your plan.",
  },
  {
    kind: "model",
    text: "/model sonnet",
    label: "Use Sonnet",
    hint: "The everyday model: fast and capable.",
  },
  {
    kind: "model",
    text: "/model haiku",
    label: "Use Haiku",
    hint: "The quickest and lightest, for small tasks.",
  },
  {
    kind: "effort",
    text: "/effort",
    label: "Set how hard it thinks",
    hint: "Opens the effort levels. Higher thinks longer before answering: slower, and better for planning and analysis.",
  },
  {
    kind: "compact",
    text: "/compact",
    label: "Free up memory",
    hint: "Condenses the conversation so far, so a long session can keep going. Nothing in the code changes.",
  },
  {
    kind: "clear",
    text: "/clear",
    label: "Start a fresh conversation",
    hint: "The agent forgets this conversation. The code stays exactly as it is.",
  },
  {
    kind: "status",
    text: "/status",
    label: "Show account and model",
    hint: "Which account it is signed in with and which model it is using.",
  },
  {
    kind: "help",
    text: "/help",
    label: "List every command",
    hint: "Everything this agent understands, printed in the terminal.",
  },
];

const CODEX: readonly AgentCommand[] = [
  {
    kind: "model",
    text: "/model",
    label: "Choose a model",
    hint: "Opens the list of models. Move with the arrow keys, then Enter.",
  },
  {
    kind: "compact",
    text: "/compact",
    label: "Free up memory",
    hint: "Condenses the conversation so far, so a long session can keep going.",
  },
  {
    kind: "clear",
    text: "/new",
    label: "Start a fresh conversation",
    hint: "The agent forgets this conversation. The code stays exactly as it is.",
  },
  {
    kind: "status",
    text: "/status",
    label: "Show account and model",
    hint: "Which account and model this session is using.",
  },
];

const GEMINI: readonly AgentCommand[] = [
  {
    kind: "login",
    text: "/auth",
    label: "Sign in",
    hint: "Chooses how the agent signs in, then walks you through it.",
  },
  {
    kind: "model",
    text: "/model",
    label: "Choose a model",
    hint: "Opens the list of models. Move with the arrow keys, then Enter.",
  },
  {
    kind: "compact",
    text: "/compress",
    label: "Free up memory",
    hint: "Condenses the conversation so far, so a long session can keep going.",
  },
  {
    kind: "clear",
    text: "/clear",
    label: "Start a fresh conversation",
    hint: "The agent forgets this conversation. The code stays exactly as it is.",
  },
  {
    kind: "help",
    text: "/help",
    label: "List every command",
    hint: "Everything this agent understands, printed in the terminal.",
  },
];

export const AGENT_COMMANDS: Partial<Record<AdapterId, readonly AgentCommand[]>> = {
  claude: CLAUDE,
  codex: CODEX,
  gemini: GEMINI,
};

/** The commands the agent running in a tab understands; empty when unknown. */
export function commandsFor(agent: string | null | undefined): readonly AgentCommand[] {
  if (!agent) return [];
  return AGENT_COMMANDS[agent as AdapterId] ?? [];
}

/** The first command of a kind — the one to offer when the screen calls for it. */
export function commandOfKind(
  agent: string | null | undefined,
  kind: AgentCommandKind,
): AgentCommand | null {
  return commandsFor(agent).find((c) => c.kind === kind) ?? null;
}

/**
 * Claude Code's permission modes, in words a person can act on. The id is
 * what Claude Code records on each message (`permissionMode`); the label is
 * the chip; `means` is what it does to the next step the agent takes.
 * "Auto" read as nothing to anyone who had not used Claude Code (operator,
 * 2026-10-15: "I don't know what that auto is").
 */
export const CLAUDE_MODES: Record<string, { label: string; means: string }> = {
  default: {
    label: "Ask first",
    means: "Asks you before it changes a file or runs a command.",
  },
  acceptEdits: {
    label: "Edits freely",
    means: "Changes files without asking; still asks before running other commands.",
  },
  plan: {
    label: "Plan only",
    means: "Reads and plans, and changes nothing until you approve the plan.",
  },
  auto: {
    label: "Auto",
    means: "Decides for itself which steps are safe and runs them without asking.",
  },
  bypassPermissions: {
    label: "No checks",
    means: "Runs everything without asking, including risky commands.",
  },
};

/**
 * Claude Code's effort levels, as it writes them on each answer in its log
 * (`effort`). Higher thinks longer before answering. A level this table does
 * not know is shown by its own name.
 */
export const CLAUDE_EFFORTS: Record<string, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "Extra-high effort",
  max: "Max effort",
};
