/**
 * Run context: which builder queue owns a run, whether that builder is up, and
 * what the runner's inject-ack said.
 *
 * Deliberately free of data access so the invariant it encodes can be tested
 * without a database — `attach-work.ts` does the querying and calls in here.
 */
import type { PendingByRun, InjectAckByRun } from "@/db/queries/pending-commands";
import { pickDispatchChannel, type ProjectLocus } from "@/lib/execution-access";
import type { BuilderChannelPresence } from "@/lib/builder-presence";
import type { FeedbackRunSnapshot } from "@/lib/feedback/work-phase";

/** The part of a run row this module reads. */
export type RunContextRow = { payload: unknown };

/** Everything about a run that lives outside the run row: which builder queue
 *  owns it, whether that builder is up, and the runner's inject-ack. */
export type RunHydrateContext = {
  presence: BuilderChannelPresence;
  /** For the channel fallback below. Omit and the cloud floor applies. */
  project?: ProjectLocus;
  pending?: PendingByRun | null;
  latestEventKind?: string | null;
  ack?: InjectAckByRun | null;
};

/**
 * Stamp queue + presence + ack onto a run snapshot.
 *
 * The ONE place that answers "which builder is this run waiting on, and is it
 * up". Four surfaces ask that question — the inbox row, Watch, Terminal's Loki
 * rail, and Implement's duplicate-guard — and they used to answer it three
 * different ways: the inbox hydrated fully, Terminal kept a stale copy that
 * fell back to "any builder will do", and Watch and the guard hydrated nothing
 * at all, so they could never see an offline builder. That is not cosmetic
 * drift. The guard decides whether to REFUSE a retry, so a run queued on an
 * offline Fleet Runner showed "Needs you — Retry" on the row while Implement
 * answered "Already on this" and blocked the very retry the row asked for.
 */
export function applyRunContext(
  snap: FeedbackRunSnapshot,
  row: RunContextRow,
  ctx: RunHydrateContext,
): FeedbackRunSnapshot {
  snap.latestEventKind = ctx.latestEventKind ?? null;
  const pending = ctx.pending ?? null;
  if (pending) {
    snap.pendingUnclaimed = pending.claimedAt == null;
    // Only ever set true: runToFeedbackSnapshot may already have read a hosted
    // dispatch off the payload, and a non-hosted pending row must not erase it.
    if (pending.type === "hosted_dispatch") snap.hostedPending = true;
    snap.commandId = pending.id;
    snap.builderChannel = pending.channel;
  } else {
    snap.pendingUnclaimed = false;
  }

  const payload = row.payload as {
    commandId?: string;
    hostedDispatchId?: string;
    feedbackAutoRetriedAt?: string;
  } | null;
  if (!snap.commandId && payload?.commandId) snap.commandId = payload.commandId;
  if (payload?.hostedDispatchId) snap.hostedPending = true;
  snap.feedbackAutoRetriedAt = payload?.feedbackAutoRetriedAt ?? null;

  snap.localOnline = ctx.presence.local;
  snap.cloudOnline = ctx.presence.cloud;
  // Channel-aware offline: local queue → need Fleet Runner; cloud → need box.
  // The open pending row is the truth while it exists, but the runner stamps
  // executedAt on its inject-ack, so for most of a run there is no row left to
  // ask and the channel reads back unknown — which fell through to "any builder
  // will do" and reported a local run HEALTHY because the cloud box was up. The
  // project's stored routing decision (locus lock → builder_pref → cloud floor)
  // is the same answer the dispatcher used, so ask it.
  const ch = snap.builderChannel ?? pickDispatchChannel(ctx.project);
  snap.builderChannel = ch;
  snap.builderOffline = ch === "local" ? !ctx.presence.local : !ctx.presence.cloud;

  const ack = ctx.ack;
  if (ack) {
    if (snap.injectVerified == null && ack.verified != null) snap.injectVerified = ack.verified;
    if (!snap.injectWarning && ack.warning) snap.injectWarning = ack.warning;
  }
  return snap;
}
