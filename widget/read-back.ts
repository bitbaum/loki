/**
 * "Here's what I heard": a spoken note, read back before it is kept.
 *
 * Done turns a walk into one note with a section per part of the page
 * (voice-moments.ts: `On “Pricing”:` …, `On /about — “Team”:` across pages).
 * The card used to show only the raw text; the owner asked to have the notes
 * grouped by page and read back (2026-10-18), so this lists them as they will
 * be built and can say them aloud. Pure, except the one speech call.
 */
import { h } from "./dom";

export type HeardPart = { page: string | null; where: string; marked: boolean; said: string };

// Escaped, not typed: a bundler keeps non-ASCII inside a regex literal as
// raw bytes, and on a host page that does not declare its encoding the
// browser reads them as something else and nothing matches (found in a
// fixture page, 2026-10-18). Strings are escaped for us; a regex is not.
const HEADING = /^On (?:(.+?) \u2014 )?\u201C(.+?)\u201D( \(marked\))?:$/;

/** The note's sections, in order. A note with no sections is one part. */
export function heardParts(text: string): HeardPart[] {
  const parts: HeardPart[] = [];
  let current: HeardPart | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(HEADING);
    if (m) {
      current = { page: m[1] ?? null, where: m[2], marked: !!m[3], said: "" };
      parts.push(current);
    } else if (line) {
      if (!current) {
        current = { page: null, where: "", marked: false, said: "" };
        parts.push(current);
      }
      current.said = current.said ? `${current.said} ${line}` : line;
    }
  }
  return parts.filter((p) => p.said);
}

/** "Here's what I heard — 3 things, on 2 pages." */
export function heardTitle(parts: readonly HeardPart[]): string {
  const pages = new Set(parts.map((p) => p.page ?? "")).size;
  if (parts.length < 2) return "Here's what I heard";
  return pages > 1
    ? `Here's what I heard — ${parts.length} things, on ${pages} pages`
    : `Here's what I heard — ${parts.length} things on this page`;
}

/** What is said aloud: the same list, as sentences. */
export function heardSpeech(parts: readonly HeardPart[]): string {
  return [
    "Here's what I heard.",
    ...parts.map((p) => (p.where ? `About ${p.where}: ${p.said}` : p.said)),
  ].join(" ");
}

/**
 * The read-back: the list, Read it back, and Edit. When it lists the note part
 * by part, the list IS the note — the editable text opens on Edit; it used to
 * sit under the list saying the same words again (2026-10-18).
 */
export function readBackView(
  text: string,
  onEdit: () => void,
): { el: HTMLElement; listed: boolean } {
  const parts = heardParts(text);
  const el = h("div", "readback");
  el.append(h("div", "changes-title", heardTitle(parts)));
  const listed = parts.length > 1 || !!parts[0]?.where;
  if (listed) {
    const list = h("ul", "readback-list");
    for (const p of parts) {
      const li = h("li");
      if (p.where) li.append(h("b", undefined, `${p.page ? `${p.page} · ` : ""}${p.where}`), " ");
      li.append(p.said.length > 140 ? `${p.said.slice(0, 140).replace(/\s+\S*$/, "")}…` : p.said);
      list.append(li);
    }
    el.append(list);
  }
  const tools = h("div", "readback-tools");
  el.append(tools);
  const speech = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (speech && parts.length) {
    const say = h("button", "act readback-say", "🔊 Read it back");
    say.type = "button";
    say.addEventListener("click", () => {
      if (speech.speaking) {
        speech.cancel();
        say.textContent = "🔊 Read it back";
        return;
      }
      const u = new SpeechSynthesisUtterance(heardSpeech(parts));
      u.lang = document.documentElement.lang || navigator.language;
      u.onend = () => (say.textContent = "🔊 Read it back");
      speech.speak(u);
      say.textContent = "■ Stop";
    });
    tools.append(say);
  }
  if (listed) {
    const editBtn = h("button", "act", "Edit");
    editBtn.type = "button";
    editBtn.addEventListener("click", () => {
      editBtn.remove();
      onEdit();
    });
    tools.append(editBtn);
  }
  return { el, listed };
}
