"use client";

import type { BuilderChannel } from "@/lib/event-stream-types";
import { projectTitle } from "@/lib/project-display";
import { SessionComposer } from "./SessionComposer";
import { SectionHeading } from "@/components/ui/section-heading";

/** The same session box before a PTY exists; tab-inject owns starting it. */
export function TerminalIdleSession({
  project,
  channel,
  offline,
}: {
  project: { name: string; agentPref: string | null };
  channel: BuilderChannel;
  offline: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-3">
      <div className="flex-1 overflow-y-auto">
        <SectionHeading title="What would you like to change?" />
        <p className="text-sm text-text-secondary">
          Send a task to start work on {projectTitle({ name: project.name })}.
          {offline
            ? " Your task will wait for the project's builder to connect."
            : " It opens here when the session starts."}
        </p>
      </div>
      <SessionComposer
        tab={project.name}
        project={project.name}
        channel={channel}
        live={false}
        agent={project.agentPref}
        onKey={async () => {
          throw new Error("No session is running yet. Send a task to start one.");
        }}
      />
    </div>
  );
}
