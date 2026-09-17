/**
 * Developer-comprehensible step for a feedback Implement run.
 *
 * The inbox used to say only "Queued" / "Moving — Telegram when you need to"
 * while the run ledger already knew which hop had happened (dispatched →
 * claimed → launched → submitted → generating → progress). This module turns
 * that ledger into one short line the captain can read, with dig-in for the
 * raw event trail. Model-agnostic: labels come from events, not model prose.
 */
import type { RunEventKind } from "@/db/schema/run-events";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import type { BuilderChannel } from "@/lib/constants/statuses";

export type RunStepSnapshot = {
  kind: RunEventKind | "waiting_builder" | "hosted_queued" | "starting";
  /** One short line — badge companion, not a paragraph. */
  summary: string;
  /** Why / where, for progressive disclosure. */
  detail: string | null;
};

const KIND_SUMMARY: Record<RunEventKind, string> = {
  dispatched: "Queued for a builder",
  claimed: "Builder claimed the job",
  launched: "Cold-starting agent session",
  submitted: "Prompt delivered to agent",
  generating: "Agent is generating",
  progress: "Agent is working",
  blocked: "Agent blocked — needs input",
  handoff: "Agent handed off",
  closed: "Run closed",
  recorded: "Recorded in changelog",
  promoted: "Promoted to OrangeCat",
};

/** Rank so a batch of events collapses to the furthest hop. */
const KIND_RANK: Record<RunEventKind, number> = {
  dispatched: 10,
  claimed: 20,
  launched: 30,
  submitted: 40,
  generating: 50,
  progress: 60,
  blocked: 55,
  handoff: 70,
  closed: 80,
  recorded: 90,
  promoted: 100,
};

export function summarizeRunStep(input: {
  latestKind: RunEventKind | null;
  deliveredAt: string | null;
  lastProgressAt: string | null;
  blocked?: string | null;
  /** Pending command still unclaimed (local or hosted). */
  pendingUnclaimed?: boolean;
  /** Hermes / hosted_dispatch id present. */
  hosted?: boolean;
  /** Which builder this run is waiting on. Default cloud. */
  channel?: BuilderChannel | null;
}): RunStepSnapshot {
  if (input.blocked === "auth") {
    return {
      kind: "blocked",
      summary: "Needs you to sign in",
      detail: "The agent is waiting at a login prompt.",
    };
  }
  if (input.lastProgressAt) {
    return {
      kind: "progress",
      summary: KIND_SUMMARY.progress,
      detail: null,
    };
  }
  if (input.deliveredAt) {
    return {
      kind: "starting",
      summary: "Starting — waiting for first output",
      detail: "Prompt reached the agent; Terminal opens the PTY once it prints.",
    };
  }
  if (input.latestKind && input.latestKind !== "dispatched") {
    return {
      kind: input.latestKind,
      summary: KIND_SUMMARY[input.latestKind],
      detail: null,
    };
  }
  if (input.hosted && input.pendingUnclaimed !== false) {
    return {
      kind: "hosted_queued",
      summary: "Queued on hosted runner (Hermes)",
      detail: "Cloud builder was offline; Hermes will clone and open a PR when it accepts.",
    };
  }
  if (input.pendingUnclaimed !== false) {
    const local = input.channel === "local";
    return {
      kind: "waiting_builder",
      summary: local
        ? EXECUTOR_COPY.loop.waitingForLocal
        : EXECUTOR_COPY.loop.waitingForCloud,
      detail: local
        ? EXECUTOR_COPY.loop.waitingForLocalDetail
        : EXECUTOR_COPY.loop.waitingForCloudDetail,
    };
  }
  return {
    kind: "dispatched",
    summary: KIND_SUMMARY.dispatched,
    detail: null,
  };
}

/** Furthest hop from a list of event kinds (ascending or mixed). */
export function furthestRunEventKind(kinds: RunEventKind[]): RunEventKind | null {
  let best: RunEventKind | null = null;
  let rank = -1;
  for (const k of kinds) {
    const r = KIND_RANK[k] ?? -1;
    if (r > rank) {
      rank = r;
      best = k;
    }
  }
  return best;
}

export function runEventKindLabel(kind: RunEventKind): string {
  return KIND_SUMMARY[kind] ?? kind;
}
