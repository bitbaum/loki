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

/** Line label → field. Order is the order the agent is asked to write them. */
const FIELDS = [
  { label: "Problem", key: "problem", ask: "what was actually wrong, in one or two sentences" },
  { label: "Change", key: "change", ask: "what you changed, as the user will see it" },
  { label: "Why", key: "why", ask: "why this approach" },
  {
    label: "Considered",
    key: "considered",
    ask: "one line per alternative you rejected, as `<option> — <why not>` (repeat the line, at most 3)",
  },
  { label: "Helps", key: "helps", ask: "who benefits and how" },
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
  where: string | null;
  plain: string | null;
};

/** The instruction appended to every fix prompt. */
export function fixNoteInstruction(): string {
  return [
    `In the pull request description, include a section headed \`## ${FIX_NOTE_HEADING}\` with these lines — Loki plays it to the owner and the reporter as a guided walkthrough of the change on the live site, so write for a person, not a reviewer:`,
    ...FIELDS.map((f) => `- ${f.label}: <${f.ask}>`),
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
    where: null,
    plain: null,
  };
  const byLabel = new Map<string, (typeof FIELDS)[number]["key"]>(
    FIELDS.map((f) => [f.label.toLowerCase(), f.key]),
  );
  const labelRe = /^\s*(?:[-*]\s*)?\**([A-Za-z][A-Za-z ]{1,24}?)\**\s*:\s*(.*)$/;
  let current: (typeof FIELDS)[number]["key"] | null = null;
  let buffer = "";

  const flush = () => {
    const text = clean(buffer);
    buffer = "";
    if (!current || !text || /^<.*>$/.test(text)) return;
    if (current === "considered") {
      if (note.considered.length >= CONSIDERED_MAX) return;
      const [option, ...rest] = text.split(/\s+[—–-]{1,2}\s+/);
      note.considered.push({
        option: cap(option),
        whyNot: rest.length ? cap(rest.join(" — ")) : null,
      });
    } else if (!note[current]) {
      note[current] = cap(text);
    }
  };

  for (const raw of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(raw.trim())) break;
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

  const any = note.problem || note.change || note.why || note.helps || note.where || note.plain;
  return any || note.considered.length ? note : null;
}
