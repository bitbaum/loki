/**
 * The delivery track — where a dispatched change IS, on the one road every
 * change travels: asked → a builder has it → the agent works → a pull
 * request → merged → live.
 *
 * Asked for on 2026-10-17. The owner sent a one-line change from a phone,
 * watched "Claude Code is working · started just now" with a narrated
 * headline that paraphrased the request, and did not believe it: "I'm not
 * sure if it's being done or not, and I don't really have faith in it." The
 * facts that would have settled it existed — the run ledger knew a builder
 * had claimed the job, GitHub knew a branch and a pull request had appeared
 * six minutes in, the fix ledger knew when it merged and deployed — but Watch
 * never put them on one line the person could read top to bottom.
 *
 * This is the pure half: run events, the fix ledger (lib/feedback/fix-shipping)
 * and repo evidence in, a fixed list of stages out, each one done / now /
 * next / needs-you / failed, with one plain sentence for the whole. The API
 * route computes it on the server; the page only draws it. Nothing here
 * guesses: a stage is "done" only on evidence (an event, a URL on GitHub, a
 * deploy run), never because time has passed.
 */
import type { RunEventKind } from "@/db/schema/run-events";
import { FIX_SHIP_STATE, type FixShipState } from "@/lib/feedback/fix-shipping";
import { ORCHESTRATION_OUTCOME } from "@/lib/orchestration/contract";

export const TRACK_STAGE_IDS = ["asked", "builder", "working", "pr", "merged", "live"] as const;
export type TrackStageId = (typeof TRACK_STAGE_IDS)[number];

/**
 * done: it happened (evidence). now: happening, moves by itself. next: not
 * yet. attention: stopped moving until a person acts. failed: ended without
 * the stage happening.
 */
export type TrackStageState = "done" | "now" | "next" | "attention" | "failed";

export type TrackStage = {
  id: TrackStageId;
  label: string;
  state: TrackStageState;
  /** One short line under the label — what exactly, or why not. */
  note: string | null;
  /** Where to look: the pull request, the live page. */
  href: string | null;
  linkLabel: string | null;
};

export type RunTrack = {
  stages: TrackStage[];
  /** The one sentence for the whole road, as the person would say it. */
  summary: string;
  /** Nothing will change any more: the page can stop asking. */
  settled: boolean;
  /** Quick index for the page: the stage marked now/attention/failed, or the
   *  last done one. */
  current: TrackStageId;
};

export type RunTrackInput = {
  eventKinds: RunEventKind[];
  run: { finishedAt: string | null; outcome: string | null } | null;
  /** The work phase every surface reads (lib/feedback/work-phase). */
  phase: string | null;
  stalled: boolean;
  /** The runner can name why the agent is quiet — a login prompt, a question. */
  needsYou: string | null;
  /** Repo-side evidence found during or after the run (lib/repo-evidence). */
  evidence: { kind: "pr" | "push"; url: string; title: string } | null;
  /** The fix ledger after the run closed, when one exists. */
  fix: {
    state: FixShipState;
    prUrl: string | null;
    liveUrl: string | null;
    looked: { verdict: "looks_fixed" | "not_visible" | "cannot_tell" } | null;
  } | null;
  liveUrl: string | null;
  /** The provider the way the person knows it — "Claude Code". */
  providerLabel: string;
  /** Why a failed run stopped, in one sentence (humanizeRunFailure). */
  failure: string | null;
};

const STARTED: ReadonlySet<RunEventKind> = new Set([
  "claimed",
  "launched",
  "submitted",
  "generating",
  "progress",
  "blocked",
  "handoff",
]);
const GENERATED: ReadonlySet<RunEventKind> = new Set(["generating", "progress", "handoff"]);
const MERGED_STATES: ReadonlySet<FixShipState> = new Set([
  FIX_SHIP_STATE.MERGED,
  FIX_SHIP_STATE.DEPLOYING,
  FIX_SHIP_STATE.DEPLOYED,
  FIX_SHIP_STATE.DEPLOY_FAILED,
]);

/** "petvity.orangecat.ch" from "https://petvity.orangecat.ch/" — the site as a person says it. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const LOOKED_NOTE: Record<"looks_fixed" | "not_visible" | "cannot_tell", string> = {
  looks_fixed: "Loki opened the live page — the change shows.",
  not_visible: "Loki opened the live page — the change does not show yet.",
  cannot_tell: "Loki opened the live page — could not tell from here.",
};

/** The input, read once into the handful of facts every stage decides on. */
type Facts = {
  input: RunTrackInput;
  finished: boolean;
  finishedWell: boolean;
  started: boolean;
  generated: boolean;
  lastKind: RunEventKind | null;
  ship: FixShipState | null;
  prUrl: string | null;
  pushed: boolean;
  site: string | null;
  working: boolean;
  provider: string;
};

