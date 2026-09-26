import { getOrchestrationRunsByIds } from "@/db/queries/orchestration-runs";
import { getLatestRunEventKinds } from "@/db/queries/run-events";
import {
  getOpenPendingByRunIds,
  getInjectAcksByRunIds,
  findQueueBlockers,
} from "@/db/queries/pending-commands";
import { getBuilderPresence } from "@/db/queries/runner-presence";
import { getUserProjectsByEntityIds, getUserProjectByEntityId } from "@/db/queries/user-projects";
import { applyRunContext } from "@/lib/feedback/run-context";
import type { FeedbackListItem } from "@/db/queries/site-feedback";
import {
  deriveFeedbackWork,
  type FeedbackWorkView,
  type FeedbackRunSnapshot,
} from "@/lib/feedback/work-phase";
import {
  fixNeedsRefresh,
  refreshFixShipping,
  FIX_REFRESH_MAX_PER_REQUEST,
} from "@/lib/feedback/fix-shipping-refresh";
import {
  fixCheckedAtMs,
  livePageHref,
  resolveFixPrRef,
  shipAnnouncementFor,
  type FixShipping,
} from "@/lib/feedback/fix-shipping";
import { projectsPausedByBrokenDeploy } from "@/lib/feedback/auto-ship";
import { notifyFixShipped } from "@/lib/feedback/notify-shipped";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import {
  ORCH_STATE,
  ORCHESTRATION_OUTCOME,
  type OrchestrationState,
} from "@/lib/orchestration/contract";

export type FeedbackListItemWithWork = FeedbackListItem & { work: FeedbackWorkView };

type RunRow = {
  id: string;
  state: string;
  outcome: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  payload: unknown;
  summary: unknown;
  /** Entity project id. The run knows which project it belongs to, so a single
   *  run can resolve its own builder routing without the caller supplying it. */
  projectId?: string | null;
};

/** Attach honest work-phase to inbox rows from linked orchestration runs.
 *  Generic so callers with wider rows (e.g. the cross-project inbox, which
 *  carries projectName) keep their extra fields in the result type.
 *
 *  Rows whose run finished well also get the fix ledger refreshed — where the
 *  PR is on its way to the live product — bounded per request. */
