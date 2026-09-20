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
   * It used to render as "Most popular". Loki has 7 users and 0 on any paid
   * plan (checked 2026-09-20), and every paid tier reads "Price to be
   * announced", so nothing has ever been bought and no tier can be the
   * popular one. The page's own header promises honesty about billing state —
   * "a paid CTA only appears when a rail can actually take the money, never a
   * dead Buy button" — and this was the one line that broke it.
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
    tagline: "Command your first projects and see the whole fleet.",
    highlights: [
      projectLimitLabel("free"),
      "The full captain dashboard",
      "Bring your own runner + agent keys",
    ],
    cta: "Start free",
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
    featured: true,
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
// While prices are to-be-announced the note says so instead.
export const PRICING_BILLING_NOTE = PRICING_ANNOUNCED
  ? "Prices are per month, billed annually. Start free — every plan runs on your own machine or box with your own agent keys, so you only pay Loki for the captain layer."
  : "Pricing is being finalized and will be announced before anything is charged. Start free — every plan runs on your own machine or box with your own agent keys, so you only ever pay Loki for the captain layer.";

// Available on EVERY plan (all shipped today) — the captain layer itself. Listed
// once, honestly, instead of scattered as per-tier gates the code doesn't apply.
export const PRICING_INCLUDED: string[] = [
  "One identity — Loki — over every agent (Claude, Grok, Codex, Cursor, OpenClaw)",
  "Feedback widget on every site you run — visitor reports become dispatchable fleet work, and the visitor hears back when you resolve it",
  "Live fleet dashboard: Control, Today, Projects, Activity",
  "Local-first execution on your laptop or your own always-on box",
  "Cross-model verification — a definition-of-done gate a single agent can't do",
  "Cross-project fleet memory, autopilot loops, and the prompt library",
  "Bring your own agent keys — your compute, your cost, your control",
];
