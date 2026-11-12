import { randomBytes } from "crypto";
import { db } from "@/db";
import { agentTokens, type AgentToken, type AgentTokenKind } from "@/db/schema";
import { eq, and, or, gt, isNull, lt, desc, sql } from "drizzle-orm";
import { DAY_MS, WEEK_MS } from "@/lib/constants/time";

export function generateToken(): string {
  return "ck_" + randomBytes(32).toString("hex");
}

export async function createAgentToken(
  userId: string,
  label: string,
  orgId?: string | null,
  kind: AgentTokenKind = "runner",
): Promise<{ token: string; record: AgentToken }> {
  const token = generateToken();
  const [record] = await db
    .insert(agentTokens)
    .values({ token, label, userId, orgId: orgId ?? null, kind })
    .returning();
  return { token, record };
}

export async function listAgentTokens(userId: string): Promise<AgentToken[]> {
  return db
    .select()
    .from(agentTokens)
    .where(eq(agentTokens.userId, userId))
    .orderBy(agentTokens.createdAt);
}

export async function deleteAgentToken(id: string, userId: string): Promise<void> {
  await db.delete(agentTokens).where(and(eq(agentTokens.id, id), eq(agentTokens.userId, userId)));
}

/**
 * Find a reusable event-stream token for `userId`. Returns the plaintext
 * token string + record, or null if none qualifies.
 *
 * "Reusable" = label='event-stream', not expired, and FRESH within
 * `maxIdleMs` (default 7 days), where freshness = last_used_at when present,
 * else created_at.
 *
 * Why coalesce to created_at: the SSE bridge is a SEPARATE service
 * (bridge.orangecat.ch), so it never calls validateAgentToken — a live
 * event-stream token's last_used_at therefore stays NULL forever. The original
 * filter `last_used_at > cutoff` treated NULL as "abandoned" and never matched,
 * so EVERY browser session minted a fresh token (56 never-used rows accumulated
 * for one account). Falling back to created_at reuses a token minted within the
 * window, capping the footprint at "one live token per active week" as intended.
 */
export async function getReusableEventStreamToken(
  userId: string,
  maxIdleMs: number = WEEK_MS,
): Promise<{ token: string; record: AgentToken } | null> {
  const now = new Date();
  // ISO string + explicit ::timestamptz cast: a bare JS Date inside a raw sql
  // fragment has no column-type context for postgres-js to bind, which throws
  // (and the route then silently mints — the leak this fix exists to stop).
  const cutoffIso = new Date(Date.now() - maxIdleMs).toISOString();
  const freshness = sql`coalesce(${agentTokens.lastUsedAt}, ${agentTokens.createdAt})`;
  const [record] = await db
    .select()
    .from(agentTokens)
    .where(
      and(
        eq(agentTokens.userId, userId),
        eq(agentTokens.label, "event-stream"),
        or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, now)),
        sql`${freshness} > ${cutoffIso}::timestamptz`,
      ),
    )
    .orderBy(desc(freshness))
    .limit(1);
  return record ? { token: record.token, record } : null;
}

/**
 * Delete event-stream tokens that haven't been touched in `olderThanMs`
 * (default 30 days). Used by the daily hygiene cron to keep the
 * agent_tokens table bounded.
 *
 * Returns the number of rows deleted, for telemetry. Other label values
 * ("Fleet Runner (auto)", custom-named tokens) are NEVER touched —
 * removing them would break the runner silently.
 */
export async function deleteStaleEventStreamTokens(
  olderThanMs: number = 30 * DAY_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await db
    .delete(agentTokens)
    .where(
      and(
        eq(agentTokens.label, "event-stream"),
        or(
          and(isNull(agentTokens.lastUsedAt), lt(agentTokens.createdAt, cutoff)),
          lt(agentTokens.lastUsedAt, cutoff),
        ),
      ),
    )
    .returning({ id: agentTokens.id });
  return result.length;
}

/** Validates a bearer token and returns the associated userId, or null if invalid/expired. */
export async function validateAgentToken(
  token: string,
): Promise<{ userId: string; orgId: string | null; kind: AgentTokenKind } | null> {
  const now = new Date();
  const [row] = await db
    .select({
      id: agentTokens.id,
      userId: agentTokens.userId,
      orgId: agentTokens.orgId,
      kind: agentTokens.kind,
    })
    .from(agentTokens)
    .where(
      and(
        eq(agentTokens.token, token),
        or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Touch lastUsedAt (fire-and-forget, don't await).
  db.update(agentTokens)
    .set({ lastUsedAt: now })
    .where(eq(agentTokens.id, row.id))
    .catch(() => {});

  return { userId: row.userId, orgId: row.orgId, kind: row.kind };
}
