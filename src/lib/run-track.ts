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
 * Second ask, the same day, once the track was live: "how long each step
 * takes or has taken by the moment I'm looking at it", and "clicking on it
 * and seeing what's going on". So every stage carries WHEN it happened and
 * the FACTS behind it (which builder, which pull request, which deploy run,
 * what Loki saw), and stageTimings turns the whens into "took 1m 20s" and a
 * clock on the stage that is happening now.
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
import { commitHeadline, type ChecksState, type RepoProgress } from "@/lib/repo-progress";

export const TRACK_STAGE_IDS = ["asked", "builder", "working", "pr", "merged", "live"] as const;
export type TrackStageId = (typeof TRACK_STAGE_IDS)[number];

/**
 * done: it happened (evidence). now: happening, moves by itself. next: not
 * yet. attention: stopped moving until a person acts. failed: ended without
 * the stage happening.
 */
export type TrackStageState = "done" | "now" | "next" | "attention" | "failed";

/** One thing a person sees when they open a stage. */
export type TrackFact = {
  text: string;
  /** ISO — when this fact happened, shown as a clock time beside it. */
  at?: string | null;
  href?: string | null;
};

export type TrackStage = {
  id: TrackStageId;
  label: string;
  state: TrackStageState;
  /** One short line under the label — what exactly, or why not. */
  note: string | null;
  /** Where to look: the pull request, the live page. */
  href: string | null;
  linkLabel: string | null;
  /** ISO — when the stage happened (done) or began (now). Null when unknown. */
  at: string | null;
  /** What is behind the stage, for the tap that opens it. */
  facts: TrackFact[];
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
  /** ISO of the FIRST event of each kind. */
  eventTimes: Partial<Record<RunEventKind, string>>;
  run: { startedAt: string | null; finishedAt: string | null; outcome: string | null } | null;
  /** When the person asked (prompt history), when known. */
  askedAt: string | null;
  /** The work phase every surface reads (lib/feedback/work-phase). */
  phase: string | null;
  stalled: boolean;
  /** ISO — the runner's last heartbeat that the agent printed something. */
  lastProgressAt: string | null;
  /** The runner can name why the agent is quiet — a login prompt, a question. */
  needsYou: string | null;
  /** Which builder has it, in words ("the cloud builder", "this computer"). */
  builderLabel: string | null;
  /** Repo-side evidence found during or after the run (lib/repo-evidence). */
  evidence: { kind: "pr" | "push"; url: string; title: string; atMs?: number | null } | null;
  /**
   * What the repository shows since the run began (lib/repo-progress): the
   * commits the builder pushed, in its own words, and the pull request with
   * the state of its checks — so "working" has a HOW behind it and "checks"
   * can say running / failed before the fix ledger has caught up.
   */
  repo?: RepoProgress | null;
  /** The fix ledger after the run closed, when one exists. */
  fix: {
    state: FixShipState;
    prUrl: string | null;
    prTitle: string | null;
    prNumber: number | null;
    mergedAt: string | null;
    deploy: { name: string; url: string | null; at: string | null } | null;
    liveUrl: string | null;
    looked: {
      verdict: "looks_fixed" | "not_visible" | "cannot_tell";
      evidence: string | null;
      at: string | null;
    } | null;
  } | null;
  liveUrl: string | null;
  /** The provider the way the person knows it — "Claude Code". */
  providerLabel: string;
  /** Why a failed run stopped, in one sentence (humanizeRunFailure). */
  failure: string | null;
  /**
   * Loki still follows this run to GitHub (lib/run-follow FOLLOW_WINDOW_MS:
   * two days after it ran). Past that nothing is looked up any more, so a
   * stage still waiting on GitHub would wait — and its clock tick — forever.
   * Omitted means yes.
   */
  followable?: boolean;
  /**
   * The project is a preview: what the agent saves in its folder is what the
   * address serves. There is no repository, so no pull request, merge or
   * deploy to wait for — and their absence is not a failure. Center SOM's
   * redesign finished well and its track said "Nothing reached GitHub ·
   * failed" (2026-10-18).
   */
  savedLive?: boolean;
  /** Clock for the one judgement that needs time (PR_LOOK_WINDOW_MS); tests pin it. */
  now?: number;
};

