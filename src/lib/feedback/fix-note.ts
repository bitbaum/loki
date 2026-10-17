/**
 * The design note an agent leaves with a fix: what was wrong, what changed,
 * why this way, what else it considered, who it helps — and one plain
 * sentence for the person who reported it.
 *
 * "Watch the fix" used to have one line to go on (the handoff's `done`) and a
 * PR title, so it could show WHERE a change was and never WHY. The reasoning
 * existed only inside the agent's session and died with it (2026-10-07).
 *
 * It travels in the pull request description, not the handoff: every runner
 * and every agent CLI already opens the PR, the fix ledger already reads it
 * (fix-shipping-refresh.ts), and a person reading the PR on GitHub gets the
 * same account the walkthrough gives. One section, one format, defined here —
 * the instruction the agent receives is rendered from the same field list the
 * parser reads, so the two cannot drift.
 *
 * Everything here is text an agent wrote after reading a stranger's report, so
 * it is capped and only ever rendered as text, never markup.
 */

export const FIX_NOTE_HEADING = "Walkthrough";

/** Line label → field. Order is the order the agent is asked to write them.
 *  Exported so a build that leaves no pull request (a preview folder) can ask
 *  for the same account under the same keys — lib/previews/improvements. */
export const FIX_NOTE_FIELDS = [
  { label: "Problem", key: "problem", ask: "what was actually wrong, in one or two sentences" },
  { label: "Change", key: "change", ask: "what you changed, in plain words" },
  {
    label: "Shows",
    key: "shows",
    ask: "`on the page` if a person can see the change, or `behind the scenes` if they cannot (backend, data, speed, reliability, security)",
  },
  {
    label: "Under the hood",
    key: "detail",
    ask: "exactly what changed in the system, in words someone who does not code can follow — required when it is behind the scenes",
  },
  { label: "Why", key: "why", ask: "why this approach" },
  {
    label: "Considered",
    key: "considered",
    ask: "one line per alternative you rejected, as `<option> — <why not>` (repeat the line, at most 3)",
  },
  {
    label: "Helps",
    key: "helps",
    ask: "how this benefits the people who use the product — every change must; for a behind-the-scenes change, the effect they will notice (faster, fewer errors, nothing lost, safer data)",
  },
  {
    label: "Benefits us",
    key: "us",
    ask: "how it benefits us, the people who run this product — revenue, trust, less support, lower running cost — or `none`",
  },
  {
    label: "Downsides",
    key: "downsides",
    ask: "what could get worse or go wrong — risks, trade-offs, anything removed — or `none` if you checked and there are none",
  },
  {
    label: "Costs",
    key: "costs",
    ask: "what it costs to run or keep — money, AI or API spend, hosting, maintenance, page speed — or `none` if you checked and there are none",
  },
  {
    label: "Proof",
    key: "proof",
    ask: "how you know it works — the test, measurement or log that shows it; essential when nothing is visible",
  },
  {
    label: "Next",
    key: "next",
    ask: "what else could be done on this front later, and why it was left out of this change (or `nothing`)",
  },
  { label: "Where", key: "where", ask: "where on the live page to look" },
  {
    label: "For the reporter",
    key: "plain",
    ask: "one or two plain sentences for the person who reported it — no code, file names or internals",
  },
] as const;

const FIELD_MAX = 400;
const CONSIDERED_MAX = 3;

export type FixNote = {
  problem: string | null;
  change: string | null;
  why: string | null;
  considered: { option: string; whyNot: string | null }[];
  helps: string | null;
  /** Can a person see this change on a page, or does it work behind the
   *  scenes? A backend fix has nothing to point a cursor at; saying so is what
   *  lets the walkthrough explain it instead of pointing at the wrong thing. */
  shows: "page" | "behind" | null;
  /** How it benefits the people who run the product (us, not the users). */
  us: string | null;
  /** Risks, trade-offs, anything that gets worse. NOTE_NONE when the
   *  developer checked and there are none — which is said out loud, never
   *  left blank: a blank reads the same as "nobody looked". */
  downsides: string | null;
  /** What it costs to run or keep: money, AI spend, hosting, maintenance,
   *  speed. NOTE_NONE when there are none. */
  costs: string | null;
  /** For a change nobody can see: exactly what changed, in plain words. */
  detail: string | null;
  /** How the developer knows it works — the test, measurement or log. */
  proof: string | null;
  /** What else could be done on this front — the developer's honest "not
   *  yet", so the owner can steer the next step instead of guessing it. */
  next: string | null;
  where: string | null;
  plain: string | null;
};

