import { db } from "@/db";
import { suggestionDecisions } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { DAY_MS } from "@/lib/constants/time";
import type { SuggestionDecision, SuggestionDecisionRecord } from "@/lib/suggestions/types";

/** How far back the board reads: the longest hide window plus a streak's worth. */
const LOOKBACK_DAYS = 90;

function toRecord(row: typeof suggestionDecisions.$inferSelect): SuggestionDecisionRecord {
  return {
    id: row.id,
    suggestionId: row.suggestionId,
    decision: row.decision,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function recordSuggestionDecision(
  userId: string,
  input: { suggestionId: string; decision: SuggestionDecision; label: string },
): Promise<SuggestionDecisionRecord> {
  const [row] = await db
    .insert(suggestionDecisions)
    .values({ userId, ...input })
    .returning();
  return toRecord(row);
}

export async function listSuggestionDecisions(
  userId: string,
  days = LOOKBACK_DAYS,
): Promise<SuggestionDecisionRecord[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await db
    .select()
    .from(suggestionDecisions)
    .where(and(eq(suggestionDecisions.userId, userId), gte(suggestionDecisions.createdAt, since)))
    .orderBy(desc(suggestionDecisions.createdAt));
  return rows.map(toRecord);
}

/** Undo: the row goes, the suggestion comes back on the next load. */
export async function deleteSuggestionDecision(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(suggestionDecisions)
    .where(and(eq(suggestionDecisions.id, id), eq(suggestionDecisions.userId, userId)))
    .returning({ id: suggestionDecisions.id });
  return deleted.length > 0;
}
