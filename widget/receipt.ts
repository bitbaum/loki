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
 * The longest note the receipt's sentence quotes whole. Anything longer — or
 * on more than one line, like a spoken note's list of changes — is named
 * ("your 3 changes", "your note") and shown in full under the sentence,
 * clamped to whole lines with "Show all" (conversation-kit.ts sentFull). A
 * quote cut to fit read "Saved “3 changes: Make it possible for users to hear
 * what is…” with nothing to open (owner's phone, 2026-10-20); before that, a
 * 300-character cut made a 90-second note look lost (2026-10-16).
 */
export const RECEIPT_QUOTE = 140;

const fitsInline = (text: string) => {
  const t = text.trim();
  return t.length <= RECEIPT_QUOTE && !t.includes("\n");
};

/** What the sentence calls what was sent: the words, or a name for them. */
function quote(item: Sent): string {
  const t = item.text.trim();
  if (fitsInline(t)) return `“${t}”`;
  return item.changes && item.changes > 1 ? `your ${item.changes} changes` : "your note";
}

/** The whole of what was sent, when the sentence above only named it. */
export function receiptFull(item: Sent): string | null {
  return fitsInline(item.text) ? null : item.text.trim();
}

export function receiptText(item: Sent): string {
  const q = quote(item);
  const is = !fitsInline(item.text) && (item.changes ?? 1) > 1 ? "are" : "is";
  if (item.toLoki) {
    if (item.building)
      return `On it — ${q} ${is} being built into Loki itself. It goes live by itself; you'll see it here.`;
    if (item.note) return `Sent to Loki about itself: ${q}. ${item.note}`;
    return `Sent to the people who build Loki: ${q}. Thank you — it helps the panel you're using get better.`;
  }
  if (item.owner) {
    if (item.building)
      return `On it — ${q} ${is} being built. Follow it on the Watching line above; it goes live here by itself and Loki tells you.`;
    return `Saved ${q}. ${item.note ?? "It waits with your other saved notes — build them all from the Watching line above when you're ready."}`;
  }
  // A member of the project (a client): Loki says what happened, in the
  // same words their project page in Loki would.
  if (item.member) return item.note ? `Got it — ${q}. ${item.note}` : `Got it — ${q}.`;
  return `Sent to whoever builds this site: ${q}. Thank you.`;
}

/** The one link under the receipt: follow a build, or track a report. */
export function receiptLinkLabel(item: Sent): string {
  if (item.savedOnly) return "Review the note in Loki →";
  if (item.member) return "See it in Loki →";
  return item.owner || item.building ? "Follow the build →" : "Track what happens next →";
}
