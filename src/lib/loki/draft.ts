/**
 * The Loki composer draft, kept where a killed tab cannot take it.
 *
 * On a phone the browser is not the only process competing for memory. Tap
 * the paperclip, and Android opens a file picker; come back and the tab has
 * been discarded ("Zu wenig Speicher für vorherige Operation", 2026-10-03).
 * The thread survived that — it is in the URL as ?c= — but every word typed
 * into the composer was React state and went with the tab. Dictating a
 * paragraph and losing it to a file picker is the kind of thing that sends an
 * operator back to another app.
 *
 * So the draft is mirrored to localStorage on every keystroke, keyed by the
 * thread it was written in, and read back once when the composer mounts. Only
 * the text: a staged image is base64 in memory and would blow the storage
 * quota, and the picker reopens it in one tap. Reads and writes swallow every
 * error — a private window, a full quota, a browser that lies about storage —
 * because losing persistence is nothing and losing the draft is the bug.
 */

const PREFIX = "loki:draft:";

/** One draft per thread. `null` is the draft on the start page: the message
 *  that will CREATE a thread when sent. */
export function lokiDraftKey(conversationId: string | null): string {
  return `${PREFIX}${conversationId ?? "new"}`;
}

export function readLokiDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Empty (or whitespace) text removes the key rather than storing it: a
 *  cleared composer must not come back as a one-space draft. */
export function writeLokiDraft(key: string, text: string): void {
  try {
    if (text.trim()) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — the in-memory draft still works */
  }
}

export function clearLokiDraft(key: string): void {
  writeLokiDraft(key, "");
}
