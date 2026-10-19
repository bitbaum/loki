import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, userPreferences } from "@/db/schema";

/** The operator's own preview access code, or null (then the env's applies). */
export async function getPreviewCode(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ code: userPreferences.previewCode })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.code?.trim() || null;
}

/** Save it (one value for all of this operator's previews). Touches nothing else. */
export async function setPreviewCode(userId: string, code: string): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, previewCode: code })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { previewCode: code, updatedAt: new Date() },
    });
}

/**
 * The code that opens ONE preview: its own when it has one, else its owner's.
 *
 * A preview built from a new account's approved request (config/build-requests)
 * is the operator's client work, and the operator's code opens every preview
 * they have — so that visitor is given a code of the preview's own instead,
 * kept on the project (entities.metadata.previewCode). Every place that opens
 * or signs for a preview asks here, so the two can never disagree.
 */
export async function getProjectPreviewCode(project: {
  userId: string;
  entityProjectId: string | null;
}): Promise<string | null> {
  if (project.entityProjectId) {
    const [row] = await db
      .select({ code: sql<string | null>`${entities.metadata}->>'previewCode'` })
      .from(entities)
      .where(eq(entities.id, project.entityProjectId))
      .limit(1);
    const own = row?.code?.trim();
    if (own) return own;
  }
  return getPreviewCode(project.userId);
}

/** Give one preview a code of its own (see getProjectPreviewCode). */
export async function setProjectPreviewCode(entityId: string, code: string): Promise<void> {
  const patch = JSON.stringify({ previewCode: code });
  await db
    .update(entities)
    .set({ metadata: sql`coalesce(${entities.metadata}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(entities.id, entityId));
}