export async function attachFeedbackWork<T extends FeedbackListItem>(
  userId: string,
  items: T[],
): Promise<(T & { work: FeedbackWorkView })[]> {
  const runIds = [
    ...new Set(items.map((i) => i.dispatchedRunId).filter((id): id is string => !!id)),
  ];
  const runs = await getOrchestrationRunsByIds(userId, runIds);
  const [latestKinds, pendingByRun, injectAcks, presence, blockers] = await Promise.all([
    getLatestRunEventKinds(runIds),
    getOpenPendingByRunIds(userId, runIds),
    getInjectAcksByRunIds(userId, runIds),
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
    findQueueBlockers(runIds).catch(() => new Map()),
  ]);
  // Presence flags alone are not enough: offline means the builder that owns
  // THIS command's channel is down. Computed per row once we know the channel.

  // Projects first: deciding whether a cached ledger is still ABOUT the right
  // pull request means re-parsing the handoff, and that needs the repo.
  const dispatched = items.filter(
    (i) => i.status === FEEDBACK_STATUS.DISPATCHED && !!i.dispatchedRunId,
  );
  const projects = dispatched.length
    ? await getUserProjectsByEntityIds(userId, [...new Set(dispatched.map((i) => i.projectId))])
    : new Map<
        string,
        Awaited<ReturnType<typeof getUserProjectsByEntityIds>> extends Map<string, infer V>
          ? V
          : never
      >();

  // The fix ledger: only for dispatched rows whose run closed well, only when
  // the cached answer can still change, and only a handful per request.
  const candidates = items.filter((item) => {
    if (item.status !== FEEDBACK_STATUS.DISPATCHED || !item.dispatchedRunId) return false;
    const run = runs.get(item.dispatchedRunId);
    if (!run || !runFinishedWell(run)) return false;
    // Re-parse the handoff every time (pure, free) so a cached answer about a
    // DIFFERENT pull request is never trusted — that is how a parser bug froze
    // rows in a terminal state nothing could correct.
    const expected = resolveFixPrRef({
      summaryDone: (run.summary as { done?: string } | null)?.done ?? null,
      evidence: runEvidence(run),
      gitUrl: projects.get(item.projectId)?.gitUrl ?? null,
    });
    return fixNeedsRefresh(runFix(run), { expectedPrUrl: expected?.url ?? null });
  });
  const refreshed = new Map<string, FixShipping>();
  // Projects whose last shipped fix failed to deploy, computed from the
  // ledgers already cached on their runs — no extra state to keep in sync.
  //
  // Only rows still OPEN count. Resolving a row is the operator saying they
  // have dealt with it, and a deploy_failed ledger was terminal — so counting
  // resolved and archived rows meant one bad deploy paused a project's
  // automatic shipping forever, with no action in the product that could lift
  // it. A pause nobody can end is not a safety feature, it is a dead end.
  const brokenProjects = projectsPausedByBrokenDeploy(
    items,
    (item) => {
      const run = (item as FeedbackListItem).dispatchedRunId
        ? runs.get((item as FeedbackListItem).dispatchedRunId!)
        : undefined;
      return run ? runFix(run) : null;
    },
    [FEEDBACK_STATUS.RESOLVED, FEEDBACK_STATUS.ARCHIVED],
  );
  if (candidates.length) {
    // Least-recently-checked first. The list arrives newest-first, so a plain
    // slice always re-checked the same newest rows and the ones past the cap
    // were never looked at again — a project with more pending fixes than the
    // cap would leave its oldest permanently stale. Oldest-first turns the cap
    // into a rate limit instead of a starvation boundary.
    const due = [...candidates].sort((a, b) => checkedAtMs(runs, a) - checkedAtMs(runs, b));
    if (due.length > FIX_REFRESH_MAX_PER_REQUEST) {
      console.info(
        `[feedback] ${due.length} fixes need a GitHub check; doing ${FIX_REFRESH_MAX_PER_REQUEST} oldest-first this request`,
      );
    }
    await Promise.all(
      due.slice(0, FIX_REFRESH_MAX_PER_REQUEST).map(async (item) => {
        const run = runs.get(item.dispatchedRunId!)!;
        const project = projects.get(item.projectId);
        const fix = await refreshFixShipping({
          runId: run.id,
          userId,
          cached: runFix(run),
          summaryDone: (run.summary as { done?: string } | null)?.done ?? null,
          evidence: runEvidence(run),
          gitUrl: project?.gitUrl ?? null,
          // The only fact that ties a pull request to this run; automatic
          // merging refuses without it (see prOpenedByRun).
          runStartedAt: run.startedAt ?? null,
          // Without these two the merge path below can never run: decideAutoShip
          // reads `autoShip === true` and holds on anything else, so an omitted
          // field silently disables the whole feature. It shipped omitted once
          // (2026-09-11) — the switch saved, the row read "PR #1 · open", and
          // nothing ever decided. The gate test pins the wiring, not just the rule.
          autoShip: project?.autoShip ?? null,
          deployBroken: brokenProjects.has(item.projectId),
        });
        refreshed.set(run.id, fix);
        // The one place that knows a ledger CHANGED. Announcing from here (not
        // from the ledger writer) keeps the notification tied to a specific
        // feedback row, which is what the operator is actually told about.
        const announce = shipAnnouncementFor(runFix(run), fix);
        if (announce) {
          void notifyFixShipped({
            userId,
            projectId: item.projectId,
            feedbackExcerpt: excerptOf(item.suggestion),
            announcement: announce,
            fix,
            livePageUrl: livePageHref(item.liveUrl, item.url, item.page),
          });
        }
      }),
    );
  }

  return items.map((item) => {
    const row = item.dispatchedRunId ? runs.get(item.dispatchedRunId) : undefined;
    const snap = runToFeedbackSnapshot(row);
    if (snap && row) {
      if (refreshed.has(row.id)) snap.fix = refreshed.get(row.id) ?? null;
      applyRunContext(snap, row, {
        presence,
        project: projects.get(item.projectId),
        pending: pendingByRun.get(row.id) ?? null,
        latestEventKind: latestKinds.get(row.id) ?? null,
        ack: injectAcks.get(row.id) ?? null,
        blocker: blockers.get(row.id) ?? null,
      });
    }
    return { ...item, work: deriveFeedbackWork(item.status, snap) };
  });
}

