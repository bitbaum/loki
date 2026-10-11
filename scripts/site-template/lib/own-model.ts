import { byokKeyHint, byokVendor, isByokConfig, type ByokConfig } from "@bitbaum/ai-kit/byok";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { canSeal, open, seal } from "@/lib/secrets";

/**
 * A person's own model key, sealed at rest (fleet SHARED.md, "Your own model").
 * The key goes in once, is checked by the vendor, sealed, and never comes back
 * out through any API — only the vendor, the model and a hint.
 */
const context = (userId: string) => `model-key:${userId}`;

export interface OwnModelView {
  vendor: string;
  model: string;
  hint: string;
}

export async function readOwnModel(userId: string): Promise<OwnModelView | null> {
  const [row] = await getDb()
    .select({
      vendor: schema.modelKey.vendor,
      model: schema.modelKey.model,
      hint: schema.modelKey.hint,
    })
    .from(schema.modelKey)
    .where(eq(schema.modelKey.userId, userId))
    .limit(1);
  return row ?? null;
}

/** The full config, key included, for the server-side model call only. */
export async function loadOwnModel(userId: string): Promise<ByokConfig | null> {
  if (!canSeal()) return null;
  const [row] = await getDb()
    .select()
    .from(schema.modelKey)
    .where(eq(schema.modelKey.userId, userId))
    .limit(1);
  if (!row) return null;
  try {
    const config = {
      vendor: row.vendor,
      model: row.model,
      apiKey: open(row.sealedKey, context(userId)),
    };
    return isByokConfig(config) ? config : null;
  } catch {
    // Sealed under another key (rotated SECRET_SEAL_KEY): treat as absent.
    return null;
  }
}

export async function saveOwnModel(userId: string, config: ByokConfig): Promise<OwnModelView> {
  if (!byokVendor(config.vendor)) throw new Error("unknown vendor");
  const values = {
    userId,
    vendor: config.vendor,
    model: config.model,
    sealedKey: seal(config.apiKey, context(userId)),
    hint: byokKeyHint(config.apiKey),
  };
  await getDb()
    .insert(schema.modelKey)
    .values(values)
    .onConflictDoUpdate({
      target: schema.modelKey.userId,
      set: {
        vendor: values.vendor,
        model: values.model,
        sealedKey: values.sealedKey,
        hint: values.hint,
      },
    });
  return { vendor: values.vendor, model: values.model, hint: values.hint };
}

export async function removeOwnModel(userId: string): Promise<void> {
  await getDb().delete(schema.modelKey).where(eq(schema.modelKey.userId, userId));
}
