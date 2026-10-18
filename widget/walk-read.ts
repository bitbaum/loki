/**
 * Loki's read of a spoken note, before anyone saves it.
 *
 * The owner walked Petvity for 43 seconds on 2026-10-18 — the home page,
 * Features, the dashboard, Settings — saying the design was inconsistent and
 * asking Loki to look at it all and say what it thought. The card that came
 * back was every word, verbatim, under each part of the page: including
 * "No, no, I'm just making a coffee", said twice to someone in the room, and
 * "we will actually log in", said to nobody. "Save" and "Fix it now" would
 * have handed that to a coding agent; the one request in it was a question
 * (what do you think?), which no build answers. They asked whether Loki had
 * heard them at all.
 *
 * So a spoken note is read first, the way a person would listen to it:
 *
 *   ask     — what was asked, as one instruction in the speaker's own terms
 *   kind    — "change" (the site should be different) or "question" (they
 *             want Loki's view or an answer), which decides the first button
 *   asides  — what was said that was not meant for Loki
 *
 * The card leads with the ask, editable; the words as spoken stay one tap
 * away, with "Use my exact words instead". Nothing waits on the read: the
 * card works exactly as before while it is coming and when it fails. And the
 * words as spoken still reach the agent with every build — each moment
 * carries what was said there (moments-contract.ts).
 *
 * Shared by the widget (cleaning what the server sends) and the server
 * (cleaning what the model answers): one rule for what a read may contain.
 */
import { momentClock, type ReportMoment } from "./moments-contract";

export const WALK_KINDS = ["change", "question"] as const;
export type WalkKind = (typeof WALK_KINDS)[number];

export type WalkRead = {
  /** What was asked, as one instruction — the speaker's request, not a summary of the talk. */
  ask: string;
  kind: WalkKind;
  /** Said, but not to Loki: to someone in the room, or narrating the clicks. */
  asides: string[];
};

export const WALK_READ_LIMITS = {
  /** The note the server reads: a long walk's words, not the whole of a long walk. */
  note: 6000,
  ask: 900,
  aside: 160,
  asides: 6,
} as const;

const line = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(null|none|n\/a|-)$/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A read, or null when there is nothing in it a person could act on. */
export function cleanWalkRead(value: unknown): WalkRead | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const ask = line(v.ask, WALK_READ_LIMITS.ask);
  if (!ask) return null;
  const kind: WalkKind = v.kind === "question" ? "question" : "change";
  const asides = (Array.isArray(v.asides) ? v.asides : [])
    .map((a) => line(a, WALK_READ_LIMITS.aside))
    .filter((a): a is string => !!a)
    .slice(0, WALK_READ_LIMITS.asides);
  return { ask, kind, asides };
}

/** The pages a walk went through, in order, each once. */
export function walkPages(moments: readonly ReportMoment[]): string[] {
  return [...new Set(moments.map((m) => m.page))];
}

/**
 * The card's answer to "did it hear me?": how long, and where.
 * "Loki heard you · 0:43 across 4 pages" — or, on one page, "· 0:12".
 */
export function heardLine(moments: readonly ReportMoment[], spokenMs?: number): string {
  const lastAt = moments.reduce((max, m) => Math.max(max, m.at), 0);
  const ms = Math.max(spokenMs ?? 0, lastAt);
  const pages = walkPages(moments).length;
  const parts = ["Loki heard you"];
  if (ms >= 1000) parts.push(momentClock(ms));
  return pages > 1 ? `${parts.join(" · ")} across ${pages} pages` : parts.join(" · ");
}

/**
 * The walk, for Ask: each part of each page, what was on screen there, and
 * what was said — so "tell me what you think" is answered about every page
 * walked through, not only the one the panel happens to be open on.
 */
export function walkSession(moments: readonly ReportMoment[], max = 5800): string {
  const lines = moments.map((m) => {
    const where = `${momentClock(m.at)} ${m.page} — “${m.label}”${m.marked ? " (marked)" : ""}`;
    const seen = m.text ? ` | on screen: ${m.text}` : "";
    const tapped = m.tap ? ` | tapped: ${m.tap.text}` : "";
    const said = m.said ? ` | said: ${m.said}` : "";
    return `${where}${seen}${tapped}${said}`;
  });
  return ["A spoken walk through the site, in order:", ...lines].join("\n").slice(0, max);
}
