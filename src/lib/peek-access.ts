import { isShellTab } from "@/lib/shell-session";

/**
 * Whether a caller may read one capture of a tab's screen.
 *
 * An agent session's screen is read by its owner's browser and by the owner's
 * own `ck_` token alike: the agent that started Claude Code in a session has
 * to be able to read what it answered. A plain shell's screen is the
 * operator's, unlocked, in a browser (peek-stream), and never a token's.
 */
export function mayPeekTab(tab: string, via: "session" | "token"): boolean {
  return via === "session" || !isShellTab(tab);
}
