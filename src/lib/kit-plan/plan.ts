/**
 * The "Built from" plan: which of the fleet's shared packages a new site
 * should be wired with, read from what its brief asks for.
 *
 * Deterministic on purpose. The same brief always plans the same packages, so
 * the kickoff screen, the first build's prompt and the record of what was
 * planned can never disagree, and the plan is testable without a model. The
 * words that call for each package are SSOT in src/config/kit-plan.ts; the
 * package itself (its install line, who else uses it) comes from the live
 * catalogue, so a package fleet retired is never planned.
 *
 * Pure: no network, no database.
 */
import { KIT_FEATURES, type KitFeature } from "@/config/kit-plan";
import type { CataloguePackage } from "@/lib/packages/catalogue-parse";
import type { KitPlanRecord } from "./types";

export type PlannedKit = {
  /** Catalogue name, e.g. `@bitbaum/searchkit`. */
  name: string;
  /** Catalogue slug, for `/packages/<slug>`. */
  slug: string;
  plain: string;
  use: string;
  avoid: string;
  /** The validated `pnpm add …` line, or null when the register's did not validate. */
  install: string | null;
  /** The starter the site is seeded from already depends on it. */
  inStarter: boolean;
  /** The trigger words the brief matched, in config order — why it is planned. */
  because: string[];
};

export type KitPlan = {
  kits: PlannedKit[];
  /** Other fleet sites already running at least one planned kit. */
  sharedWith: number;
};

const NEGATIONS = new Set([
  "no",
  "not",
  "without",
  "never",
  "dont",
  "doesnt",
  "nor",
  "kein",
  "keine",
  "ohne",
  "sans",
  "pas",
]);
/** How many words before a match a negation still reaches ("no online payments"). */
const NEGATION_REACH = 3;

/** Lowercase, accents and apostrophes folded away, so "Réservation" and "don't" match plainly. */
export function foldBriefText(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the brief asks for `trigger` somewhere it is not negated. */
export function briefMentions(folded: string, trigger: string): boolean {
  const re = new RegExp(`(?<![a-z0-9])${escapeRegex(trigger)}s?(?![a-z0-9])`, "g");
  for (const match of folded.matchAll(re)) {
    // A clause boundary ends a negation's reach: "No ads, but search the shop."
    const clause =
      folded
        .slice(0, match.index)
        .split(/[.!?;,\n]|\bbut\b/)
        .pop() ?? "";
    const reach = clause
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(-NEGATION_REACH);
    if (!reach.some((word) => NEGATIONS.has(word))) return true;
  }
  return false;
}

/**
 * The plan for a brief. `starterPackages` are the names the starter already
 * depends on; `selfSlug` is the project's own repo name, so it is not counted
 * among the "other sites" sharing a kit.
 */
export function planKits(
  brief: string,
  catalogue: readonly CataloguePackage[],
  opts: {
    starterPackages?: ReadonlySet<string>;
    selfSlug?: string | null;
    features?: Readonly<Record<string, KitFeature>>;
  } = {},
): KitPlan {
  const features = opts.features ?? KIT_FEATURES;
  const folded = foldBriefText(brief);
  const byName = new Map(catalogue.map((pkg) => [pkg.name, pkg]));
  const packageSlugs = new Set(catalogue.map((pkg) => pkg.slug));
  const kits: PlannedKit[] = [];
  const adopters = new Set<string>();
  for (const [name, feature] of Object.entries(features)) {
    const pkg = byName.get(name);
    if (!pkg) continue; // retired from the register, or not registered yet
    const because = feature.triggers.filter((t) => briefMentions(folded, t));
    if (because.length === 0) continue;
    kits.push({
      name,
      slug: pkg.slug,
      plain: feature.plain,
      use: feature.use,
      avoid: feature.avoid,
      install: pkg.install,
      inStarter: opts.starterPackages?.has(name) ?? false,
      because,
    });
    for (const adopter of pkg.adopterNames) {
      // Adopters include other packages (ai-forms is used by ai-kit); those are not sites.
      if (adopter !== opts.selfSlug && !packageSlugs.has(adopter)) adopters.add(adopter);
    }
  }
  return { kits, sharedWith: adopters.size };
}

/** "search, sign-in and email" — the plain words, joined the way a person would say them. */
export function plainList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The kickoff screen's one sentence, or null when nothing is planned. */
export function kitPlanSentence(plan: KitPlan): string | null {
  if (plan.kits.length === 0) return null;
  const parts = plainList(plan.kits.map((kit) => kit.plain));
  const shared =
    plan.sharedWith > 0
      ? ` — parts already running on ${plan.sharedWith} other site${plan.sharedWith === 1 ? "" : "s"}, kept up to date automatically`
      : " — shared parts, kept up to date automatically";
  return `Your site will use ${parts}${shared}.`;
}

/** The plan as stored on the project (user_projects.kit_plan). */
export function toKitPlanRecord(
  plan: KitPlan,
  opts: { clientTokens: boolean; at?: Date },
): KitPlanRecord {
  return {
    plannedAt: (opts.at ?? new Date()).toISOString(),
    kits: plan.kits.map(({ name, slug, plain }) => ({ name, slug, plain })),
    clientTokens: opts.clientTokens,
  };
}
