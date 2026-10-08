import type { TourBeat, TourOutlineItem, TourStep } from "../../../widget/tour";
import type { FixNote } from "./fix-note";
import type { TourAudience } from "./tour-token";

/**
 * The script of a fix walkthrough — which parts of the live page to show, in
 * what order, and what to say at each. Pure: the route supplies the model
 * call, this file owns the prompt, the parsing and the no-model fallback, so
 * a walkthrough never depends on a vendor being up.
 */

export const TOUR_MAX_STEPS = 6;
const SAY_MAX = 160;

export type TourInput = {
  /** What was asked for, in the reporter's words. */
  suggestion: string;
  /** The agent's own one-line account of what it did, when it gave one. */
  didLine: string | null;
  prTitle: string | null;
  /** Elements the reporter pointed at with the picker. */
  selectors: string[];
  outline: TourOutlineItem[];
  /** The agent's design note, when its PR carried one — its `change` and
   *  `where` lines are the best map of what to point at. */
  note?: FixNote | null;
  audience?: TourAudience;
};

const WORD = /[\p{L}\p{N}]{4,}/gu;
const STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "there",
  "they",
  "what",
  "when",
  "page",
  "please",
  "should",
  "would",
  "could",
  "make",
  "very",
  "some",
  "just",
  "like",
  "into",
  "your",
]);

function words(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 6)),
  );
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * No model: point at what the reporter picked, else at the parts of the page
 * whose words overlap the report and the agent's account most. Honest about
 * being a best guess — it says "here", never "this is exactly the change".
 */
