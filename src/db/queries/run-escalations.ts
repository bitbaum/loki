import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runEscalations, type RunEscalation } from "@/db/schema/run-escalations";
import {
  ESCALATION_HUMAN_STREAK,
  levelForStreak,
  renderEscalationBlock,
} from "@/lib/orchestration/escalation-ladder";
import { insertActiveAlertOnce } from "./alerts";
import { notifyPerson } from "@/lib/notify/person";
import { logDebug } from "./debug-logs";

/** The open (unresolved) ladder row for one project, if any. */
export async function getOpenEscalation(
  userId: string,
  projectKey: string,
): Promise<RunEscalation | null> {
  const [row] = await db
    .select()
    .from(runEscalations)
    .where(
      and(
        eq(runEscalations.userId, userId),
        eq(runEscalations.projectKey, projectKey),
        isNull(runEscalations.resolvedAt),
      ),
    )
    .orderBy(desc(runEscalations.openedAt))
    .limit(1);
  return row ?? null;
}

/**
 * A failing run closed — advance the project's ladder one rung (or open it at
 * 'retry'). At the 'human' rung, raise the deduped alert + Telegram ping once.
 * Never throws: escalation bookkeeping must not fail a close.
 */
export async function advanceEscalation(input: {
  userId: string;
  projectKey: string;
  runId: string;
  outcome: string;
  error?: string | null;
}): Promise<void> {
  try {
    const open = await getOpenEscalation(input.userId, input.projectKey);
    const failStreak = (open?.failStreak ?? 0) + 1;
    const level = levelForStreak(failStreak);
    if (!level) return;

    if (open) {
      await db
        .update(runEscalations)
        .set({
          failStreak,
          level,
          lastRunId: input.runId,
          lastOutcome: input.outcome,
          lastError: input.error ?? null,
          updatedAt: new Date(),
        })
        .where(eq(runEscalations.id, open.id));
    } else {
      // Read-then-insert races with itself: the reaper calls this for every
      // reaped run without awaiting, so two closes for one project can both
      // see "no open row". The partial unique index now refuses the second
      // insert instead of letting it create a parallel ladder — and this
      // catches that refusal and advances the row the winner created, so the
      // losing close still counts toward the streak rather than vanishing.
      const inserted = await db
        .insert(runEscalations)
        .values({
          userId: input.userId,
          projectKey: input.projectKey,
          level,
          failStreak,
          lastRunId: input.runId,
          lastOutcome: input.outcome,
          lastError: input.error ?? null,
        })
        .onConflictDoNothing({
          target: [runEscalations.userId, runEscalations.projectKey],
          // The partial index's predicate — without it Postgres cannot match
          // the conflict target and the insert raises instead of doing nothing.
          where: isNull(runEscalations.resolvedAt),
        })
        .returning({ id: runEscalations.id });

      if (inserted.length === 0) {
        const winner = await getOpenEscalation(input.userId, input.projectKey);
        if (winner) {
          const merged = winner.failStreak + 1;
          const mergedLevel = levelForStreak(merged) ?? winner.level;
          await db
            .update(runEscalations)
            .set({
              failStreak: merged,
              level: mergedLevel,
              lastRunId: input.runId,
              lastOutcome: input.outcome,
              lastError: input.error ?? null,
              updatedAt: new Date(),
            })
            .where(eq(runEscalations.id, winner.id));
        }
      }
    }

    // Top rung = the failure brake's trip point (same constant by
    // construction). The agent can't route around this one — a human can.
    if (failStreak === ESCALATION_HUMAN_STREAK) {
      const created = await insertActiveAlertOnce({
        userId: input.userId,
        type: "run_escalation",
        severity: "urgent",
        title: `${input.projectKey}: ${failStreak} consecutive failed runs`,
        description:
          `The escalation ladder (retry → patch → replan) is exhausted and autopilot is braked. ` +
          `Last failure: ${(input.error ?? input.outcome).slice(0, 300)}`,
        actionUrl: "/control",
        metadata: { projectKey: input.projectKey, runId: input.runId, failStreak },
      });
      if (created) {
        void notifyPerson(input.userId, {
          source: "runs",
          category: "results",
          text: `🚨 ${input.projectKey}: ${failStreak} failed runs in a row — autopilot is paused until you decide.`,
          buttons: [[{ text: "Decide on Control", url: "https://loki.orangecat.ch/control" }]],
          key: `escalation:${input.projectKey}`,
        }).catch(() => undefined);
      }
    }
  } catch (err) {
    void logDebug({
      source: "run-escalations",
      level: "warn",
      message: "advanceEscalation failed",
      meta: { projectKey: input.projectKey, error: (err as Error).message },
    }).catch(() => {});
  }
}

/**
 * The project is moving again (or the operator intervened) — close the ladder.
 *
 * `by` records WHICH kind of evidence closed it, because the three are not
 * interchangeable when you later ask whether escalating helped:
 *   success  — the run met its definition of done
 *   progress — real work landed without clearing the bar (`partial`). This is
 *              the common case by a wide margin, and requiring `success` here
 *              is what left seventeen ladders open with no way out.
 *   manual   — a human looked at it and closed it. Before this existed the
 *              value was declared in the type and written by nothing, so
 *              `resolved_by = 'manual'` read as "humans never intervene" when
 *              it actually meant "humans cannot".
 *
 * Resolves EVERY open row for the project, not just the newest — a concurrent
 * reap could open more than one (see the unique index in the schema).
 */
export async function resolveEscalation(
  userId: string,
  projectKey: string,
  by: "success" | "progress" | "manual",
): Promise<void> {
  try {
    await db
      .update(runEscalations)
      .set({ resolvedAt: new Date(), resolvedBy: by, updatedAt: new Date() })
      .where(
        and(
          eq(runEscalations.userId, userId),
          eq(runEscalations.projectKey, projectKey),
          isNull(runEscalations.resolvedAt),
        ),
      );
  } catch (err) {
    void logDebug({
      source: "run-escalations",
      level: "warn",
      message: "resolveEscalation failed",
      meta: { projectKey, error: (err as Error).message },
    }).catch(() => {});
  }
}

/**
 * The prompt block for the project's open escalation, or "" — the shape the
 * dispatch assembly paths consume (best-effort, like every context block).
 */
export async function getOpenEscalationBlock(userId: string, projectKey: string): Promise<string> {
  const open = await getOpenEscalation(userId, projectKey);
  if (!open) return "";
  return (
    renderEscalationBlock({
      level: open.level,
      failStreak: open.failStreak,
      lastError: open.lastError,
      lastOutcome: open.lastOutcome,
    }) ?? ""
  );
}