/**
 * How long after the agent finishes "Looking for the pull request" may stay
 * the answer, inside the window Loki still follows a run in. The fix ledger
 * is re-read every few minutes while anyone looks (fixNeedsRefresh); a pull
 * request the agent opened shows up well inside this. Past it, "looking" is
 * no longer true, and a clock on it read as still going (owner's
 * walk-through of the demo, 2026-10-17).
 */
export const PR_LOOK_WINDOW_MS = 30 * 60_000;

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

const iso = (ms: number | null | undefined): string | null =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

/** The input, read once into the handful of facts every stage decides on. */
type Facts = {
  input: RunTrackInput;
  finished: boolean;
  finishedWell: boolean;
  started: boolean;
  generated: boolean;
  /** The agent's session opened, or the request reached it. */
  opened: boolean;
  lastKind: RunEventKind | null;
  ship: FixShipState | null;
  prUrl: string | null;
  prAt: string | null;
  checks: ChecksState | null;
  commits: { message: string; at: string; url: string }[];
  pushed: boolean;
  site: string | null;
  working: boolean;
  provider: string;
  askedAt: string | null;
  startedWorkAt: string | null;
  /** Finished well, but older than the window Loki follows a change in. */
  unfollowed: boolean;
  /** Still followed, finished well, nothing on GitHub, past PR_LOOK_WINDOW_MS. */
  noPrFound: boolean;
};

function readFacts(input: RunTrackInput): Facts {
  const kinds = new Set(input.eventKinds);
  const finished = Boolean(input.run?.finishedAt);
  const outcome = input.run?.outcome ?? null;
  const ship = input.fix?.state ?? null;
  const repo = input.repo ?? null;
  const prUrl =
    input.fix?.prUrl ??
    (input.evidence?.kind === "pr" ? input.evidence.url : null) ??
    repo?.pr?.url ??
    null;
  const commits = repo?.commits ?? [];
  const t = input.eventTimes;
  const finishedWell =
    finished &&
    (outcome === ORCHESTRATION_OUTCOME.SUCCESS || outcome === ORCHESTRATION_OUTCOME.PARTIAL);
  return {
    input,
    finished,
    finishedWell,
    // A run that finished well was run by a builder, whether or not its claim
    // was recorded — seeded and older runs carry no claim event, and "No
    // builder picked it up" above "Claude Code finished" is a contradiction.
    started: [...kinds].some((k) => STARTED.has(k)) || finishedWell,
    unfollowed: finishedWell && input.followable === false,
    noPrFound:
      input.followable !== false && noPrFound(input, prUrl, commits.length > 0, finishedWell),
    generated: [...kinds].some((k) => GENERATED.has(k)),
    opened: [...kinds].some((k) => k === "launched" || k === "submitted" || GENERATED.has(k)),
    lastKind: input.eventKinds.at(-1) ?? null,
    ship,
    prUrl,
    prAt: (input.evidence?.kind === "pr" ? iso(input.evidence.atMs) : null) ?? repo?.pr?.at ?? null,
    checks: repo?.pr?.checks ?? null,
    commits,
    pushed:
      ship === FIX_SHIP_STATE.PUSHED ||
      (!prUrl && (input.evidence?.kind === "push" || commits.length > 0)),
    site: hostOf(input.fix?.liveUrl ?? input.liveUrl),
    working: input.phase === "working" && !input.stalled,
    provider: input.providerLabel,
    askedAt: input.askedAt ?? input.run?.startedAt ?? null,
    startedWorkAt: t.generating ?? t.submitted ?? t.launched ?? t.claimed ?? null,
  };
}

function noPrFound(
  input: RunTrackInput,
  prUrl: string | null,
  committed: boolean,
  finishedWell: boolean,
): boolean {
  const fin = Date.parse(input.run?.finishedAt ?? "");
  return (
    finishedWell &&
    Number.isFinite(fin) &&
    !prUrl &&
    !input.evidence &&
    !committed &&
    !input.fix?.state &&
    (input.now ?? Date.now()) - fin > PR_LOOK_WINDOW_MS
  );
}

