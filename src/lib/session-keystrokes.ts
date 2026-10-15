/**
 * How a message is TYPED into a live agent session: as a bracketed paste, so
 * newlines stay inside the message instead of submitting it early, then Enter
 * after a beat (Claude Code's TUI needs one between a paste and the Enter).
 *
 * The conversation view and the terminal view both send this way — one box,
 * one path (components/terminal/SessionComposer).
 */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
export const ENTER = "\r";
export const ESC = "\x1b";
const SUBMIT_DELAY_MS = 150;

export async function typeMessage(
  onKey: (bytes: string) => void | Promise<void>,
  text: string,
): Promise<void> {
  await onKey(`${PASTE_START}${text}${PASTE_END}`);
  await new Promise<void>((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
  await onKey(ENTER);
}
