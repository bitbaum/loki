import { eq } from "drizzle-orm";
import { sealSecret, openSecret } from "@bitbaum/ai-kit/seal";
import { byokKeyHint, byokVendor, type ByokConfig, type ByokVendorId } from "@bitbaum/ai-kit/byok";
import { db } from "@/db";
import { userModelKeys } from "@/db/schema/user-model-keys";

/**
 * The model a user brought — see src/db/schema/user-model-keys.ts.
 *
 * The key leaves this module in exactly one place: `getOwnModel`, which a chat
 * turn calls to make the request. Everything the settings screen reads goes
 * through `getOwnModelSummary`, which has no key in it.
 */

/** "byok": what the value was sealed for; a value sealed for anything else does not open here. */
const SEAL_CONTEXT = "byok";

/**
 * The app's sealing secret, or null when this deployment has none.
 *
 * Null is a normal state, not a crash: the settings screen says "not available
 * on this server" and chat keeps running on the free chain. Without the secret
 * a key could only be stored in the clear, which this module refuses to do.
 */
export function ownModelSealSecret(): string | null {
  const secret = process.env.BYOK_SEAL_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export type OwnModelSummary = {
  vendor: ByokVendorId;
  model: string;
  /** "…abcd" — never more of the key than that. */
  keyHint: string;
  verifiedAt: Date;
};

function summaryOf(row: typeof userModelKeys.$inferSelect): OwnModelSummary | null {
  if (!byokVendor(row.vendor)) return null; // a vendor since removed from the closed list
  return {
    vendor: row.vendor as ByokVendorId,
    model: row.model,
    keyHint: row.keyHint,
    verifiedAt: row.verifiedAt,
  };
}

/** What the user brought, without the key. Null when they brought nothing. */
export async function getOwnModelSummary(userId: string): Promise<OwnModelSummary | null> {
  const [row] = await db
    .select()
    .from(userModelKeys)
    .where(eq(userModelKeys.userId, userId))
    .limit(1);
  return row ? summaryOf(row) : null;
}

/**
 * The user's model WITH its key, for the one request it is needed for.
 *
 * Null when nothing is stored, the server has no sealing secret, or the value
 * will not open (a rotated secret). The last is logged and treated as "no key"
 * — a chat turn must not fail because of it; the settings screen asks the user
 * to paste the key again.
 */
export async function getOwnModel(userId: string): Promise<ByokConfig | null> {
  const secret = ownModelSealSecret();
  if (!secret) return null;
  const [row] = await db
    .select()
    .from(userModelKeys)
    .where(eq(userModelKeys.userId, userId))
    .limit(1);
  if (!row || !byokVendor(row.vendor)) return null;
  try {
    return {
      vendor: row.vendor as ByokVendorId,
      model: row.model,
      apiKey: openSecret(row.sealedKey, secret, SEAL_CONTEXT),
    };
  } catch {
    console.error(`[own-model] stored key for user ${userId} did not open — secret rotated?`);
    return null;
  }
}

/** Store (or replace) the user's model. Caller has already probed the key. */
export async function saveOwnModel(userId: string, config: ByokConfig): Promise<OwnModelSummary> {
  const secret = ownModelSealSecret();
  if (!secret) throw new Error("BYOK_SEAL_SECRET is not set on this server");
  const now = new Date();
  const values = {
    vendor: config.vendor,
    model: config.model,
    sealedKey: sealSecret(config.apiKey, secret, SEAL_CONTEXT),
    keyHint: byokKeyHint(config.apiKey),
    verifiedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(userModelKeys)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userModelKeys.userId, set: values })
    .returning();
  const summary = summaryOf(row!);
  if (!summary) throw new Error(`unknown vendor ${config.vendor}`);
  return summary;
}

/** Change only the model, keeping the stored key. Null when nothing is stored. */
export async function setOwnModelChoice(
  userId: string,
  model: string,
): Promise<OwnModelSummary | null> {
  const [row] = await db
    .update(userModelKeys)
    .set({ model, updatedAt: new Date() })
    .where(eq(userModelKeys.userId, userId))
    .returning();
  return row ? summaryOf(row) : null;
}

/** Forget the user's key entirely. */
export async function deleteOwnModel(userId: string): Promise<void> {
  await db.delete(userModelKeys).where(eq(userModelKeys.userId, userId));
}
