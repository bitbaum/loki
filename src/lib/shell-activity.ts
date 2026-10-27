/**
 * When each account last typed into a shell — in this process's memory, for one
 * purpose: a shell's output stream closes itself once nobody has typed for
 * SHELL_IDLE_MS, so a screen left open does not keep a root prompt on display.
 * Not a record of anything (the audit trail is), and a restart forgetting it
 * only means the stream asks to be unlocked again.
 */
const g = globalThis as unknown as { __shellActivity?: Map<string, number> };
const seen = (g.__shellActivity ??= new Map<string, number>());

export function noteShellActivity(userId: string, now = Date.now()): void {
  seen.set(userId, now);
}

export function lastShellActivity(userId: string): number | undefined {
  return seen.get(userId);
}