/** How the walkthrough names each field to the owner — one list, drawn by the
 *  watch page (components/projects/Walkthrough) and the preview tour
 *  (lib/previews/before-after-page) alike. */
export const WALKTHROUGH_LABELS = {
  problem: "The problem",
  change: "The change",
  helps: "For the people using it",
  detail: "Under the hood",
  why: "Why this way",
  considered: "Also considered",
  us: "For us",
  downsides: "Downsides",
  costs: "What it costs",
  proof: "How we know it works",
  next: "Left for later",
} as const;

/** The instruction appended to every fix prompt. */
export function fixNoteInstruction(): string {
  return [
    `In the pull request description, include a section headed \`## ${FIX_NOTE_HEADING}\` with these lines — Loki plays it to the owner and the reporter as a guided walkthrough of the change on the live site, so write for a person, not a reviewer. Every change must say how it helps the people who use the product and how it benefits us, and must state its downsides and costs — write \`none\` only when you checked and there are none; a change nobody can see must say exactly what changed and how you know it works:`,
    ...FIX_NOTE_FIELDS.map((f) => `- ${f.label}: <${f.ask}>`),
  ].join("\n");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s.length > FIELD_MAX ? `${s.slice(0, FIELD_MAX - 1)}…` : s);

/** Read the note out of a PR description. Null when there is no section or
 *  nothing usable in it — the walkthrough then falls back to what it had. */
export function parseFixNote(body: string | null | undefined): FixNote | null {
  if (!body) return null;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const heading = new RegExp(`^#{2,4}\\s*${FIX_NOTE_HEADING}\\s*$`, "i");
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start < 0) return null;

  const note: FixNote = {
    problem: null,
    change: null,
    why: null,
    considered: [],
    helps: null,
    us: null,
    downsides: null,
    costs: null,
    shows: null,
    detail: null,
    proof: null,
    next: null,
    where: null,
    plain: null,
  };
  const byLabel = new Map<string, (typeof FIX_NOTE_FIELDS)[number]["key"]>(
    FIX_NOTE_FIELDS.map((f) => [f.label.toLowerCase(), f.key]),
  );
  const labelRe = /^\s*(?:[-*]\s*)?\**([A-Za-z][A-Za-z ]{1,24}?)\**\s*:\s*(.*)$/;
  let current: (typeof FIX_NOTE_FIELDS)[number]["key"] | null = null;
  let buffer = "";

  const flush = () => {
    const text = clean(buffer);
    buffer = "";
    if (!current || !text || /^<.*>$/.test(text)) return;
    if (current === "considered") {
      note.considered.push(...splitAlternatives(text));
      note.considered.length = Math.min(note.considered.length, CONSIDERED_MAX);
    } else if (current === "shows") {
      note.shows ??= readShows(text);
    } else if (!note[current]) {
      note[current] = cap(text);
    }
  };

  for (const raw of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(raw.trim())) break;
    // A blank line ends the field: what follows a list is not part of its
    // last line. The PR footer ("🤖 Generated with …") sits exactly there, and
    // was read into the reporter's sentence on every note this parser saw
    // in its first week (substrata#169, 2026-10-09).
    if (!raw.trim()) {
      flush();
      current = null;
      continue;
    }
    const m = raw.match(labelRe);
    const key = m ? byLabel.get(m[1].trim().toLowerCase()) : undefined;
    if (m && key) {
      flush();
      current = key;
      buffer = m[2];
    } else if (current && raw.trim()) {
      buffer += ` ${raw.trim().replace(/^[-*]\s*/, "")}`;
    }
  }
  flush();

  const tidy = tidyFixNote(note);
  const any =
    tidy.problem ||
    tidy.change ||
    tidy.detail ||
    tidy.why ||
    tidy.helps ||
    tidy.next ||
    tidy.where ||
    tidy.plain;
  return any || tidy.considered.length ? tidy : null;
}

