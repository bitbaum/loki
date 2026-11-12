"use client";

import { Fragment, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleDashed,
  CirclePause,
  Hammer,
  MessageCircle,
  Plus,
  Settings2,
} from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { projectTitle } from "@/lib/project-display";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { elapsedLabel, waitingLine, type DoneJob, type NowJob } from "./control-now";

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
  //
  // Only work that is actually being done sits under "Being built". Agents
  // waiting for the owner are listed in "Needs you" (ControlWaiting): two
  // waiting rows under "Being built", beside a hero saying nothing was
  // building, gave three answers to "is anything running?" (2026-11-12).
  const active = jobs.filter((j) => j.tone === "working");
  const quiet = jobs.filter((j) => j.tone === "quiet");
  if (active.length === 0 && quiet.length === 0) return null;
  // One row per job (design reset, 2026-10): the project, what it is doing
  // this minute, how long. They were cards that each read "Next best step"
  // in large type — the prompt's name, the same on every card.
  const row = (job: NowJob) => <NowJobRow key={job.tab} job={job} nowMs={nowMs} />;
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

/**
 * Agents that stopped to ask the owner something, inside "Needs you": each
 * row names the project and shows the question itself. It read "Waiting for
 * you · Waiting for your a…" — the state twice, cut off, and never the
 * question the owner had to open the session to learn (2026-11-12).
 */
export function ControlWaiting({
  jobs,
  nowMs,
  onReply,
}: {
  jobs: NowJob[];
  nowMs: number;
  /** Answer the agent from here (the same /api/inject the box at the top of
   *  Home uses); without it a waiting row only opens the session. */
  onReply?: (tab: string, text: string) => Promise<unknown>;
}) {
  const waiting = jobs.filter((j) => j.tone === "you");
  if (waiting.length === 0) return null;
  return (
    <List aria-label="Agents waiting for you" id="control-waiting">
      {waiting.map((job) => (
        <Fragment key={job.tab}>
          <ListRow
            href={job.href}
            icon={MessageCircle}
            title={projectTitle({ name: job.tab })}
            secondary={waitingLine(job)}
            // Waiting for an answer is a to-do, not a warning: neutral, never
            // the warning orange (owner: "Orange is not the color of Loki").
            status="neutral"
            trailing={elapsedLabel(job.since, nowMs) ?? undefined}
            chevron
          />
          {job.reply && onReply && (
            <ReplyRow tab={job.tab} question={job.question} onReply={onReply} />
          )}
        </Fragment>
      ))}
    </List>
  );
}

/**
 * One job, as one row: the project, what it is doing or waiting on, how long.
 * The whole row opens the live session. Home and the chat's start screen draw
 * a job the same way (owner audit, 2026-11-12: the chat opened without a word
 * about the two agents waiting for him). A waiting job shows its question,
 * neutral, as in "Needs you".
 */
export function NowJobRow({ job, nowMs }: { job: NowJob; nowMs: number }) {
  return (
    <ListRow
      href={job.href}
      icon={job.tone === "you" ? MessageCircle : job.tone === "quiet" ? CirclePause : Hammer}
      title={projectTitle({ name: job.tab })}
      secondary={
        job.tone === "you" ? waitingLine(job) : job.tone === "quiet" ? job.status : jobLine(job)
      }
      status={job.tone === "you" ? "neutral" : undefined}
      trailing={job.tone === "quiet" ? undefined : (elapsedLabel(job.since, nowMs) ?? undefined)}
      chevron
    />
  );
}

/**
 * The answer, right under the question: one line and Send, which goes to the
 * project's agent. Before, answering meant opening the session to find out
 * what was being asked (owner, 2026-11-12). Its own list item, not inside the
 * row: the row is a link, and a field inside a link is not a field.
 */
function ReplyRow({
  tab,
  question,
  onReply,
}: {
  tab: string;
  question: string | null;
  onReply: (tab: string, text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const name = projectTitle({ name: tab });
  if (state === "sent") {
    return (
      <li className="ui-home-reply">
        <span className="ui-home-reply-sent" role="status">
          Sent to {name}
        </span>
      </li>
    );
  }
  const send = async () => {
    const reply = text.trim();
    if (!reply || state === "sending") return;
    setState("sending");
    try {
      await onReply(tab, reply);
      setState("sent");
    } catch {
      setState("failed");
    }
  };
  return (
    <li className="ui-home-reply">
      <form
        className="ui-home-reply-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state === "failed") setState("idle");
          }}
          placeholder={`Reply to ${name}`}
          aria-label={question ? `Reply to ${name}: ${question}` : `Reply to ${name}`}
          className="ui-home-reply-input"
          enterKeyHint="send"
        />
        <button
          type="submit"
          className="ui-home-fix"
          disabled={!text.trim() || state === "sending"}
        >
          {state === "failed" ? "Didn't send — retry" : state === "sending" ? "Sending" : "Send"}
        </button>
      </form>
    </li>
  );
}

/** "Editing page.tsx · Fix the settings page" — what it is doing this minute,
 *  then what was asked; the task name alone when the step says nothing new.
 *  The step leads because a phone row holds about thirty characters: with the
 *  name first, every row read "Next best step · Editing src/app/pa…", the
 *  same four words on each and the one live fact cut off. */
function jobLine(job: NowJob): string {
  if (!job.status || job.status === job.title) return job.title;
  return `${job.status} · ${job.title}`;
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
 * The foot of the page: the settings (naming where builds run, in plain
 * words) and a new project.
 */
export function ControlFoot({
  builderLine,
  builderNote = null,
  onNewProject,
  onOpenSettings,
}: {
  /** Where builds run ("Builds run in Loki's cloud") — null when no builder
   *  is on: the builder banner at the top of Home already says so. The row
   *  used to be titled "Cloud runner online" and open Settings (2026-11-12). */
  builderLine: string | null;
  /** "An update installs when current work finishes" — wins when present. */
  builderNote?: string | null;
  onNewProject: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <List aria-label="Settings and new project" className="ui-home-foot">
      <ListRow
        icon={Settings2}
        title="Settings"
        secondary={builderNote ?? builderLine ?? "Autopilot, refresh and agents"}
        onClick={onOpenSettings}
        chevron
      />
      <ListRow icon={Plus} title="New project" onClick={onNewProject} chevron />
    </List>
  );
}