function readFacts(input: RunTrackInput): Facts {
  const kinds = new Set(input.eventKinds);
  const finished = Boolean(input.run?.finishedAt);
  const outcome = input.run?.outcome ?? null;
  const ship = input.fix?.state ?? null;
  const prUrl =
    input.fix?.prUrl ?? (input.evidence?.kind === "pr" ? input.evidence.url : null) ?? null;
  return {
    input,
    finished,
    finishedWell:
      finished &&
      (outcome === ORCHESTRATION_OUTCOME.SUCCESS || outcome === ORCHESTRATION_OUTCOME.PARTIAL),
    started: [...kinds].some((k) => STARTED.has(k)),
    generated: [...kinds].some((k) => GENERATED.has(k)),
    lastKind: input.eventKinds.at(-1) ?? null,
    ship,
    prUrl,
    pushed: ship === FIX_SHIP_STATE.PUSHED || (!prUrl && input.evidence?.kind === "push"),
    site: hostOf(input.fix?.liveUrl ?? input.liveUrl),
    working: input.phase === "working" && !input.stalled,
    provider: input.providerLabel,
  };
}

const stage = (
  id: TrackStageId,
  label: string,
  state: TrackStageState,
  note: string | null = null,
  link: { href: string; label: string } | null = null,
): TrackStage => ({
  id,
  label,
  state,
  note,
  href: link?.href ?? null,
  linkLabel: link?.label ?? null,
});

function builderStage(f: Facts): TrackStage {
  if (f.started) return stage("builder", "A builder picked it up", "done");
  // The reason is the card's headline (summaryOf); saying it twice, one line
  // apart, is what the first preview showed.
  if (f.finished) return stage("builder", "No builder picked it up", "failed");
  if (f.input.stalled)
    return stage(
      "builder",
      "Waiting for a builder",
      "attention",
      "Nobody has picked it up for a while.",
    );
  return stage("builder", "Waiting for a builder", "now", "Usually under a minute.");
}

function workingStage(f: Facts): TrackStage {
  const p = f.provider;
  if (f.prUrl || f.pushed) return stage("working", `${p} made the change`, "done");
  if (f.finished)
    return f.finishedWell
      ? stage("working", `${p} finished`, "done")
      : stage("working", `${p} stopped`, "failed");
  if (!f.started) return stage("working", `${p} makes the change`, "next");
  if (f.input.needsYou || f.lastKind === "blocked")
    return stage(
      "working",
      `${p} needs you`,
      "attention",
      f.input.needsYou ?? "It is waiting for an answer.",
    );
  if (f.input.stalled)
    return stage(
      "working",
      `${p} went quiet`,
      "attention",
      "No output for a while — it may be stuck.",
    );
  const busy = f.working || f.generated;
  return stage(
    "working",
    busy ? `${p} is making the change` : `${p} is starting`,
    "now",
    busy ? null : "The agent is opening the project.",
  );
}

function prStage(f: Facts): TrackStage {
  const ev = f.input.evidence;
  if (f.prUrl)
    return stage(
      "pr",
      "Pull request opened",
      "done",
      f.input.fix?.prUrl ? null : (ev?.title ?? null),
      { href: f.prUrl, label: "See the change" },
    );
  if (f.pushed)
    return stage(
      "pr",
      "Pushed to a branch",
      f.finished ? "attention" : "now",
      f.finished
        ? "No pull request was opened, so it cannot merge by itself."
        : "A pull request usually follows in a moment.",
      ev?.kind === "push" ? { href: ev.url, label: "See the branch" } : null,
    );
  if (f.finishedWell && f.ship === FIX_SHIP_STATE.NO_EVIDENCE)
    return stage(
      "pr",
      "Nothing reached GitHub",
      "failed",
      "The agent finished, but no branch or pull request was found.",
    );
  if (f.finishedWell) return stage("pr", "Looking for the pull request", "now", "Checking GitHub.");
  return stage("pr", "Pull request", "next");
}