/** "<option> — <why not>" as one alternative. */
function toAlternative(text: string): { option: string; whyNot: string | null } {
  const [option, ...rest] = text.split(/\s+[—–-]{1,2}\s+/);
  return { option: cap(option), whyNot: rest.length ? cap(rest.join(" — ")) : null };
}

/**
 * One `Considered:` line may carry several alternatives — agents write them as
 * sentences, each "<option> — <why not>." A sentence with its own dash starts
 * a new alternative; one without continues the reason before it.
 */
function splitAlternatives(text: string): { option: string; whyNot: string | null }[] {
  const groups: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (/\s[—–]\s/.test(sentence) || groups.length === 0) groups.push(sentence);
    else groups[groups.length - 1] += ` ${sentence}`;
  }
  return groups.map(toAlternative);
}

const FOOTER = /\s*(?:🤖\s*)?Generated with \[?Claude Code\]?(?:\([^)]*\))?\.?\s*$/i;

/**
 * Repair a note read by an earlier parser. The fix ledger stops asking GitHub
 * once a fix is live, so a note saved with last week's mistakes would keep
 * them forever; the walkthrough runs every stored note through this first.
 * Idempotent, and a no-op on a note this parser wrote.
 */
/** "on the page" / "behind the scenes", however an agent phrased it. */
function readShows(text: string): FixNote["shows"] {
  if (/behind|backend|server|not visible|invisible|under the hood|\bno\b/i.test(text))
    return "behind";
  if (/page|visible|screen|\byes\b|ui\b/i.test(text)) return "page";
  return null;
}

/** Fields added after the first notes were saved; absent on those. */
type LateFields = "next" | "shows" | "detail" | "proof" | "us" | "downsides" | "costs";

/** What a note says when the developer checked and there is nothing to say. */
export const NOTE_NONE = "None";
const SAYS_NONE =
  /^(none|nothing|no|zero|n\/a|\$?0|none (that i|i) (know|can see|found)|no (known )?(downsides?|costs?|risks?|trade-?offs?|extra cost))\b[.!]?$/i;
const noneOr = (s: string | null) => (s && SAYS_NONE.test(s.trim()) ? NOTE_NONE : s);

export function tidyFixNote(
  note: Omit<FixNote, LateFields> & Partial<Pick<FixNote, LateFields>>,
): FixNote {
  const strip = (s: string | null) => {
    const t = s ? s.replace(FOOTER, "").trim() : "";
    return t || null;
  };
  const considered = note.considered
    .flatMap((alt) => {
      const whole = strip(alt.whyNot ? `${alt.option} — ${alt.whyNot}` : alt.option);
      return whole ? splitAlternatives(whole) : [];
    })
    .slice(0, CONSIDERED_MAX);
  return {
    problem: strip(note.problem),
    change: strip(note.change),
    why: strip(note.why),
    considered,
    helps: strip(note.helps),
    us: noneOr(strip(note.us ?? null)),
    downsides: noneOr(strip(note.downsides ?? null)),
    costs: noneOr(strip(note.costs ?? null)),
    shows: note.shows === "page" || note.shows === "behind" ? note.shows : null,
    detail: strip(note.detail ?? null),
    proof: strip(note.proof ?? null),
    // Absent on notes saved before the field existed.
    next: /^(nothing|none|n\/a)\.?$/i.test((note.next ?? "").trim())
      ? null
      : strip(note.next ?? null),
    where: strip(note.where),
    plain: strip(note.plain),
  };
}