function runFix(run: RunRow): FixShipping | null {
  return (run.payload as { fix?: FixShipping } | null)?.fix ?? null;
}

function runFinishedWell(run: RunRow): boolean {
  const closed =
    run.state === ORCH_STATE.DONE ||
    run.state === ORCH_STATE.CLOSED ||
    run.state === ORCH_STATE.CLOSING;
  return (
    closed &&
    (run.outcome === ORCHESTRATION_OUTCOME.SUCCESS || run.outcome === ORCHESTRATION_OUTCOME.PARTIAL)
  );
}

/**
 * The single-run version of the inbox's hydration, for the routes that look at
 * one run: Watch, Terminal's rail, and Implement's duplicate-guard. The run
 * carries its own `projectId`, so no caller has to know how builder routing is
 * decided — which is exactly how the three of them drifted apart.
 */
export async function hydrateFeedbackSnapshot(
  userId: string,
  run: RunRow | null | undefined,
): Promise<FeedbackRunSnapshot | null> {
  const snap = runToFeedbackSnapshot(run);
  if (!snap || !run) return snap;
  const [latestKinds, pendingByRun, injectAcks, presence, project, blockers] = await Promise.all([
    getLatestRunEventKinds([run.id]),
    getOpenPendingByRunIds(userId, [run.id]),
    getInjectAcksByRunIds(userId, [run.id]),
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
    run.projectId
      ? getUserProjectByEntityId(userId, run.projectId).catch(() => null)
      : Promise.resolve(null),
    findQueueBlockers([run.id]).catch(() => new Map()),
  ]);
  return applyRunContext(snap, run, {
    presence,
    project: project ?? undefined,
    pending: pendingByRun.get(run.id) ?? null,
    latestEventKind: latestKinds.get(run.id) ?? null,
    ack: injectAcks.get(run.id) ?? null,
    blocker: blockers.get(run.id) ?? null,
  });
}

/** Run row → the snapshot shape deriveFeedbackWork consumes. Shared with the
 *  dispatch route's duplicate-guard so "is the agent working" has ONE source
 *  of truth (the route used to re-implement the thresholds inline). */
export function runToFeedbackSnapshot(row: RunRow | null | undefined): FeedbackRunSnapshot | null {
  if (!row) return null;
  const payload = row.payload as {
    deliveredAt?: string;
    lastProgressAt?: string;
    blocked?: string | null;
    injectVerified?: boolean | null;
    injectWarning?: string | null;
    error?: string;
    fix?: FixShipping;
    commandId?: string;
    sessionTab?: string;
    hostedDispatchId?: string;
    feedbackAutoRetriedAt?: string;
  } | null;
  return {
    id: row.id,
    state: row.state as OrchestrationState,
    outcome: row.outcome ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    deliveredAt: payload?.deliveredAt ?? null,
    lastProgressAt: payload?.lastProgressAt ?? null,
    blocked: payload?.blocked ?? null,
    injectVerified: typeof payload?.injectVerified === "boolean" ? payload.injectVerified : null,
    injectWarning: payload?.injectWarning ?? null,
    error: payload?.error ?? null,
    summaryDone: (row.summary as { done?: string } | null)?.done ?? null,
    fix: payload?.fix ?? null,
    commandId: payload?.commandId ?? null,
    sessionTab: payload?.sessionTab ?? null,
    hostedPending: !!payload?.hostedDispatchId,
    feedbackAutoRetriedAt: payload?.feedbackAutoRetriedAt ?? null,
  };
}

/** payload.evidence, in the shape both the resolver and the refresher read. */
function runEvidence(run: RunRow): { kind: string; url: string; title: string } | null {
  return (
    (run.payload as { evidence?: { kind: string; url: string; title: string } } | null)?.evidence ??
    null
  );
}

/** When this run's ledger was last checked — 0 (oldest) when never. */
function checkedAtMs(runs: Map<string, RunRow>, item: FeedbackListItem): number {
  const run = item.dispatchedRunId ? runs.get(item.dispatchedRunId) : undefined;
  return fixCheckedAtMs(run ? runFix(run) : null);
}

/** Short enough for a push notification body. */
function excerptOf(text: string | null | undefined, max = 120): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