export function fallbackTourSteps(input: TourInput): TourStep[] {
  const steps: TourStep[] = [];
  for (const selector of input.selectors.slice(0, 3)) {
    steps.push({
      target: null,
      selector,
      action: "point",
      say: "This is the part the report was about.",
    });
  }
  if (steps.length) return steps;
  const want = words(`${input.suggestion} ${input.didLine ?? ""} ${input.prTitle ?? ""}`);
  const scored = input.outline
    .map((item) => {
      const have = words(`${item.text} ${item.id ?? ""}`);
      let score = 0;
      for (const w of have) if (want.has(w)) score++;
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.i - b.item.i)
    .slice(0, 3)
    .sort((a, b) => a.item.i - b.item.i);
  for (const { item } of scored) {
    steps.push({
      target: item.i,
      action: "point",
      say: `Here — “${cut(item.text, 60)}” is where the change should show.`,
    });
  }
  return steps;
}

export function tourSystemPrompt(audience: TourAudience = "owner"): string {
  return [
    "You direct a short guided walkthrough of a website, like a developer showing a client a change they asked for.",
    "A fake cursor moves to each element you choose while your caption is shown. You see only a numbered outline of the visible page, not pixels.",
    `Reply with JSON only: {"steps":[{"target":<outline number or null>,"action":"point"|"click"|"scroll","say":"<caption>"}]} — at most ${TOUR_MAX_STEPS} steps, in page order.`,
    "Rules:",
    '- Show where the requested change lives and demonstrate it. If it is a control (a link, a button), point at it, then use action "click" to show it working.',
    '- Each caption: one plain sentence, under 20 words, saying WHY the cursor is there ("Down at the bottom — the new Back to top link.").',
    '- Use target null with action "scroll" only to return to the top of the page after a click demonstrates it.',
    "- Only use outline numbers that exist. If the change is not visible in the outline, return the single most relevant element and say it should be here.",
    "- Never invent text the outline does not contain.",
    audience === "reporter"
      ? "- You are speaking to the person who reported the problem, not a developer: plain words, no code, file names or technical terms."
      : audience === "viewer"
        ? "- You are speaking to someone the site's owner shared this change with, not a developer: plain words, no code, file names or technical terms."
        : "- You are speaking to the site's owner, who asked for this change.",
  ].join("\n");
}

export function tourPrompt(input: TourInput): string {
  const outline = input.outline
    .map((o) => `${o.i}. <${o.tag}${o.id ? ` id=${o.id}` : ""}> ${o.text}`)
    .join("\n");
  return [
    `The request: ${cut(input.suggestion, 1200)}`,
    input.didLine ? `What the developer says they did: ${cut(input.didLine, 400)}` : null,
    input.prTitle ? `Change title: ${cut(input.prTitle, 200)}` : null,
    input.note?.change ? `The change, as the developer describes it: ${input.note.change}` : null,
    input.note?.where ? `Where the developer says to look: ${input.note.where}` : null,
    "",
    "Visible page outline (document order, top to bottom):",
    outline || "(empty)",
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Parse the model's JSON, keeping only steps that point at real outline rows. */
export function parseTourSteps(text: string, outlineLength: number): TourStep[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (raw as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return [];
  const steps: TourStep[] = [];
  for (const s of list) {
    if (steps.length >= TOUR_MAX_STEPS) break;
    const o = s as { target?: unknown; action?: unknown; say?: unknown };
    const say = typeof o.say === "string" ? o.say.replace(/\s+/g, " ").trim() : "";
    if (!say) continue;
    const action = o.action === "click" || o.action === "scroll" ? o.action : "point";
    const target =
      typeof o.target === "number" &&
      Number.isInteger(o.target) &&
      o.target >= 0 &&
      o.target < outlineLength
        ? o.target
        : null;
    // A targetless beat is only meaningful as "back to the top".
    if (target === null && action !== "scroll") continue;
    steps.push({ target, action, say: cut(say, SAY_MAX) });
  }
  // A walkthrough of nothing but scrolling shows nothing.
  return steps.some((s) => s.target !== null) ? steps : [];
}

/** Chapter names. One list, so the card header and the tests agree. */
export const TOUR_CHAPTER = {
  ASKED: "You asked",
  REQUEST: "The request",
  PROBLEM: "The problem",
  CHANGE: "The change",
  SEE_IT: "Here it is",
  WHY: "Why this way",
  CONSIDERED: "Also considered",
  HELPS: "Who it helps",
  FOR_YOU: "What changed for you",
} as const;

export type TourStory = {
  audience: TourAudience;
  /** The report, in the reporter's own words. */
  asked: string;
  note: FixNote | null;
  /** The handoff's one-line account — the owner's fallback when there is no note. */
  didLine: string | null;
  /** The live, on-page steps (planned by the model or the fallback). */
  steps: TourStep[];
  /** A screenshot the reporter attached — the closest thing to "before". */
  before: string | null;
};

/**
 * The whole walkthrough as a story in chapters: what was asked, what was
 * wrong, the change shown live on the page, then — for the owner — why it was
 * done this way, what else was considered and who it helps.
 *
 * The reporter's version keeps only their own words, the live demonstration
 * and the note's plain sentence. Everything else in the note is reasoning a
 * maintainer wrote for a maintainer, and it never reaches a stranger's screen:
 * that boundary lives here and nowhere else.
 */
export function buildTourBeats(story: TourStory): TourBeat[] {
  const beats: TourBeat[] = [];
  const asked = cut(story.asked.replace(/\s+/g, " ").trim(), 220);
  const note = story.note;
  const live = (chapter: string) => story.steps.map((step): TourBeat => ({ chapter, ...step }));

  if (story.audience === "reporter") {
    beats.push({
      chapter: TOUR_CHAPTER.ASKED,
      action: "say",
      say: `You reported: “${asked}” It has been fixed — here is the change.`,
      image: story.before,
    });
    beats.push(...live(TOUR_CHAPTER.SEE_IT));
    if (note?.plain) beats.push({ chapter: TOUR_CHAPTER.FOR_YOU, action: "say", say: note.plain });
    return beats;
  }

  // Someone the owner shared the link with: the request and the live change,
  // nothing of the maintainer's and nothing of the reporter's but their words —
  // their screenshot may show their own screen.
  if (story.audience === "viewer") {
    beats.push({
      chapter: TOUR_CHAPTER.REQUEST,
      action: "say",
      say: `Someone asked: “${asked}” Here is what changed on the live site.`,
    });
    beats.push(...live(TOUR_CHAPTER.SEE_IT));
    if (note?.plain) beats.push({ chapter: TOUR_CHAPTER.HELPS, action: "say", say: note.plain });
    return beats;
  }

  beats.push({
    chapter: TOUR_CHAPTER.ASKED,
    action: "say",
    say: `The report: “${asked}”`,
    image: story.before,
  });
  if (note?.problem)
    beats.push({ chapter: TOUR_CHAPTER.PROBLEM, action: "say", say: note.problem });
  const change = note?.change ?? story.didLine;
  if (change) beats.push({ chapter: TOUR_CHAPTER.CHANGE, action: "say", say: change });
  beats.push(...live(TOUR_CHAPTER.CHANGE));
  if (note?.why) beats.push({ chapter: TOUR_CHAPTER.WHY, action: "say", say: note.why });
  for (const alt of note?.considered ?? []) {
    beats.push({
      chapter: TOUR_CHAPTER.CONSIDERED,
      action: "say",
      say: alt.whyNot ? `${alt.option} — not chosen: ${alt.whyNot}` : alt.option,
    });
  }
  if (note?.helps) beats.push({ chapter: TOUR_CHAPTER.HELPS, action: "say", say: note.helps });
  return beats;
}

/**
 * The closing line on the end card: one short sentence and the question it
 * asks. It used to repeat the agent's one-line account, which the story had
 * already told under "The change" — on a big fix that was a wall of change log
 * ("…into typed content, rebuilt the home page (team-photo hero, …), verified
 * 115/115 browser checks incl.") where the card should simply ask (2026-10-08).
 */
export function tourOutro(audience: TourAudience): string {
  if (audience === "reporter")
    return "That's your fix, live. Thank you for reporting it — if it still isn't right, tell us the same way.";
  if (audience === "viewer") return "That's the change, live on the site — made with Loki.";
  return "That's the change, live on the site. Does it look right to you?";
}
