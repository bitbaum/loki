/**
 * The parts of a spoken note's card that depend on Loki's read of it
 * (walk-read.ts): what the card says before its buttons, the asides, and the
 * words as spoken one tap away. The card itself is drawn in conversation.ts.
 */
import { h } from "./dom";
import type { Draft } from "./conversation-model";

/** The box holds Loki's read (the ask), not the words as spoken. */
export const showsRead = (draft: Draft): boolean => !!draft.read && draft.text === draft.read.ask;

/**
 * What the buttons will do, said before them, in the terms of what was asked:
 * a question is answered by Ask, a change by Save or Fix it now (2026-10-18:
 * "let me know what you think" was offered Fix it now).
 */
export function noteGuide(draft: Draft, owner: boolean): string {
  if (draft.reading) return "Loki is reading what you said…";
  const read = draft.read;
  if (read && showsRead(draft)) {
    if (read.kind === "question")
      return "Loki understood your question — edit it if that is not quite it. Ask answers it here, about every page you went through.";
    return owner
      ? "Loki understood this change — edit it if that is not quite it. Save keeps it with your other notes to build together; Fix it now starts on it straight away."
      : "Loki understood this change — edit it if that is not quite it, then save it for whoever builds this site.";
  }
  if (read) return "Your words as you said them. Edit them if you like.";
  return owner
    ? "Edit it if you like. Save it with your other notes and build them together when you're ready — or fix it now, or Ask Loki about it."
    : "Edit it if you like, then Ask Loki about it, or save it for whoever builds this site.";
}

/** "Loki noted what was on screen: …" — or where it was said, for a short note. */
export function seenLine(draft: Draft): string {
  if (!draft.capture) return "";
  const seen = draft.capture.diagnostics["On screen while speaking"];
  const picked = draft.capture.selected.map((item) => item.elementText).join(", ");
  return typeof seen === "string" && seen
    ? `Loki noted what was on screen: ${seen}${picked ? ` · pointed at ${picked}` : ""}`
    : `About ${draft.capture.page}${picked ? ` · ${picked}` : ""}`;
}

/**
 * Under the box: the asides Loki left out, and the words as spoken with what
 * was on screen — one tap away, never lost (they also travel with the note).
 */
export function noteExtras(draft: Draft, onUseExact: () => void): HTMLElement[] {
  const seen = seenLine(draft);
  const read = draft.read;
  if (!read || !showsRead(draft) || !draft.verbatim) return seen ? [h("p", "diag", seen)] : [];
  const out: HTMLElement[] = [];
  if (read.asides.length)
    out.push(
      h(
        "p",
        "diag",
        `Left out — not meant for Loki: ${read.asides.map((a) => `“${a}”`).join(" ")}`,
      ),
    );
  const exact = h("details", "said-exact");
  exact.append(h("summary", "", "Word for word"), h("p", "said-words", draft.verbatim));
  if (seen) exact.append(h("p", "diag", seen));
  const use = h("button", "act", "Use my exact words instead");
  use.type = "button";
  use.addEventListener("click", onUseExact);
  exact.append(use);
  out.push(exact);
  return out;
}
