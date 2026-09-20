/**
 * The one dev-log line a hosted run leaves behind.
 *
 * This is not bookkeeping. `user_projects.dev_log`'s newest entry is what
 * `project-dossier.ts` renders as "## Latest handoff → Done / Next / Health",
 * and the dossier is re-served to EVERY later dispatch for that project. So a
 * line written here is read by every agent that touches the project until the
 * next run replaces it — one bad line degrades the context of all of them.
 *
 * Two things were wrong with the line the hosted runner used to write, both
 * reported in #584 and both still reproducing on 2026-09-20:
 *
 *   `done: label.slice(0, 100)` where the label was
 *   `Hosted dispatch (Hermes) — ${task.slice(0, 70)}`. For an autopilot run the
 *   task IS the assembled dispatch envelope, so "what did the last run do?"
 *   came back as the first hundred characters of the preamble:
 *   "Hosted dispatch (Hermes) — # Loki operator dispatch Everything in this
 *   message is assembled by Lo". Zero information, re-served for hours.
 *
 *   `next: text.slice(0, 2_000)` where text was the run's OUTPUT — on failure,
 *   the raw error. A failure's stderr became the project's next step, under a
 *   heading that says what to do next.
 *
 * So: `done` states the OUTCOME, `next` is a real next step or empty, and
 * nothing is lost by the change — the full output and the full error already
 * live on the orchestration run's payload (closeHostedRun) and in the
 * task_failed/task_completed activity event beside it. This line is the
 * summary, not the archive.
 */
import { extractOperatorTask } from "@/lib/activity-status";
import type { DevLogEntry } from "@/db/schema/user-projects";

/** What the runner actually did, in the terms the caller already has. */
export type HostedRunOutcome =
  | { ok: true; kind: "dispatch"; prUrl?: string; branch?: string; noChanges?: boolean }
  | { ok: true; kind: "analysis" }
  | { ok: false; kind: "dispatch" | "analysis"; error: string };

/** How much of the operator's instruction identifies the run in one line. */
const TASK_LABEL_MAX = 80;
/** A failure's headline. The full error is on the run payload and the event. */
const ERROR_LINE_MAX = 160;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * An error's headline: its FIRST line, then clamped.
 *
 * Not the whole error flattened. Flattening "Error: spawn pnpm ENOENT" plus
 * three stack frames yields 158 characters — under any sane clamp, so the
 * frames ride along into a dossier line that every later agent reads, and the
 * one part that identifies the failure gets equal billing with
 * `node:internal/child_process:285:19`. The full error is on the run payload
 * and in the task_failed event; this is the headline.
 */
function errorHeadline(error: string): string {
  const first = error.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return oneLine(first, ERROR_LINE_MAX);
}

/**
 * The operator's ASK, not the envelope it arrived in.
 *
 * `extractOperatorTask` exists precisely for this — the Activity feed uses it
 * so a row shows what was asked rather than the scaffolding. The hosted runner
 * had its own `task.slice(0, 70)` beside it, which is why the dossier read like
 * a truncated system prompt.
 */
export function hostedTaskLabel(task: string): string {
  const recovered = extractOperatorTask(task) ?? task;
  const label = oneLine(recovered, TASK_LABEL_MAX);
  return label || "(no task text)";
}

/** The dev-log entry for one finished hosted run. Pure; `now` is injectable. */
export function hostedRunDevLogEntry(
  task: string,
  outcome: HostedRunOutcome,
  now: Date = new Date(),
): DevLogEntry {
  const who = outcome.kind === "dispatch" ? "Hosted dispatch (Hermes)" : "Hosted analysis";
  const label = hostedTaskLabel(task);

  let done: string;
  if (!outcome.ok) {
    done = `${who} FAILED — ${label} — ${errorHeadline(outcome.error) || "no error text"}`;
  } else if (outcome.kind === "analysis") {
    done = `${who} — ${label}`;
  } else if (outcome.prUrl) {
    done = `${who} — opened ${outcome.prUrl} — ${label}`;
  } else if (outcome.noChanges) {
    done = `${who} — no file changes — ${label}`;
  } else if (outcome.branch) {
    done = `${who} — pushed ${outcome.branch} — ${label}`;
  } else {
    done = `${who} — finished without a PR or branch — ${label}`;
  }

  return {
    date: now.toISOString(),
    done,
    // Empty, deliberately. A hosted run does not know the project's next step,
    // and the dossier omits the line entirely when this is blank — which is the
    // honest rendering. Inventing one here would put words in the next agent's
    // mouth exactly the way the old error dump did.
    next: "",
    tests: "",
    todos: "",
    // A run that failed is not a project in good health. The old code stamped
    // "good" on every entry including the FAILED ones, so the dossier's Health
    // line agreed with itself no matter what happened.
    health: outcome.ok ? "good" : "needs attention",
  };
}
