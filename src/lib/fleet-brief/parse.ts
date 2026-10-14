/**
 * Reading bitbaum/fleet's registers into the few fields the fleet brief renders.
 *
 * The brief tells every agent Loki dispatches into a bitbaum repo which shared
 * package already does the job and which technology the fleet blessed for it.
 * Those facts have ONE producer — `registers/packages.json` and the table in
 * `STACK.md` in bitbaum/fleet — and this file only reads them. Nothing here
 * types a package name or a stack choice; a Loki-side copy is the drift the
 * fleet's "one producer per fact" rule exists to prevent.
 *
 * Everything fetched is treated as DATA headed into an agent's prompt, so it is
 * validated (zod), reduced to the fields we render, flattened to one line,
 * stripped of markdown and control characters, and length-capped. A register
 * row that does not validate is dropped, not repaired. An install command must
 * match a strict `pnpm add …` shape or it is not rendered at all — the one
 * field an agent might execute verbatim is the one with no free text in it.
 *
 * Pure: no network, no database. The fetch-and-cache half is in ./brief.ts.
 */
import { z } from "zod";

export type FleetPackage = {
  /** npm name, e.g. `@bitbaum/ai-kit`. */
  name: string;
  /** One line from the register's description, or null when it has none. */
  purpose: string | null;
  /** A validated `pnpm add …` command, or null when the register's did not validate. */
  install: string | null;
};

export type FleetStackRow = { job: string; blessed: string };

/** Hard ceilings, so a register that balloons cannot balloon a prompt. */
export const LIMITS = {
  packages: 30,
  stackRows: 30,
  purposeChars: 80,
  jobChars: 40,
  blessedChars: 60,
  /** Refuse to even parse a fetched body larger than this. */
  bodyBytes: 512 * 1024,
} as const;

export const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]{0,40}\/)?[a-z0-9][a-z0-9._-]{0,60}$/;

/**
 * The only install commands that may reach a prompt: `pnpm add` of one npm
 * name (optionally with a version range), or of one tagged git ref inside the
 * bitbaum org. No flags but `-w`, no shell metacharacters, no second command.
 */
export const INSTALL_RE =
  /^pnpm add (?:-w )?(?:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[\w.^~<>=|-]+)?|github:bitbaum\/[a-z0-9][a-z0-9._-]*#[\w.-]+)$/i;

/** C0/C1 controls, zero-width, bidi overrides and the BOM, built from code points so
 * the source carries no invisible characters of its own. */
const INVISIBLE = new RegExp(
  `[${(
    [
      [0x00, 0x1f],
      [0x7f, 0x9f],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2060, 0x206f],
      [0xfeff, 0xfeff],
    ] as const
  )
    .map(
      ([from, to]) =>
        `\\u${from.toString(16).padStart(4, "0")}-\\u${to.toString(16).padStart(4, "0")}`,
    )
    .join("")}]`,
  "g",
);

/**
 * One line of untrusted text, safe to place in a prompt: no control or
 * zero-width/bidi characters, no line breaks (so it cannot open a heading or a
 * new instruction block), no markdown emphasis, code fences or link syntax.
 */
export function flattenText(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      // C0/C1 controls, zero-width, bidi overrides, BOM — all become a space.
      .replace(INVISIBLE, " ")
      // [text](url) → text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|`+/g, "")
      .replace(/[<>]|#+(?=\s)|#{2,}/g, "")
      .replace(/^[\s#>*-]+/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Cap at a word boundary, marking the cut. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.(—-]+$/, "")}…`;
}

/** The first sentence, so a paragraph-long register entry renders as one line. */
function firstSentence(text: string): string {
  const m = /^(.+?[.!?])\s+(?=\S)/.exec(text);
  return (m ? m[1] : text).replace(/\.$/, "");
}

const RegisterRow = z.object({
  name: z.string().regex(PACKAGE_NAME_RE),
  description: z.string().max(8000).nullable().optional(),
  install: z.object({ command: z.string().max(200) }).optional(),
});

const Register = z.object({
  generatedAt: z.string().max(40).optional(),
  packages: z.array(z.unknown()).max(500),
});

/** `registers/packages.json` → the rows the brief renders, or null when unusable. */
export function parsePackagesRegister(
  json: unknown,
): { packages: FleetPackage[]; generatedAt: string | null } | null {
  const register = Register.safeParse(json);
  if (!register.success) return null;
  const packages: FleetPackage[] = [];
  const seen = new Set<string>();
  for (const raw of register.data.packages) {
    const row = RegisterRow.safeParse(raw);
    if (!row.success || seen.has(row.data.name)) continue;
    seen.add(row.data.name);
    const description = row.data.description ? flattenText(row.data.description) : "";
    const command = row.data.install?.command.trim().replace(/\s+/g, " ") ?? "";
    packages.push({
      name: row.data.name,
      purpose: description ? capText(firstSentence(description), LIMITS.purposeChars) : null,
      install: INSTALL_RE.test(command) ? command : null,
    });
    if (packages.length >= LIMITS.packages) break;
  }
  if (packages.length === 0) return null;
  const generatedAt = register.data.generatedAt ?? null;
  return {
    packages,
    generatedAt:
      generatedAt && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(generatedAt) ? generatedAt : null,
  };
}

/** Cells of one markdown table row; `\|` inside a cell is kept as a literal bar. */
function tableCells(line: string): string[] {
  return line
    .replace(/\\\|/g, "\u0000")
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.replace(/\u0000/g, "/").trim());
}

/** A Blessed cell, reduced to the choice itself — the reasoning stays in STACK.md. */
function shortBlessed(cell: string): string {
  let text = firstSentence(flattenText(cell));
  if (text.length > LIMITS.blessedChars) text = text.replace(/\s*\([^()]*\)/g, "");
  return capText(text, LIMITS.blessedChars);
}

/**
 * The "| Job | Blessed | … |" table in fleet `STACK.md` → one row per job, or
 * null when the table is missing or implausibly short (a rewrite of the file
 * must degrade to the snapshot, never to an empty stack).
 */
export function parseStackTable(markdown: string): FleetStackRow[] | null {
  const lines = markdown.split(/\r?\n/);
  const header = lines.findIndex((line) => /^\s*\|\s*Job\s*\|\s*Blessed\s*\|/i.test(line));
  if (header < 0) return null;
  const rows: FleetStackRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [jobCell, blessedCell] = tableCells(line);
    if (!jobCell || !blessedCell) continue;
    const job = capText(flattenText(jobCell), LIMITS.jobChars);
    const blessed = shortBlessed(blessedCell);
    if (job && blessed) rows.push({ job, blessed });
    if (rows.length >= LIMITS.stackRows) break;
  }
  return rows.length >= 3 ? rows : null;
}

/** The committed fallback's shape — validated on load like anything fetched. */
export const FleetSnapshot = z.object({
  fetchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  registerGeneratedAt: z.string().nullable(),
  packages: z
    .array(
      z.object({
        name: z.string().regex(PACKAGE_NAME_RE),
        purpose: z.string().max(LIMITS.purposeChars).nullable(),
        install: z.string().regex(INSTALL_RE).nullable(),
      }),
    )
    .min(1)
    .max(LIMITS.packages),
  stack: z
    .array(
      z.object({
        job: z.string().min(1).max(LIMITS.jobChars),
        blessed: z.string().min(1).max(LIMITS.blessedChars),
      }),
    )
    .min(3)
    .max(LIMITS.stackRows),
});
export type FleetSnapshot = z.infer<typeof FleetSnapshot>;
