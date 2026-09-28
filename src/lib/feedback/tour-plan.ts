import type { TourOutlineItem, TourStep } from "../../../widget/tour";

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

export function tourSystemPrompt(): string {
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
