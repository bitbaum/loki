import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { autopilotNights, type AutopilotNightRow } from "@/db/schema";
import type { NightSummary } from "@/config/autopilot-night";

/** One row per night; a second tick on the same night overwrites, never doubles. */
export async function recordAutopilotNight(
  userId: string,
  night: string,
  summary: NightSummary,
): Promise<void> {
  await db
    .insert(autopilotNights)
    .values({ userId, night, summary })
    .onConflictDoUpdate({
      target: [autopilotNights.userId, autopilotNights.night],
      set: { summary, createdAt: new Date() },
    });
}

export async function getLatestAutopilotNight(userId: string): Promise<AutopilotNightRow | null> {
  const [row] = await db
    .select()
    .from(autopilotNights)
    .where(eq(autopilotNights.userId, userId))
    .orderBy(desc(autopilotNights.night))
    .limit(1);
  return row ?? null;
}

export async function hasAutopilotNight(userId: string, night: string): Promise<boolean> {
  const [row] = await db
    .select({ id: autopilotNights.id })
    .from(autopilotNights)
    .where(and(eq(autopilotNights.userId, userId), eq(autopilotNights.night, night)))
    .limit(1);
  return !!row;
}
