import { and, asc, eq, sql } from "drizzle-orm";
import { sealSecret, openSecret } from "@bitbaum/ai-kit/seal";
import { byokKeyHint } from "@bitbaum/ai-kit/byok";
import {
  CUSTOM_VENDOR_ID,
  vendorById,
  type OwnKeyConfig,
  type VendorId,
} from "@/config/model-vendors";
import { db } from "@/db";
import { userModelKeys } from "@/db/schema/user-model-keys";

/**
 * The models a user brought — see src/db/schema/user-model-keys.ts. One row
 * per vendor, ordered into the user's own chain by `position`.
 *
 * Keys leave this module in exactly one place: `getOwnModels`, which a chat
 * turn calls to make the requests. Everything the settings screen reads goes
 * through `listOwnModels`, which has no key in it.
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
  vendor: VendorId;
  model: string;
  /** "…abcd" — never more of the key than that; "no key" for a keyless endpoint. */
  keyHint: string;
  verifiedAt: Date;
  position: number;
  /** Only for `custom`: the host and the name the person gave it. */
  baseUrl: string | null;
  label: string | null;
};

/** The two columns only `custom` carries; read for no other vendor. */
function endpointOf(row: { vendor: string; baseUrl: string | null; label: string | null }) {
  return row.vendor === CUSTOM_VENDOR_ID
    ? { baseUrl: row.baseUrl, label: row.label }
    : { baseUrl: null, label: null };
}

function summaryOf(row: typeof userModelKeys.$inferSelect): OwnModelSummary | null {
  if (!vendorById(row.vendor)) return null; // a vendor since removed from the closed list
  return {
    vendor: row.vendor as VendorId,
    model: row.model,
    keyHint: row.keyHint,
    verifiedAt: row.verifiedAt,
    position: row.position,
    ...endpointOf(row),
  };
}

async function rowsFor(userId: string) {
  return db
    .select()
    .from(userModelKeys)
    .where(eq(userModelKeys.userId, userId))
    .orderBy(asc(userModelKeys.position), asc(userModelKeys.createdAt));
}

/** What the user brought, without the keys, in chain order. Empty when nothing. */
export async function listOwnModels(userId: string): Promise<OwnModelSummary[]> {
  return (await rowsFor(userId)).flatMap((r) => summaryOf(r) ?? []);
}

/**
 * The user's models WITH their keys, in chain order, for the one request
 * they are needed for.
 *
 * Empty when nothing is stored or the server has no sealing secret. A value
 * that will not open (a rotated secret) is logged and skipped — a chat turn
 * must not fail because of it; the settings screen asks for the key again.
 */
export async function getOwnModels(userId: string): Promise<OwnKeyConfig[]> {
  const secret = ownModelSealSecret();
  if (!secret) return [];
  const out: OwnKeyConfig[] = [];
  for (const row of await rowsFor(userId)) {
    if (!vendorById(row.vendor)) continue;
    // A custom row without a host cannot be called; it is skipped, not thrown.
    if (row.vendor === CUSTOM_VENDOR_ID && !row.baseUrl) continue;
    const endpoint = endpointOf(row);
    try {
      out.push({
        vendor: row.vendor as VendorId,
        model: row.model,
        apiKey: openSecret(row.sealedKey, secret, SEAL_CONTEXT),
        ...(endpoint.baseUrl ? { baseUrl: endpoint.baseUrl } : {}),
        ...(endpoint.label ? { label: endpoint.label } : {}),
      });
    } catch {
      console.error(
        `[own-model] stored ${row.vendor} key for user ${userId} did not open — secret rotated?`,
      );
    }
  }
  return out;
}

/** One vendor's stored key, for probing its models without a new paste. */
export async function getOwnModelKey(
  userId: string,
  vendor: VendorId,
): Promise<OwnKeyConfig | null> {
  return (await getOwnModels(userId)).find((c) => c.vendor === vendor) ?? null;
}

/** Store (or replace) the key for one vendor. A new vendor joins the end of the chain. */
export async function saveOwnModel(userId: string, config: OwnKeyConfig): Promise<OwnModelSummary> {
  const secret = ownModelSealSecret();
  if (!secret) throw new Error("BYOK_SEAL_SECRET is not set on this server");
  const now = new Date();
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${userModelKeys.position}), -1) + 1` })
    .from(userModelKeys)
    .where(eq(userModelKeys.userId, userId));
  const custom = config.vendor === CUSTOM_VENDOR_ID;
  const values = {
    model: config.model,
    sealedKey: sealSecret(config.apiKey, secret, SEAL_CONTEXT),
    keyHint: config.apiKey ? byokKeyHint(config.apiKey) : "no key",
    verifiedAt: now,
    updatedAt: now,
    baseUrl: custom ? (config.baseUrl ?? null) : null,
    label: custom ? config.label?.trim() || null : null,
  };
  const [row] = await db
    .insert(userModelKeys)
    .values({ userId, vendor: config.vendor, position: Number(next), ...values })
    .onConflictDoUpdate({ target: [userModelKeys.userId, userModelKeys.vendor], set: values })
    .returning();
  const summary = summaryOf(row!);
  if (!summary) throw new Error(`unknown vendor ${config.vendor}`);
  return summary;
}

/** Change only the model for one vendor, keeping its key. Null when that vendor is not stored. */
export async function setOwnModelChoice(
  userId: string,
  vendor: VendorId,
  model: string,
): Promise<OwnModelSummary | null> {
  const [row] = await db
    .update(userModelKeys)
    .set({ model, updatedAt: new Date() })
    .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.vendor, vendor)))
    .returning();
  return row ? summaryOf(row) : null;
}

/** Re-order the chain: vendors in the order given come first, any not named keep their relative order after. */
export async function reorderOwnModels(
  userId: string,
  vendors: string[],
): Promise<OwnModelSummary[]> {
  const current = await listOwnModels(userId);
  const named = vendors.filter((v) => current.some((c) => c.vendor === v));
  const rest = current.map((c) => c.vendor).filter((v) => !named.includes(v));
  const order = [...named, ...rest];
  await Promise.all(
    order.map((vendor, position) =>
      db
        .update(userModelKeys)
        .set({ position, updatedAt: new Date() })
        .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.vendor, vendor))),
    ),
  );
  return listOwnModels(userId);
}

/** Forget one vendor's key. */
export async function deleteOwnModel(userId: string, vendor: VendorId): Promise<void> {
  await db
    .delete(userModelKeys)
    .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.vendor, vendor)));
}
