/**
 * What Control shows first: the work being done for you now, and what got
 * done — in words, each one a tap from the live session.
 *
 * Built for the person who just wants to see their thing being made
 * (2026-10-17: "When I see Building, I tap it and expect to see how it's
 * building — the chat or the terminal. Here there is just so much."). The
 * old top of the page reported the machinery: a builder sync line, three
 * counters, a raw prompt log. This reads the same project states and says
 * what each job is, what it is doing right now, and where to watch it.
 *
 * Pure: snapshots in, view model out. ControlNow renders it.
 */
import { STATE_DEFINITIONS } from "@/lib/control-states";
import { CANONICAL_LABEL, CANONICAL_STATE } from "@/lib/feedback/canonical-status";
import { describeRunShipping } from "@/lib/control-run-shipping";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { isRunProgressFresh } from "@/lib/run-progress";
import { intentTitle } from "@/lib/task-title";
import type { ProjectState } from "@/lib/control-types";
import type { ProjectOperationsSnapshot } from "./control-presenter";

/** A run sent this long ago that never reported a step has not been picked
 *  up: it is waiting on a builder, not being built. */
export const NOT_PICKED_UP_MS = 30 * 60_000;

/** A finished run stays in "Done" this long. */
export const DONE_WINDOW_MS = 24 * 60 * 60_000;
export const DONE_MAX = 6;

export type NowJob = {
  tab: string;
  title: string;
  /** "working": doing it. "you": waiting for your answer or a sign-in.
   *  "quiet": a run that has not reported for a while. */
  tone: "working" | "you" | "quiet";
  /** One line of what is happening — the agent's current step when known.
   *  On a "you" row it is the canonical state word, "Needs you", once
   *  (RUN-STATUS-SSOT): the row read "Waiting for you · Waiting for your
   *  answer" and never said what answer (owner, 2026-11-12). */
  status: string;
  /** On a "you" row: what is needed, in one line — the agent's question
   *  (blockReason, else its `next`), the permission it asks for, or the
   *  sign-in it waits on. Null on every other row. */
  question: string | null;
  /** The agent is idle at its prompt waiting for an answer, so a typed reply
   *  can go straight to it (/api/inject on `tab`). False where the answer is
   *  a keypress in a dialog or a sign-in: those are answered in the session
   *  the row opens. */
  reply: boolean;
  /** When the work started (ms), for "12 min". */
  since: number | null;
  /** The live session, in the conversation view. */
  href: string;
};

export type DoneJob = {
  key: string;
  tab: string;
  title: string;
  tone: "good" | "partial" | "bad";
  /** What came of it, in one line. */
  result: string;
  /** The row's headline: what was done, in the agent's words, else what was asked. */
  headline: string;
  /** How it ended: "#12 merged and deployed", "Stopped with an error". */
  outcome: string;
  at: number;
  /** Where to look at it. The first is the main one. */
  links: { label: string; href: string; external?: boolean }[];
};

type Run = NonNullable<ProjectState["latestOrchestrationRun"]>;

