// SSOT for the public /pricing page. The differences the code actually
// enforces between tiers are the project limit and the monthly AI allowance
// (both in src/lib/plan.ts; the allowance is applied by lib/ai-budget/gate.ts).
// Everything a single builder can do is available on every plan — so those
// capabilities live in PRICING_INCLUDED, not as fake per-tier feature gates.
// Prices are the master-plan anchors (docs/master-plan-2026-07.md §7.2), set by
// the founder on 2026-10-17; one edit here, no component changes.
//
// Checkout is a switch (LOKI_PAYMENTS_OPEN, lib/oc-pay.ts). A price is shown
// so a person can decide; while the switch is off the button under it
// reserves the plan (db/schema/plan-reservations.ts) and charges nothing, and
// the copy says exactly that — never WHY the switch is off. A plan is sold
// once its OrangeCat pass exists and the switch is on; the same button then
// becomes "Pay in Bitcoin". Build every surface as the subscription product it
// is about to be: the owner's rule (2026-10-21) is that nothing here may read
// as provisional.

import type { Plan } from "@/db/schema/users";
import { WELCOME_BUILDS } from "@/config/welcome-changes";
import { PLAN_LIMITS, isUnlimitedProjects } from "@/lib/plan";

export const PRICING_CURRENCY = "CHF";

export type PricingPlan = {
  key: Plan;
  name: string;
  /**
   * CHF per month. 0 = genuinely free; null = price to be announced — the tier
   * stays visible, no number is shown, and it can be neither reserved nor
   * bought. Mirror any change in orangecat's src/config/loki-passes.ts + re-seed.
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
   * 7 users and 0 on any paid plan (checked 2026-09-20), so neither badge was
   * true. While payments are not open the only tier a person can actually
   * start is Free, so that is the one drawn louder, and no badge is rendered.
   */
  featured?: boolean;
};

const projectLimitLabel = (plan: Plan): string =>
  isUnlimitedProjects(plan) ? "Unlimited projects" : `Up to ${PLAN_LIMITS.projects[plan]} projects`;

const aiAllowanceLabel = (plan: Plan): string =>
  `About ${PLAN_LIMITS.aiAnswersMonthly[plan].toLocaleString("en-US")} Loki answers a month, with no daily wait`;

/** Builds on Loki's engine are the bounded part; on your own they are not counted. */
const buildsLabel = (plan: Plan): string =>
  `${PLAN_LIMITS.buildsMonthly[plan]} builds a month on Loki's engine; no limit on your own sign-in or key`;

export const PRICING_PLANS: PricingPlan[] = [
  {
    key: "free",
    name: "Free",
    priceMonthly: 0,
    tagline: "Start your first projects and see everything your agents do.",
    highlights: [
      projectLimitLabel("free"),
      "Loki's chat on the free models, from a pool shared by everyone each day",
      `${WELCOME_BUILDS} welcome builds on Loki's engine, then your own agent sign-ins and keys`,
      "Everything in Loki — nothing held back",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    key: "personal",
    name: "Personal",
    priceMonthly: 15,
    tagline: "For one builder running Loki as a daily operating layer.",
    highlights: [
      projectLimitLabel("personal"),
      aiAllowanceLabel("personal"),
      buildsLabel("personal"),
      "Everything in Free",
      "Room for a real project portfolio",
    ],
    cta: "Choose Personal",
  },
  {
    key: "pro",
    name: "Pro",
    priceMonthly: 40,
    tagline: "For operators running many projects at once.",
    highlights: [
      projectLimitLabel("pro"),
      aiAllowanceLabel("pro"),
      buildsLabel("pro"),
      "Everything in Personal",
      "No ceiling as your fleet grows",
    ],
    cta: "Choose Pro",
  },
  {
    key: "team",
    name: "Team",
    priceMonthly: 90,
    tagline: "Shared projects and fleet visibility for a studio.",
    highlights: [
      projectLimitLabel("team"),
      aiAllowanceLabel("team"),
      buildsLabel("team"),
      "Everything in Pro",
      "Shared projects, roles, and team visibility",
    ],
    cta: "Choose Team",
  },
];

/** True once any paid tier has a price — flips the copy. */
const PRICING_ANNOUNCED = PRICING_PLANS.some((p) => p.priceMonthly !== null && p.priceMonthly > 0);

// A pass is a month at a time, paid in Bitcoin on OrangeCat, and nothing
// renews by itself (BillingSettings). Until the passes exist, a paid plan can
// only be reserved — and the note says so, under every price.
export const PRICING_BILLING_NOTE = PRICING_ANNOUNCED
  ? "Prices are per month, paid in Bitcoin on OrangeCat a month at a time; nothing renews by itself. Reserve a plan today and nothing is charged until checkout opens for your account — you hear from us the day it does. Your agents run with your own sign-ins and keys, which Loki never bills, or on Loki's engine within your plan's builds a month."
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
  "Agents run on your own computer with the Fleet Runner app, or in a private runner of your own on Loki's cloud",
  "Whoever asks for a change pays for it, with their own engine, in their own runner — nobody's request runs on another person's subscription",
  "Give a project a definition of done, and a run is checked against it before it counts as done",
  "Loki keeps your project's code for you, free — no GitHub account needed; take it to your own GitHub whenever you want",
  "Memory across projects, autopilot, and the prompt library",
  "Loki's own chat on a key from any model provider you choose — your provider bills you, Loki never does",
];
