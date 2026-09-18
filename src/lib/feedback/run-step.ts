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
  /**
   * Queue channel the open pending_commands row is pinned to.
   * Absent/null = legacy unrouted (claimable by either runner) — treat like
   * cloud for copy, but still offer the local CTA when This computer is online.
   */
  channel?: BuilderChannel | null;
  /** Fleet Runner (This computer) presence at attach time. */
  localOnline?: boolean;
  /** Cloud box-runner presence at attach time. */
  cloudOnline?: boolean;
  /**
   * The open run ahead of this one in the project's lane (findQueueBlockers).
   * When set, the command is unclaimed BY DESIGN and no runner is at fault.
   */
  queuedBehind?: { label: string | null } | null;
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
    // An unclaimed command has two very different causes, and only one of them
    // is anybody's fault. The per-project gate withholds a command while an
    // older run for that project is still open — no runner ever sees it, so
    // "confirm Fleet Runner is polling" sends the reader to inspect a healthy
    // machine. Name the run that holds the lane instead.
    if (input.queuedBehind) {
      const ahead = input.queuedBehind.label?.trim();
      return {
        kind: "waiting_builder",
        summary: ahead ? `Waiting its turn behind “${ahead}”` : "Waiting its turn on this project",
        detail:
          "Loki runs one agent per project at a time. This starts by itself when the run ahead of it finishes — nothing to fix, and Retry would only queue a second one.",
      };
    }
    return waitingBuilderStep(input.channel ?? null, input.localOnline, input.cloudOnline);
  }
  return {
    kind: "dispatched",
    summary: KIND_SUMMARY.dispatched,
    detail: null,
  };
}

/** Honest waiting copy: name the queue, and when local is online but the job
 *  is on cloud, say Switch to This computer — not a generic cloud claim. */
function waitingBuilderStep(
  channel: BuilderChannel | null,
  localOnline: boolean | undefined,
  cloudOnline: boolean | undefined,
): RunStepSnapshot {
  if (channel === "local") {
    if (localOnline === false) {
      return {
        kind: "waiting_builder",
        summary: "Open Fleet Runner on This computer",
        detail:
          "This job is on the This computer queue. Open Loki desktop / Fleet Runner to claim it — or Switch Runs on to Cloud.",
      };
    }
    return {
      kind: "waiting_builder",
      summary: "Waiting for This computer to claim",
      detail:
        "Command is on the This computer queue. If this stays put, confirm Fleet Runner is polling — Telegram when it stalls.",
    };
  }

  // cloud channel, or legacy null (either runner could claim)
  if (localOnline === true && cloudOnline !== true) {
    return {
      kind: "waiting_builder",
      summary: "Waiting for cloud builder — Switch to This computer",
      detail:
        "This computer is online, but this job is on the cloud queue. Set project Runs on → This computer (then Retry), or wait for the cloud builder.",
    };
  }
  if (localOnline === true) {
    return {
      kind: "waiting_builder",
      summary: "Waiting for cloud builder to claim",
      detail:
        "Job is on the cloud queue (This computer is also online). Switch Runs on → This computer if you want Fleet Runner to claim it — or wait for cloud.",
    };
  }
  return {
    kind: "waiting_builder",
    summary: "Waiting for cloud builder to claim",
    detail:
      "Command is in the cloud queue. If this stays put, Watch shows why — Telegram when it stalls.",
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
