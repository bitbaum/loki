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
import { MOMENT_LIMITS, momentClock, type ReportMoment } from "./moments-contract";

export const WALK_KINDS = ["change", "question"] as const;
export type WalkKind = (typeof WALK_KINDS)[number];

/**
 * One thing said in a walk: a change to make or a question to answer, and
 * where it applies. The owner talks freely while scrolling (2026-10-18: "I
 * wasn't really referring to that particular part of the screen"), so the
 * part of the page in view is background, not a claim about what they meant;
 * `where` names a part only when they pointed at it.
 */
export type WalkItem = {
  text: string;
  kind: WalkKind;
  /** "Home page, signed in", "Contact section", "Whole site" — or null when unclear. */
  where: string | null;
  /** The walk's moments this came from (indexes into the moments sent), for the builder. */
  parts: number[];
};

export type WalkRead = {
  /** Everything asked, as one instruction — the items joined; what an old card shows. */
  ask: string;
  kind: WalkKind;
  /** The same, one thing per item: what the card lists and what is saved. */
  items: WalkItem[];
  /** Said, but not to Loki: to someone in the room, or narrating the clicks. */
  asides: string[];
};

export const WALK_READ_LIMITS = {
  /** The note the server reads: a long walk's words, not the whole of a long walk. */
  note: 6000,
  ask: 900,
  item: 600,
  items: 8,
  where: 80,
  aside: 160,
  asides: 6,
} as const;

const line = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || /^(null|none|n\/a|-)$/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const kindOf = (v: unknown): WalkKind => (v === "question" ? "question" : "change");

function cleanItem(value: unknown, moments: number): WalkItem | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const text = line(v.text, WALK_READ_LIMITS.item);
  if (!text) return null;
  const parts = [
    ...new Set(
      (Array.isArray(v.parts) ? v.parts : []).filter(
        (n): n is number => Number.isInteger(n) && n >= 0 && n < moments,
      ),
    ),
  ];
  return { text, kind: kindOf(v.kind), where: line(v.where, WALK_READ_LIMITS.where), parts };
}

/** All the items as one instruction: what a card that predates the list shows. */
export function itemsAsk(items: readonly WalkItem[]): string {
  if (items.length === 1) return items[0].text;
  return items.map((i, n) => `${n + 1}. ${i.where ? `${i.where}: ` : ""}${i.text}`).join("\n");
}

/**
 * A read, or null when there is nothing in it a person could act on.
 * `moments` is how many moments were sent, so a part index is never invented.
 * An answer from before the list (one `ask`) becomes a one-item list.
 */
export function cleanWalkRead(
  value: unknown,
  moments: number = MOMENT_LIMITS.count,
): WalkRead | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  let items = (Array.isArray(v.items) ? v.items : [])
    .map((i) => cleanItem(i, moments))
    .filter((i): i is WalkItem => !!i)
    .slice(0, WALK_READ_LIMITS.items);
  if (!items.length) {
    const ask = line(v.ask, WALK_READ_LIMITS.ask);
    if (!ask) return null;
    items = [{ text: ask, kind: kindOf(v.kind), where: null, parts: [] }];
  }
  const asides = (Array.isArray(v.asides) ? v.asides : [])
    .map((a) => line(a, WALK_READ_LIMITS.aside))
    .filter((a): a is string => !!a)
    .slice(0, WALK_READ_LIMITS.asides);
  const ask = itemsAsk(items).slice(0, WALK_READ_LIMITS.ask * 3);
  const kind: WalkKind = items.some((i) => i.kind === "change") ? "change" : "question";
  return { ask, kind, items, asides };
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
