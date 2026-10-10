import {
  CUSTOM_VENDOR_ID,
  vendorById,
  type OwnKeyConfig,
  type VendorId,
} from "@/config/model-vendors";
import { listOwnModels } from "@/db/queries/user-model-keys";
import { listTierOverrides } from "@/db/queries/user-model-tiers";
import { getUserPreferences } from "@/db/queries/user-preferences";
import {
  autoPicks,
  chainFor,
  resolvePicks,
  tierFor,
  type Candidate,
  type TierPick,
  type Stance,
} from "@/lib/models/auto-picks";
import { difficultyOf, type DifficultyVerdict } from "@/lib/models/difficulty";
import { fetchStoreCatalog, type ModelTier, type StoreModel } from "@/lib/models/store-catalog";

/**
 * Auto, assembled: the person's keys + the catalogue → what each key can
 * reach → the three picks (theirs where they chose) → for one turn, the
 * links to walk. The rules are in auto-picks.ts and difficulty.ts (pure);
 * this file is the plumbing that feeds them from the database and the cache.
 */

/** What one key can reach, as the catalogue knows it. */
function candidatesFor(
  keys: ReadonlyArray<Pick<OwnKeyConfig, "vendor" | "model">>,
  models: readonly StoreModel[],
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const k = `${c.vendor}/${c.model}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };
  const fromModel = (vendor: VendorId, model: string, m: StoreModel): Candidate => ({
    vendor,
    model,
    name: m.name,
    index: m.index,
    inPerM: m.inPerM,
    outPerM: m.outPerM,
    tier: m.tier,
    tools: m.tools ? true : null,
  });
  for (const key of keys) {
    const vendor = vendorById(key.vendor);
    if (!vendor) continue;
    // The stored model is always a candidate, with the catalogue's numbers
    // when it matches a row and unknowns when it does not.
    const stored = vendor.routed
      ? models.find((m) => m.id === key.model)
      : models.find((m) => m.vendor === key.vendor && m.model === key.model);
    add(
      stored
        ? fromModel(key.vendor, key.model, stored)
        : {
            vendor: key.vendor,
            model: key.model,
            name: key.model,
            index: null,
            inPerM: null,
            outPerM: null,
            tier: "standard",
            tools: null,
          },
    );
    // A router reaches everything the catalogue lists (not the free router
    // rows, which the catalogue prices at zero and Auto must not lean on
    // from a paid key); a lab key reaches its own namespace. A host or an
    // endpoint reaches only what was stored — their catalogues are theirs.
    if (vendor.routed) {
      for (const m of models)
        if (!m.free && !m.id.endsWith(":free")) add(fromModel(key.vendor, m.id, m));
    } else if (vendor.kind === "lab") {
      for (const m of models)
        if (m.vendor === key.vendor && !m.id.includes(":")) add(fromModel(key.vendor, m.model, m));
    }
  }
  return out;
}

export type RoutingView = {
  stance: Stance;
  /** Empty when the person holds no key: Auto then means the free pool. */
  picks: Array<TierPick & { chosenBy: "auto" | "user"; name: string }>;
  /** Per tier, what the person may choose instead (their keys' reach), best value first. */
  candidates: Array<{
    vendor: VendorId;
    model: string;
    name: string;
    index: number | null;
    outPerM: number | null;
    tier: ModelTier;
  }>;
  keys: Array<{ vendor: VendorId; model: string; label: string | null }>;
};

/** Everything the settings block and the store strip show. */
export async function routingFor(userId: string): Promise<RoutingView> {
  const [keys, prefs, overrides, catalog] = await Promise.all([
    listOwnModels(userId).catch(() => []),
    getUserPreferences(userId),
    listTierOverrides(userId).catch(() => []),
    fetchStoreCatalog(),
  ]);
  const candidates = candidatesFor(keys, catalog?.models ?? []);
  const held = new Set(keys.map((k) => k.vendor));
  const valid = overrides.filter((o) => held.has(o.vendor));
  const picks = resolvePicks(autoPicks(candidates), valid).map((p) => ({
    ...p,
    name: candidates.find((c) => c.vendor === p.vendor && c.model === p.model)?.name ?? p.model,
  }));
  return {
    stance: prefs.modelStance,
    picks,
    candidates: candidates
      .map((c) => ({
        vendor: c.vendor,
        model: c.model,
        name: c.name,
        index: c.index,
        outPerM: c.outPerM,
        tier: c.tier,
      }))
      .sort((a, b) => (b.index ?? -1) - (a.index ?? -1) || a.name.localeCompare(b.name))
      .slice(0, 120),
    keys: keys.map((k) => ({ vendor: k.vendor, model: k.model, label: k.label })),
  };
}

export type TurnRoute = {
  difficulty: DifficultyVerdict;
  tier: ModelTier;
  stance: Stance;
  links: Array<{ vendor: VendorId; model: string }>;
};

/**
 * The links for one turn on the person's own keys, in walk order. Null when
 * Auto has nothing to decide with (no catalogue yet, or every key is a host
 * or endpoint with one stored model) — the caller then walks the keys as
 * stored, which is what Auto meant before this existed.
 */
export async function routeTurn(
  userId: string,
  configs: readonly OwnKeyConfig[],
  message: string,
  history: ReadonlyArray<{ role: string; content: string }>,
): Promise<TurnRoute | null> {
  const [prefs, overrides, catalog] = await Promise.all([
    getUserPreferences(userId).catch(() => null),
    listTierOverrides(userId).catch(() => []),
    fetchStoreCatalog().catch(() => null),
  ]);
  if (!catalog) return null;
  const stance = prefs?.modelStance ?? "balanced";
  const candidates = candidatesFor(configs, catalog.models);
  if (!candidates.some((c) => c.index !== null)) return null;
  const held = new Set(configs.map((c) => c.vendor));
  const picks = resolvePicks(
    autoPicks(candidates),
    overrides.filter((o) => held.has(o.vendor)),
  );
  const difficulty = difficultyOf(message, history);
  const tier = tierFor(stance, difficulty.level);
  const links = chainFor(
    tier,
    picks,
    configs.map((c) => ({ vendor: c.vendor, model: c.model })),
  );
  return { difficulty, tier, stance, links };
}

/** "Auto · balanced — light turns on Kimi K3, heavy ones on Claude Fable 5.1", or null without keys. */
export function autoSummary(view: Pick<RoutingView, "stance" | "picks">): string | null {
  if (view.picks.length === 0) return null;
  const by = (tier: ModelTier) => view.picks.find((p) => p.tier === tier)?.name;
  const light = by("economy");
  const heavy = by(view.stance === "thrifty" ? "standard" : "frontier");
  if (!light || !heavy) return null;
  return light === heavy
    ? `Auto · ${view.stance} — every turn on ${light}`
    : `Auto · ${view.stance} — light turns on ${light}, heavy ones on ${heavy}`;
}

export { CUSTOM_VENDOR_ID };
