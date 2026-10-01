import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentSessions, type AgentSessionRow } from "@/db/schema";
import { OPEN_TURN_TTL_MS, bucketTurnsByProject } from "@/lib/agent-turns";
import type { LiveAgentTurns } from "@/lib/control-types";

// TTL and bucketing live in lib/agent-turns.ts — pure, so the unit suite can
// test them with no DATABASE_URL. Re-exported here so callers that already
// import this module do not need to know where the constant moved.
export { OPEN_TURN_TTL_MS, bucketTurnsByProject };

/**
 * Record that an agent STARTED a turn. Called from the UserPromptSubmit hook
 * path. Upsert, not insert: one row per session, so a session's tenth turn
 * updates its row instead of adding a tenth "live agent".
 *
 * Clearing endedAt is the point — a session that ended a turn and started
 * another is working again.
 */
export async function startAgentTurn(input: {
  userId: string;
  sessionId: string;
  projectKey: string;
  cwd: string;
  projectId: string | null;
  agent?: string;
}): Promise<void> {
  await db
    .insert(agentSessions)
    .values({
      userId: input.userId,
      sessionId: input.sessionId,
      projectKey: input.projectKey,
      cwd: input.cwd,
      projectId: input.projectId,
      agent: input.agent ?? "claude",
      startedAt: new Date(),
      endedAt: null,
    })
    .onConflictDoUpdate({
      target: [agentSessions.userId, agentSessions.sessionId],
      set: {
        // A session can move between worktrees of the same project, and a
        // long-lived session can be re-pointed entirely. Last report wins.
        projectKey: input.projectKey,
        cwd: input.cwd,
        projectId: input.projectId,
        startedAt: new Date(),
        endedAt: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Record that an agent FINISHED a turn (Stop hook). Returns false when the
 * session was never seen — the caller answers 200 either way, because a hook
 * that fails is a hook the user disables.
 */
export async function endAgentTurn(userId: string, sessionId: string): Promise<boolean> {
  const rows = await db
    .update(agentSessions)
    .set({ endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentSessions.userId, userId), eq(agentSessions.sessionId, sessionId)))
    .returning({ id: agentSessions.id });
  return rows.length > 0;
}

/**
 * Sessions whose turn is open AND recent enough to believe. This is the
 * evidence behind "N working" — every row is an agent that told us it started
 * a turn and has not told us it finished.
 */
export async function getOpenAgentTurns(
  userId: string,
  now = new Date(),
): Promise<AgentSessionRow[]> {
  const cutoff = new Date(now.getTime() - OPEN_TURN_TTL_MS);
  return db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.userId, userId),
        isNull(agentSessions.endedAt),
        gt(agentSessions.startedAt, cutoff),
      ),
    );
}

/**
 * Open turns tallied per project key, for the Control payload.
 *
 * Returns a plain object rather than a Map so it survives the JSON boundary
 * between the route and the client without a bespoke serializer.
 */
export async function getOpenAgentTurnsByProject(
  userId: string,
  now = new Date(),
): Promise<Record<string, LiveAgentTurns>> {
  return bucketTurnsByProject(await getOpenAgentTurns(userId, now));
}

/**
 * Durable identity for the next project action.
 *
 * A project tab is transport, not identity. Claude's native session id is the
 * only identity reported end-to-end today, so callers must resume only rows
 * that Claude itself reported. Prefer a genuinely open turn; otherwise return
 * the most recently observed session so a stopped session can be continued.
 */
export async function getCurrentClaudeSessionForProject(
  userId: string,
  projectKey: string,
  now = new Date(),
  projectId?: string,
): Promise<Pick<AgentSessionRow, "sessionId" | "cwd" | "endedAt" | "startedAt"> | null> {
  const cutoff = new Date(now.getTime() - OPEN_TURN_TTL_MS);
  const fields = {
    sessionId: agentSessions.sessionId,
    cwd: agentSessions.cwd,
    endedAt: agentSessions.endedAt,
    startedAt: agentSessions.startedAt,
  };
  const common = and(
    eq(agentSessions.userId, userId),
    projectId ? eq(agentSessions.projectId, projectId) : eq(agentSessions.projectKey, projectKey),
    eq(agentSessions.agent, "claude"),
  );

  const [open] = await db
    .select(fields)
    .from(agentSessions)
    .where(and(common, isNull(agentSessions.endedAt), gt(agentSessions.startedAt, cutoff)))
    .orderBy(desc(agentSessions.startedAt))
    .limit(1);
  if (open) return open;

  const [latest] = await db
    .select(fields)
    .from(agentSessions)
    .where(common)
    .orderBy(desc(agentSessions.startedAt))
    .limit(1);
  return latest ?? null;
}

/**
 * Housekeeping: close turns that blew past the TTL. Purely cosmetic for the
 * live read (which already bounds on startedAt) — it exists so the table does
 * not accumulate rows that look open forever to anything querying it directly,
 * including a human with psql.
 */
export async function closeStaleAgentTurns(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - OPEN_TURN_TTL_MS);
  const rows = await db
    .update(agentSessions)
    .set({ endedAt: sql`${agentSessions.startedAt}`, updatedAt: new Date() })
    // lt(), not a raw sql`< ${cutoff}`: postgres-js cannot serialise a Date in a
    // raw fragment, so this threw ERR_INVALID_ARG_TYPE on every hourly reap.
    .where(and(isNull(agentSessions.endedAt), lt(agentSessions.startedAt, cutoff)))
    .returning({ id: agentSessions.id });
  return rows.length;
}
