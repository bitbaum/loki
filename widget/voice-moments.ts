/**
 * What was on screen while someone talked — and which words go with which part.
 *
 * The owner, speaking into their site on a phone (2026-10-16): "while I'm
 * talking about some element or some part of the page, I don't know whether
 * what I'm saying corresponds to what is shown on the screen and the coding
 * agent sees it." It did not: the note carried the page they started on and a
 * list of headings they passed, and the words arrived as one block.
 *
 * And the day after (2026-10-17): "I can scroll through the site and click
 * different things while recording an audio … and as I comment, the
 * screenshots or whatever else needs to be taken, so the changes will be
 * made in the most effective way possible."
 *
 * A web page cannot film itself on a phone without a permission prompt, so
 * the widget takes no pictures. What it does take, honestly: at the start,
 * each time scrolling settles, each time the person taps anything on the site
 * and each time they tap Mark, it notes the part of the page in view (its
 * nearest heading), the text at the reading line, how far the page is
 * scrolled, and the control that was tapped — by its own label, never by
 * what was typed into it. Whisper says when each sentence was said, so every
 * sentence lands under the part that was in view at that second. The note
 * then reads
 *
 *   On “Nutzen” (marked):
 *   This card is empty, there should be a picture here.
 *
 * — the same text the person sees and can edit before it is sent, and the
 * same text the agent receives — and beside it travels the structured list
 * of moments (moments-contract.ts): said → seen, with enough of "seen" (page,
 * scroll, tapped selector) for Loki to take the picture itself afterwards,
 * on the server, where no permission prompt stands in the way.
 *
 * Pure: the DOM reads are the small functions at the bottom; tested in
 * scripts/test/widget-voice-moments.ts.
 */
import {
  clampMoments,
  MOMENT_LIMITS,
  type ReportMoment,
  type ReportMomentTap,
} from "./moments-contract";

export type Moment = {
  /** Milliseconds from the start of the recording. */
  at: number;
  /** What was in view, in the page's own words: its nearest heading. */
  label: string;
  /** The path, so a note that crossed pages says where each part was. */
  page: string;
  /** The person tapped Mark here. */
  marked?: boolean;
  /** How far the page was scrolled when this part was last in view. */
  scrollY?: number;
  /** The text at the reading line when this part was last in view. */
  text?: string;
  /** The last thing tapped on the site while this part was in view. */
  tap?: ReportMomentTap;
};

export type TimedText = { start: number; text: string };

/** More would be a list nobody reads; the newest are the ones talked about last. */
export const MOMENTS_MAX = MOMENT_LIMITS.count;

/** Add a moment. Scrolling back and forth past one heading is one moment;
 *  a Mark always counts, and turns the moment it lands on into a marked one;
 *  a tap on the same part replaces the part's tap, and the view (scroll,
 *  reading text) follows the latest look at that part. */
