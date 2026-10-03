/**
 * One task, several projects — the pure half (no DB, no HTTP).
 *
 * A request like "make it so I can post prompts in OrangeCat and Loki" is ONE
 * piece of work that lands in several repositories. Loki's dispatch unit is a
 * project: one checkout, one agent session. So a multi-project task is a
 * fan-out — the same words go to each named project — and the only thing that
 * keeps N agents from each trying to build the whole thing in their own repo
 * is that every one of them is told the shape of the fan-out: who else got the
 * request, and which part is theirs.
 *
 * The impure half (resolving names, calling injectPrompt) lives in
 * lib/multi-project-dispatch.ts; this file is what the tests pin.
 */

/** A ceiling on fan-out. Each project is a whole agent on one subscription's
 *  rate limit — the same reason parallel lanes are capped per project. */
export const MAX_TASK_PROJECTS = 8;

/** Same ceiling /api/inject puts on a custom prompt, so a task that fits one
 *  project fits every project. */
export const MAX_TASK_LENGTH = 4000;

/** Trim, drop blanks, and dedupe case-insensitively — project names resolve
 *  case-insensitively (lib/inject-project.ts), so "Loki" and "loki" are one. */
export function normalizeTaskProjects(projects: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of projects) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * The prompt one project's agent receives.
 *
 * A single project gets the task verbatim — nothing to coordinate. Several get
 * a short preamble naming the others, so the agent does its own slice, says so
 * when there is nothing for it to do, and writes down any contract it assumed
 * (an endpoint, a payload) that the sibling repo has to match.
 */
export function buildProjectTaskPrompt(
  task: string,
  project: string,
  all: readonly string[],
): string {
  const body = task.trim();
  if (all.length <= 1) return body;
  const others = all.filter((p) => p.toLowerCase() !== project.toLowerCase());
  return [
    `Cross-project task. The same request below was sent to ${all.length} projects at once: ${all.join(", ")}.`,
    `You are working in ${project}. Do the part that belongs in this repository; ${others.join(", ")} ${others.length === 1 ? "is" : "are"} handling ${others.length === 1 ? "its" : "their"} own part in parallel.`,
    "If this repository has nothing to do for it, say so and stop. Where your part depends on another project (an endpoint, a payload shape, a URL, a shared secret's name), state the contract you assumed in your summary so the other side can match it.",
    "",
    "---",
    "",
    body,
  ].join("\n");
}
