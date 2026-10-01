import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  frontierDigests,
  type FrontierDigestRow,
  type NewFrontierDigestRow,
  frontierProposals,
  type FrontierProposalRow,
  type NewFrontierProposalRow,
  entities,
} from "@/db/schema";
import { createGoal } from "@/db/queries/goals";

/** Insert today's digest, or overwrite it if the cron already ran today
 *  (digestDate is unique → one row per day, idempotent). */
export async function upsertFrontierDigest(row: NewFrontierDigestRow): Promise<FrontierDigestRow> {
  const [saved] = await db
    .insert(frontierDigests)
    .values(row)
    .onConflictDoUpdate({
      target: frontierDigests.digestDate,
      set: {
        headline: row.headline,
        intro: row.intro,
        items: row.items,
        candidateCount: row.candidateCount,
        sourceCount: row.sourceCount,
        model: row.model,
        generatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

// ─── Self-improvement proposals ──────────────────────────────────────────────

/** Who/what the self-improvement loop drafts proposals for: the owner of the
 *  "loki" product entity. Resolved (not hardcoded) so it survives reseeds. */
export async function getSelfImprovementTarget(): Promise<{
  userId: string;
  entityId: string;
} | null> {
  const [row] = await db
    .select({ userId: entities.userId, entityId: entities.id })
    .from(entities)
    .where(eq(entities.name, "loki"))
    .orderBy(asc(entities.createdAt))
    .limit(1);
  return row ?? null;
}

export async function insertProposals(
  rows: NewFrontierProposalRow[],
): Promise<FrontierProposalRow[]> {
  if (rows.length === 0) return [];
  return db.insert(frontierProposals).values(rows).returning();
}

/** Recent proposal titles for a user (any status) — grounds the next run so
 *  accepted/dismissed ideas are never re-proposed. */
export async function listConsideredProposalTitles(userId: string, limit = 40): Promise<string[]> {
  const rows = await db
    .select({ title: frontierProposals.title })
    .from(frontierProposals)
    .where(eq(frontierProposals.userId, userId))
    .orderBy(desc(frontierProposals.createdAt))
    .limit(limit);
  return rows.map((r) => r.title);
}

export async function listOpenProposals(userId: string): Promise<FrontierProposalRow[]> {
  return db
    .select()
    .from(frontierProposals)
    .where(and(eq(frontierProposals.userId, userId), eq(frontierProposals.status, "proposed")))
    .orderBy(desc(frontierProposals.score), desc(frontierProposals.createdAt));
}

/** Accept a proposal → create a roadmap goal from it; or dismiss it. Idempotent
 *  on status (a non-"proposed" row is left unchanged). */
export async function decideProposal(
  userId: string,
  id: string,
  action: "accept" | "dismiss",
): Promise<{ ok: true; goalId?: string } | { ok: false; reason: string }> {
  const [proposal] = await db
    .select()
    .from(frontierProposals)
    .where(and(eq(frontierProposals.id, id), eq(frontierProposals.userId, userId)))
    .limit(1);
  if (!proposal) return { ok: false, reason: "not_found" };
  if (proposal.status !== "proposed") return { ok: false, reason: "already_decided" };

  if (action === "dismiss") {
    await db
      .update(frontierProposals)
      .set({ status: "dismissed", decidedAt: new Date() })
      .where(eq(frontierProposals.id, id));
    return { ok: true };
  }

  // accept → goal. Fold the source links into the goal description for provenance.
  const links = proposal.sourceUrls.length
    ? `\n\nFrom the frontier digest (${proposal.digestDate}):\n${proposal.sourceUrls.map((u) => `- ${u}`).join("\n")}`
    : "";
  const goal = await createGoal(userId, {
    title: proposal.title,
    description: `${proposal.rationale}${links}`,
    entityId: proposal.entityId ?? undefined,
  });
  await db
    .update(frontierProposals)
    .set({ status: "accepted", createdGoalId: goal.id, decidedAt: new Date() })
    .where(eq(frontierProposals.id, id));
  return { ok: true, goalId: goal.id };
}
