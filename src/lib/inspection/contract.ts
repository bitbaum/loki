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
});
export type ReviewFrame = z.infer<typeof ReviewFrame>;
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