const stage = (
  id: TrackStageId,
  label: string,
  state: TrackStageState,
  extra: {
    note?: string | null;
    link?: { href: string; label: string } | null;
    at?: string | null;
    facts?: TrackFact[];
  } = {},
): TrackStage => ({
  id,
  label,
  state,
  note: extra.note ?? null,
  href: extra.link?.href ?? null,
  linkLabel: extra.link?.label ?? null,
  at: extra.at ?? null,
  facts: extra.facts ?? [],
});

function askedStage(f: Facts): TrackStage {
  const to = f.input.builderLabel ? `${f.provider} on ${f.input.builderLabel}` : f.provider;
  return stage("asked", "You asked", "done", {
    at: f.askedAt,
    facts: [{ text: `Sent to ${to}.`, at: f.askedAt }],
  });
}

function builderStage(f: Facts): TrackStage {
  const t = f.input.eventTimes;
  const who = f.input.builderLabel ?? "A builder";
  const facts: TrackFact[] = [];
  if (t.claimed) facts.push({ text: `${who} claimed the job.`, at: t.claimed });
  if (t.launched) facts.push({ text: `Opened an agent session.`, at: t.launched });
  if (t.submitted)
    facts.push({ text: `Delivered your request to ${f.provider}.`, at: t.submitted });
  if (f.started)
    return stage("builder", `${who.charAt(0).toUpperCase()}${who.slice(1)} picked it up`, "done", {
      at: t.claimed ?? t.launched ?? t.submitted ?? t.generating ?? t.progress ?? null,
      facts,
    });
  // The reason is the card's headline (summaryOf); saying it twice, one line
  // apart, is what the first preview showed.
  if (f.finished) return stage("builder", "No builder picked it up", "failed", { at: f.askedAt });
  if (f.input.stalled)
    return stage("builder", "Waiting for a builder", "attention", {
      note: "Nobody has picked it up for a while.",
      at: f.askedAt,
      facts: [{ text: "Builders claim work every few seconds; a long wait means none is online." }],
    });
  return stage("builder", "Waiting for a builder", "now", {
    note: "Usually under a minute.",
    at: f.askedAt,
    facts: [{ text: "The job is on the queue; the next free builder claims it." }],
  });
}

/** The newest few commits, in the builder's words; a run that pushed twenty
 *  does not need twenty rows. */
const COMMITS_SHOWN = 3;

function commitFacts(commits: Facts["commits"]): TrackFact[] {
  const shown = commits.slice(-COMMITS_SHOWN);
  const hidden = commits.length - shown.length;
  const out: TrackFact[] = [];
  if (hidden > 0)
    out.push({ text: `Pushed ${hidden} earlier ${hidden === 1 ? "commit" : "commits"}.` });
  for (const c of shown)
    out.push({ text: `Pushed: ${commitHeadline(c.message)}`, at: c.at, href: c.url });
  return out;
}

