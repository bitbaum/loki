/**
 * A walk through a live site, the way a visitor on a phone would take it: open
 * each page in a real browser and say, per page, what is wrong with it.
 *
 * This is the QA half of Cat Bot's parity with Grok Bot (OrangeCat
 * docs/PARITY.md, plan step 1): a bot's QA hand asks for a walk over the
 * signed rail, files each failure with the feedback door, and the Developer
 * picks it up. The browser is Loki's own (lib/feedback/page-picture): one at
 * a time, every request checked against the private network, never
 * OrangeCat's web process.
 *
 * A page fails on facts a person can check: it did not load, words it must
 * show are missing, it scrolls sideways on a phone, or a picture is broken.
 * Nothing here is a model's opinion.
 */
import { PICTURE_VIEWPORT, withLivePage } from "@/lib/feedback/page-picture";

/** A walk is a few pages, not a crawl: each one opens a browser on the app box. */
export const WALK_MAX_STEPS = 3;
export const WALK_MAX_EXPECT = 5;
export const WALK_EXPECT_MAX_LENGTH = 120;
/** One page may take this long before the walk moves on and says so. */
export const WALK_STEP_DEADLINE_MS = 40_000;

export type WalkStep = { url: string; expect: string[] };

export type WalkStepResult = {
  url: string;
  ok: boolean;
  /** The page's own title, when it loaded. */
  title: string | null;
  /** One sentence per fact that failed; empty when the page passed. */
  problems: string[];
  /** A JPEG of the phone viewport, base64, for a page that loaded and failed. */
  screenshot?: string;
};

export type WalkResult = {
  ok: boolean;
  viewport: { width: number; height: number };
  steps: WalkStepResult[];
};

/** What the browser read off a loaded page. */
export type PageFacts = {
  title: string;
  /** Everything a visitor can read, as the browser lays it out. */
  text: string;
  scrollWidth: number;
  innerWidth: number;
  /** Pictures that finished loading with nothing in them. */
  brokenImages: string[];
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The steps of a walk from what a bot sent, or why it cannot be walked.
 * Pure: the route and its test share it.
 */
export function parseWalk(
  input: unknown,
): { ok: true; steps: WalkStep[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "A walk needs at least one page to open." };
  }
  if (input.length > WALK_MAX_STEPS) {
    return {
      ok: false,
      error: `A walk opens at most ${WALK_MAX_STEPS} pages; this one has ${input.length}. Walk the rest in a second one.`,
    };
  }
  const steps: WalkStep[] = [];
  for (const raw of input) {
    const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `"${url.slice(0, 80)}" is not a full address (https://…).` };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        ok: false,
        error: `Only web pages can be walked; "${url.slice(0, 80)}" is not one.`,
      };
    }
    const expect = (Array.isArray(rec.expect) ? rec.expect : [])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().slice(0, WALK_EXPECT_MAX_LENGTH))
      .filter(Boolean)
      .slice(0, WALK_MAX_EXPECT);
    steps.push({ url: parsed.toString(), expect });
  }
  return { ok: true, steps };
}

/** What is wrong with a loaded page, as sentences. Pure. */
export function judgePage(facts: PageFacts, expect: readonly string[]): string[] {
  const problems: string[] = [];
  const text = norm(facts.text);
  if (!text) problems.push("The page loaded with nothing a visitor can read.");
  for (const want of expect) {
    if (!text.includes(norm(want))) problems.push(`The page does not show “${want}”.`);
  }
  if (facts.scrollWidth > facts.innerWidth + 1) {
    problems.push(
      `The page scrolls sideways on a phone: it is ${facts.scrollWidth}px wide on a ${facts.innerWidth}px screen.`,
    );
  }
  if (facts.brokenImages.length) {
    const shown = facts.brokenImages.slice(0, 3).join(", ");
    problems.push(
      facts.brokenImages.length === 1
        ? `A picture did not load: ${shown}.`
        : `${facts.brokenImages.length} pictures did not load: ${shown}${facts.brokenImages.length > 3 ? ", …" : ""}.`,
    );
  }
  return problems;
}

/** Read the facts off the page the browser has open. */
async function readFacts(page: import("playwright").Page): Promise<PageFacts> {
  return page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText ?? "",
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    brokenImages: Array.from(document.images)
      .filter((i) => i.complete && i.naturalWidth === 0 && Boolean(i.currentSrc || i.src))
      .map((i) => (i.currentSrc || i.src).slice(0, 160)),
  }));
}

type OpenPage = typeof withLivePage;

async function walkOne(step: WalkStep, open: OpenPage): Promise<WalkStepResult> {
  const opened = await open(step.url, { viewport: { ...PICTURE_VIEWPORT } }, async (live) => {
    const facts = await readFacts(live.page);
    const problems = judgePage(facts, step.expect);
    return {
      title: facts.title.trim() || null,
      problems,
      screenshot: problems.length ? await live.shoot().catch(() => undefined) : undefined,
    };
  });
  if (!opened.ok) {
    const why =
      opened.reason === "did-not-load"
        ? `The page did not load${opened.detail ? ` (${opened.detail})` : ""}.`
        : "No browser is installed on this Loki, so no page could be opened.";
    return { url: step.url, ok: false, title: null, problems: [why] };
  }
  const { title, problems, screenshot } = opened.value;
  return {
    url: step.url,
    ok: problems.length === 0,
    title,
    problems,
    ...(screenshot ? { screenshot } : {}),
  };
}

/**
 * Walk the pages in order. A page that takes longer than its deadline is
 * reported as such and the walk moves on; the walk never throws.
 */
export async function runWalk(
  steps: readonly WalkStep[],
  deps: { open?: OpenPage; deadlineMs?: number } = {},
): Promise<WalkResult> {
  const open = deps.open ?? withLivePage;
  const deadlineMs = deps.deadlineMs ?? WALK_STEP_DEADLINE_MS;
  const results: WalkStepResult[] = [];
  for (const step of steps) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<WalkStepResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            url: step.url,
            ok: false,
            title: null,
            problems: [`The page was not ready after ${Math.round(deadlineMs / 1000)} seconds.`],
          }),
        deadlineMs,
      );
    });
    const walked = walkOne(step, open).catch((e: unknown): WalkStepResult => ({
      url: step.url,
      ok: false,
      title: null,
      problems: [
        `The page could not be read (${(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 80)}).`,
      ],
    }));
    results.push(await Promise.race([walked, late]));
    if (timer) clearTimeout(timer);
  }
  return {
    ok: results.every((r) => r.ok),
    viewport: { ...PICTURE_VIEWPORT },
    steps: results,
  };
}
