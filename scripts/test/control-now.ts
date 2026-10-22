/**
 * The top of Control (components/control/control-now): one card per job being
 * built, with what it is and what it is doing now, each opening the live
 * session; and what got done. Before, the page said "Building · 1 agent
 * working" and nothing on it could be tapped (2026-10-17).
 *
 * Run: npx tsx scripts/test/control-now.ts
 */
import assert from "node:assert/strict";
import {
  buildDoneJobs,
  buildNowJobs,
  elapsedLabel,
  sessionHref,
} from "@/components/control/control-now";
import type { ProjectOperationsSnapshot } from "@/components/control/control-presenter";
import type { ProjectState } from "@/lib/control-types";

const NOW = Date.parse("2026-10-17T18:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

type Run = NonNullable<ProjectState["latestOrchestrationRun"]>;
function run(over: Partial<Run>): Run {
  return {
    id: "run-1",
    adapter: "claude",
    intent: "custom",
    state: "running",
    startedAt: ago(12),
    finishedAt: null,
    summary: null,
    tokensIn: null,
    tokensOut: null,
    tokensCacheRead: null,
    costUsd: null,
    payload: null,
    ...over,
  };
}
function snap(
  tab: string,
  phase: ProjectOperationsSnapshot["phase"],
  over: Partial<ProjectState> = {},
): ProjectOperationsSnapshot {
  const project = {
    tab,
    liveTab: tab,
    session: null,
    profile: null,
    currentPrompt: null,
    liveAgentTurns: null,
    latestOrchestrationRun: null,
    ...over,
  } as unknown as ProjectState;
  return { project, phase } as unknown as ProjectOperationsSnapshot;
}

let n = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  n++;
};

// A working project with a live step.
const working = snap("center-com-3", "working", {
  latestOrchestrationRun: run({
    title: "Develop a new version of this existing website: center-com.ru",
    lastProgressAt: ago(1),
    lastStep: { text: "Editing Header.tsx", at: ago(1) },
  }),
});
const [job] = buildNowJobs([working], NOW);
ok(
  job?.title === "Develop a new version of this existing website: center-com.ru",
  "the job is named in words",
);
ok(job?.status === "Editing Header.tsx", "and says what it is doing now");
ok(job?.tone === "working", "working");
ok(
  job?.href === "/terminal?project=center-com-3&view=chat&run=run-1",
  "the card opens the live conversation for this run",
);
ok(elapsedLabel(job!.since, NOW) === "12m", "how long it has been at it");

// A stale step is not presented as current.
const stale = snap("a", "working", {
  latestOrchestrationRun: run({
    lastProgressAt: ago(30),
    lastStep: { text: "Editing x", at: ago(30) },
  }),
});
ok(
  buildNowJobs([stale], NOW)[0]?.status === "Working on it",
  "a step from 30 minutes ago is not 'now'",
);

// Waiting on you leads, and says so.
const asking = snap("heidi", "awaiting_you", {
  session: { blockReason: "Which logo should I use?" } as ProjectState["session"],
});
const signin = snap("solon", "working", {
  latestOrchestrationRun: run({ id: "r2", blocked: "auth" }),
});
const order = buildNowJobs([working, asking, signin], NOW);
ok(order[0]?.tone === "you" && order[1]?.tone === "you", "what needs you comes first");
ok(
  order.some(
    (j) => j.title === "Which logo should I use?" && j.status === "Waiting for your answer",
  ),
  "a question leads with the question",
);
ok(
  order.some((j) => j.status === "Waiting for someone to sign in"),
  "a sign-in wait is named",
);

// Idle projects are not jobs.
ok(buildNowJobs([snap("idle", "not_running")], NOW).length === 0, "idle is not a job");

// A run that stopped reporting.
const quiet = snap("q", "not_running", {
  latestOrchestrationRun: run({ lastProgressAt: ago(40) }),
});
ok(buildNowJobs([quiet], NOW)[0]?.tone === "quiet", "an open run that went quiet says so");
ok(
  /^No word from the agent for \d+m$/.test(buildNowJobs([quiet], NOW)[0]?.status ?? ""),
  "and says for how long, not 'No update for a while'",
);

// A parallel run opens its own tab.
ok(
  sessionHref(working.project, run({ sessionTab: "center-com-3~abcd1234" })).startsWith(
    "/terminal?project=center-com-3%7Eabcd1234",
  ),
  "a parallel run opens its own session",
);

// Done.
const shipped = snap("loki", "completed", {
  profile: { url: "https://loki.orangecat.ch" } as ProjectState["profile"],
  latestOrchestrationRun: run({
    id: "r3",
    title: "Make the save button bigger",
    finishedAt: ago(30),
    outcome: "success",
    payload: { fix: { state: "deployed", prNumber: 12, prUrl: "https://github.com/x/y/pull/12" } },
  }),
});
const failed = snap("evig", "not_running", {
  latestOrchestrationRun: run({ id: "r4", finishedAt: ago(90), outcome: "error" }),
});
const old = snap("old", "not_running", {
  latestOrchestrationRun: run({ id: "r5", finishedAt: ago(60 * 30), outcome: "success" }),
});
const done = buildDoneJobs([failed, shipped, old], NOW);
ok(done.length === 2, "only the last day");
ok(done[0]?.title === "Make the save button bigger", "newest first");
ok(done[0]?.result === "#12 merged and deployed" && done[0]?.tone === "good", "what came of it");
ok(done[0]?.links[0]?.label === "Open the site", "the site to look at, first");
ok(
  done[0]?.links.some((l) => l.label === "See the change"),
  "and the change",
);
ok(done[1]?.tone === "bad" && done[1]?.result === "Stopped with an error", "a failure says so");
ok(
  done[1]?.links.at(-1)?.href === "/terminal?project=evig&view=chat",
  "a finished run's session opens without pinning a closed run",
);

ok(elapsedLabel(NOW - 125 * 60_000, NOW) === "2h 5m", "hours");
ok(elapsedLabel(NOW - 26 * 3_600_000, NOW) === "1d", "days, compact like the rest of Home");
ok(elapsedLabel(NOW - 20_000, NOW) === "just now", "seconds");

console.log(`✓ control-now: ${n} checks passed`);
