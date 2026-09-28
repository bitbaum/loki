/**
 * What a one-click dispatch actually asks the agent to do.
 *
 * Lives here rather than in the route because it is domain logic, not HTTP —
 * and because a route file cannot export anything but its handlers, so while it
 * sat there the prompts were untestable. They are the product: every "Make it
 * happen" run is only as good as this text.
 */
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";
import type { ProjectDossier } from "@/db/queries/project-dossier";
import { MINUTE_MS } from "@/lib/constants/time";
import { answer, cleanDescription } from "@/lib/project-display";
import type { ProjectDispatchKind } from "@/lib/project-dispatch";

export type ComposedPrompt = { prompt: string; error?: never } | { prompt?: never; error: string };

/**
 * Appended to every dispatch kind — the standing terms of any dispatched run.
 *
 * The shipping clause is not boilerplate. A kickoff run built Zeitkastli's
 * entire first milestone (schema, migration, map picker, upload, tests, all
 * green) and left it sitting in `git status` while its session ended; it was
 * found stranded 13 hours later, and only because someone went looking. The
 * old prompt said "commit it" once, buried inside an "if the repository is
 * empty" clause — so for a seeded repo it never applied at all. Work that is
 * not pushed is work nobody can see, review, or build on.
 */
export function dispatchClosing(dod: string | null): string {
  return [
    dod
      ? `Definition of done: ${dod}`
      : "Verify your work before claiming done — run the relevant tests or exercise the change.",
    "Ship it: commit on a branch, push it, open a PR, and enable auto-merge on it (`gh pr merge --auto --squash`) before your run ends — CI is the reviewer, and a green PR merges and deploys without anyone pressing a button. Work left uncommitted in the workspace does not exist.",
    "Record what you actually did (with evidence) in your final session handoff.",
  ].join(" ");
}

export function composeDispatchPrompt(
  kind: ProjectDispatchKind,
  signalKey: string | undefined,
  dossier: ProjectDossier,
): ComposedPrompt {
  const attrs = dossier.detail.attrs;
  const name = dossier.detail.project.name;
  const closing = dispatchClosing(answer(attrs.definition_of_done));

  if (kind === "fix_signal") {
    const signal = HEALTH_SIGNAL_BASE.find((s) => s.key === signalKey);
    const issue = signal ? answer(attrs[signal.key]) : null;
    if (!signal || !issue) return { error: "That issue is no longer recorded on the profile." };
    return {
      prompt: `Fix this called-out issue on ${name}.\n\n${signal.label.toUpperCase()}: ${issue}\n\nScope: fix exactly this issue — no unrelated refactors. ${closing}`,
    };
  }

  if (kind === "kickoff") {
    const description = cleanDescription(dossier.detail.project.description);
    // Creation order is the build order — the list itself is sorted by progress
    // for the human reading it, which on a fresh roadmap says nothing.
    const milestones = [...dossier.detail.linkedGoals].sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );
    const target = milestones.find((goal) => (goal.progress ?? 0) < 100) ?? null;
    // Brief from the project description and profile; when a roadmap exists,
    // aim at the next open milestone.
    if (!description && !target) {
      return { error: "Describe the project first — there is nothing to brief an agent with." };
    }

    const profile = (
      [
        ["Mission", attrs.mission],
        ["Problem", attrs.problem],
        ["Solution", attrs.solution],
        ["Distribution", attrs.distribution],
        ["Go-to-market", attrs.gtm],
        ["Stack", attrs.stack],
        ["Architecture", attrs.architecture],
        ["Conventions", attrs.conventions],
      ] as Array<[string, string | undefined]>
    )
      // answer(), not truthiness: a field the extractor filled with "Unknown"
      // must not reach the agent as "STACK: Unknown".
      .map(([label, value]) => [label, answer(value)] as const)
      .filter((row): row is readonly [string, string] => row[1] !== null)
      .map(([label, value]) => `${label.toUpperCase()}: ${value}`);

    const roadmap = milestones.map(
      (goal, i) => `${i + 1}. ${goal.title}${goal.description ? ` — ${goal.description}` : ""}`,
    );

    return {
      prompt: [
        `Start building ${name}. This project is being kicked off — treat the repository as possibly empty.`,
        description ? `\nWHAT IT IS: ${description}` : "",
        profile.length > 0 ? `\n${profile.join("\n")}` : "",
        roadmap.length > 0
          ? `\nBUILD ROADMAP (tracked as this project's goals):\n${roadmap.join("\n")}`
          : "",
        target
          ? `\nYOUR TARGET THIS RUN: ${target.title}${target.description ? `\n${target.description}` : ""}`
          : "\nYOUR TARGET THIS RUN: get the project to its first working, runnable state (a real site or app the person can open).",
        `\nScope: deliver that target only — do not attempt the whole roadmap in one run. If the repository is empty, scaffold the minimum that makes the target real and runnable. ${closing}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (kind === "next_step") {
    const next = answer(dossier.detail.devLog?.at(-1)?.next) ?? answer(attrs.next_step);
    if (!next) return { error: "No queued next step to dispatch." };
    return {
      prompt: `Execute the queued next step for ${name}:\n\n${next}\n\n${closing}`,
    };
  }

  const timedOut = dossier.runs
    .filter((run) => run.finishedAt && run.outcome === "timeout")
    .slice(0, 5)
    .map(
      (run) =>
        `- ${run.startedAt.toISOString().slice(0, 10)}: "${run.intent}" ran ~${Math.round(((run.finishedAt as Date).getTime() - run.startedAt.getTime()) / MINUTE_MS)}m then timed out`,
    );
  if (timedOut.length === 0) return { error: "No timed-out runs to diagnose." };
  return {
    prompt: `Diagnose why dispatched agent runs for ${name} keep timing out instead of finishing:\n\n${timedOut.join("\n")}\n\nInvestigate the workspace state (does the checkout exist and build? are handoffs being written? is the agent stalling on a prompt?), identify the most likely root cause, and fix what you can. ${closing}`,
  };
}
