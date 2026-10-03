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
import { injectPrompt } from "@/lib/inject-core";
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
  commandId?: string;
  /** The dispatcher's own sentence when it refused or warned (runner offline). */
  message?: string;
};

export type MultiDispatchResult =
  | { ok: true; status: 200; results: ProjectTaskOutcome[]; sent: number; failed: number }
  | {
      ok: false;
      status: 400 | 404;
      error: string;
      unknown?: string[];
      available?: string[];
    };

export type MultiDispatchInput = {
  task: string;
  projects: string[];
  adapter?: (typeof ORCHESTRATION_ADAPTER_IDS)[number];
  /** Push each project's close outcome to the operator's chat. True for any
   *  caller whose person is not watching a Loki tab (OrangeCat, MCP). */
  notifyOnClose?: boolean;
};

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

  const results = await Promise.all(
    canonical.map(async (project): Promise<ProjectTaskOutcome> => {
      try {
        const { status, body } = await injectPrompt(
          {
            tab: project,
            customPrompt: buildProjectTaskPrompt(task, project, canonical),
            adapter: input.adapter,
            notifyOnClose: input.notifyOnClose,
          },
          userId,
        );
        const ok = status < 300;
        return {
          project,
          ok,
          mode: body.mode === "queued" ? "queued" : ok ? "direct" : undefined,
          runId: str(body.runId),
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
