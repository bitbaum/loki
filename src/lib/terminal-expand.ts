/**
 * When Esc may leave the expanded terminal.
 *
 * Esc is overloaded on /terminal. To the operator watching an expanded pane it
 * means "give me the page back"; to the agent in the session it means
 * "interrupt" (claude) or "close this menu" (every TUI). Taking it from the
 * xterm would make an expanded terminal the one place you cannot stop an
 * agent, so the terminal keeps its own Esc, and so does any control that
 * already handled the key (a picker closing, a sheet dismissing).
 */
export type KeyLike = {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target?: unknown;
};

/** The xterm host marks its focus target (a hidden textarea) inside `.xterm`. */
const XTERM_SELECTOR = ".xterm";
/** A dialog on top (the session sheet, the Loki sheet) owns its own Esc. */
const DIALOG_SELECTOR = '[role="dialog"]';

type ClosestCapable = { closest: (selector: string) => unknown };

function within(target: unknown, selector: string): boolean {
  if (!target || typeof (target as ClosestCapable).closest !== "function") return false;
  return Boolean((target as ClosestCapable).closest(selector));
}

export function shouldLeaveExpandedOnKey(e: KeyLike): boolean {
  if (e.key !== "Escape") return false;
  if (e.defaultPrevented || e.isComposing) return false;
  if (within(e.target, XTERM_SELECTOR)) return false;
  if (within(e.target, DIALOG_SELECTOR)) return false;
  return true;
}
