import type { TerminalContext } from "@/app/api/terminal/context/route";

/** A missing session never grants permission to type into a different project. */
export function idleProjectFor(input: {
  requested: string | null | undefined;
  activeTab: string | null;
  loading: boolean;
  gatedMessage: string | null;
  shell: boolean;
  context: TerminalContext | null | undefined;
}) {
  if (input.activeTab || input.loading || input.gatedMessage || input.shell || !input.requested)
    return null;
  return (
    input.context?.startable?.find(
      (project) => project.name.toLowerCase() === input.requested!.toLowerCase(),
    ) ?? null
  );
}

/** Match a project to its reported session without falling through to another project. */
export function resolveProjectToTab(
  projectOrTab: string | null | undefined,
  context: TerminalContext | null | undefined,
): string | null {
  if (!projectOrTab || !context) return projectOrTab ?? null;
  const lower = projectOrTab.toLowerCase();
  const direct = context.tabs.find((tab) => tab.tab.toLowerCase() === lower);
  if (direct) return direct.tab;
  return context.tabs.find((tab) => tab.projectName?.toLowerCase() === lower)?.tab ?? projectOrTab;
}
