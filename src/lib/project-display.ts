// Display helpers for project metadata shown on PUBLIC surfaces (hero, profile).
//
// The bulk GitHub-import flow stamped every project with a placeholder
// description ("Local repository imported from loki-ui"). It's dead text,
// not signal — never show it. Until real descriptions are backfilled, treat the
// stub as empty so public surfaces stay clean instead of repeating it N times.

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
  const cut = clean.indexOf(BRIEF_HEADING);
  if (cut <= 0) return clean;
  return clean.slice(0, cut).trim() || clean;
}

/** Real description, or null when it's empty / the import placeholder. */
export function cleanDescription(desc: string | null | undefined): string | null {
  const d = desc?.trim();
  if (!d) return null;
  return PLACEHOLDER_DESCRIPTIONS.has(d.toLowerCase()) ? null : d;
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
 * header wants a summary, not an essay. Prefers whole-sentence boundaries and
 * appends an ellipsis when it trims.
 */
export function summarizeDescription(
  desc: string | null | undefined,
  maxChars = 220,
): string | null {
  const clean = cleanDescription(desc);
  if (!clean || clean.length <= maxChars) return clean;
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? "";
  for (let i = 1; i < sentences.length; i++) {
    if (out.length + 1 + sentences[i].length > maxChars) break;
    out += " " + sentences[i];
  }
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, "");
  return `${out.trimEnd()}…`;
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
