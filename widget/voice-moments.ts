/**
 * What was on screen while someone talked — and which words go with which part.
 *
 * The owner, speaking into their site on a phone (2026-10-16): "while I'm
 * talking about some element or some part of the page, I don't know whether
 * what I'm saying corresponds to what is shown on the screen and the coding
 * agent sees it." It did not: the note carried the page they started on and a
 * list of headings they passed, and the words arrived as one block.
 *
 * Loki does not film the screen and takes no screenshots — a web page cannot,
 * on a phone, without a permission prompt. What it can do honestly: note what
 * part of the page was in view (its nearest heading) at the start, each time
 * scrolling settles, and each time the person taps Mark; and, because Whisper
 * says when each sentence was said, put every sentence under the part of the
 * page that was in view at that second. The note then reads
 *
 *   On “Nutzen” (marked):
 *   This card is empty, there should be a picture here.
 *
 * — the same text the person sees and can edit before it is sent, and the
 * same text the agent receives. Pure: the DOM read is one small function at
 * the bottom; tested in scripts/test/widget-voice-moments.ts.
 */

export type Moment = {
  /** Milliseconds from the start of the recording. */
  at: number;
  /** What was in view, in the page's own words: its nearest heading. */
  label: string;
  /** The path, so a note that crossed pages says where each part was. */
  page: string;
  /** The person tapped Mark here. */
  marked?: boolean;
};

export type TimedText = { start: number; text: string };

/** More would be a list nobody reads; the newest are the ones talked about last. */
export const MOMENTS_MAX = 12;

/** Add a moment. Scrolling back and forth past one heading is one moment;
 *  a Mark always counts, and turns the moment it lands on into a marked one. */
export function addMoment(list: Moment[], next: Moment): Moment[] {
  const last = list.at(-1);
  if (last && last.label === next.label && last.page === next.page) {
    if (!next.marked || last.marked) return list;
    return [...list.slice(0, -1), { ...last, marked: true }];
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

/**
 * The note as the person reads it and the agent receives it: each sentence
 * under the part of the page that was in view when it was said. Plain
 * transcript when there is nothing to line up — one part of the page, or no
 * timings (a long recording that was split).
 */
export function alignNote(text: string, segments: TimedText[], moments: Moment[]): string {
  const parts = new Set(moments.map((m) => `${m.page}|${m.label}`));
  if (parts.size < 2 || !segments.length) return text;
  const pages = new Set(moments.map((m) => m.page)).size;
  const groups: Array<{ moment: Moment; lines: string[] }> = [];
  for (const seg of segments) {
    const ms = seg.start * 1000;
    // The part in view when the sentence began: the last moment at or before it.
    let current = moments[0];
    for (const m of moments) if (m.at <= ms + 250) current = m;
    const last = groups.at(-1);
    if (last && last.moment === current) last.lines.push(seg.text);
    else groups.push({ moment: current, lines: [seg.text] });
  }
  return groups.map((g) => `${heading(g.moment, pages)}\n${g.lines.join(" ")}`).join("\n\n");
}

/**
 * The part of the page the person is looking at: the last heading that starts
 * above the middle of the screen — the section being read, not the first
 * heading that happens to peek in at the top. Falls back to the first visible
 * heading, then the page title.
 */
export function inView(skip: (el: Element) => boolean): string {
  const clean = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const visible = Array.from(
    document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,[role=heading]"),
  ).filter((el) => {
    if (skip(el) || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && clean(el.innerText || el.textContent);
  });
  const reading = visible.filter((el) => el.getBoundingClientRect().top < innerHeight * 0.55);
  const pick = reading.at(-1) ?? visible[0];
  return pick
    ? clean(pick.innerText || pick.textContent)
    : clean(document.title) || location.pathname;
}
