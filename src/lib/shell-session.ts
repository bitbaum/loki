/**
 * The plain shell — SSOT for what it is, what may touch it and for how long.
 *
 * A plain shell is a bash login shell in a PTY a BUILDER owns (the cloud
 * builder's box-runner, or Fleet Runner on a person's computer): no project,
 * no agent CLI, no inject wrapper. It rides the same transport as every agent
 * session — the command queue to open it, peek-stream to read it, the bridge's
 * rawkey lane to type into it — so there is one terminal, not a second one.
 *
 * It is a root-class capability on a production machine, so the rules for it
 * live here once, imported by the routes, the runner and the screen alike:
 * the tab's name, who may open it, how long an unlock lasts, how many may be
 * open. docs/architecture/plain-shell.md is the threat model.
 *
 * Request-free and DOM-free on purpose: the runner (desktop/src/main), the web
 * app and the browser all import this file.
 */

/** A shell's tab: `loki-shell-` and eight hex digits, minted by the server. A
 *  project can never be named like this by accident, and nothing else is. */
const SHELL_TAB_RE = /^loki-shell-[0-9a-f]{8}$/i;

export function isShellTab(tab: string | null | undefined): boolean {
  return typeof tab === "string" && SHELL_TAB_RE.test(tab);
}

/** The tab name for a shell, from eight hex digits of randomness. */
export function shellTabFromHex(hex: string): string {
  const tab = `loki-shell-${hex.toLowerCase()}`;
  if (!SHELL_TAB_RE.test(tab)) throw new Error("a shell tab needs eight hex digits");
  return tab;
}

/** How many shells one builder keeps open. A shell is a process tree on a
 *  production machine; a few is a working set, more is a leak. The server
 *  refuses the fourth and the runner refuses it again. */
export const SHELL_MAX_OPEN = 3;

/** Typing (or opening) keeps an unlock alive for this long. Past it the PIN is
 *  asked again — a phone left on a table is not a root prompt. */
export const SHELL_IDLE_MS = 10 * 60 * 1000;

/** However busy, an unlock ends after this long and the PIN is asked again. */
export const SHELL_UNLOCK_MAX_MS = 60 * 60 * 1000;

/** Opening shells: this many per window, per account. */
export const SHELL_OPEN_LIMIT = { limit: 6, windowMs: 10 * 60 * 1000 } as const;

/** Wrong PINs: this many per window, per account (the private-zone rule). */
export const SHELL_UNLOCK_LIMIT = { limit: 5, windowMs: 60 * 1000 } as const;

/** Keystroke posts: far above fast typing and a long paste, far below a loop. */
export const SHELL_KEY_LIMIT = { limit: 2400, windowMs: 60 * 1000 } as const;

/** The only commands that may name a shell tab. Everything else — inject,
 *  dispatch, switch_agent, launch_agent — would type into a root shell as if
 *  it were an agent's prompt box, which is how a sentence a stranger wrote
 *  becomes a command. Enforced where commands are queued AND where the runner
 *  executes them. */
export const SHELL_COMMAND_TYPES = ["open_shell", "close_tab", "peek_start", "peek_stop"] as const;

export function isShellCommandType(type: string): boolean {
  return (SHELL_COMMAND_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a queued command may be made. Null = fine; otherwise the reason.
 * One rule for the queue (db/queries/pending-commands.ts) and the tests: a
 * command that names a shell tab must be one of SHELL_COMMAND_TYPES, and
 * `open_shell` must name a shell tab.
 */
export function shellCommandRefusal(type: string, payload: unknown): string | null {
  const tab = (payload as { tab?: unknown } | null)?.tab;
  if (typeof tab === "string" && isShellTab(tab) && !isShellCommandType(type)) {
    return `"${type}" cannot target a shell tab`;
  }
  if (type === "open_shell" && !(typeof tab === "string" && isShellTab(tab))) {
    return "open_shell needs a shell tab name";
  }
  return null;
}

/** Why a shell was refused, in words a person can act on. One place so the
 *  screen and the API never say two different things. */
export const SHELL_REFUSALS = {
  "not-operator":
    "Only the account that owns this runner can open a shell on it. Nothing else can.",
  "pin-required":
    "A shell needs a PIN first. Set one in Settings → Privacy, then come back — it takes a minute.",
  locked: "The shell is locked. Enter your PIN to unlock it.",
  "no-channel": "Say where the shell should run: the cloud runner or your computer.",
  offline: "That runner is not connected, so there is nothing to open a shell on.",
  "too-many": `Three shells are already open there. Close one first.`,
  "rate-limited": "Too many shells opened in a short while. Wait a few minutes and try again.",
  sandboxed: "This runner runs sealed builds only, so it does not offer a shell.",
} as const;

export type ShellRefusal = keyof typeof SHELL_REFUSALS;

/** What the runner's environment says about offering a shell at all. `off` is
 *  a kill switch; a sealed (sandboxed) builder never offers one. */
export function runnerOffersShell(env: Record<string, string | undefined>): boolean {
  if ((env.LOKI_SHELL ?? "").trim().toLowerCase() === "off") return false;
  if (env.LOKI_EXECUTOR === "sandbox") return false;
  return true;
}

/** The label a person reads for the builder a shell runs on. */
export function shellPlaceLabel(channel: "cloud" | "local"): string {
  return channel === "cloud" ? "the cloud runner" : "your computer";
}

/** Audit events. NO command content, no output, no keystrokes — who, when,
 *  from where, on what, and how it ended. */
export const SHELL_AUDIT_EVENTS = [
  "unlock",
  "unlock-failed",
  "lock",
  "open",
  "close",
  "denied",
  "started",
  "ended",
] as const;
export type ShellAuditEvent = (typeof SHELL_AUDIT_EVENTS)[number];

export type ShellSignals = {
  isOperator: boolean;
  pinConfigured: boolean;
  unlock: "ok" | "idle" | "expired" | "invalid";
};

/** Pure: the verdict for a set of facts. `needUnlock` is false only for the
 *  calls that must work while locked (status, the PIN form, closing). */
export function decideShellAccess(
  s: ShellSignals,
  needUnlock: boolean,
): { ok: true } | { ok: false; status: 401 | 403; code: ShellRefusal } {
  if (!s.isOperator) return { ok: false, status: 403, code: "not-operator" };
  if (!s.pinConfigured) return { ok: false, status: 403, code: "pin-required" };
  if (needUnlock && s.unlock !== "ok") return { ok: false, status: 403, code: "locked" };
  return { ok: true };
}
