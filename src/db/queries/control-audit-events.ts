import { createHash } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { controlAuditEvents, type NewControlAuditEvent } from "@/db/schema/control-audit-events";
import type { Action } from "@/db/schema/actions";

/** Lifecycle stages of an action, mirrored into the control audit log so the
 *  whole propose → approve → execute path is visible in RecentControlAuditCard. */
export type ActionAuditLifecycle =
  "proposed" | "approved" | "executed" | "rejected" | "deferred" | "failed" | "expired";

export function promptFingerprint(prompt: string | null | undefined) {
  const text = prompt?.trim();
  if (!text) return { promptHash: null, promptPreview: null };
  return {
    promptHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
    promptPreview: text.replace(/\s+/g, " ").slice(0, 220),
  };
}

export function recordControlAuditEvent(
  entry: Omit<NewControlAuditEvent, "id" | "createdAt">,
): Promise<unknown> {
  return db
    .insert(controlAuditEvents)
    .values(entry)
    .catch((err) => {
      console.error("[control-audit] insert failed:", err, "for entry:", {
        event: entry.event,
        source: entry.source,
        action: entry.action,
        projectKey: entry.projectKey,
      });
    });
}

/**
 * Audit one stage of an action's lifecycle. Thin wrapper over
 * recordControlAuditEvent so producers/executors don't re-declare the
 * event/source shape. Fire-and-forget (never throws — inherits the catch above).
 */
export function recordActionAuditEvent(
  userId: string,
  action: Pick<Action, "id" | "type" | "title" | "reasoning" | "payload" | "entityId">,
  lifecycle: ActionAuditLifecycle,
  extra?: { reason?: string; meta?: Record<string, unknown> },
): Promise<unknown> {
  return recordControlAuditEvent({
    userId,
    event: "action",
    source: "actions",
    action: lifecycle,
    reason: extra?.reason ?? action.title,
    promptPreview: action.reasoning ?? null,
    meta: {
      actionId: action.id,
      type: action.type,
      channel: action.payload?.channel ?? null,
      entityId: action.entityId ?? null,
      ...extra?.meta,
    },
  });
}

/** How many times one action reached `lifecycle` (e.g. how often its booking failed). */
export async function countActionAuditEvents(
  actionId: string,
  lifecycle: ActionAuditLifecycle,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(controlAuditEvents)
    .where(
      and(
        eq(controlAuditEvents.event, "action"),
        eq(controlAuditEvents.action, lifecycle),
        sql`${controlAuditEvents.meta}->>'actionId' = ${actionId}`,
      ),
    );
  return row?.n ?? 0;
}

export async function getRecentControlAuditEvents(userId: string, limit = 20) {
  return db
    .select()
    .from(controlAuditEvents)
    .where(eq(controlAuditEvents.userId, userId))
    .orderBy(desc(controlAuditEvents.createdAt))
    .limit(limit);
}
