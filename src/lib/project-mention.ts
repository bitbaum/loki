/**
 * Which registered project does a sentence name? SSOT for text → project.
 *
 * Four call sites each carried their own copy of the same one-liner:
 *
 *   projectNames.find((p) => text.toLowerCase().includes(p.toLowerCase()))
 *
 * That is a raw substring match, so it only ever fires when the operator types
 * the slug exactly. Observed on a phone 2026-08-18: "I want you to tell me what
 * is left to do with Orange Cat for it to work properly" resolved to NO project.
 * The registry holds `orangecat`; the sentence holds `orange cat`; one space is
 * the entire difference. Loki answered with a nine-project picker that did not
 * contain the project the operator had just named — the worst possible reply,
 * because it proves the name was read and then ignored.
 *
 * People type project names the way they SAY them; the registry stores slugs.
 * Matching has to bridge that without inventing hits — comparing squashed
 * strings alone makes the project `go` match the word "going".
 *
 * So: tokenize both sides into alphanumeric runs, then look for a CONTIGUOUS
 * run of sentence tokens whose concatenation equals the project's.
 *   "orange cat"  → orange|cat → "orangecat"  ✓ matches `orangecat`
 *   "orange-cat"  → orange|cat → "orangecat"  ✓
 *   "OrangeCat"   → orangecat                 ✓
 *   "going"       → going ≠ go                ✗ no false positive
 *
 * Longest project name wins, so `aoz-begleitung` beats `aoz` on a sentence that
 * contains both.
 */

import { APP_NAME } from "@/config/brand";

/** Alphanumeric runs, lowercased. `Orange Cat!` → ["orange", "cat"]. */
function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A project's comparable form: every separator removed. `aoz-begleitung` → `aozhousing`. */
function squash(value: string): string {
  return tokenize(value).join("");
}

/** True when `text` names `projectName`, tolerating spacing/case/separators. */
export function textMentionsProject(text: string, projectName: string): boolean {
  const target = squash(projectName);
  if (!target) return false;
  const tokens = tokenize(text);
  for (let start = 0; start < tokens.length; start++) {
    let run = "";
    for (let end = start; end < tokens.length; end++) {
      run += tokens[end];
      if (run === target) return true;
      // Runs only grow, so once past the target length this start can't match.
      if (run.length >= target.length) break;
    }
  }
  return false;
}

/**
 * The text with every place it ADDRESSES the assistant taken out.
 *
 * The assistant is called Loki and so is one of the projects. A name in the
 * text outranks the selected project (lib/loki-fleet-commands, on purpose), so
 * "Loki, add a dark mode toggle" typed with orangecat selected is sent to
 * the loki project: the greeting is read as the place to build. Found on
 * 2026-11-12, when a probe sent on the live site with orangecat selected and
 * the word "loki" in its marker came back "Sent loki to the cloud runner" and
 * sat behind that project's open run. That was the rule working as written;
 * an address to the assistant is the case where it should not apply.
 *
 * Only an address is removed, and an address is the name SET OFF from the
 * sentence: by a comma, a colon, a dash, an exclamation or question mark, or
 * by "please" / "can you". "Loki's sidebar", "in loki", "the loki repo",
 * "ok loki is broken" and "loki-loop-check" still name the project, and so
 * does a bare "Loki fix the header": with nothing setting the name off it
 * cannot be told from a mention, and the old reading stands.
 *
 * "loki: fix the header" stays ambiguous. It is read as an address, so with
 * another project selected the work goes there; with nothing selected and no
 * other project named, the name is all there is to go on and it is the
 * project (projectNamedByAddress, the last resort of every caller).
 */
const ADDRESS_GREETING =
  "(?:hey there|hey|hi|hello|hallo|hoi|ok|okay|yo|dear|please|thanks|thank you|danke|bitte|salut|ciao|good morning|good evening|morning)";
/** What sets a name off as an address: punctuation, a dash, or the end. A
 *  hyphen counts only with a space on each side ("Loki - add …"), never
 *  attached ("loki-loop-check"). Lookahead only: nothing is consumed. */
