import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory, type NewPromptHistoryRow } from "@/db/schema/prompt-history";
import { excludeSmokeDispatchesSql } from "./smoke-filter";
import { toPromptDisplayFields, type PromptDisplayFields } from "@/lib/activity-status";
import { HOUR_MS } from "@/lib/constants/time";

export async function insertPromptHistory(
  userId: string,
  row: Omit<NewPromptHistoryRow, "id" | "userId" | "dispatchedAt">,
) {
  await db.insert(promptHistory).values({ ...row, userId });
}

/**
 * True when this exact prompt text was already recorded for the project
 * recently. Claude's UserPromptSubmit hook fires for EVERY prompt the CLI
 * receives — it cannot distinguish keystrokes Loki injected from
 * keystrokes the human typed. Dispatch paths (inject-core, tab-inject) record
 * their prompt_history row at dispatch time, so when the capture hook's
 * payload matches a fresh dispatch row it is the echo of that dispatch, not
 * direct typing, and must not be recorded twice. The 10-minute window covers
 * queued cloud dispatches that the runner delivers late.
 */
export async function hasRecentIdenticalPrompt(
  userId: string,
  projectKey: string,
  promptText: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: promptHistory.id })
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        eq(promptHistory.projectKey, projectKey),
        sql`${promptHistory.dispatchedAt} > now() - interval '10 minutes'`,
        // btrim both sides: assembled prompts can carry trailing whitespace
        // that the hook's trimmed payload won't have.
        sql`(btrim(${promptHistory.resolvedPrompt}) = ${promptText} OR btrim(${promptHistory.customPrompt}) = ${promptText})`,
      ),
    )
    .limit(1);
  return !!row;
}

export type RecentCustomPrompt = {
  customPrompt: string;
  count: number;
  lastUsedAt: string;
};

/**
 * A prompt is worth OFFERING BACK only if it was actually reused.
 *
 * "Paste from history" exists for the thing you keep retyping. It was fed by
 * every custom dispatch ordered by recency, which is the opposite selection:
 * measured on prod 2026-09-04, 30 days of history holds 1859 distinct custom
 * prompts, of which 1823 — 98% — were sent exactly once. Ordering by recency
 * therefore surfaced the three most recent ONE-OFFS, i.e. by definition the
 * prompts least likely to be wanted again. On /control it was offering back
 * conversational asides ("you do it. open in browser and do it") as reusable
 * work, next to genuinely reused ones like "continue" (115×).
 *
 * Requiring two uses cuts the pool from 1859 to 36 and leaves exactly the
 * prompts the feature is named for. A one-off is still reachable — Activity
 * keeps every dispatch with a re-run control; it just stops competing for the
 * card with the ones that earn their place.
 */
const MIN_USES_TO_OFFER = 2;

// Per-project: deduplicated custom prompts sorted by recency and frequency
export async function getRecentCustomPromptsByProjectKey(
  userId: string,
  projectKey: string,
  limit = 8,
): Promise<RecentCustomPrompt[]> {
  const rows = await db
    .select({
      customPrompt: promptHistory.customPrompt,
      count: sql<number>`count(*)::int`,
      lastUsedAt: sql<string>`max(dispatched_at)::text`,
    })
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        eq(promptHistory.projectKey, projectKey),
        eq(promptHistory.intent, "custom"),
        sql`custom_prompt is not null`,
        excludeSmokeDispatchesSql(),
      ),
    )
    .groupBy(promptHistory.customPrompt)
    .having(sql`count(*) >= ${MIN_USES_TO_OFFER}`)
    .orderBy(desc(sql`max(dispatched_at)`))
    .limit(limit);

  return rows
    .filter((r): r is typeof r & { customPrompt: string } => r.customPrompt !== null)
    .map((r) => ({ customPrompt: r.customPrompt, count: r.count, lastUsedAt: r.lastUsedAt }));
}

// Batch version for the control panel — one query for all projects
export async function getRecentCustomPromptsByProjectKeys(
  userId: string,
  projectKeys: string[],
): Promise<Map<string, RecentCustomPrompt[]>> {
  if (projectKeys.length === 0) return new Map();

  const rows = await db
    .select({
      projectKey: promptHistory.projectKey,
      customPrompt: promptHistory.customPrompt,
      count: sql<number>`count(*)::int`,
      lastUsedAt: sql<string>`max(dispatched_at)::text`,
    })
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        inArray(promptHistory.projectKey, projectKeys),
        eq(promptHistory.intent, "custom"),
        sql`custom_prompt is not null`,
        excludeSmokeDispatchesSql(),
      ),
    )
    .groupBy(promptHistory.projectKey, promptHistory.customPrompt)
    // Same rule as the single-project query above — the control panel is the
    // surface where this was actually offering back one-offs.
    .having(sql`count(*) >= ${MIN_USES_TO_OFFER}`)
    .orderBy(desc(sql`max(dispatched_at)`));

  const result = new Map<string, RecentCustomPrompt[]>();
  for (const row of rows) {
    if (!row.customPrompt) continue;
    const entry = result.get(row.projectKey) ?? [];
    if (entry.length < 8) {
      entry.push({ customPrompt: row.customPrompt, count: row.count, lastUsedAt: row.lastUsedAt });
    }
    result.set(row.projectKey, entry);
  }
  return result;
}

