import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { planReservations, type PlanReservation } from "@/db/schema/plan-reservations";
import type { Plan } from "@/db/schema/users";

/** Reserve (or switch) the person's plan. One row per person. */
export async function reservePlan(userId: string, plan: Plan): Promise<PlanReservation> {
  const [row] = await db
    .insert(planReservations)
    .values({ userId, plan })
    .onConflictDoUpdate({
      target: planReservations.userId,
      set: { plan, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function cancelPlanReservation(userId: string): Promise<void> {
  await db.delete(planReservations).where(eq(planReservations.userId, userId));
}

export async function getPlanReservation(userId: string): Promise<PlanReservation | null> {
  const [row] = await db
    .select()
    .from(planReservations)
    .where(eq(planReservations.userId, userId))
    .limit(1);
  return row ?? null;
}

/** How many people are waiting on each plan — the founder's demand signal. */
export async function countPlanReservations(): Promise<Array<{ plan: Plan; count: number }>> {
  return db
    .select({ plan: planReservations.plan, count: sql<number>`count(*)::int` })
    .from(planReservations)
    .groupBy(planReservations.plan);
}
