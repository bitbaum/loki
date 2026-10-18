/**
 * The parts of a spoken note's card that depend on Loki's read of it
 * (walk-read.ts): what the card says before its buttons, the asides, and the
 * words as spoken one tap away. The card itself is drawn in conversation.ts.
 */
import { h } from "./dom";
import type { Draft } from "./conversation-model";

/** The card shows Loki's read as a list, not the words as spoken. */
export const showsRead = (draft: Draft): boolean => !!draft.read && !!draft.items?.length;

/** How many of the listed things are changes, and how many questions. */
export function itemCounts(draft: Draft): { changes: number; questions: number } {
  const items = draft.items ?? [];
  return {
    changes: items.filter((i) => i.kind === "change").length,
    questions: items.filter((i) => i.kind === "question").length,
  };
}

/**
 * What the buttons will do, said before them, in the terms of what was asked:
 * a question is answered by Ask, a change by Save or Fix it now (2026-10-18:
 * "let me know what you think" was offered Fix it now).
 */
export function noteGuide(draft: Draft, owner: boolean): string {
  if (draft.reading) return "Loki is reading what you said…";
  const read = draft.read;
  if (read && showsRead(draft)) {
    const { changes, questions } = itemCounts(draft);
    const heard =
      changes + questions > 1
        ? "Here is what Loki heard, one thing per line — change the words or drop a line with ✕."
        : "Here is what Loki heard — change the words if that is not quite it.";
    if (!changes) return `${heard} Ask answers it here, about every page you went through.`;
    const save = owner
      ? "Save keeps each change with your other notes, to build page by page; Fix it now starts on them straight away."
      : "Save sends each change to whoever builds this site.";
    return questions ? `${heard} ${save} Questions stay here for Ask.` : `${heard} ${save}`;
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

/**
 * Loki's read as a list: one line per thing said, each with what it is and
 * where it applies, its words editable, and ✕ to drop it (2026-10-18: a walk
 * talked about freely came back filed under whatever heading was on screen).
 */
export function itemsList(
  draft: Draft,
  onEdit: (index: number, text: string) => void,
  onDrop: (index: number) => void,
): HTMLElement {
  const list = h("ol", "heard-list");
  (draft.items ?? []).forEach((item, i) => {
    const li = h("li", item.kind === "question" ? "heard-item question" : "heard-item");
    const head = h("div", "heard-head");
    head.append(
      h(
        "span",
        "heard-where",
        `${item.kind === "question" ? "Question" : "Change"}${item.where ? ` · ${item.where}` : ""}`,
      ),
    );
    const drop = h("button", "heard-drop", "✕");
    drop.type = "button";
    drop.setAttribute("aria-label", `Leave out: ${item.text.slice(0, 60)}`);
    drop.addEventListener("click", () => onDrop(i));
    head.append(drop);
    const words = h("textarea", "heard-text");
    words.value = item.text;
    words.rows = 1;
    words.setAttribute(
      "aria-label",
      `${item.kind === "question" ? "Question" : "Change"} ${i + 1}`,
    );
    // Reads as text, as tall as its words; a box only while being edited.
    const fit = () => {
      words.style.height = "auto";
      words.style.height = `${words.scrollHeight}px`;
    };
    words.addEventListener("input", () => {
      fit();
      onEdit(i, words.value);
    });
    requestAnimationFrame(fit);
    li.append(head, words);
    list.append(li);
  });
  return list;
}

/** The note's buttons, named for what they will do with this list. */
export function noteLabels(
  draft: Draft,
  owner: boolean,
): { save: string; fix: string; ask: string } {
  const { changes, questions } = showsRead(draft)
    ? itemCounts(draft)
    : { changes: 1, questions: 0 };
  const many = changes > 1;
  return {
    save: many ? `Save ${changes} changes` : owner ? "Save" : "Save feedback",
    fix: many ? "Fix them now" : "Fix it now",
    ask: !changes
      ? "Ask Loki"
      : questions > 1
        ? `Ask ${questions} questions`
        : questions
          ? "Ask the question"
          : "Ask",
  };
}

/** What Ask asks: the listed questions — or, with none, everything heard. */
export function noteQuestion(draft: Draft, typed: string): string {
  if (!showsRead(draft)) return typed;
  const items = draft.items ?? [];
  const questions = items.filter((i) => i.kind === "question");
  return (questions.length ? questions : items)
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join("\n");
}