const SET_OFF = "(?=\\s*(?:[,:;!?—–]|\\s-\\s|\\.(?:\\s|$)|$))";
/** A request that follows a name makes the name an address ("Loki please …"). */
const ASKS = "(?=\\s+(?:please|can you|could you|would you|will you)\\b)";
/** Start of the message, of a sentence, or of a line. */
const START = "(^|[.!?\\n]\\s*)";
/** The punctuation and space an address leaves behind. */
const TAIL = "(?:\\s*[,:;!?—–]|\\s+-(?=\\s))*\\s*";

export function withoutAddressTo(text: string, assistantName: string = APP_NAME): string {
  const name = assistantName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!name) return text;
  // Not "loki's" and not "loki-loop-check": the name must end the word.
  const whole = `${name}(?!['’]s\\b)(?!-\\w)\\b`;
  return (
    text
      // "@loki" opening the message or a sentence; "@loki/ui" is a package.
      .replace(new RegExp(`${START}@${name}\\b(?!/)${TAIL}`, "gi"), "$1")
      // "Hey Loki, …", "Thanks Loki!": a greeting, then the name set off.
      .replace(
        new RegExp(`${START}${ADDRESS_GREETING}[\\s,]+${whole}${SET_OFF}${TAIL}`, "gi"),
        "$1",
      )
      // "Loki, …" / "Loki: …" / "Loki — …" / "Loki - …" opening a sentence.
      .replace(new RegExp(`${START}${whole}${SET_OFF}${TAIL}`, "gi"), "$1")
      // "Loki please …", "Loki can you …".
      .replace(new RegExp(`${START}${whole}${ASKS}\\s*`, "gi"), "$1")
      // "…, Loki, …" between commas.
      .replace(new RegExp(`,\\s*${whole}\\s*,`, "gi"), ",")
      // "…, Loki." at the end.
      .replace(new RegExp(`,\\s*${whole}\\s*[.!?]*\\s*$`, "i"), "")
  );
}

/**
 * The registered project this text names, or null.
 *
 * Longest name first so a sentence mentioning both `aoz` and `aoz-begleitung`
 * resolves to the more specific one rather than whichever the caller listed
 * first — list order is a registry accident, not operator intent.
 *
 * An address to the assistant ("Loki, …") is not a mention of the project
 * that shares its name (withoutAddressTo).
 */
export function projectMentionedIn(text: string, projectNames: string[]): string | null {
  const said = withoutAddressTo(text);
  const ranked = [...projectNames].sort((a, b) => squash(b).length - squash(a).length);
  return ranked.find((name) => textMentionsProject(said, name)) ?? null;
}

/**
 * The project a text names ONLY in the way one addresses the assistant, or
 * null. The last resort when nothing else says where the work goes: no other
 * project named, none selected. "loki: fix the header" typed with nothing
 * selected means the project; with orangecat selected it is read as "Loki,
 * fix the header" and never reaches this.
 */
export function projectNamedByAddress(text: string, projectNames: string[]): string | null {
  if (projectMentionedIn(text, projectNames)) return null;
  const ranked = [...projectNames].sort((a, b) => squash(b).length - squash(a).length);
  return ranked.find((name) => textMentionsProject(text, name)) ?? null;
}

/**
 * Selection first, then the name in the text. The precedence every call site
 * already wanted: an explicit pick outranks a guess from prose.
 */
export function resolveProjectFromContext(
  text: string,
  selectedProject: string | undefined | null,
  projectNames: string[],
): string | null {
  if (selectedProject) return selectedProject;
  return projectMentionedIn(text, projectNames);
}

// ── Naming something we don't have ────────────────────────────────────────────

/**
 * Capitalized words that carry no project intent. Without this every sentence
 * opening with "I" or naming a weekday would report a phantom project.
 */
