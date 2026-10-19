"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { patchJson } from "@/lib/api/fetch";
import type { ControlData } from "@/lib/control-types";
import { agentToSwitchTo } from "./agent-switch";

/** "Ask it to finish" on a task that stopped (ControlDone): the same session,
 *  which has the conversation, asked to find what went wrong and finish. */
export const FINISH_PROMPT =
  "Your last task stopped before it finished. Look at what went wrong, fix it, and finish the task.";

/**
 * On a phone the project list is the Projects tab's job: Home showed a second
 * list under the first, with a second message box in its open card ("What
 * should the agent work on?") under the box at the top of the page (owner,
 * 2026-10-19). One row leads there instead. The list still opens on Home when
 * a project is opened on purpose — a deep link, "Needs you", back from a
 * session — and on a desk it stays where it is.
 */
export function HomeAllProjects({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link href="/projects" className="ui-home-all-projects md:hidden">
      <span className="min-w-0 flex-1">All projects</span>
      <span className="ui-home-all-projects-count">{count}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
    </Link>
  );
}

/**
 * "Use Claude instead" for a failure whose agent is not on the builder: which
 * agent to offer (control/agent-switch), and making the choice the project's
 * agent once the retry went through.
 */
export function failureFixes(data: ControlData | null, refresh: (force?: boolean) => unknown) {
  return {
    switchFor: (tab: string) =>
      agentToSwitchTo(
        data?.projects.find((p) => p.tab === tab),
        data?.failedCommands?.find((f) => f.tab === tab)?.error ?? "",
        data?.agentRegistry.agents ?? [],
      ),
    onSwitchAgent: (tab: string, agent: string) => {
      const id = data?.projects.find((p) => p.tab === tab)?.id;
      if (id) void patchJson(`/api/user-projects/${id}`, { agentPref: agent }).catch(() => {});
      void refresh(true);
    },
  };
}