/** The live session for a project (and run), opened as a conversation. */
export function sessionHref(project: ProjectState, run: Run | null): string {
  const tab = run?.sessionTab || project.tab;
  const q = new URLSearchParams({ project: tab, view: "chat" });
  if (run?.id && !run.finishedAt) q.set("run", run.id);
  return `/terminal?${q.toString()}`;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function runTitle(project: ProjectState, run: Run | null): string {
  if (run?.title) return run.title;
  if (run?.intent) return intentTitle(run.intent);
  return project.currentPrompt?.label || `Working on ${project.tab}`;
}

export function buildNowJobs(
  snapshots: readonly ProjectOperationsSnapshot[],
  nowMs: number,
): NowJob[] {
  const jobs: NowJob[] = [];
  for (const s of snapshots) {
    const project = s.project;
    const run = project.latestOrchestrationRun;
    const openRun = run && !run.finishedAt ? run : null;
    const category = STATE_DEFINITIONS[s.phase].counterCategory;
    const awaiting = s.phase === "awaiting_you";
    if (category !== "working" && !awaiting && !openRun) continue;

    const since =
      parseMs(openRun?.startedAt) ??
      (project.liveAgentTurns ? parseMs(project.liveAgentTurns.startedAt) : null) ??
      (project.currentPrompt?.startedAt ? project.currentPrompt.startedAt * 1000 : null);
    const fresh = isRunProgressFresh(openRun?.lastProgressAt, nowMs);
    const step = openRun?.lastStep?.text;

    let tone: NowJob["tone"] = "working";
    let status: string;
    let question: string | null = null;
    let reply = false;
    const title = runTitle(project, openRun ?? run);
    // Every "you" row says the canonical word once, then what is needed.
    const needsYou = CANONICAL_LABEL[CANONICAL_STATE.NEEDS_YOU];
    if (openRun?.blocked === "auth") {
      tone = "you";
      status = needsYou;
      question = "Someone has to sign the agent in";
    } else if (openRun?.blocked === "exited") {
      tone = "you";
      status = needsYou;
      question = oneLine(openRun.blockedQuestion) ?? "The agent stopped — try again";
    } else if (openRun?.blocked === "permission") {
      tone = "you";
      status = needsYou;
      const asked = oneLine(openRun.blockedQuestion);
      question = asked ? `It asks: ${asked}` : "It asks permission to run a tool";
    } else if (awaiting) {
      tone = "you";
      status = needsYou;
      question = awaitedQuestion(project, run);
      reply = true;
    } else if (category === "working") {
      status = step && (fresh || !openRun?.lastProgressAt) ? step : "Working on it";
    } else if (openRun && openRun.lastProgressAt && !fresh) {
      // Say what it is waiting on, with when it was last heard from: "No
      // update for a while" under three rows told the owner nothing, and it
      // sat under "Being built" though nothing was (2026-10-22). Home lists
      // these under "Gone quiet".
      tone = "quiet";
      const heard = elapsedLabel(parseMs(openRun.lastProgressAt), nowMs);
      status = heard ? `No word from the agent for ${heard}` : "No word from the agent";
    } else if (openRun && !step && since !== null && nowMs - since > NOT_PICKED_UP_MS) {
      // Sent long ago and never reported a step: no builder took it.
      tone = "quiet";
      status = "Waiting for a runner to pick it up";
    } else if (openRun) {
      // Sent, and not yet reporting: picked up, or still on its way.
      status = step ?? "Starting";
    } else {
      continue;
    }

    jobs.push({
      tab: project.tab,
      title,
      tone,
      status,
      question,
      reply,
      since,
      href: sessionHref(project, openRun),
    });
  }
  // What needs you first, then the newest work.
  const rank = { you: 0, working: 1, quiet: 2 } as const;
  return jobs.sort((a, b) => rank[a.tone] - rank[b.tone] || (b.since ?? 0) - (a.since ?? 0));
}

const OUTCOME_WORDS: Record<string, { tone: DoneJob["tone"]; text: string }> = {
  success: { tone: "good", text: "Done" },
  partial: { tone: "partial", text: "Partly done" },
  error: { tone: "bad", text: "Stopped with an error" },
  hang: { tone: "bad", text: "Stopped responding" },
  timeout: { tone: "bad", text: "Ran out of time" },
  user_abort: { tone: "partial", text: "Stopped by you" },
  unconfirmed: { tone: "partial", text: "Finished — not confirmed" },
};

export function buildDoneJobs(
  snapshots: readonly ProjectOperationsSnapshot[],
  nowMs: number,
): DoneJob[] {
  const done: DoneJob[] = [];
  for (const s of snapshots) {
    const project = s.project;
    const run = project.latestOrchestrationRun;
    const at = parseMs(run?.finishedAt);
    if (!run || at === null || nowMs - at > DONE_WINDOW_MS) continue;

    const words = OUTCOME_WORDS[run.outcome ?? ""] ?? { tone: "good", text: "Finished" };
    const shipped = describeRunShipping(run.payload?.fix);
    const said = run.summary?.done?.trim();
    const result = shipped ?? (said ? clip(said) : words.text);

    const links: DoneJob["links"] = [];
    const site = project.profile?.url?.trim();
    if (site && /^https?:\/\//.test(site))
      links.push({ label: "Open the site", href: site, external: true });
    const change = run.payload?.fix?.prUrl ?? run.payload?.evidence?.url;
    if (change) links.push({ label: "See the change", href: change, external: true });
    links.push({
      label: words.tone === "bad" && !shipped ? "See what happened" : "See the conversation",
      href: sessionHref(project, run),
    });

    done.push({
      key: run.id ?? `${project.tab}:${run.finishedAt}`,
      tab: project.tab,
      title: runTitle(project, run),
      // What was done, in the agent's words; else what was asked. The
      // outcome ("#12 merged and deployed", "Stopped with an error") is the
      // line under it.
      headline: said ? clip(said) : runTitle(project, run),
      outcome: shipped ?? words.text,
      tone: shipped ? shipTone(run.payload?.fix?.state) : words.tone,
      result,
      at,
      links,
    });
  }
  return done.sort((a, b) => b.at - a.at).slice(0, DONE_MAX);
}

/** "12 min", "2 h 5 min", "3 d" — how long something has been going. */
export function elapsedLabel(since: number | null, nowMs: number): string | null {
  if (since === null) return null;
  const mins = Math.max(0, Math.floor((nowMs - since) / 60_000));
  if (mins < 1) return "just now";
  // Compact like every other time on Home ("21h ago", "3d ago"): "12m",
  // "2h 5m", "1d" — not "1 d" beside "21h ago" on the next row.
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A string as one line, or null when it says nothing. */
function oneLine(text: string | null | undefined): string | null {
  const line = text?.replace(/\s+/g, " ").trim();
  return line ? line : null;
}

/**
 * What an agent that handed control back is waiting to hear: its block reason
 * (the session's, else the run's handoff), else the next step it named. Never
 * empty — a row that says only "Needs you" leaves the owner to go and find
 * out why.
 */
function awaitedQuestion(project: ProjectState, run: Run | null): string {
  return (
    oneLine(project.session?.blockReason) ??
    oneLine(run?.summary?.["block-reason"]) ??
    oneLine(project.session?.next) ??
    oneLine(run?.summary?.next) ??
    "It stopped for your answer — open it to read the question"
  );
}

function clip(text: string, max = 110): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

function shipTone(state: string | undefined): DoneJob["tone"] {
  if (state === FIX_SHIP_STATE.DEPLOYED) return "good";
  if (state === FIX_SHIP_STATE.DEPLOY_FAILED || state === FIX_SHIP_STATE.PR_CLOSED) return "bad";
  return "partial";
}