const NOT_A_PROJECT = new Set([
  "i",
  "i'm",
  "im",
  "i'd",
  "i've",
  "ok",
  "okay",
  "yes",
  "no",
  "please",
  "thanks",
  "loki",
  "claude",
  "codex",
  "grok",
  "github",
  "control",
  "terminal",
  "today",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/** Quoted phrases — the operator's own explicit delimiter around a name. */
const QUOTED_RE = /["'“”‘’`]([^"'“”‘’`]{2,40})["'“”‘’`]/g;

/**
 * A run of Capitalized Words introduced by a preposition — "with Orange Cat",
 * "on Prime Tower", "about BiasLens". The preposition is what makes this safe
 * to read as a name: it rules out a capitalized sentence opener, which is
 * grammar rather than intent.
 */
const PREPOSITION_NAME_RE =
  /\b(?:with|on|for|about|in|to|from|of|regarding|re)\s+((?:[A-Z][A-Za-z0-9]*)(?:[ -](?:[A-Z][A-Za-z0-9]*|of|the|and)){0,3})/g;

function candidatePhrases(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(QUOTED_RE)) found.push(m[1].trim());
  for (const m of text.matchAll(PREPOSITION_NAME_RE)) found.push(m[1].trim());
  return found;
}

/**
 * A phrase the operator used as a project name that this fleet does not have.
 *
 * The point is to be able to say "I don't have a project called Orange Cat"
 * instead of listing nine projects and hoping. Returns the phrase AS TYPED —
 * the reply has to quote the operator's own words back, not a slug they never
 * wrote. Null when nothing in the sentence reads like a name, which is the
 * common case and must stay silent rather than guess.
 */
export function unknownProjectMention(text: string, projectNames: string[]): string | null {
  if (projectMentionedIn(text, projectNames)) return null;
  for (const phrase of candidatePhrases(text)) {
    const tokens = tokenize(phrase);
    if (tokens.length === 0 || tokens.length > 4) continue;
    if (tokens.every((t) => NOT_A_PROJECT.has(t))) continue;
    // A single lowercase word is prose, not a name. Multi-word or capitalized
    // phrases are the ones an operator means as a proper noun.
    const looksNamed = tokens.length > 1 || /^[A-Z]/.test(phrase);
    if (!looksNamed) continue;
    if (squash(phrase).length < 3) continue;
    return phrase;
  }
  return null;
}

/** The line the vision preflight is asked to open with (lib/loki/vision.ts). */
export const SCREENSHOT_SHOWN_PREFIX = "Shown:";

/** Hostnames in free text, lowercased, without a leading `www.`. */
function hostsIn(text: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/g)) {
    hosts.add(m[1].replace(/^www\./, ""));
  }
  return hosts;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Which ONE project a screenshot is of, from the vision model's reading of it —
 * or null when that is not certain.
 *
 * "Fix this so it works properly", sent with a screenshot of Loki's own
 * Control page from a chat with no project picked (2026-10-12), could not be
 * acted on: the text names nothing, and the picture was only ever described,
 * never used to choose. The person had to know to pick a project the
 * screenshot already showed.
 *
 * Two pieces of evidence, strongest first, and each must point at exactly one
 * project — two candidates is a question for the person, not a coin toss:
 *   1. a project's live site host visible in the screenshot
 *      (`loki.orangecat.ch` is Loki's site even though it also contains the
 *      word "orangecat", which is why hosts are compared whole, not as words);
 *   2. a project named on the analysis's `Shown:` line — the line the vision
 *      prompt asks for. Only that line: the rest of the analysis lists what is
 *      ON the screen, and a dashboard naming five projects is still one app.
 */
export function projectShownInScreenshot(
  analysis: string,
  projects: { name: string; liveUrl?: string | null }[],
): string | null {
  if (!analysis.trim() || projects.length === 0) return null;

  const seen = hostsIn(analysis);
  const byHost = projects.filter((p) => {
    const host = hostOf(p.liveUrl);
    return host != null && seen.has(host);
  });
  if (byHost.length === 1) return byHost[0].name;
  if (byHost.length > 1) return null;

  const shownLine = analysis
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith(SCREENSHOT_SHOWN_PREFIX.toLowerCase()));
  if (!shownLine) return null;
  // Hostnames on the Shown line were already judged above; as words they would
  // only re-add the false hits that rule exists to avoid.
  const words = shownLine
    .slice(SCREENSHOT_SHOWN_PREFIX.length)
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, " ");
  const named = projects.map((p) => p.name).filter((name) => textMentionsProject(words, name));
  // `aoz` inside `aoz-begleitung` is one project named, not two.
  const distinct = named.filter(
    (n) => !named.some((other) => other !== n && squash(other).includes(squash(n))),
  );
  return distinct.length === 1 ? distinct[0] : null;
}
