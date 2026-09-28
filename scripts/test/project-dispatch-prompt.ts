// Verifies what a one-click dispatch actually asks the agent to do
// (src/lib/project-dispatch-prompt.ts).
//
// Two things are being protected here, both learned the hard way on 2026-08-04:
//   1. A placeholder must never reach an agent. "STACK: Unknown" is worse than
//      no stack line — it reads as a decision.
//   2. Every dispatch kind must tell the agent to push. A kickoff run built
//      Zeitkastli's whole first milestone, green, and left it uncommitted in
//      the workspace when its session ended; the instruction to commit existed
//      but only inside an "if the repository is empty" clause.
// Run: npx tsx scripts/test/project-dispatch-prompt.ts
import { composeDispatchPrompt, dispatchClosing } from "@/lib/project-dispatch-prompt";
import { PROJECT_DISPATCH_KINDS } from "@/lib/project-dispatch";
import type { ProjectDossier } from "@/db/queries/project-dossier";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}: expected ${e}, got ${a}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-08-04T12:00:00Z");

/** A dossier with everything a prompt can draw on; override per test. */
function dossier(
  over: {
    attrs?: Record<string, string>;
    description?: string | null;
    goals?: Array<{
      title: string;
      description?: string | null;
      progress?: number;
      createdAt?: Date;
    }>;
    devLog?: Array<{ next?: string | null }>;
    runs?: Array<{ intent: string; outcome: string; startedAt: Date; finishedAt: Date | null }>;
  } = {},
): ProjectDossier {
  return {
    detail: {
      project: {
        name: "Zeitkastli",
        description:
          "description" in over ? (over.description ?? null) : "A capsule you leave somewhere.",
      },
      attrs: over.attrs ?? {},
      linkedGoals: (over.goals ?? []).map((g, i) => ({
        title: g.title,
        description: g.description ?? null,
        progress: g.progress ?? 0,
        createdAt: g.createdAt ?? new Date(T0.getTime() + i * 1000),
      })),
      devLog: over.devLog ?? [],
    },
    runs: over.runs ?? [],
  } as unknown as ProjectDossier;
}

// ── Every kind ships ────────────────────────────────────────────────────────
// The invariant, not four copies of one assertion: whatever a dispatch is for,
// the agent is told its work must end up pushed.

const FOR_EVERY_KIND: Record<string, ProjectDossier> = {
  kickoff: dossier({ goals: [{ title: "Core data model" }] }),
  next_step: dossier({ attrs: { next_step: "Add the recovery contact field" } }),
  fix_signal: dossier({ attrs: { security_vulnerability: "Uploads are unauthenticated" } }),
  diagnose_timeouts: dossier({
    runs: [
      {
        intent: "build",
        outcome: "timeout",
        startedAt: T0,
        finishedAt: new Date(T0.getTime() + DAY),
      },
    ],
  }),
};

eq(
  Object.keys(FOR_EVERY_KIND).sort(),
  [...PROJECT_DISPATCH_KINDS].sort(),
  "this test covers every dispatch kind — a new kind must be added here",
);

for (const kind of PROJECT_DISPATCH_KINDS) {
  const signalKey = kind === "fix_signal" ? "security_vulnerability" : undefined;
  const composed = composeDispatchPrompt(kind, signalKey, FOR_EVERY_KIND[kind]);
  ok(!composed.error, `${kind}: composes a prompt (${composed.error ?? "ok"})`);
  const p = composed.prompt ?? "";
  ok(/commit/i.test(p), `${kind}: tells the agent to commit`);
  ok(/push/i.test(p), `${kind}: tells the agent to push`);
  ok(/open a PR/i.test(p), `${kind}: tells the agent to open a PR`);
}

// ── Placeholders never reach an agent ───────────────────────────────────────

const withUnknowns = composeDispatchPrompt(
  "kickoff",
  undefined,
  dossier({
    attrs: {
      mission: "Keep valuables out of the house",
      stack: "Unknown",
      architecture: "N/A",
      conventions: "TBD",
      distribution: "RSS + newsletter",
      gtm: "Solo builders; first paying customer via OrangeCat",
    },
    goals: [{ title: "Core data model" }],
  }),
);
const kickoffPrompt = withUnknowns.prompt ?? "";
ok(!/Unknown/.test(kickoffPrompt), "a placeholder stack never reaches the agent");
ok(!/N\/A/.test(kickoffPrompt), "'N/A' never reaches the agent");
ok(!/TBD/.test(kickoffPrompt), "'TBD' never reaches the agent");
ok(/MISSION: Keep valuables out of the house/.test(kickoffPrompt), "the real field is still there");
ok(/DISTRIBUTION: RSS \+ newsletter/.test(kickoffPrompt), "distribution reaches the kickoff agent");
ok(/GO-TO-MARKET: Solo builders/.test(kickoffPrompt), "go-to-market reaches the kickoff agent");

eq(
  composeDispatchPrompt("next_step", undefined, dossier({ attrs: { next_step: "Unknown" } })).error,
  "No queued next step to dispatch.",
  "a placeholder next_step is no next step — refuse rather than dispatch 'do Unknown'",
);
eq(
  composeDispatchPrompt(
    "fix_signal",
    "security_vulnerability",
    dossier({ attrs: { security_vulnerability: "Unknown" } }),
  ).error,
  "That issue is no longer recorded on the profile.",
  "a placeholder signal is not an issue to fix",
);
ok(
  !/Definition of done: Unknown/.test(
    composeDispatchPrompt(
      "kickoff",
      undefined,
      dossier({
        attrs: { definition_of_done: "Unknown" },
        goals: [{ title: "x" }],
      }),
    ).prompt ?? "",
  ),
  "a placeholder definition_of_done falls back to the generic verify instruction",
);
ok(
  dispatchClosing("npm run verify passes").includes("Definition of done: npm run verify passes"),
  "a real definition of done is quoted verbatim",
);

// ── Kickoff targets one milestone, in creation order ─────────────────────────

const ordered =
  composeDispatchPrompt(
    "kickoff",
    undefined,
    dossier({
      goals: [
        { title: "Core data model", createdAt: new Date(T0.getTime() + 1000), progress: 100 },
        { title: "Map picker", createdAt: new Date(T0.getTime() + 2000), progress: 0 },
        { title: "Photo upload", createdAt: new Date(T0.getTime() + 3000), progress: 0 },
      ],
    }),
  ).prompt ?? "";
ok(
  /YOUR TARGET THIS RUN: Map picker/.test(ordered),
  "the target is the first UNFINISHED milestone by creation order, not the first listed",
);
ok(/do not attempt the whole roadmap in one run/.test(ordered), "scope is one milestone");

eq(
  composeDispatchPrompt("kickoff", undefined, dossier({ description: null, goals: [] })).error,
  "Describe the project first — there is nothing to brief an agent with.",
  "nothing written down means nothing to dispatch",
);
ok(
  /first working, runnable state/.test(
    composeDispatchPrompt("kickoff", undefined, dossier({ goals: [] })).prompt ?? "",
  ),
  "a description with no roadmap still dispatches, aimed at first-runnable",
);

// ── next_step prefers the freshest handoff ──────────────────────────────────

ok(
  /Wire the recovery contact/.test(
    composeDispatchPrompt(
      "next_step",
      undefined,
      dossier({
        attrs: { next_step: "stale plan" },
        devLog: [{ next: "older" }, { next: "Wire the recovery contact" }],
      }),
    ).prompt ?? "",
  ),
  "the last dev-log handoff beats the stored next_step",
);

console.log(`${fail === 0 ? "✓" : "✗"} project-dispatch-prompt: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
