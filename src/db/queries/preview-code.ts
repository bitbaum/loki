import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";

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
