import { withoutRetiredClaims } from "@/lib/project-signals";
// Display helpers for project metadata shown on PUBLIC surfaces (hero, profile).
//
// The bulk GitHub-import flow stamped every project with a placeholder
// description ("Local repository imported from loki-ui"). It's dead text,
// not signal — never show it. Until real descriptions are backfilled, treat the
// stub as empty so public surfaces stay clean instead of repeating it N times.

/**
 * What a person calls the project: its title when one is set, else its name —
 * except a name minted by the retired `<host>-refresh-<32 hex>` scheme
 * (lib/brief-project-name.ts), which reads as the site it was made from:
 * "xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf" → "Xhiva" (the owner
 * found that string as a project's heading, 2026-10-19). Every heading, list
 * row, invitation and email names a project through this.
 */
export function projectTitle(project: {
  name: string;
  title?: string | null;
  description?: string | null;
}): string {
  const own = project.title?.trim();
  if (own) return own;
  const legacy = /^(.+)-refresh-[0-9a-f]{32}$/.exec(project.name);
  if (!legacy) return readableName(project.name);
  const host = /https?:\/\/(?:www\.)?([a-z0-9-]+)\./i.exec(project.description ?? "")?.[1];
  const word = host ?? legacy[1].split("-")[0]!;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A folder name, said as a word: "murphys-bar" → "Murphys bar", "loki" →
 * "Loki". Only an all-lowercase slug is rewritten — a name someone typed with
 * capitals ("BiasLens") is already how they say it. The owner read Home as a
 * list of folder names (2026-10-21); a project with no title was shown by its
 * folder everywhere this helper is used.
 */
function readableName(name: string): string {
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) return name;
  const words = name.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A website brief, said as a person would. A project started from /change
 * stores the agent's whole brief as its description, so its heading opened
 * "Develop a new version of this existing website: https://www.xhiva.art/
 * Requested changes (the customer's exact words): …" — instructions to an
 * agent, shown to the client it is for (2026-10-19).
 */
function plainBrief(text: string): string {
  const site = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
  const refresh = /^Develop a new version of this existing website: (\S+)/.exec(text);
  if (refresh) return `A new version of ${site(refresh[1]!)}.`;
  const inspired = /^Create a new, independent website inspired by: (\S+)/.exec(text);
  if (inspired) return `A new website, inspired by ${site(inspired[1]!)}.`;
  return text;
}

/** Heads the owner's interview answers appended to a description (lib/project-interview.ts). */
export const BRIEF_HEADING = "From the owner:";

const PLACEHOLDER_DESCRIPTIONS = new Set([
  "local repository imported from loki-ui",
  "local repository imported from loki",
  "local repository",
  "imported from loki-ui",
]);

/**
 * What the project IS, for a person reading it: the description without the
 * owner's interview answers appended under "From the owner:".
 *
 * Those answers belong in the brief (kickoff, dispatch prompt and search all
 * read cleanDescription and must keep them), but on a header, a list row, a
 * public profile or an OrangeCat listing they read as a transcript: Skif's
 * header opened "…freedom. From the owner: Who is this for, and who pays for
 * it? Year one pays per booking…" (2026-09-25). Falls back to the brief itself
 * when there is no headline before it, so a project never shows nothing.
 */
export function projectHeadline(desc: string | null | undefined): string | null {
  const clean = cleanDescription(desc);
  if (!clean) return null;
  const plain = plainBrief(clean);
  if (plain !== clean) return plain;
  const cut = clean.indexOf(BRIEF_HEADING);
  if (cut <= 0) return clean;
  return clean.slice(0, cut).trim() || clean;
}

/** Real description, or null when it's empty / the import placeholder. */
export function cleanDescription(desc: string | null | undefined): string | null {
  const d = desc?.trim();
  if (!d) return null;
  if (PLACEHOLDER_DESCRIPTIONS.has(d.toLowerCase())) return null;
  // A brief that only restates a retired fact is not a brief. The sentence
  // is dropped; anything else in the same text stays. See project-signals.ts.
  const kept = withoutRetiredClaims(d);
  return kept || null;
}

// Operator-facing dumps (CLAUDE.md, dogfood notes, seam contracts) must never
// reach a public hero. The live homepage leaked "KNOWN BUG" + webhook-secret
// status from project descriptions on 2026-08-13.
const INTERNAL_DUMP =
  /known bug|mutual dogfood|webhook_secret|hmac|42501|rls |seam (status|contract)|todo:|fixme:|orangecat_webhook/i;

const HERO_NOTE_MAX = 72;

/**
 * One public-safe line for the landing hero. Returns null when the text is
 * empty, a placeholder, an internal dump, or too long to be a label.
 */
export function publicHeroNote(desc: string | null | undefined): string | null {
  const summary = summarizeDescription(desc, HERO_NOTE_MAX);
  if (!summary) return null;
  if (INTERNAL_DUMP.test(summary)) return null;
  return summary;
}

/**
 * Non-answers a profile field can hold — the same "dead text, not signal"
 * problem as PLACEHOLDER_DESCRIPTIONS, one layer down.
 *
 * A model asked to fill 17 named fields from a two-line description writes
 * "Unknown" for the ones it cannot infer rather than omitting them (the
 * extraction prompt only says "omit if unknown" on 3 of them). Zeitkastli is
 * the live case: `stack: "Unknown"`, `competitors: "Unknown"`. Those are
 * truthy, so every "is this filled?" check counted them — health scored a point
 * for a field that says nothing, the context header claimed a field complete,
 * and the kickoff planner skipped the profile step for a project whose profile
 * was not actually filled in.
 */
const PLACEHOLDER_ANSWERS = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "nil",
  "null",
  "tbd",
  "to be determined",
  "not specified",
  "not applicable",
  "not known",
  "unspecified",
  "-",
  "—",
  "?",
]);