function workingStage(f: Facts): TrackStage {
  const p = f.provider;
  const t = f.input.eventTimes;
  const facts: TrackFact[] = [];
  if (t.generating) facts.push({ text: `${p} started working.`, at: t.generating });
  facts.push(...commitFacts(f.commits));
  if (f.input.lastProgressAt)
    facts.push({ text: "Last output on its screen.", at: f.input.lastProgressAt });
  if (t.handoff) facts.push({ text: `${p} handed the work back.`, at: t.handoff });
  // A pull request exists but the agent is still in the session: it is
  // wrapping up (final checks, the handoff). Without this the live track had
  // no stage marked "now" at all, and a running agent read as idle.
  if ((f.prUrl || f.pushed) && !f.finished)
    return stage("working", `${p} is finishing up`, "now", {
      note: "The change is pushed; it is doing its final checks.",
      at: f.startedWorkAt,
      facts,
    });
  if (f.prUrl || f.pushed)
    return stage("working", `${p} made the change`, "done", {
      at: f.prAt ?? t.handoff ?? f.input.run?.finishedAt ?? null,
      facts,
    });
  if (f.finished)
    return f.finishedWell
      ? stage("working", `${p} finished`, "done", {
          at: t.handoff ?? f.input.run?.finishedAt ?? null,
          facts,
        })
      : stage(
          "working",
          // Nothing opened and nothing was delivered: the agent never ran, so
          // "stopped" (the owner's screen on 2026-10-20, for a Grok the cloud
          // builder does not have) claimed a start that did not happen.
          f.opened ? `${p} stopped` : `${p} could not start`,
          "failed",
          { at: f.input.run?.finishedAt ?? null, facts },
        );
  if (!f.started) return stage("working", `${p} makes the change`, "next");
  if (f.input.needsYou || f.lastKind === "blocked")
    return stage("working", `${p} needs you`, "attention", {
      note: f.input.needsYou ?? "It is waiting for an answer.",
      at: t.blocked ?? f.startedWorkAt,
      facts,
    });
  if (f.input.stalled)
    return stage("working", `${p} went quiet`, "attention", {
      note: "No output for a while — it may be stuck.",
      at: f.startedWorkAt,
      facts,
    });
  const busy = f.working || f.generated;
  return stage("working", busy ? `${p} is making the change` : `${p} is starting`, "now", {
    note: busy ? null : "The agent is opening the project.",
    at: f.startedWorkAt,
    facts,
  });
}

function prStage(f: Facts): TrackStage {
  const ev = f.input.evidence;
  const fix = f.input.fix;
  if (f.prUrl) {
    const title = fix?.prTitle ?? (ev?.kind === "pr" ? ev.title : null) ?? f.input.repo?.pr?.title;
    const number = fix?.prNumber ?? f.input.repo?.pr?.number;
    return stage("pr", "Pull request opened", "done", {
      note: title ? (number ? `#${number} · ${title}` : title) : null,
      link: { href: f.prUrl, label: "See the change" },
      at: f.prAt,
      facts: [
        {
          text: "The change is on a branch of its own, so nothing on the site moves until it is checked.",
        },
        ...(f.prAt ? [{ text: "Opened.", at: f.prAt }] : []),
      ],
    });
  }
  if (f.pushed)
    return stage("pr", "Pushed to a branch", f.finished ? "attention" : "now", {
      note: f.finished
        ? "No pull request was opened, so it cannot merge by itself."
        : "A pull request usually follows in a moment.",
      link: ev?.kind === "push" ? { href: ev.url, label: "See the branch" } : null,
      at: ev?.kind === "push" ? iso(ev.atMs) : null,
    });
  if (f.finishedWell && f.ship === FIX_SHIP_STATE.NO_EVIDENCE)
    return stage("pr", "Nothing reached GitHub", "failed", {
      note: "The agent finished, but no branch or pull request was found.",
      at: f.input.run?.finishedAt ?? null,
    });
  if (f.noPrFound)
    return stage("pr", "No pull request found", "attention", {
      note: "The agent finished, but Loki found no pull request for it — open the run to see what it left.",
      // No time: a stage that will not move must not carry a running clock.
      at: null,
    });
  if (f.finishedWell)
    return stage("pr", "Looking for the pull request", "now", {
      note: "Checking GitHub.",
      at: f.input.run?.finishedAt ?? null,
    });
  return stage("pr", "Pull request", "next");
}

