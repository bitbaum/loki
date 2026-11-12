/**
 * One task, several projects — the dispatching half.
 *
 * Every project goes through injectPrompt, the same dispatcher /api/inject,
 * Loki chat and the MCP `dispatch` tool use, so a project reached this way is
 * routed, serialised, tracked and announced exactly as if it had been sent on
 * its own. Nothing here decides which builder runs what.
 *
 * Names are resolved BEFORE anything is sent. A coordinated task that reaches
 * two of its three repositories is worse than one that reaches none: the two
 * agents are told a third is handling its part, and nobody is. So an unknown
 * name refuses the whole task, and the refusal lists the names that would
 * have worked — the caller fixes one word instead of guessing.
 */
import { ensureUserProjectEntityLinks, getOrgProjects } from "@/db/queries/user-projects";
import { isProjectBusy } from "@/db/queries/orchestration-runs";
import type { RunnerChannel } from "@/db/schema/pending-commands";
import { APP_URL } from "@/config/brand";
import { injectPrompt } from "@/lib/inject-core";
import type { DispatchSession, WhenBusy } from "@/lib/orchestration/busy-placement";
import type { ORCHESTRATION_ADAPTER_IDS } from "@/lib/orchestration";
import {
  MAX_TASK_LENGTH,
  MAX_TASK_PROJECTS,
  buildProjectTaskPrompt,
  normalizeTaskProjects,
} from "@/lib/multi-dispatch-prompt";

export type ProjectTaskOutcome = {
  project: string;
  ok: boolean;
  /** "direct" = typed into a live session; "queued" = waiting for a builder. */
  mode?: "direct" | "queued";
  runId?: string;
  /** Where the run's live status and track are read (GET, the owner's session or token). */
  statusUrl?: string;
  commandId?: string;
  /** The dispatcher's own sentence when it refused or warned (runner offline). */
  message?: string;
};

export type MultiDispatchResult =
  | { ok: true; status: 200; results: ProjectTaskOutcome[]; sent: number; failed: number }
  | {
      ok: false;
      status: 400 | 404 | 409;
      error: string;
      unknown?: string[];
      available?: string[];
      /** On 409: the projects that already have an open run. */
      busy?: string[];
    };

export type MultiDispatchInput = {
  task: string;
  projects: string[];
  adapter?: (typeof ORCHESTRATION_ADAPTER_IDS)[number];
  /** Push each project's close outcome to the operator's chat. True for any
   *  caller whose person is not watching a Loki tab (OrangeCat, MCP). */
  notifyOnClose?: boolean;
  /** Prefer this builder where a project is not locked to one (inject-core). */
  builderChannel?: RunnerChannel;
  /**
   * Refuse the whole task, with a sentence, when a named project already has
   * an open run, instead of queueing behind it without saying so. For callers
   * whose person is not looking at Control (OrangeCat): they are told, and
   * ask again with `queueIfBusy` when behind-the-run is what they want.
   */
  refuseBusy?: boolean;
  /**
   * What a busy project does with the task when it is not refused: "queue"
   * (the default, behind the open run in the project's own session) or
   * "lane" (a separate agent session in its own worktree, for a one-off that
   * stands apart from the open run). orchestration/busy-placement.ts.
   */
  whenBusy?: WhenBusy;
  /**
   * "fresh": each project gets a one-off session of its own for this task (a
   * new agent in its own worktree, closed when it reports), whether or not
   * the project is busy, and never its shared session (busy-placement.ts).
   */
  session?: DispatchSession;
};

/** Where one run is read: the same address the run card polls. */
export function runStatusUrl(runId: string): string {
  return `${APP_URL}/api/orchestration/runs/${runId}`;
}

/** The refusal a person reads when a project is already at work. */
export function busySentence(busy: string[]): string {
  const names = busy.join(", ");
  return `${names} ${busy.length === 1 ? "is" : "are"} already working on a run. Nothing was sent. Wait for it to finish, or send again saying either to queue it behind the open run or to ask it in a fresh session of its own.`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export async function dispatchToProjects(
  input: MultiDispatchInput,
  userId: string,
): Promise<MultiDispatchResult> {
  const task = input.task.trim();
  const requested = normalizeTaskProjects(input.projects);
  if (!task) return { ok: false, status: 400, error: "The task is empty." };
  if (task.length > MAX_TASK_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `The task is ${task.length} characters; the limit is ${MAX_TASK_LENGTH}. Shorten it or split it into two tasks.`,
    };
  }
  if (requested.length === 0) {
    return { ok: false, status: 400, error: "Name at least one project to send the task to." };
  }
  if (requested.length > MAX_TASK_PROJECTS) {
    return {
      ok: false,
      status: 400,
      error: `${requested.length} projects is more than ${MAX_TASK_PROJECTS} at once. Each one starts a whole agent — send the task in two batches.`,
    };
  }

  const [own, team] = await Promise.all([
    ensureUserProjectEntityLinks(userId).catch(() => []),
    getOrgProjects(userId).catch(() => []),
  ]);
  const byKey = new Map<string, string>();
  for (const p of [...team, ...own]) byKey.set(p.name.toLowerCase(), p.name);

  const unknown = requested.filter((name) => !byKey.has(name.toLowerCase()));
  if (unknown.length > 0) {
    const available = [...new Set(byKey.values())].sort((a, b) => a.localeCompare(b));
    return {
      ok: false,
      status: 404,
      error: `No project named ${unknown.map((n) => `"${n}"`).join(", ")}. Nothing was sent. Projects you can send to: ${available.join(", ") || "none yet — add one in Loki first"}.`,
      unknown,
      available,
    };
  }

  // Canonical spelling from here on, so the preamble names projects the way
  // the agents and the Control rail do.
  const canonical = requested.map((name) => byKey.get(name.toLowerCase()) as string);

  // A fresh session never touches the project's open run, so a busy project
  // is no reason to refuse it.
  if (input.refuseBusy && input.session !== "fresh") {
    const flags = await Promise.all(
      canonical.map((project) => isProjectBusy(userId, project).catch(() => false)),
    );
    const busy = canonical.filter((_, i) => flags[i]);
    if (busy.length > 0) {
      return { ok: false, status: 409, error: busySentence(busy), busy };
    }
  }

  const results = await Promise.all(
    canonical.map(async (project): Promise<ProjectTaskOutcome> => {
      try {
        const { status, body } = await injectPrompt(
          {
            tab: project,
            customPrompt: buildProjectTaskPrompt(task, project, canonical),
            adapter: input.adapter,
            notifyOnClose: input.notifyOnClose,
            ...(input.builderChannel ? { builderChannel: input.builderChannel } : {}),
            ...(input.whenBusy ? { whenBusy: input.whenBusy } : {}),
            ...(input.session ? { session: input.session } : {}),
          },
          userId,
        );
        const ok = status < 300;
        return {
          project,
          ok,
          mode: body.mode === "queued" ? "queued" : ok ? "direct" : undefined,
          runId: str(body.runId),
          ...(str(body.runId) ? { statusUrl: runStatusUrl(str(body.runId) as string) } : {}),
          commandId: str(body.commandId),
          message: str(body.error) ?? str(body.message),
        };
      } catch (err) {
        return {
          project,
          ok: false,
          message: err instanceof Error ? err.message : "Dispatch failed.",
        };
      }
    }),
  );

  const sent = results.filter((r) => r.ok).length;
  return { ok: true, status: 200, results, sent, failed: results.length - sent };
}
