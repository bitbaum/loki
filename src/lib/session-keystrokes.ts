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

/**
 * One at a time. A message or command is two writes with a beat between,
 * so two sent within that beat would interleave: Sonnet then High, tapped
 * quickly, typed "/model sonnet/effort high" and two Enters. Each waits for
 * the one before it to finish its Enter.
 */
let queue: Promise<void> = Promise.resolve();
function inTurn(run: () => Promise<void>): Promise<void> {
  const turn = queue.then(run);
  queue = turn.catch(() => {});
  return turn;
}

export function typeMessage(
  onKey: (bytes: string) => void | Promise<void>,
  text: string,
): Promise<void> {
  return inTurn(async () => {
    await onKey(`${PASTE_START}${text}${PASTE_END}`);
    await new Promise<void>((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    await onKey(ENTER);
  });
}

/**
 * A COMMAND typed as a person types it: the words, a beat, then Enter as its
 * own keystroke.
 *
 * "/model opus\r" in one write is not what a person types: Claude Code reads
 * a multi-character write as pasted text, and a carriage return inside a
 * paste is a newline, not a submit. The command then sat in its composer,
 * and the owner's next message was typed after it and submitted as one
 * line — "/model opusWhy is the name of the repo…" → "Model 'opusWhy is the
 * name…' not found" (2026-10-19). The runner's own injectPty learned the
 * same lesson on long prompts (desktop/src/main/pty-runtime.ts); this is the
 * one path every command button in the browser takes.
 */
export function typeCommand(
  onKey: (bytes: string) => void | Promise<void>,
  command: string,
): Promise<void> {
  return inTurn(async () => {
    await onKey(command.replace(/[\r\n]+$/, ""));
    await new Promise<void>((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
    await onKey(ENTER);
  });
}
