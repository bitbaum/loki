/**
 * Watch narrates the build by itself.
 *
 * "It should say something the user would think: wow, this is exactly what I
 * want" (operator, 2026-10-07). A terminal answers "what bytes is the agent
 * printing"; a person watching wants "what is it making for me, and do I need
 * to do anything". So while a run is live, Watch hands the agent's screen to
 * a fast model every half-minute or so and shows one plain headline — "Adding
 * the Team page in Italian, German and French" — with past headlines stacking
 * up underneath as the story of the build.
 *
 * This is the pure half the BROWSER may import: the prompt, and when a new
 * narration is worth asking for. Reading the model's answer lives in
 * watch-narration-parse.ts, because the model-JSON reader reaches the agent
 * library and, through it, the database driver — imported from here it broke
 * the production build of every page that renders Watch (2026-10-07).
 */

export type Narration = {
  /** What it is doing now, as the person would say it. ≤ 90 chars. */
  headline: string;
  /** What that means for them — one sentence, or null. */
  detail: string | null;
  /** Something only the person can answer, or null. Never invented. */
  needsYou: string | null;
};

/** Screen lines sent per narration — the newest; enough for one step. */
export const NARRATE_MAX_LINES = 40;
export const NARRATE_MAX_LINE_CHARS = 300;
/** Never more often than this per viewer, however busy the screen is. */
export const NARRATE_MIN_INTERVAL_MS = 30_000;
/** Past headlines kept on screen as "So far". */
export const NARRATE_HISTORY = 5;

export const NARRATION_SYSTEM = [
  "You narrate a coding agent's work for the person who owns the project. They are not a programmer and are watching on a phone.",
  "You get: the project, what they asked for, the headline you gave last time, and the agent's terminal as it looks now.",
  'Answer with JSON only: {"headline": string, "detail": string | null, "needsYou": string | null}.',
  "headline: what the agent is doing right now, in the person's terms — the page, feature or fix they will see. Present tense, starts with a verb, at most 12 words. No file names, commands, tool names or jargon unless the screen shows nothing else.",
  "detail: one short sentence on what that means for them or what comes next. null if there is nothing worth adding.",
  "needsYou: only if the screen shows the agent asking a question, waiting for approval, or stopped on an error it cannot fix alone — then say plainly what they need to do. Otherwise null. Never invent one.",
  "If the work has not moved since the last headline, return the same headline.",
].join("\n");

export function narrationPrompt(input: {
  project: string;
  asked: string | null;
  previous: string | null;
  screen: string[];
}): string {
  const asked = (input.asked ?? "").trim();
  return [
    `Project: ${input.project}`,
    `They asked: ${asked ? asked.slice(0, 1200) : "(not recorded)"}`,
    `Last headline: ${input.previous ?? "(none yet)"}`,
    "Terminal now:",
    "```",
    ...input.screen.slice(-NARRATE_MAX_LINES).map((l) => l.slice(0, NARRATE_MAX_LINE_CHARS)),
    "```",
  ].join("\n");
}

/**
 * Ask again only when the screen moved and the last answer is old enough —
 * a person watching for ten minutes costs ~20 small calls, not one per poll.
 */
export function shouldNarrate(input: {
  screenKey: string;
  lastKey: string | null;
  lastAt: number | null;
  now: number;
  inFlight: boolean;
}): boolean {
  if (input.inFlight || !input.screenKey) return false;
  if (input.lastAt === null) return true;
  if (input.screenKey === input.lastKey) return false;
  return input.now - input.lastAt >= NARRATE_MIN_INTERVAL_MS;
}

/** A new headline joins the story; a repeat only refreshes the current one. */
export function pushNarration<T extends { narration: Narration; at: number }>(
  story: T[],
  next: T,
): T[] {
  const last = story.at(-1);
  if (last && last.narration.headline === next.narration.headline) {
    return [...story.slice(0, -1), next];
  }
  return [...story, next].slice(-(NARRATE_HISTORY + 1));
}
