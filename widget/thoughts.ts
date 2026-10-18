/**
 * What Loki is thinking while it watches, as sentences the owner reads.
 *
 * Watch used to be silent until something broke: a "Loki · watching" pill and
 * then nothing, so its owner could not tell whether it was looking at
 * anything at all (heidi.orangecat.ch, 2026-10-09: "It's not clear what it
 * thinks when it watches"). The trail it keeps already says, step by step,
 * what it saw — this turns that trail into the running notes the panel shows.
 *
 * Pure (scripts/test/widget-thoughts.ts). Nothing here is new information and
 * nothing is invented: every line is one recorded step, worded.
 */
import type { TrailEntry } from "./watch-trail";

export type ThoughtTone = "plain" | "good" | "warn" | "bad";
export type Thought = { at: number; text: string; tone: ThoughtTone };

/** Lines the panel lists, newest first. */
export const THOUGHTS_SHOWN = 30;

function pageName(path: string): string {
  return path === "/" || !path ? "the home page" : path;
}

export function thoughtFor(e: TrailEntry): Thought {
  const at = e.at;
  switch (e.kind) {
    case "page":
      return { at, tone: "plain", text: `Opened ${pageName(e.text)}` };
    case "tap":
      return { at, tone: "plain", text: `You pressed ${e.text}` };
    case "look":
      return {
        at,
        tone: /^nothing\b/.test(e.text) ? "good" : "warn",
        text: `Looked over the page — ${e.text}`,
      };
    case "result": {
      const nothing = /^nothing\b/.test(e.text);
      return {
        at,
        tone: nothing ? "warn" : "plain",
        text: `↳ ${nothing ? "Nothing visibly happened" : e.text.charAt(0).toUpperCase() + e.text.slice(1)}`,
      };
    }
    case "notice":
      return { at, tone: "warn", text: `Noticed: ${e.text}` };
    case "talk":
      return { at, tone: "plain", text: `You asked me: ${e.text}` };
    case "error":
      return { at, tone: "bad", text: `The page hit an error: ${e.text}` };
    case "request": {
      const failed = /\u2192 (5\d\d|no response)/.test(e.text);
      return failed
        ? { at, tone: "bad", text: `A request failed: ${e.text}` }
        : { at, tone: "plain", text: `The page sent ${e.text}` };
    }
  }
}

export function thoughtsFrom(trail: TrailEntry[]): Thought[] {
  return trail.slice(-THOUGHTS_SHOWN).map(thoughtFor).reverse();
}

/** The one line the collapsed row says. */
export function thoughtsSummary(trail: TrailEntry[], watching: boolean): string {
  if (!watching) return "Not watching — nothing is recorded";
  if (!trail.length) return "Watching — waiting for the page to settle";
  const lines = trail.map(thoughtFor);
  const problems = lines.filter((t) => t.tone === "warn" || t.tone === "bad").length;
  const pages = trail.filter((e) => e.kind === "page").length;
  const taps = trail.filter((e) => e.kind === "tap").length;
  const seen = [
    `${pages} ${pages === 1 ? "page" : "pages"}`,
    ...(taps ? [`${taps} ${taps === 1 ? "press" : "presses"}`] : []),
  ].join(", ");
  const verdict = problems
    ? `${problems} ${problems === 1 ? "thing" : "things"} to look at`
    : "nothing wrong so far";
  return `Watching · ${seen} · ${verdict}`;
}

/**
 * The owner's header, in two lines: the state in a word ("Watching" /
 * "Paused"), and under it what needs a look — "2 to look at · 2 notes saved".
 * One line held both and was cut off on a phone (2026-10-18). The page and
 * press counts stay in thoughtsSummary (the tooltip) and in the list.
 */
export function watchHeadline(
  trail: TrailEntry[],
  watching: boolean,
  more = "",
): { state: string; detail: string } {
  const problems = trail
    .map(thoughtFor)
    .filter((t) => t.tone === "warn" || t.tone === "bad").length;
  const parts = [...(problems ? [`${problems} to look at`] : []), ...(more ? [more] : [])];
  return {
    state: watching ? "Watching" : "Paused",
    detail: parts.length
      ? parts.join(" · ")
      : watching
        ? "Nothing to look at so far"
        : "Nothing is being recorded",
  };
}

/** "now", "40s", "3m" — how long ago, short enough for a line's margin. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
