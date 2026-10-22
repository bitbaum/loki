"use client";

import { FolderKanban } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
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
    <List aria-label="Projects" className="md:hidden">
      <ListRow href="/projects" icon={FolderKanban} title="All projects" trailing={count} chevron />
    </List>
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

/**
 * Home's "Needs you" section (design reset, 2026-10). Its pieces — failures,
 * escalations, the review inbox, the hero — each render nothing when they have
 * nothing, and the heading goes with them (.ui-home-needs in globals.css), so
 * an idle Home never shows a heading over nothing.
 */
export function HomeNeeds({ children }: { children: React.ReactNode }) {
  return (
    <section className="ui-home-needs" aria-labelledby="home-needs-title">
      <SectionHeading id="home-needs-title" title="Needs you" />
      <div className="ui-home-needs-body">{children}</div>
    </section>
  );
}

/**
 * Whether the status card (ControlFleetStatus) has anything to say. It speaks
 * only when something is wrong or someone is needed: "Building" and "nothing
 * running" are answered by the rows above it, and saying them twice is what
 * made this page read as machinery.
 *
 * Failures and the projects that need you are NOT its news: "Needs you" shows
 * each one with its fix, and the card saying "1 dispatch failed — review
 * failed dispatches" under it was the same thing twice, the second time in
 * jargon (owner, 2026-10-19). Nor are projects whose agents need you when the
 * rows already name them: it said "2 projects' agents need you" with a black
 * "Open murphys-bar" under the two rows naming them (2026-10-21).
 */
export function heroHasNewsFor(
  dashboard: { countsKnown?: boolean } | null,
  pulseKey: string,
  attentionCount: number,
): boolean {
  return (
    !(dashboard?.countsKnown ?? true) ||
    ["stalled", "partial", "unknown"].includes(pulseKey) ||
    (pulseKey === "failing" && attentionCount === 0)
  );
}