/**
 * A `<word>` or `<a few words>` template token the enrichment model never
 * substituted — e.g. `next_step: "Keep projects/<name>.md accurate"`. Unlike
 * PLACEHOLDER_ANSWERS this is a substring match: the surrounding sentence can
 * be real prose and the field still isn't a real answer, because a raw
 * placeholder in the middle of it is the model quoting its own prompt
 * template back, not describing this project. Reported from a phone
 * 2026-08-18: "Suggested next (profile): Keep projects/<name>.md accu…" —
 * shown as if it were an actionable next step.
 *
 * Narrow on purpose: the negative lookbehind requires the `<` NOT be glued to
 * a preceding word character, so genuine generic-type syntax like `List<T>`
 * or `Promise<T>` — which always touches its `<` directly — never matches,
 * while a placeholder always has a space, slash, or line start before it
 * ("Keep projects/<name>.md", "Wire up the <repo> CI badge").
 */
const UNSUBSTITUTED_TEMPLATE_RE = /(?<!\w)<[a-z][a-z0-9 _-]{0,24}>/i;

/**
 * Does this attribute hold a real answer? Use everywhere a field's presence
 * decides something — a placeholder must never earn a health point, satisfy a
 * gate, or brief an agent with "STACK: Unknown".
 */
export function hasAnswer(value: string | null | undefined): boolean {
  return answer(value) !== null;
}

/**
 * The real answer this attribute holds, or null — the value-returning twin of
 * `hasAnswer`, and what `cleanDescription` is to descriptions.
 *
 * It exists because `attrs.x?.trim()` reads as "the value, if any" but is not:
 * it happily returns "Unknown". Both shapes are needed (a boolean for gates, a
 * value for display and prompts) and they must agree, so both come from here.
 * An eslint rule bans the raw `attrs.x?.trim()` form to keep it that way.
 */
export function answer(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (PLACEHOLDER_ANSWERS.has(v.toLowerCase().replace(/[.!]+$/, ""))) return null;
  if (UNSUBSTITUTED_TEMPLATE_RE.test(v)) return null;
  return v;
}

/**
 * A short lead for a dossier/card header — the first sentence(s) up to ~maxChars.
 * Descriptions are frequently the entire CLAUDE.md dumped in (400+ words); the
 * header wants a summary, not an essay. Prefers whole-sentence boundaries;
 * a sentence cut short ends with an ellipsis.
 */
export function summarizeDescription(
  desc: string | null | undefined,
  maxChars = 220,
): string | null {
  const described = cleanDescription(desc);
  const clean = described ? plainBrief(described) : null;
  if (!clean || clean.length <= maxChars) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? "";
  for (let i = 1; i < sentences.length; i++) {
    if (out.length + 1 + sentences[i].length > maxChars) break;
    out += " " + sentences[i];
  }
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, "");
  const summary = out.trimEnd();
  return /[.!?]$/.test(summary) ? summary : `${summary}…`;
}

/** A handoff/run older than this reads as stale: the dossier's "Status quo" must
 *  not present a week-old snapshot as the live, healthy present. */
export const DOSSIER_STALE_MS = 6 * 60 * 60 * 1000;

// Names our own smoke/dogfood suites mint — e.g. `smoke-1783188931860-gh`,
// `smoke-<ts> person`. A leaked test row once surfaced on the public landing
// hero (2026-07-08 dogfood find); defend the public face so a future leak
// can never repeat it, independent of DB hygiene.
const TEST_ARTIFACT_NAME = /^smoke-\d{6,}/i;

/** True when a project name is an obvious test/dogfood artifact — never show it publicly. */
export function isPublicTestArtifact(name: string | null | undefined): boolean {
  return TEST_ARTIFACT_NAME.test((name ?? "").trim());
}