// ── Shared select shape + mappers ─────────────────────────────────────────────

const DISPATCH_COLS = {
  id: promptHistory.id,
  projectId: promptHistory.projectId,
  projectKey: promptHistory.projectKey,
  adapter: promptHistory.adapter,
  intent: promptHistory.intent,
  customPrompt: promptHistory.customPrompt,
  resolvedPrompt: promptHistory.resolvedPrompt,
  dispatchedAt: promptHistory.dispatchedAt,
};

type RawDispatchRow = {
  id: string;
  projectId: string | null;
  projectKey: string;
  adapter: string;
  intent: string;
  customPrompt: string | null;
  resolvedPrompt: string | null;
  dispatchedAt: Date;
};

// All dispatches — for the dedicated history page (dispatchedAt stays as Date for RSC prop passing)
export type HistoryItem = Omit<RawDispatchRow, "customPrompt" | "resolvedPrompt"> &
  PromptDisplayFields;

// Last N dispatches — for activity feeds serialized through JSON API (dispatchedAt as ISO string)
export type ActivityItem = Omit<HistoryItem, "dispatchedAt"> & { dispatchedAt: string };

function toHistoryItem(r: RawDispatchRow): HistoryItem {
  const display = toPromptDisplayFields(r);
  return {
    id: r.id,
    projectId: r.projectId ?? null,
    projectKey: r.projectKey,
    adapter: r.adapter,
    intent: r.intent,
    ...display,
    dispatchedAt: r.dispatchedAt,
  };
}

function toActivityItem(r: RawDispatchRow): ActivityItem {
  return { ...toHistoryItem(r), dispatchedAt: r.dispatchedAt.toISOString() };
}

// ── Query functions ───────────────────────────────────────────────────────────

export async function getPromptHistory(userId: string, limit = 200): Promise<HistoryItem[]> {
  const rows = await db
    .select(DISPATCH_COLS)
    .from(promptHistory)
    .where(and(eq(promptHistory.userId, userId), excludeSmokeDispatchesSql()))
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(limit);
  return rows.map(toHistoryItem);
}

export async function getRecentActivity(
  userId: string,
  hours = 24,
  limit = 30,
): Promise<ActivityItem[]> {
  const since = new Date(Date.now() - hours * HOUR_MS);
  const rows = await db
    .select(DISPATCH_COLS)
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        gte(promptHistory.dispatchedAt, since),
        excludeSmokeDispatchesSql(),
      ),
    )
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(limit);
  return rows.map(toActivityItem);
}

// The single most-recent dispatch for a project — powers the Duet watch view,
// where each pane shows one agent's last prompt, live. Matched case-insensitively
// on projectKey because the dispatch tab and the registered project name can
// differ in case (see recordSessionHandoffChangelog's ilike match).
export async function getLastPromptByProjectKey(
  userId: string,
  projectKey: string,
): Promise<ActivityItem | null> {
  const [row] = await db
    .select(DISPATCH_COLS)
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        sql`lower(${promptHistory.projectKey}) = lower(${projectKey})`,
        excludeSmokeDispatchesSql(),
      ),
    )
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(1);
  return row ? toActivityItem(row) : null;
}

export async function getProjectPromptActivity(
  userId: string,
  projectId: string,
  limit = 50,
): Promise<ActivityItem[]> {
  const rows = await db
    .select(DISPATCH_COLS)
    .from(promptHistory)
    .where(
      and(
        eq(promptHistory.userId, userId),
        eq(promptHistory.projectId, projectId),
        excludeSmokeDispatchesSql(),
      ),
    )
    .orderBy(desc(promptHistory.dispatchedAt))
    .limit(limit);
  return rows.map(toActivityItem);
}

/**
 * The prompt each run was dispatched with, by run id — what a run is ABOUT
 * (lib/task-title reads a title from it). Runs dispatched before run_id was
 * recorded have no row and are named by their intent instead.
 */
export async function getPromptsByRunIds(
  userId: string,
  runIds: string[],
): Promise<Map<string, { customPrompt: string | null; resolvedPrompt: string | null }>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      runId: promptHistory.runId,
      customPrompt: promptHistory.customPrompt,
      resolvedPrompt: promptHistory.resolvedPrompt,
    })
    .from(promptHistory)
    .where(and(eq(promptHistory.userId, userId), inArray(promptHistory.runId, runIds)))
    .orderBy(desc(promptHistory.dispatchedAt));
  const byRun = new Map<string, { customPrompt: string | null; resolvedPrompt: string | null }>();
  for (const row of rows) {
    if (row.runId && !byRun.has(row.runId)) {
      byRun.set(row.runId, { customPrompt: row.customPrompt, resolvedPrompt: row.resolvedPrompt });
    }
  }
  return byRun;
}