export function addMoment(list: Moment[], next: Moment): Moment[] {
  const last = list.at(-1);
  if (last && last.label === next.label && last.page === next.page) {
    const merged: Moment = {
      ...last,
      // A page change is noted with the moment it happened, after a beat to
      // draw (browse-voice.ts): its look may land after a later scroll's.
      at: Math.min(last.at, next.at),
      ...(next.marked ? { marked: true } : {}),
      ...(next.scrollY !== undefined ? { scrollY: next.scrollY } : {}),
      ...(next.text ? { text: next.text } : {}),
      ...(next.tap ? { tap: next.tap } : {}),
    };
    return [...list.slice(0, -1), merged];
  }
  return [...list, next].slice(-MOMENTS_MAX);
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** One line for the note's context: "0:00 Werde Teil der Community → 0:41 Nutzen (marked)". */
export function timeline(moments: Moment[], max = 300): string {
  return moments
    .map((m) => `${clock(m.at)} ${m.label}${m.marked ? " (marked)" : ""}`)
    .join(" → ")
    .slice(0, max);
}

const heading = (m: Moment, pages: number) =>
  `On ${pages > 1 ? `${m.page} — ` : ""}“${m.label}”${m.marked ? " (marked)" : ""}:`;

// A sentence ends at . ! ? or an ellipsis, maybe followed by a closing quote.
// Escaped, not typed: widget regexes stay ASCII (README, "The bundle is ASCII").
const SENTENCE_END = /[.!?\u2026]["'\u201D\u00BB)]*$/;

/**
 * Whisper's segments joined back into whole sentences, each starting when its
 * first words were said. Whisper cuts on pauses, not on meaning, and a cut
 * landing on a scroll filed half a sentence under one heading and the rest
 * under the next (owner, 2026-10-18: "the first screen that the / logged-in
 * user sees"). A sentence is never split.
 */
export function wholeSentences(segments: readonly TimedText[]): TimedText[] {
  const out: TimedText[] = [];
  let open: TimedText | null = null;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    open = open ? { start: open.start, text: `${open.text} ${text}` } : { start: seg.start, text };
    if (SENTENCE_END.test(text)) {
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

/**
 * Each sentence under the part of the page that was in view when it began:
 * the last moment at or before it. Empty when there is nothing to line up —
 * one part of the page, or no timings.
 */
export function groupNote(
  segments: TimedText[],
  moments: Moment[],
): Array<{ moment: Moment; lines: string[] }> {
  const parts = new Set(moments.map((m) => `${m.page}|${m.label}`));
  if (parts.size < 2 || !segments.length) return [];
  const groups: Array<{ moment: Moment; lines: string[] }> = [];
  for (const seg of wholeSentences(segments)) {
    const ms = seg.start * 1000;
    let current = moments[0];
    for (const m of moments) if (m.at <= ms + 250) current = m;
    const last = groups.at(-1);
    if (last && last.moment === current) last.lines.push(seg.text);
    else groups.push({ moment: current, lines: [seg.text] });
  }
  return groups;
}

/**
 * The note as the person reads it and the agent receives it: each sentence
 * under the part of the page that was in view when it was said. Plain
 * transcript when there is nothing to line up — one part of the page, or no
 * timings (a long recording that was split).
 */
export function alignNote(text: string, segments: TimedText[], moments: Moment[]): string {
  const groups = groupNote(segments, moments);
  if (!groups.length) return text;
  const pages = new Set(moments.map((m) => m.page)).size;
  return groups.map((g) => `${heading(g.moment, pages)}\n${g.lines.join(" ")}`).join("\n\n");
}

/**
 * The structured list that travels beside the note: every moment, with what
 * was said while it was in view. With one part of the page, or no timings,
 * the whole text belongs to the first moment.
 */
export function momentsForReport(
  text: string,
  segments: TimedText[],
  moments: Moment[],
): ReportMoment[] {
  if (!moments.length) return [];
  const groups = groupNote(segments, moments);
  const said = new Map<Moment, string>();
  if (groups.length) for (const g of groups) said.set(g.moment, g.lines.join(" "));
  else said.set(moments[0], text);
  return clampMoments(
    moments.map((m) => ({
      at: m.at,
      page: m.page,
      label: m.label,
      ...(m.marked ? { marked: true } : {}),
      ...(m.scrollY !== undefined ? { scrollY: m.scrollY } : {}),
      ...(m.text ? { text: m.text } : {}),
      ...(m.tap ? { tap: m.tap } : {}),
      ...(said.has(m) ? { said: said.get(m) } : {}),
    })),
  );
}

/** Earlier takes' words and timings, shifted onto the walk's own clock. */
export function joinTakes(
  takes: Array<{ offsetMs: number; text: string; segments: TimedText[] }>,
): { text: string; segments: TimedText[] } {
  const text = takes
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join(" ");
  // Timings exist only when EVERY take carried them: a half-timed walk would
  // pin the untimed sentences onto the wrong part of the page.
  const timed = takes.every((t) => t.segments.length > 0 || !t.text.trim());
  const segments = timed
    ? takes.flatMap((t) =>
        t.segments.map((s) => ({ start: s.start + t.offsetMs / 1000, text: s.text })),
      )
    : [];
  return { text, segments };
}

// ── DOM ────────────────────────────────────────────────────────────────────

const cleanText = (t: string | null | undefined, max: number) =>
  (t ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The part of the page the person is looking at: the last heading that
 * starts above the reading line (a little past the middle of the screen) —
 * the section being read, not the first heading that happens to peek in at
 * the top. That heading may have scrolled off the top: someone deep in a long
 * section, or down at the footer, is still in that section, and naming the
 * page's title instead (what this did until 2026-10-17, found walking the
 * live Petvity home page to its bottom) tells the agent nothing. Falls back
 * to the first heading on screen, then the page title.
 */
export function inView(skip: (el: Element) => boolean): string {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,[role=heading]"),
  ).filter(
    (el) =>
      !skip(el) && el.getClientRects().length > 0 && cleanText(el.innerText || el.textContent, 80),
  );
  const readingLine = innerHeight * 0.55;
  const above = headings.filter((el) => el.getBoundingClientRect().top < readingLine);
  const pick =
    above.at(-1) ??
    headings.find((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
  return pick
    ? cleanText(pick.innerText || pick.textContent, 80)
    : cleanText(document.title, 80) || location.pathname;
}

/**
 * The text at the reading line — a little below the top third of the screen,
 * where a person's eyes rest — so "this" in what they say has a referent.
 * Never an input's value: a form field reads as its label or placeholder.
 */
export function readingText(skip: (el: Element) => boolean): string | undefined {
  const at = document.elementFromPoint(innerWidth / 2, innerHeight * 0.4);
  if (!at || skip(at)) return undefined;
  const field = at.closest("input,textarea,select");
  if (field) {
    const label = (field as HTMLInputElement).placeholder || field.getAttribute("aria-label");
    return cleanText(label, MOMENT_LIMITS.text) || undefined;
  }
  const block =
    at.closest("p,li,h1,h2,h3,h4,h5,h6,td,th,figcaption,blockquote,label,summary,button,a") ??
    at.closest("section,article,main,div") ??
    at;
  const text = cleanText((block as HTMLElement).innerText || block.textContent, MOMENT_LIMITS.text);
  return text || undefined;
}

/** `#id`, `[data-testid=…]`, or tag plus up to two classes — enough for a
 *  picture to scroll to it, never a path that breaks on the next render. */
export function selectorFor(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => /^[A-Za-z_-][\w-]*$/.test(c))
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  const parent = el.parentElement;
  if (!parent) return `${tag}${classes}`;
  const siblings = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
  const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : "";
  return `${tag}${classes}${nth}`.slice(0, MOMENT_LIMITS.selector);
}

/**
 * What was tapped, as the control names itself: aria-label, alt, title, or
 * its text; a form field by its label or placeholder — never its value.
 * Undefined for a tap on nothing nameable (bare page, the widget itself).
 */
export function describeTap(
  target: EventTarget | null,
  skip: (el: Element) => boolean,
): ReportMomentTap | undefined {
  if (!(target instanceof Element) || skip(target)) return undefined;
  const control =
    target.closest(
      "a,button,[role=button],[role=link],[role=tab],input,select,textarea,label,summary",
    ) ?? target;
  let text: string | null = null;
  if (control.matches("input,textarea,select")) {
    const field = control as HTMLInputElement;
    const labelled = field.id
      ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`)
      : null;
    text =
      cleanText(field.getAttribute("aria-label"), MOMENT_LIMITS.tapText) ||
      cleanText(labelled?.textContent, MOMENT_LIMITS.tapText) ||
      cleanText(field.placeholder, MOMENT_LIMITS.tapText) ||
      `${field.type || "field"} field`;
  } else {
    const img = control.querySelector("img[alt]");
    text =
      cleanText(control.getAttribute("aria-label"), MOMENT_LIMITS.tapText) ||
      cleanText(control.getAttribute("title"), MOMENT_LIMITS.tapText) ||
      cleanText((control as HTMLElement).innerText || control.textContent, MOMENT_LIMITS.tapText) ||
      cleanText(img?.getAttribute("alt"), MOMENT_LIMITS.tapText);
  }
  if (!text) return undefined;
  return { text, selector: selectorFor(control) };
}