function mergedStage(f: Facts): TrackStage {
  if (f.ship && MERGED_STATES.has(f.ship))
    return stage("merged", "Checks passed and merged", "done");
  if (f.ship === FIX_SHIP_STATE.PR_CLOSED)
    return stage(
      "merged",
      "Closed without merging",
      "failed",
      "The pull request was closed, so nothing shipped.",
    );
  if (f.ship === FIX_SHIP_STATE.PR_OPEN)
    return stage("merged", "Checks running", "now", "It merges by itself once they pass.");
  return stage("merged", "Checks and merge", "next");
}

function liveStage(f: Facts): TrackStage {
  const label = f.site ? `Live on ${f.site}` : "Live";
  const url = f.input.fix?.liveUrl ?? f.input.liveUrl;
  if (f.ship === FIX_SHIP_STATE.DEPLOYED)
    return stage(
      "live",
      label,
      "done",
      f.input.fix?.looked
        ? LOOKED_NOTE[f.input.fix.looked.verdict]
        : f.site
          ? "Loki is opening the live page to check."
          : null,
      url ? { href: url, label: "Open the live page" } : null,
    );
  if (f.ship === FIX_SHIP_STATE.DEPLOY_FAILED)
    return stage(
      "live",
      "The deploy failed",
      "failed",
      "Merged, but the site did not take the new build.",
    );
  if (f.ship === FIX_SHIP_STATE.MERGED || f.ship === FIX_SHIP_STATE.DEPLOYING)
    return stage(
      "live",
      "Deploying",
      "now",
      f.site ? `${f.site} gets the new build in a few minutes.` : "A few minutes.",
    );
  return stage("live", label, "next");
}

/** The one sentence: the furthest point the change has reached, or why it stopped. */
function summaryOf(f: Facts, builder: TrackStage, work: TrackStage): string {
  const site = f.site ?? "the site";
  const p = f.provider;
  const verdict = f.input.fix?.looked?.verdict;
  switch (f.ship) {
    case FIX_SHIP_STATE.DEPLOYED:
      if (verdict === "looks_fixed") return `Live on ${site} — Loki checked, and the change shows.`;
      if (verdict === "not_visible")
        return `Live on ${site}, but Loki could not see the change yet.`;
      return `Live on ${site}.`;
    case FIX_SHIP_STATE.DEPLOY_FAILED:
      return "Merged, but the deploy failed.";
    case FIX_SHIP_STATE.MERGED:
    case FIX_SHIP_STATE.DEPLOYING:
      return `Merged — deploying to ${site} now, usually a few minutes.`;
    case FIX_SHIP_STATE.PR_CLOSED:
      return "The pull request was closed without merging — nothing shipped.";
    default:
      break;
  }
  if (f.prUrl)
    return f.finished
      ? "Pull request open — checks run, then it merges and deploys by itself."
      : `Pull request open — ${p} is finishing up.`;
  if (f.pushed)
    return f.finished
      ? "Pushed to a branch, but no pull request — it cannot ship by itself."
      : "Pushed to a branch — a pull request usually follows.";
  if (f.finishedWell)
    return f.ship === FIX_SHIP_STATE.NO_EVIDENCE
      ? "The agent finished, but nothing reached GitHub."
      : `${p} finished — checking where the change is.`;
  if (f.finished) return f.input.failure ?? `${p} stopped before the change shipped.`;
  if (work.state === "attention") return work.note ?? `${p} needs you.`;
  if (builder.state === "attention") return "Sent, but no builder has picked it up.";
  if (f.working || f.generated) return `${p} is making the change.`;
  if (f.started) return `${p} is starting.`;
  return "Waiting for a builder to pick it up — usually under a minute.";
}

export function buildRunTrack(input: RunTrackInput): RunTrack {
  const f = readFacts(input);
  const builder = builderStage(f);
  const work = workingStage(f);
  const stages = [
    stage("asked", "You asked", "done"),
    builder,
    work,
    prStage(f),
    mergedStage(f),
    liveStage(f),
  ];

  const settled =
    (f.ship === FIX_SHIP_STATE.DEPLOYED && (Boolean(input.fix?.looked) || !f.site)) ||
    f.ship === FIX_SHIP_STATE.PR_CLOSED ||
    (f.finished && !f.finishedWell) ||
    (f.finishedWell && f.ship === FIX_SHIP_STATE.NO_EVIDENCE) ||
    (f.finishedWell && f.pushed);

  const current =
    stages.find((s) => s.state === "failed" || s.state === "attention" || s.state === "now")?.id ??
    [...stages].reverse().find((s) => s.state === "done")?.id ??
    "asked";

  return { stages, summary: summaryOf(f, builder, work), settled, current };
}
