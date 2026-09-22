// Cron target — OrangeCat promote backfill (bridge Part C reconcile step).
//
// promoteDevLogEntry / promoteMomentToOrangeCat are fire-and-forget at the
// user-action call sites: a process restart, OC downtime, or an expired token
// drops the promote silently. The bridge spec's rule is "best-effort must not
// mean silently lossy" — this janitor re-emits recent publish-worthy moments
// for projects that opted into Publish (orangecatProjectId). Linking alone is
// not consent, and history from before publish is skipped. External ids are
// deterministic (sha256 of the entry / stable project id), so re-posting is
// idempotent: OrangeCat reconciles on (source, external_id) and returns 200
// instead of double-posting.
//
// Schedule: daily at 09:00 UTC (systemd timer, scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { userProjects } from "@/db/schema";
import type { DevLogEntry } from "@/db/schema/user-projects";
import { requireCronAuth } from "@/lib/cron-auth";
import { DAY_MS } from "@/lib/constants/time";
import { logDebug } from "@/db/queries/debug-logs";
import {
  promoteDevLogEntry,
  promoteMomentToOrangeCat,
  promoteRunClose,
  type PromoteOutcome,
} from "@/lib/integrations/orangecat-publish";
import { getRecentSuccessfulRuns } from "@/db/queries/orchestration-runs";
import { getOrangeCatLinksForProject } from "@/db/queries/orangecat-links";

/** Upper bound on how far back we look — never past publish consent (below). */
const BACKFILL_WINDOW_DAYS = 14;
/** Cap re-emits per tick so a misconfig can't hammer the OC publish bus. */
const MAX_PROMOTES_PER_TICK = 50;

/**
 * One emit every this long, because OrangeCat allows 30 writes per minute per
 * user (`rateLimitWriteAsync`, sliding 60s window) and this janitor used to
 * fire its whole tick as fast as the event loop allowed.
 *
 * The arithmetic was doing exactly what it looks like: measured on prod
 * 2026-09-22, the first tick after a five-day outage reported
 * `posted: 30, failed: 20` — the first thirty landed, the bucket emptied, and
 * every remaining attempt came back 429 and was logged as a failure. Not a
 * fluke to retry past: a backlog larger than thirty ALWAYS burned the
 * remainder of its budget on refusals, and the deterministic external ids
 * meant the next tick re-sent the same doomed twenty a day later.
 *
 * Paced, nothing is refused and nothing is wasted. The number is the
 * neighbour's published limit with headroom (60s / 30 = 2000ms), not a guess
 * tuned until the errors stopped.
 */
const PROMOTE_PACE_MS = 2_100;

/**
 * Stop before the caller does. The systemd timer curls this with `-m 120`
 * (scripts/install-hetzner-crons.sh), and a tick killed mid-flight reports
 * nothing at all — no counts, no debug_logs row, just a dead curl. Ending
 * early and saying `capped` keeps the tick's own account of itself intact;
 * the deterministic ids mean the rest is picked up next time.
 */
const TIME_BUDGET_MS = 90_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const linked = await db
    .select({
      id: userProjects.id,
      userId: userProjects.userId,
      name: userProjects.name,
      description: userProjects.description,
      devLog: userProjects.devLog,
      orangecatProjectId: userProjects.orangecatProjectId,
    })
    .from(userProjects)
    .where(and(isNotNull(userProjects.orangecatProjectId), eq(userProjects.isActive, true)));

  const startedAt = Date.now();
  const counts: Record<PromoteOutcome, number> = { posted: 0, skipped: 0, failed: 0 };
  let attempted = 0;
  let capped = false;

  /**
   * Build every project's queue FIRST, then drain them round-robin.
   *
   * WHY, and it is not tidiness: the previous shape walked the projects in
   * order and stopped at the budget, from the top, every tick. So a project
   * far enough down the list was never reached — not "eventually", never.
   * Measured on prod 2026-09-22 while catching up a five-day outage: three
   * consecutive ticks each reported `posted: 30, capped: true`, and across all
   * three Heidi's wall went 0 → 0 → 0 while the first projects in the list
   * were re-sent their same thirty moments each time. The janitor looked busy
   * and was starving its own tail.
   *
   * Round-robin makes the budget a share rather than a race: one moment from
   * each project in turn, so every wall moves every tick and a project with a
   * large backlog cannot hold the others hostage. Unused turns are reclaimed
   * naturally — a project whose queue empties simply stops being asked.
   */
  const queues: Array<Array<() => Promise<PromoteOutcome>>> = [];

  for (const project of linked) {
    // Linking an OrangeCat account is not consent to publish. Publish sets the
    // funding entity link; its createdAt is when the operator opted the project
    // onto the public wall. Never backfill private history from before that.
    const links = await getOrangeCatLinksForProject(project.userId, project.id);
    const publishLink =
      links.find((l) => l.entityId === project.orangecatProjectId) ??
      links.find((l) => l.role === "funding");
    const publishedAt = publishLink?.createdAt ?? null;
    // No publish timestamp → only reconcile the "went public" moment; do not
    // invent a 14-day dump of private notes onto the wall.
    const historyCutoffIso = publishedAt
      ? new Date(
          Math.max(publishedAt.getTime(), Date.now() - BACKFILL_WINDOW_DAYS * DAY_MS),
        ).toISOString()
      : null;
    const historyCutoffDate = historyCutoffIso ? historyCutoffIso.slice(0, 10) : null;

    // The "went public" moment first — it anchors the wall if the original
    // fire-and-forget emit was dropped during the publish call.
    queues.push([
      () =>
        promoteMomentToOrangeCat(project.userId, project.id, "project_published", {
          externalId: `loki_project_published_${project.id}`,
          title: `${project.name} is now building in public`,
          description: project.description ?? undefined,
          subjectId: project.orangecatProjectId ?? undefined,
        }),
      ...((project.devLog ?? []) as DevLogEntry[])
        .filter((entry) => historyCutoffDate != null && entry.date >= historyCutoffDate)
        .map((entry) => () => promoteDevLogEntry(project.userId, project.id, project.name, entry)),
      // Run→wall reconcile: only runs finished at/after publish consent.
      ...(historyCutoffIso
        ? (
            await getRecentSuccessfulRuns(project.userId, project.name, new Date(historyCutoffIso))
          ).map((run) => () => promoteRunClose(run))
        : []),
    ]);
  }

  // Sequential on purpose: this is a janitor, not a hot path — one in-flight
  // request to the OC bus at a time. Sequential is not the same as PACED,
  // which is what the pause below adds; see PROMOTE_PACE_MS.
  let cursor = 0;
  drain: while (queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const emit = queue.shift();
      if (!emit) continue;
      if (attempted >= MAX_PROMOTES_PER_TICK || Date.now() - startedAt > TIME_BUDGET_MS) {
        capped = true;
        break drain;
      }
      if (attempted > 0) await sleep(PROMOTE_PACE_MS);
      attempted++;
      counts[await emit()]++;
    }
    cursor++;
    // Defensive: a round that moved nothing would spin. Cannot happen while
    // every round shifts from a non-empty queue, but a janitor that can hang
    // is worse than one that stops early and says so.
    if (cursor > MAX_PROMOTES_PER_TICK) break;
  }

  const summary = { projects: linked.length, attempted, ...counts, capped };
  await logDebug({
    source: "crons/orangecat-promote-backfill",
    level: counts.failed > 0 ? "warn" : "info",
    message: "backfill tick",
    meta: summary,
  });
  return NextResponse.json({ ok: true, ...summary });
}
