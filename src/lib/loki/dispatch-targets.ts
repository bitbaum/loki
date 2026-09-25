/**
 * Which fleet projects a Loki command should fan out to — SSOT for multi-select.
 */
import type { CommandResolution } from "@/lib/command-resolve";

export function resolveDispatchTargets(input: {
  resolution: CommandResolution;
  selectedProjects: string[];
  /** Project explicitly named in the message, if any. */
  namedInText: string | null;
}): string[] {
  const { resolution, selectedProjects, namedInText } = input;

  if (resolution.kind !== "command" || resolution.needsProject) return [];

  // Explicit name in text always wins — single-project dispatch.
  if (namedInText) return [namedInText];

  if (selectedProjects.length > 1) return [...selectedProjects];

  if (resolution.projectKey) return [resolution.projectKey];

  if (selectedProjects[0]) return [selectedProjects[0]];

  return [];
}

/**
 * Whether to answer with "which project?" chips instead of replying.
 *
 * Only when there is something to pick: with no projects the question is a
 * dead end — the reply promised "pick one below" and the picker, given no
 * options, rendered nothing, not even its "just answer" button. A workspace
 * with no projects yet gets an answer.
 */
export function shouldAskForProject(
  resolution: Pick<CommandResolution, "needsProject">,
  projectNames: readonly string[],
): boolean {
  return Boolean(resolution.needsProject) && projectNames.length > 0;
}
