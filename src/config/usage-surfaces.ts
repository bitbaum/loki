/**
 * SSOT for the surfaces whose USE Loki records, and what it may record there.
 *
 * WHY: "Build next" shipped on 2026-10-11 with a merge notice and nothing
 * else — no screenshot, no link, and no way for anyone, Loki included, to
 * learn whether the row was ever tapped. A surface that is shown and never
 * used is a finding about the surface, and only a record can show it. These
 * events are that record. Loki reads them back (src/lib/agent/sources-usage.ts)
 * so "how am I using X?" and "what should I build?" are answered from what the
 * operator actually does, not only from what they hold.
 *
 * Rules this file encodes:
 *   - An event names a SURFACE listed here and an ACTION that surface allows.
 *     /api/usage refuses anything else: a free-text event name is a second,
 *     undocumented registry, and the first one of those is the one nobody
 *     can summarise later.
 *   - OPERATOR-owned only. Nothing a visitor does on a customer site belongs
 *     here (that is site_feedback), and no text anyone typed: `target` is an
 *     id or a kind, never prose.
 *   - Adding a surface is adding an entry here and three `trackUsage(...)`
 *     calls in its component. Nothing else needs to change for Loki to read it.
 */
export const USAGE_ACTIONS = ["shown", "tap", "rotate", "dismiss"] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

type UsageSurfaceSpec = {
  /** How the surface is named to the operator and in Loki's answers. */
  label: string;
  /** Where it lives — the link a report points at. */
  path: string;
  /** Which of USAGE_ACTIONS this surface may record. */
  actions: readonly UsageAction[];
  /** What `target` carries on a tap, so a summary can group it. */
  target: string;
};

export const USAGE_SURFACES = {
  "loki.build-next": {
    label: "Build next (Loki start screen)",
    path: "/loki",
    actions: ["shown", "tap", "rotate"],
    target: "the suggestion id — `<kind>:<subject>` (src/lib/build-suggestions/rank.ts)",
  },
  "loki.start-my-day": {
    label: "Start my day",
    path: "/today",
    actions: ["shown", "tap"],
    target: "the owned project id, or selected for a batch",
  },
} as const satisfies Record<string, UsageSurfaceSpec>;

export type UsageSurface = keyof typeof USAGE_SURFACES;
export const USAGE_SURFACE_IDS = Object.keys(USAGE_SURFACES) as UsageSurface[];

export function isUsageSurface(surface: string): surface is UsageSurface {
  return Object.prototype.hasOwnProperty.call(USAGE_SURFACES, surface);
}

/** True only for a (surface, action) pair the registry allows. */
export function allowsUsageAction(surface: string, action: string): boolean {
  if (!isUsageSurface(surface)) return false;
  return (USAGE_SURFACES[surface].actions as readonly string[]).includes(action);
}

/** Bounds at the API boundary. Small on purpose: this is a tally, not a log. */
export const USAGE_LIMITS = {
  /** Events per POST. The client sends one at a time; a batch is a courtesy. */
  batch: 20,
  target: 200,
  path: 200,
  /** Serialised `meta` — enough for the kinds and ids of one shown row. */
  metaChars: 2_000,
} as const;

/** How far back Loki looks when it summarises a surface's use. */
export const USAGE_WINDOW_DAYS = 14;
