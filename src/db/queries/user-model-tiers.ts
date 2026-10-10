import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { userModelTiers } from "@/db/schema/user-model-tiers";
import { isVendorId, type VendorId } from "@/config/model-vendors";
import type { ModelTier } from "@/lib/models/store-catalog";
import type { TierOverride } from "@/lib/models/auto-picks";

const TIER_IDS = new Set<string>(["economy", "standard", "frontier"]);

/** The picks this person set by hand. Rows naming a vendor Loki no longer knows are dropped. */
export async function listTierOverrides(userId: string): Promise<TierOverride[]> {
  const rows = await db.select().from(userModelTiers).where(eq(userModelTiers.userId, userId));
  return rows.flatMap((r) =>
    isVendorId(r.vendor) && TIER_IDS.has(r.tier)
      ? [{ tier: r.tier as ModelTier, vendor: r.vendor, model: r.model }]
      : [],
  );
}

export async function setTierOverride(
  userId: string,
  tier: ModelTier,
  vendor: VendorId,
  model: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(userModelTiers)
    .values({ userId, tier, vendor, model, updatedAt: now })
    .onConflictDoUpdate({
      target: [userModelTiers.userId, userModelTiers.tier],
      set: { vendor, model, updatedAt: now },
    });
}

/** Back to the computed pick for that tier. */
export async function clearTierOverride(userId: string, tier: ModelTier): Promise<void> {
  await db
    .delete(userModelTiers)
    .where(and(eq(userModelTiers.userId, userId), eq(userModelTiers.tier, tier)));
}
