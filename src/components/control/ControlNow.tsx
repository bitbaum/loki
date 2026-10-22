"use client";

import { useState } from "react";
import {
  Check,
  CircleAlert,
  CircleDashed,
  CirclePause,
  Hammer,
  MessageCircle,
  Plus,
  Server,
} from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { elapsedLabel, type DoneJob, type NowJob } from "./control-now";

/**
 * The top of Control: what is being built for you right now. One card per
 * job — what it is, what the agent is doing this minute, how long it has
 * been at it — and the whole card opens the live session, where you watch
 * it work and can say something to it.
 *
 * It replaced a hero that reported the machinery ("Cloud builder online ·
 * sync 1m ago · 1 working · 0 awaiting input · 30 idle · Counts only agents
 * Loki started") and whose headline, "Building", could not be tapped
 * (2026-10-17: "When I see building I tap it and expect to see how it's
 * building").
 */
export function ControlNow({ jobs, nowMs }: { jobs: NowJob[]; nowMs: number }) {
  // Nothing running: nothing to say. The box above is where work starts; a
  // card here saying so, with a "Start something" that left for /loki, was a
  // second way to the same act and the loudest thing on an idle page.
  if (jobs.length === 0) return null;
  // One row per job (design reset, 2026-10): the project, what it is doing
  // this minute, how long. They were cards that each read "Next best step"
  // in large type — the prompt's name, the same on every card.
  const active = jobs.filter((j) => j.tone !== "quiet");
  const quiet = jobs.filter((j) => j.tone === "quiet");
  const row = (job: NowJob) => (
    <ListRow
      key={job.tab}
      href={job.href}
      icon={job.tone === "you" ? MessageCircle : job.tone === "quiet" ? CirclePause : Hammer}
      title={projectTitle({ name: job.tab })}
      secondary={
        job.tone === "you"
          ? `Waiting for you · ${job.status}`
          : job.tone === "quiet"
            ? job.status
            : jobLine(job)
      }
      status={job.tone === "you" ? "warning" : undefined}
      trailing={job.tone === "quiet" ? undefined : (elapsedLabel(job.since, nowMs) ?? undefined)}
      chevron
    />
  );
  // Work that went quiet is not "being built": it sits under its own quieter
  // heading and says what it is waiting on (control-now).
  return (
    <>
      {active.length > 0 && (
        <Section title="Being built">
          <List aria-label="Being built">{active.map(row)}</List>
        </Section>
      )}
      {quiet.length > 0 && (
        <Section title="Gone quiet">
          <List aria-label="Gone quiet">{quiet.map(row)}</List>
        </Section>
      )}
    </>
  );
}

/** "Fix the settings page · Editing page.tsx" — what it is, then what it is
 *  doing; the task name alone when the step says nothing new. */
function jobLine(job: NowJob): string {
  if (!job.status || job.status === job.title) return job.title;
  return `${job.title} · ${job.status}`;
}

/**
 * What got done in the last day, newest first, one row each: what was done
 * (or, when the agent said nothing, which project and how it ended), and
 * the row opens where to look. A task that stopped carries its fix on the row:
 * "Ask it to finish".
 */
export function ControlDone({
  jobs,
  onFinish,
}: {
  jobs: DoneJob[];
  /** Ask the session whose task stopped to finish it — the fix on the row,
   *  not a red row to read and leave (owner, 2026-10-19: "how is that
   *  helpful?"). */
  onFinish?: (tab: string) => Promise<unknown> | void;
}) {
  if (jobs.length === 0) return null;
  return (
    <Section title="Done">
      <List aria-label="Done">
        {jobs.map((job) => {
          const Icon =
            job.tone === "good" ? Check : job.tone === "bad" ? CircleAlert : CircleDashed;
          // The agent's own words lead when there are any; a headline that is
          // only the task's name ("Next best step") says nothing, so the
          // project and the outcome lead instead.
          const said = job.headline && job.headline !== job.title;
          const main = job.links.find((l) => !l.external) ?? job.links[0];
          return (
            <ListRow
              key={job.key}
              href={main?.href}
              icon={Icon}
              title={said ? job.headline : projectTitle({ name: job.tab })}
              secondary={said ? `${projectTitle({ name: job.tab })} · ${job.outcome}` : job.outcome}
              status={job.tone === "bad" ? "negative" : undefined}
              trailing={
                job.tone === "bad" && onFinish ? (
                  <FinishButton tab={job.tab} onFinish={onFinish} />
                ) : (
                  timeAgo(job.at)
                )
              }
            />
          );
        })}
      </List>
    </Section>
  );
}

/** "Ask it to finish": sends the stopped session one sentence, then says so. */
function FinishButton({
  tab,
  onFinish,
}: {
  tab: string;
  onFinish: (tab: string) => Promise<unknown> | void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (state === "sent") return <span>Asked — it shows above</span>;
  return (
    <button
      type="button"
      className="ui-home-fix"
      disabled={state === "sending"}
      onClick={async () => {
        setState("sending");
        try {
          await onFinish(tab);
          setState("sent");
        } catch {
          setState("failed");
        }
      }}
    >
      {state === "failed" ? "Didn't send — try again" : "Ask it to finish"}
    </button>
  );
}

/**
 * The machinery, in one quiet line at the foot of the page: which builder is
 * on, and the two things a person occasionally needs here — a new project and
 * the settings (autopilot, refresh, builder detail).
 */
export function ControlFoot({
  builderLabel,
  builderNote = null,
  onNewProject,
  onOpenSettings,
}: {
  /** Which builder is on — null when none is: the builder row at the top
   *  of Home already says so, and the foot saying "No builder connected"
   *  under "Builder offline · last seen 1d ago" told one fact twice, two
   *  different ways (owner, 2026-10-22). */
  builderLabel: string | null;
  /** One clause after the label: "a newer version waits for its agents to finish". */
  builderNote?: string | null;
  onNewProject: () => void;
  onOpenSettings: () => void;
}) {
  // The last rows of the page, not a strip of chrome: settings (naming the
  // builder when one is on), and a new project.
  return (
    <List aria-label="Builder and settings" className="ui-home-foot">
      <ListRow
        icon={Server}
        title={builderLabel ?? "Settings"}
        secondary={builderNote ?? "Autopilot, refresh and agents"}
        onClick={onOpenSettings}
        chevron
      />
      <ListRow icon={Plus} title="New project" onClick={onNewProject} chevron />
    </List>
  );
}
