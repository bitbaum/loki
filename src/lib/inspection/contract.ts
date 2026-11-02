import { z } from "zod";

/** Review scope and wire protocol shared by the UI, API and runner. */
export const REVIEW_MODES = {
  visual: {
    label: "Design and usability",
    description: "See every reachable page on phone and desktop.",
  },
  functional: {
    label: "Pages and navigation",
    description: "Follow links and check loading, errors and navigation.",
  },
  code: {
    label: "Code quality",
    description: "Review duplication, boundaries and sources of truth in the code.",
  },
  full: {
    label: "Full review",
    description: "Design, navigation and code quality, with separate evidence for each.",
  },
} as const;
export const ReviewMode = z.enum(
  Object.keys(REVIEW_MODES) as [keyof typeof REVIEW_MODES, ...(keyof typeof REVIEW_MODES)[]],
);
export type ReviewMode = z.infer<typeof ReviewMode>;
export const REVIEW_LIMITS = {
  pages: 40,
  scrolls: 6,
  findings: 24,
  events: 1000,
  lifetimeMs: 2 * 60 * 60 * 1000,
} as const;
export const ReviewStart = z.object({
  mode: ReviewMode,
  paths: z.array(z.string().trim().max(500).startsWith("/")).max(40).default([]),
});
export const ReviewFrame = z.object({
  url: z.string().url().max(1500),
  image: z
    .string()
    .max(400000)
    .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(400).max(1200),
  action: z.string().max(200),
  scrollY: z.number().nonnegative(),
  /** What Loki is about to press, in the frame's own pixels (the viewport),
   *  so the page can draw the pointer and lean in to it. Absent on a frame
   *  that only looks (and on every frame recorded before it existed). */
  target: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().nonnegative().finite(),
      height: z.number().nonnegative().finite(),
    })
    .optional(),
  /** What Loki opens after this view; absent while the person has the browser. */
  next: z.string().max(200).optional(),
  /** Pages finished out of those planned so far (the plan grows as links are found). */
  progress: z
    .object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
    .optional(),
});
export type ReviewFrame = z.infer<typeof ReviewFrame>;

/**
 * Take over: the person drives the review's browser and hands it back.
 *
 * The owner, 2026-11-02, with Grok Bot's live Handler beside him: "I want to
 * see how the machine is being used and click through", and to be "led
 * through the whole experience and made to feel in control … and it should be
 * objectively so". Taking over is that, for the browser Loki already runs:
 * the person's clicks, scrolls and typing reach the same page Loki was on.
 *
 * Nothing about the browser's limits changes. The same guard refuses every
 * request that is not a read (GET/HEAD) and every navigation off the site, so
 * a click on a submit button sends nothing; the screen says so. Inputs are
 * coordinates in the captured viewport, a short text, or one named key: no
 * script, no URL, nothing the worker would execute.
 */
export const REVIEW_INPUT_KEYS = [
  "Enter",
  "Tab",
  "Backspace",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
] as const;
export const ReviewInput = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number().int().min(0).max(1920),
    y: z.number().int().min(0).max(1200),
  }),
  z.object({ type: z.literal("scroll"), dy: z.number().int().min(-3000).max(3000) }),
  z.object({ type: z.literal("type"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("key"), key: z.enum(REVIEW_INPUT_KEYS) }),
  z.object({ type: z.literal("back") }),
]);
export type ReviewInput = z.infer<typeof ReviewInput>;
/** Who has the browser. Null is Loki; inputs wait for the worker's next checkpoint. */
export type ReviewControl = { by: "you"; since: string; inputs: ReviewInput[] };
/** Inputs waiting at once; a person faster than the browser waits a moment. */
export const REVIEW_INPUT_QUEUE = 20;

/** What the screen says one input did, in the person's words. */
export function describeInput(input: ReviewInput): string {
  switch (input.type) {
    case "click":
      return "You clicked";
    case "scroll":
      return input.dy > 0 ? "You scrolled down" : "You scrolled up";
    case "type":
      return "You typed";
    case "key":
      return `You pressed ${input.key}`;
    case "back":
      return "You went back";
  }
}
export const ReviewFinding = z.object({
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(2000),
  category: z.enum(["visual", "functional", "code"]),
  evidence: z.string().trim().min(1).max(2000),
  location: z.string().max(1500),
});
export type ReviewFinding = z.infer<typeof ReviewFinding>;
export const ReviewWorkerEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("checkpoint"), workerId: z.string().uuid() }),
  z.object({
    kind: z.literal("frame"),
    frame: ReviewFrame,
    text: z.string().max(1500),
    analyze: z.boolean().default(false),
  }),
  z.object({ kind: z.literal("finding"), finding: ReviewFinding }),
  z.object({
    kind: z.literal("page"),
    url: z.string().url().max(1500),
    width: z.number().int(),
    result: z.enum(["visited", "blocked", "failed"]),
    detail: z.string().max(1000),
  }),
  z.object({ kind: z.literal("message"), text: z.string().min(1).max(3000) }),
  z.object({ kind: z.literal("finished"), text: z.string().min(1).max(3000) }),
  z.object({ kind: z.literal("failed"), text: z.string().min(1).max(1000) }),
]);
export type ReviewStatus = "queued" | "running" | "paused" | "stopped" | "finished" | "failed";
export type ReviewCoverage = {
  url: string;
  width: number;
  result: "visited" | "blocked" | "failed";
  detail: string;
};
export function reviewUrl(candidate: string, base: string): string | null {
  try {
    const url = new URL(candidate, base);
    if (url.origin !== new URL(base).origin || url.username || url.password) return null;
    if (!/^https?:$/.test(url.protocol)) return null;
    // Navigation that ends a session or performs work is never part of a read-only crawl.
    if (
      /(?:logout|signout|delete|remove|unsubscribe|checkout|purchase|confirm|revoke)/i.test(
        url.pathname + url.search,
      )
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
export function reviewIsActive(status: ReviewStatus) {
  return ["queued", "running", "paused"].includes(status);
}
