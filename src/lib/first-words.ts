/**
 * What a visitor said on the homepage before they had an account.
 *
 * The homepage's headline is "Say what you want", and its one action is a box
 * to say it in. A signed-out visitor still has to create an account, so the
 * sentence is kept in this tab (sessionStorage) across sign-up and onboarding
 * and handed to the new-project form at the end. Fleet "No dead ends": context
 * that arrives survives the detours.
 *
 * Kept in the browser only: nothing is sent or stored on the server until the
 * person presses the form's own button. A different tab (an emailed link) does
 * not have it; they land where they always did, with nothing lost but typing.
 */
const KEY = "loki:first-words";

/** The new-project form caps a prefilled brief at 2000 characters
 *  (control/new-from-scratch MAX_PREFILL.brief); longer is cut there anyway. */
const MAX = 2000;

/** A sentence older than this was for another visit: it is dropped unread. */
const MAX_AGE_MS = 60 * 60 * 1000;

export function saveFirstWords(text: string): void {
  const words = text.trim().slice(0, MAX);
  if (!words) return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), words }));
  } catch {
    // Storage is off (private mode): the visitor simply types it again later.
  }
}

export function readFirstWords(): string | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return null;
    const { at, words } = saved as { at?: unknown; words?: unknown };
    if (typeof at !== "number" || typeof words !== "string") return null;
    if (Date.now() - at > MAX_AGE_MS) return null;
    return words.trim().slice(0, MAX) || null;
  } catch {
    return null;
  }
}

export function clearFirstWords(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Where a carried sentence lands: the new-project form, with the brief
 *  filled in. That form only prefills; nothing is created until its button. */
export function firstWordsHref(text: string): string {
  return `/control/new-from-scratch?brief=${encodeURIComponent(text.trim().slice(0, MAX))}`;
}