function mergedStage(f: Facts): TrackStage {
  const fix = f.input.fix;
  if (f.ship && MERGED_STATES.has(f.ship))
    return stage("merged", "Checks passed and merged", "done", {
      at: fix?.mergedAt ?? null,
      facts: [
        { text: "Every check on the pull request passed." },
        { text: "Merged into the main branch.", at: fix?.mergedAt ?? null },
      ],
    });
  if (f.ship === FIX_SHIP_STATE.PR_CLOSED)
    return stage("merged", "Closed without merging", "failed", {
      note: "The pull request was closed, so nothing shipped.",
    });
  const checksLink = f.prUrl ? `${f.prUrl}/checks` : null;
  if (f.checks === "failed" && f.prUrl)
    return stage("merged", "A check failed", "attention", {
      note: f.finished
        ? "It cannot merge until the check passes — open the pull request to see which."
        : "The agent usually sees it and fixes it; it cannot merge until the check passes.",
      link: checksLink ? { href: checksLink, label: "See the checks" } : null,
      at: f.prAt,
      facts: [{ text: "One of the checks on the pull request came back red.", href: checksLink }],
    });
  if (f.checks === "passed" && f.prUrl)
    return stage("merged", "Checks passed — merging", "now", {
      note: "Every check is green; it merges by itself in the next sweep.",
      at: f.prAt,
      facts: [{ text: "Every check on the pull request passed.", href: checksLink }],
    });
  if (f.ship === FIX_SHIP_STATE.PR_OPEN || (f.checks === "running" && f.prUrl))
    return stage("merged", "Checks running", "now", {
      note: "It merges by itself once they pass.",
      at: f.prAt,
      facts: [
        {
          text: "Tests, lint and a build run on the change; a green result merges it with nobody pressing a button.",
          href: f.prUrl ? `${f.prUrl}/checks` : null,
        },
      ],
    });
  return stage("merged", "Checks and merge", "next");
}

function liveStage(f: Facts): TrackStage {
  const fix = f.input.fix;
  const label = f.site ? `Live on ${f.site}` : "Live";
  const url = fix?.liveUrl ?? f.input.liveUrl;
  const deployFact: TrackFact[] = fix?.deploy
    ? [
        {
          text: `Deploy run: ${fix.deploy.name}.`,
          at: fix.deploy.at,
          href: fix.deploy.url,
        },
      ]
    : [];
  if (f.ship === FIX_SHIP_STATE.DEPLOYED) {
    const looked = fix?.looked ?? null;
    return stage("live", label, "done", {
      note: looked
        ? LOOKED_NOTE[looked.verdict]
        : f.site
          ? "Loki is opening the live page to check."
          : null,
      link: url ? { href: url, label: "Open the live page" } : null,
      at: fix?.deploy?.at ?? looked?.at ?? null,
      facts: [
        ...deployFact,
        ...(looked?.evidence ? [{ text: looked.evidence, at: looked.at }] : []),
      ],
    });
  }
  if (f.ship === FIX_SHIP_STATE.DEPLOY_FAILED)
    return stage("live", "The deploy failed", "failed", {
      note: "Merged, but the site did not take the new build.",
      at: fix?.deploy?.at ?? null,
      facts: deployFact,
    });
  if (f.ship === FIX_SHIP_STATE.MERGED || f.ship === FIX_SHIP_STATE.DEPLOYING)
    return stage("live", "Deploying", "now", {
      note: f.site ? `${f.site} gets the new build in a few minutes.` : "A few minutes.",
      at: fix?.mergedAt ?? null,
      facts: deployFact.length
        ? deployFact
        : [{ text: "The build runs on GitHub, then the box swaps to it and health-checks." }],
    });
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
  if (f.checks === "failed" && f.prUrl)
    return f.finished
      ? "A check failed on the pull request — it cannot merge until that passes."
      : `A check failed on the pull request — ${p} usually fixes it.`;
  if (f.checks === "passed" && f.prUrl) return "Checks passed — it merges and deploys by itself.";
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
      : f.noPrFound
        ? `${p} finished, but no pull request was found.`
        : `${p} finished — checking where the change is.`;
  if (f.finished) return f.input.failure ?? `${p} stopped before the change shipped.`;
  if (work.state === "attention") return work.note ?? `${p} needs you.`;
  if (builder.state === "attention") return "Sent, but no builder has picked it up.";
  if (f.working || f.generated) return `${p} is making the change.`;
  if (f.started) return `${p} is starting.`;
  return "Waiting for a builder to pick it up — usually under a minute.";
}

/** What a stage that was still moving reads once nobody follows it any more. */
const STALE_LABEL: Partial<Record<TrackStageId, string>> = {
  pr: "No pull request on record",
  merged: "Merge not on record",
  live: "Deploy not on record",
};

