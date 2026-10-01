// SSOT for the public /pricing page. The ONLY difference the code actually
// enforces between tiers is the project limit (see src/lib/plan.ts); the tier
// ladder here is built on that real gate plus team collaboration (org/team
// projects are real). Everything a single builder can do is available on every
// plan — so those capabilities live in PRICING_INCLUDED, not as fake per-tier
// feature gates. Prices are the master-plan anchors (docs/master-plan-2026-07.md
// §7.2); adjust freely — one edit here, no component changes.

import type { Plan } from "@/db/schema/users";
import { PLAN_LIMITS, isUnlimitedProjects } from "@/lib/plan";

export const PRICING_CURRENCY = "CHF";

export type PricingPlan = {
  key: Plan;
  name: string;
  /**
   * CHF per month. 0 = genuinely free; null = price to be announced — the tier
   * stays visible, no number is shown, and the checkout rail (the
   * OrangeCat Bitcoin passes) is disabled for it until a number is set.
   * Mirror any change in orangecat's src/config/loki-passes.ts + re-seed.
   */
  priceMonthly: number | null;
  tagline: string;
  /** The tier's real differentiators — led by the enforced project limit. */
  highlights: string[];
  cta: string;
  /**
   * Draw this tier louder than the others. The SELLER's emphasis — never a
   * claim about what other people bought.
   *
   * It used to render as "Most popular", then "Recommended" on Pro. Loki has
   * 7 users and 0 on any paid plan (checked 2026-09-20), every paid tier reads
   * "Price to be announced", and Pro differs from Personal only in the project
   * ceiling — so neither badge was true. While prices are unannounced the only
   * tier a person can actually start is Free, so that is the one drawn louder,
   * and no badge is rendered at all.
   */
  featured?: boolean;
};

const projectLimitLabel = (plan: Plan): string =>
  isUnlimitedProjects(plan) ? "Unlimited projects" : `Up to ${PLAN_LIMITS.projects[plan]} projects`;

export const PRICING_PLANS: PricingPlan[] = [
  {
    key: "free",
    name: "Free",
    priceMonthly: 0,
    tagline: "Start your first projects and see everything your agents do.",
    highlights: [
      projectLimitLabel("free"),
      "Everything in Loki — nothing held back",
      "Use your own agent sign-ins and keys",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    key: "personal",
    name: "Personal",
    priceMonthly: null,
    tagline: "For one builder running Loki as a daily operating layer.",
    highlights: [
      projectLimitLabel("personal"),
      "Everything in Free",
      "Room for a real project portfolio",
    ],
    cta: "Choose Personal",
  },
  {
    key: "pro",
    name: "Pro",
    priceMonthly: null,
    tagline: "For operators running many projects at once.",
    highlights: [
      projectLimitLabel("pro"),
      "Everything in Personal",
      "No ceiling as your fleet grows",
    ],
    cta: "Choose Pro",
  },
  {
    key: "team",
    name: "Team",
    priceMonthly: null,
    tagline: "Shared projects and fleet visibility for a studio.",
    highlights: [
      projectLimitLabel("team"),
      "Everything in Pro",
      "Shared projects, roles, and team visibility",
    ],
    cta: "Choose Team",
  },
];

/** True once any paid tier has an announced price — flips the copy + rails. */
export const PRICING_ANNOUNCED = PRICING_PLANS.some(
  (p) => p.priceMonthly !== null && p.priceMonthly > 0,
);

// Paid plans bill annually (the checkout route wires the annual price id); the
// figure shown is the per-month equivalent. Stated plainly under the grid.
// While prices are to-be-announced the note says so instead — and says plainly
// that Loki is free until then (#995 kept self-service free).
export const PRICING_BILLING_NOTE = PRICING_ANNOUNCED
  ? "Prices are per month, billed annually. Your agents run with your own sign-ins and keys, so Loki never bills you for what they use."
  : "Loki is free while prices are not announced. Nothing is charged until they are, and every feature below is on every plan.";

// Available on EVERY plan (all shipped today). Listed once, honestly, instead of
// scattered as per-tier gates the code doesn't apply.
//
// Guarded by scripts/test/plans-copy-truth.ts. Three lines that used to be here
// were false and must not come back: "Local-first execution on … your own
// always-on box" (the always-on box is Loki's shared cloud builder, for
// eligible accounts only), "Cross-model verification" (the cross-model judge
// was removed 2026-09-25, see lib/orchestration/dod-gate.ts) and OpenClaw in
// the agent list (it is a system gateway, not an agent anyone picks).
export const PRICING_INCLUDED: string[] = [
  "One assistant — Loki — over the agents you already use: Claude, Codex, Cursor, Antigravity and Grok",
  "A feedback button for every site you run — what visitors report becomes work you can hand to an agent, and the visitor hears back when it is fixed",
  "Fleet dashboard: Control, Today, Projects, Activity",
  "Agents run on your own computer with the Fleet Runner app, or on Loki's cloud builder where your account has it",
  "Give a project a definition of done, and a run is checked against it before it counts as done",
  "Memory across projects, autopilot, and the prompt library",
];
