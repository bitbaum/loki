import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { npmPublishKeys, type NpmPublishKeyRow } from "@/db/schema";

export async function getNpmPublishKey(userId: string): Promise<NpmPublishKeyRow | null> {
  const row = await db.query.npmPublishKeys.findFirst({
    where: eq(npmPublishKeys.userId, userId),
  });
  return row ?? null;
}

/** Everyone holding a key, for the cron. */
export async function listNpmPublishKeys(): Promise<NpmPublishKeyRow[]> {
  return db.select().from(npmPublishKeys);
}

/** A new key replaces the old one, and forgets the old one's attempts. */
export async function saveNpmPublishKey(input: {
  userId: string;
  sealed: string;
  npmUser: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  await db
    .insert(npmPublishKeys)
    .values({ ...input, attempts: {} })
    .onConflictDoUpdate({
      target: npmPublishKeys.userId,
      set: {
        sealed: input.sealed,
        npmUser: input.npmUser,
        expiresAt: input.expiresAt,
        attempts: {},
        createdAt: new Date(),
      },
    });
}

export async function recordNpmPublishAttempts(
  userId: string,
  names: string[],
  at: Date,
): Promise<void> {
  if (names.length === 0) return;
  const patch = Object.fromEntries(names.map((n) => [n, at.toISOString()]));
  await db
    .update(npmPublishKeys)
    .set({ attempts: sql`${npmPublishKeys.attempts} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(npmPublishKeys.userId, userId));
}

export async function deleteNpmPublishKey(userId: string): Promise<void> {
  await db.delete(npmPublishKeys).where(eq(npmPublishKeys.userId, userId));
}