export function buildRunTrack(input: RunTrackInput): RunTrack {
  const f = readFacts(input);
  const builder = builderStage(f);
  const work = workingStage(f);
  if (input.savedLive) return savedLiveTrack(f, builder, work);
  const stages = [askedStage(f), builder, work, prStage(f), mergedStage(f), liveStage(f)];

  // Past the window Loki follows a change in, nothing will be looked up again:
  // a stage still "happening" would happen — and its clock tick — forever.
  // Say what is on record, mark the rest not followed, and stop asking.
  const stale = f.unfollowed && stages.some((st) => st.state === "now");
  if (stale) {
    for (const st of stages)
      if (st.state === "now") {
        st.state = "next";
        // "Looking for the pull request" over "Not followed" says two things.
        st.label = STALE_LABEL[st.id] ?? st.label;
        st.note = "Not followed — Loki follows a change for two days after its run.";
        st.at = null;
      }
  }

  const settled =
    stale ||
    (f.ship === FIX_SHIP_STATE.DEPLOYED && (Boolean(input.fix?.looked) || !f.site)) ||
    f.ship === FIX_SHIP_STATE.PR_CLOSED ||
    (f.finished && !f.finishedWell) ||
    (f.finishedWell && f.ship === FIX_SHIP_STATE.NO_EVIDENCE) ||
    f.noPrFound ||
    (f.finishedWell && f.pushed);

  const current =
    stages.find((s) => s.state === "failed" || s.state === "attention" || s.state === "now")?.id ??
    [...stages].reverse().find((s) => s.state === "done")?.id ??
    "asked";

  const summary = stale
    ? `${f.prUrl ? "Pull request opened" : `${f.provider} finished`} — this ran more than two days ago, so what happened after is not on record here.`
    : summaryOf(f, builder, work);
  return { stages, summary, settled, current };
}

/** A preview's track: asked → builder → working → live, nothing in between. */
function savedLiveTrack(f: Facts, builder: TrackStage, work: TrackStage): RunTrack {
  const site = f.site ?? "the preview";
  const url = f.input.liveUrl;
  const live = f.finishedWell
    ? stage("live", `Live on ${site}`, "done", {
        note: "A preview has no pull request: what the agent saved is what the address serves.",
        link: url ? { href: url, label: "Open it" } : null,
        at: f.input.run?.finishedAt ?? null,
      })
    : stage("live", `Live on ${site}`, "next");
  const stages = [askedStage(f), builder, work, live];
  const current =
    stages.find((s) => s.state === "failed" || s.state === "attention" || s.state === "now")?.id ??
    [...stages].reverse().find((s) => s.state === "done")?.id ??
    "asked";
  const summary = f.finishedWell
    ? `Live on ${site} — ${f.provider} saved the change, and the address serves it.`
    : summaryOf(f, builder, work);
  return { stages, summary, settled: f.finished, current };
}

// ── Timing ─────────────────────────────────────────────────────────────────

export type StageTiming = {
  /** Seconds from the previous timed stage to this one — "took 1m 20s". */
  took: number | null;
  /** Seconds this stage has been the current one — the clock. */
  soFar: number | null;
};

/**
 * Pure, and client-safe: the page calls it every second for the stage that
 * is happening now. A "took" needs two timestamps; a stage with none, or the
 * first one, shows nothing rather than a guess. Clock time is never shown
 * for the ask itself — "took" there would be the time before the person
 * pressed send, which is theirs, not the system's.
 */
export function stageTimings(stages: TrackStage[], now: number = Date.now()): StageTiming[] {
  let prev: number | null = null;
  return stages.map((s) => {
    const at = s.at ? Date.parse(s.at) : NaN;
    const has = Number.isFinite(at);
    const timing: StageTiming = { took: null, soFar: null };
    if (s.state === "done" && has && prev !== null && s.id !== "asked")
      timing.took = Math.max(0, Math.round((at - prev) / 1000));
    if ((s.state === "now" || s.state === "attention") && has)
      timing.soFar = Math.max(0, Math.round((now - at) / 1000));
    if (has) prev = at;
    return timing;
  });
}

/** "1m 20s", "48s", "1h 03m" — short enough for a column on a phone. */
export function formatStageSeconds(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  if (seconds >= 60)
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}
