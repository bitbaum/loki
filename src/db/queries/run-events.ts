import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { runEvents, type NewRunEvent, type RunEventKind } from "@/db/schema/run-events";

// Dedup/plumbing acks that aren't a real cause — a re-claim of an already-done
// command emits a "blocked: already-done" event that would otherwise masquerade
// as the failure reason.
const NOISE_BLOCKED_REASON = /^already[ -]done$/i;

/**
 * The meaningful "why it failed" per run: the latest blocked-event reason that
 * isn't dedup noise. Reaped timeouts store a circular payload.error ("timed out
 * — exceeded max duration"); the ACTUAL cause ("agent isn't generating", "not
 * authenticated (401)") lives in these events. Batched so the Activity digest
 * can show the real reason in one page load instead of a transcript dig.
 */
export async function getBlockedReasonsForRuns(runIds: string[]): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({ runId: runEvents.runId, detail: runEvents.detail })
    .from(runEvents)
    .where(and(inArray(runEvents.runId, runIds), eq(runEvents.kind, "blocked")))
    .orderBy(asc(runEvents.createdAt));
  const out = new Map<string, string>();
  for (const r of rows) {
    const raw = (r.detail as { reason?: unknown } | null)?.reason;
    const reason = typeof raw === "string" ? raw.trim() : "";
    if (!reason || NOISE_BLOCKED_REASON.test(reason)) continue;
    out.set(r.runId, reason); // ascending order → the last meaningful reason wins
  }
  return out;
}

/**
 * Append one hop to the run ledger. Fire-and-forget at call sites (never
 * block or fail the hop itself because telemetry hiccuped) — but callers
 * should `void emitRunEvent(...)` explicitly so intent is visible.
 */
export async function emitRunEvent(
  runId: string,
  userId: string,
  kind: RunEventKind,
  detail?: Record<string, unknown>,
): Promise<void> {
  const row: NewRunEvent = { runId, userId, kind, detail: detail ?? null };
  await db
    .insert(runEvents)
    .values(row)
    .catch((err) => {
      console.error("[run-events] emit failed:", kind, runId, err);
    });
}

/**
 * Latest hop per run — for feedback Watch step summaries. Ascending fetch then
 * last-write-wins so a small IN list stays one query.
 */
export async function getLatestRunEventKinds(runIds: string[]): Promise<Map<string, RunEventKind>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({ runId: runEvents.runId, kind: runEvents.kind })
    .from(runEvents)
    .where(inArray(runEvents.runId, runIds))
    .orderBy(asc(runEvents.createdAt));
  const out = new Map<string, RunEventKind>();
  for (const r of rows) out.set(r.runId, r.kind);
  return out;
}

/** Full event trail for one run — progressive disclosure under Watch. */
export async function listRunEventsForRun(
  runId: string,
  userId: string,
  limit = 40,
): Promise<{ kind: RunEventKind; detail: Record<string, unknown> | null; createdAt: Date }[]> {
  const rows = await db
    .select({
      kind: runEvents.kind,
      detail: runEvents.detail,
      createdAt: runEvents.createdAt,
      userId: runEvents.userId,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.userId, userId)))
    .orderBy(asc(runEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    kind: r.kind,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt,
  }));
}
