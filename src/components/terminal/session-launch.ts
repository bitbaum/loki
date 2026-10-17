import type { ComponentProps } from "react";
import type { TerminalContext } from "@/app/api/terminal/context/route";
import type { BuilderChannel } from "@/lib/event-stream-types";
import type { TerminalLaunch } from "./TerminalLaunch";

/**
 * What every start-a-session form on the page gets — the desktop strip's "+",
 * the phone's "+" sheet: the projects and agents, and the sessions already
 * open, so a project that has one gets a second beside it instead of a
 * replacement; plus where to go once the new session exists.
 */
export function sessionLaunchProps(args: {
  context: TerminalContext | null | undefined;
  agents: { id: string; label: string }[];
  activeProject: string | null;
  channel: BuilderChannel;
  openTabs: string[];
  select: (tab: string) => void;
}): ComponentProps<typeof TerminalLaunch> | null {
  const { context } = args;
  if (!context) return null;
  return {
    projects: context.launchable,
    agents: args.agents,
    defaultAgent: context.agents.defaultAgent,
    activeProject: args.activeProject,
    channel: args.channel,
    openTabs: args.openTabs,
    onStarted: args.select,
    onOpenSession: args.select,
  };
}
