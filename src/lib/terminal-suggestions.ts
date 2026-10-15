/**
 * Prompts worth sending next, read off what the session's screen shows now.
 *
 * The Prompt box under the terminal used to open empty with a generic
 * placeholder — "Describe a task for skif" — while the screen right above it
 * said "PR #43 CI pending; auto-merge armed" and "Completed". The person had
 * to compose, on a phone keyboard, the obvious next instruction the screen was
 * already implying. These are those instructions, one tap from the box.
 *
 * Deterministic and local on purpose: it runs on every screen change, costs
 * nothing, and cannot be wrong in a way a person can't see — a suggestion only
 * fills the box, it never sends. The AI summary in the Loki panel is the deep
 * version; this is the reflex.
 */

/** Rows from the bottom of the screen worth reading — the live part. */
export const SUGGESTION_WINDOW_ROWS = 60;
const MAX_SUGGESTIONS = 3;

const PR_RE = /\bPR\s*#(\d+)\b/i;
const CI_TROUBLE_RE = /\b(ci|checks?)\b[^\n]{0,40}\b(fail(?:ed|ing|s)?|red|broken|error)\b/i;
const CI_PENDING_RE = /\b(ci|checks?)\b[^\n]{0,40}\b(pending|running|queued|in progress)\b/i;
/**
 * A line of error OUTPUT, not prose about errors. Matching the words anywhere
 * ("…returns an error", "the one failure was…") turned an agent's finished
 * report into "Fix the error on screen" — tapped, it sent a fix-it task to a
 * session with nothing broken (2026-10-05). So: an error or failure marker at
 * the start of a line, the shapes tools print, or a non-zero exit.
 */
const ERROR_LINE_RE =
  /^(?:[A-Za-z]*Error:|error(?:\[[^\]]*\])?:|error TS\d+|fatal:|panic:|Traceback \(most recent call last\)|npm ERR!|✗|✘|FAIL\s|[A-Za-z]*Exception\b)|\bexit(?:ed with)? code [1-9]|^\s*Tests?\s+\d+ failed\b/;
const QUESTION_RE =
  /(\(y\/n\)|\[y\/n\]|\byes\/no\b|\bcontinue\?|\bproceed\?|do you want to|\bwant me to\b[^\n]*\?|\bshall i\b[^\n]*\?)/i;
const DONE_RE = /\b(completed|done|finished|all tests pass(?:ed)?|merged)\b/i;

/** Up to three instructions fitting the screen, most specific first. */
export function suggestPrompts(screen: readonly string[]): string[] {
  const lines = screen
    .slice(-SUGGESTION_WINDOW_ROWS)
    .map((l) => l.trim())
    .filter(Boolean);
  const text = lines.join("\n");
  const out: string[] = [];
  const add = (s: string) => {
    if (out.length < MAX_SUGGESTIONS && !out.includes(s)) out.push(s);
  };

  if (QUESTION_RE.test(lines.slice(-8).join("\n"))) add("Yes, go ahead.");

  const pr = PR_RE.exec(text)?.[1];
  if (pr && CI_TROUBLE_RE.test(text)) add(`Fix what is failing in CI on PR #${pr}, then push.`);
  else if (pr && CI_PENDING_RE.test(text))
    add(`Watch PR #${pr} until CI finishes — fix and push anything that goes red.`);

  if (lines.slice(-20).some((l) => ERROR_LINE_RE.test(l)))
    add("Fix the error on screen, then re-run what failed.");

  if (DONE_RE.test(text)) add("Continue with the next most valuable step.");

  add("Summarize what you did and what is left.");
  add("Run the checks, fix what fails, then commit.");
  add("Continue with the next most valuable step.");
  return out;
}

/**
 * The same, read from the agent's last reply in the chat view, where there is
 * no screen: its closing lines are what it is waiting on ("Want me to start on
 * 1?", "PR #44 open, CI pending").
 */
export function suggestFromReply(reply: string): string[] {
  return suggestPrompts(reply.split("\n"));
}

/** Same suggestions → same array, so a poll does not re-render for nothing. */
export function sameSuggestions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

const FEEDBACK_NOUN_RE =
  /\b(feedback|user (?:reports?|messages|reviews|complaints|voice)|widget (?:submissions|reports|data)|survey responses)\b/i;
const NEEDS_IT_RE =
  /(needs input|need (?:an? |the )?(?:export|access|reports?|feedback)|couldn'?t (?:find|reach|read|see)|could not (?:find|reach|read|see)|can'?t (?:find|reach|access|read|see)|cannot (?:find|reach|access|read|see)|no (?:user )?feedback|found no\b|export (?:the|an?|of)|paste (?:the|them|emails)|send me|give me|provide (?:the|an?))/i;

/**
 * The agent says it needs feedback it cannot reach — "needs input: an export
 * of substrata's feedback-widget submissions". Loki holds those reports, so
 * the box offers to attach them instead of a chip that says "Yes, go ahead."
 * Only the closing lines count: a reply that MENTIONS feedback while working
 * is not asking for it.
 */
export function asksForFeedback(text: string | null | undefined): boolean {
  if (!text) return false;
  const tail = text.split("\n").slice(-15).join("\n");
  return FEEDBACK_NOUN_RE.test(tail) && NEEDS_IT_RE.test(tail);
}
