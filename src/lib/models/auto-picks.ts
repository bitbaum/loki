import type { VendorId } from "@/config/model-vendors";
import type { ModelTier } from "@/lib/models/store-catalog";
import type { Difficulty } from "@/lib/models/difficulty";

/**
 * Which model answers which kind of turn — the decision Auto makes, as pure
 * rules over what the person's keys can reach.
 *
 * ── The three picks ──────────────────────────────────────────────────────────
 * economy   the best value among cheap models that can call tools: what
 *           answers a light turn. Never a frontier model for "what time is it".
 * standard  the best value among models at least as smart as the median of
 *           what the keys reach, below frontier price: the everyday answer.
 * frontier  the smartest model reachable, whatever it costs: for the turns
 *           where the difference shows.
 *
 * ── The stance ───────────────────────────────────────────────────────────────
 * Which pick a turn's difficulty maps to is the person's STANCE, because the
 * same person is thrifty on a Tuesday and wants the best on a deadline:
 *
 *   thrifty    light→economy  standard→standard  heavy→standard
 *   balanced   light→economy  standard→standard  heavy→frontier   (default)
 *   best       light→economy  standard→frontier  heavy→frontier
 *
 * Even "best" sends a light turn to the economy pick: George's rule, and the
 * whole point — "we don't want Fable 5.1 used for trivial tasks".
 *
 * A pick the person set by hand wins over the computed one. The fallback
 * chain for a turn is the pick, then the other picks nearest in tier, then
 * every key's own default model, so a refused model never ends the turn.
 */
export type Stance = "thrifty" | "balanced" | "best";
export const STANCES: ReadonlyArray<{ id: Stance; label: string; line: string }> = [
  {
    id: "thrifty",
    label: "Thrifty",
    line: "Never spends on a frontier model unless you pick it for a turn.",
  },
  {
    id: "balanced",
    label: "Balanced",
    line: "Cheap for small things, the best you have for the hard ones.",
  },
  { id: "best", label: "Best", line: "The strongest model for anything that is not trivial." },
];
export const DEFAULT_STANCE: Stance = "balanced";
export function isStance(x: unknown): x is Stance {
  return STANCES.some((s) => s.id === x);
}

export const TIERS: ReadonlyArray<{ id: ModelTier; label: string; forTurns: string }> = [
  { id: "economy", label: "Light turns", forTurns: "greetings, lookups, captures" },
  { id: "standard", label: "Standard turns", forTurns: "most questions and small tasks" },
  { id: "frontier", label: "Heavy turns", forTurns: "code, strategy, anything asked with care" },
];

export const STANCE_TABLE: Record<Stance, Record<Difficulty, ModelTier>> = {
  thrifty: { light: "economy", standard: "standard", heavy: "standard" },
  balanced: { light: "economy", standard: "standard", heavy: "frontier" },
  best: { light: "economy", standard: "frontier", heavy: "frontier" },
};

/** One model a key can reach, with what the catalogue knows about it. */
export type Candidate = {
  vendor: VendorId;
  model: string;
  name: string;
  index: number | null;
  inPerM: number | null;
  outPerM: number | null;
  tier: ModelTier;
  /** False when the catalogue says the model cannot call tools; null when unknown. */
  tools: boolean | null;
};

export type TierPick = { tier: ModelTier; vendor: VendorId; model: string; reason: string };

const TIER_RANK: Record<ModelTier, number> = { economy: 0, standard: 1, frontier: 2 };

function value(c: Candidate): number {
  if (c.index === null) return Number.NEGATIVE_INFINITY;
  const blended = 0.25 * (c.inPerM ?? 0) + 0.75 * (c.outPerM ?? 0);
  return c.index / Math.log2(2 + blended);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

const bestBy = (list: Candidate[], score: (c: Candidate) => number) =>
  list.reduce<Candidate | null>(
    (best, c) => (best === null || score(c) > score(best) ? c : best),
    null,
  );

/** The three computed picks for these candidates. Fewer when the keys reach too little to fill a tier. */
export function autoPicks(candidates: readonly Candidate[]): TierPick[] {
  const usable = candidates.filter((c) => c.tools !== false);
  if (usable.length === 0) return [];
  const rated = usable.filter((c) => c.index !== null);
  const mid = median(rated.map((c) => c.index!));
  const picks: TierPick[] = [];

  const economy =
    bestBy(
      usable.filter((c) => c.tier === "economy"),
      value,
    ) ??
    bestBy(usable, (c) => (c.outPerM === null ? Number.NEGATIVE_INFINITY : -c.outPerM)) ??
    usable[0]!;
  picks.push({
    tier: "economy",
    vendor: economy.vendor,
    model: economy.model,
    reason:
      economy.index === null ? "the cheapest your keys reach" : "best value among cheap models",
  });

  const standardPool = usable.filter(
    (c) => TIER_RANK[c.tier] <= 1 && c.index !== null && (mid === null || c.index >= mid),
  );
  const standard =
    bestBy(standardPool, value) ??
    bestBy(
      usable.filter((c) => TIER_RANK[c.tier] <= 1),
      value,
    ) ??
    economy;
  picks.push({
    tier: "standard",
    vendor: standard.vendor,
    model: standard.model,
    reason:
      standard === economy
        ? "nothing stronger below frontier price"
        : "best value at or above the median",
  });

  const frontier =
    bestBy(rated, (c) => c.index! * 1000 - (c.outPerM ?? 0)) ??
    bestBy(usable, (c) => c.outPerM ?? 0) ??
    standard;
  picks.push({
    tier: "frontier",
    vendor: frontier.vendor,
    model: frontier.model,
    reason:
      frontier.index === null
        ? "the dearest your keys reach — no index to go by"
        : "the smartest your keys reach",
  });

  return picks;
}

export type TierOverride = { tier: ModelTier; vendor: VendorId; model: string };

/** Computed picks with the person's own choices laid over them. */
export function resolvePicks(
  computed: readonly TierPick[],
  overrides: readonly TierOverride[],
): Array<TierPick & { chosenBy: "auto" | "user" }> {
  return computed.map((p) => {
    const o = overrides.find((x) => x.tier === p.tier);
    return o
      ? { ...p, vendor: o.vendor, model: o.model, reason: "your choice", chosenBy: "user" as const }
      : { ...p, chosenBy: "auto" as const };
  });
}

/** The tier a turn of this difficulty goes to under this stance. */
export function tierFor(stance: Stance, level: Difficulty): ModelTier {
  return STANCE_TABLE[stance][level];
}

/**
 * The links to walk for one turn: the tier's pick first, then the other
 * picks by tier distance (up before down — a refusal is usually capacity,
 * and the next tier up has a different vendor more often than not), then
 * every key's default, duplicates dropped.
 */
export function chainFor(
  tier: ModelTier,
  picks: ReadonlyArray<TierPick>,
  defaults: ReadonlyArray<{ vendor: VendorId; model: string }>,
): Array<{ vendor: VendorId; model: string }> {
  const ordered = [...picks].sort(
    (a, b) =>
      Math.abs(TIER_RANK[a.tier] - TIER_RANK[tier]) -
        Math.abs(TIER_RANK[b.tier] - TIER_RANK[tier]) || TIER_RANK[b.tier] - TIER_RANK[a.tier],
  );
  const seen = new Set<string>();
  const out: Array<{ vendor: VendorId; model: string }> = [];
  for (const l of [...ordered, ...defaults]) {
    const key = `${l.vendor}/${l.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ vendor: l.vendor, model: l.model });
  }
  return out;
}
