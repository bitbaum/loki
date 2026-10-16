/**
 * What Loki says once a note has gone somewhere — the receipt in the thread.
 * Three destinations, each with its own promise: the site's builder (it
 * waits for them), the owner's own build (an agent is on it), and Loki
 * itself (the widget being improved, by Loki). Pure, so the wording is
 * tested without a DOM.
 */
import type { ThreadItem } from "./thread";

type Sent = Extract<ThreadItem, { kind: "sent" }>;

/**
 * How much of what was sent the receipt's sentence quotes. The whole note is
 * kept and shown under it (receiptFull): the receipt used to be the only copy
 * the person saw, cut at 300 characters, so a 90-second voice note read as if
 * all but its first sentence had been lost (2026-10-16).
 */
export const RECEIPT_QUOTE = 140;

function quote(text: string): string {
  const t = text.trim();
  if (t.length <= RECEIPT_QUOTE) return `“${t}”`;
  const cut = t.slice(0, RECEIPT_QUOTE).replace(/\s+\S*$/, "");
  return `“${cut}…”`;
}

/** The whole of what was sent, when the sentence above quoted only its start. */
export function receiptFull(item: Sent): string | null {
  return item.text.trim().length > RECEIPT_QUOTE ? item.text.trim() : null;
}

export function receiptText(item: Sent): string {
  const q = quote(item.text);
  if (item.toLoki) {
    if (item.building)
      return `On it — ${q} is being built into Loki itself. It goes live by itself; you'll see it here.`;
    if (item.note) return `Sent to Loki about itself: ${q}. ${item.note}`;
    return `Sent to the people who build Loki: ${q}. Thank you — it helps the panel you're using get better.`;
  }
  if (item.owner) {
    if (item.building)
      return `On it — ${q} is in Your changes above. One agent builds it; it goes live here by itself and Loki tells you.`;
    return `Saved ${q}. ${item.note ?? "It waits in Loki under Feedback."}`;
  }
  return `Sent to whoever builds this site: ${q}. Thank you.`;
}

/** The one link under the receipt: follow a build, or track a report. */
export function receiptLinkLabel(item: Sent): string {
  if (item.savedOnly) return "Review the note in Loki →";
  return item.owner || item.building ? "Follow the build →" : "Track what happens next →";
}
