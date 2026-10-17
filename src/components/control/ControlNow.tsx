"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ChevronRight, CircleAlert, CircleDashed, Plus } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
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
  return (
    <section aria-labelledby="control-now-title" className="space-y-3">
      <div className="ui-now-header">
        <h2 id="control-now-title" className="ui-now-heading">
          {jobs.length > 0 ? "Being built now" : "Nothing is being built right now"}
        </h2>
        {jobs.length > 0 && (
          <Link href="/loki" className="ui-btn-ghost ui-btn-sm shrink-0">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="ui-now-empty">
          <p className="text-sm leading-relaxed text-text-secondary">
            Tell Loki what to make. While it is being built, it shows up here — tap it to watch it
            happen.
          </p>
          <Link href="/loki" className="ui-btn-primary ui-btn-sm mt-3 w-full sm:w-auto">
            Start something
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.tab}>
              <JobCard job={job} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JobCard({ job, nowMs }: { job: NowJob; nowMs: number }) {
  const elapsed = elapsedLabel(job.since, nowMs);
  return (
    <Link href={job.href} className={cn("ui-now-card", job.tone === "you" && "ui-now-card-you")}>
      <span className="ui-now-card-top">
        <span className={cn("ui-now-dot", `ui-now-dot-${job.tone}`)} aria-hidden="true" />
        <span className="min-w-0 truncate">{job.tab}</span>
        {elapsed && <span className="ml-auto shrink-0 tabular-nums">{elapsed}</span>}
      </span>
      <span className="ui-now-title">{job.title}</span>
      <span className="ui-now-status">{job.status}</span>
      <span className="ui-now-go">
        {job.tone === "you" ? "Answer it" : "Watch it being built"}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </Link>
  );
}

/**
 * What got done in the last day, newest first: what it was, what came of it,
 * and where to look. Replaced "Recent activity", which listed the prompts
 * sent to agents verbatim — safety fences included — and could not be tapped.
 */
export function ControlDone({ jobs }: { jobs: DoneJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby="control-done-title" className="space-y-3">
      <h2 id="control-done-title" className="ui-now-heading">
        Done recently
      </h2>
      <ul className="ui-done-list">
        {jobs.map((job) => {
          const Icon =
            job.tone === "good" ? Check : job.tone === "bad" ? CircleAlert : CircleDashed;
          return (
            <li key={job.key} className="ui-done-row">
              <Icon className={cn("ui-done-icon", `ui-done-icon-${job.tone}`)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="ui-done-title">{job.title}</p>
                <p className="ui-done-result">
                  {job.result}
                  <span className="text-text-muted">
                    {" "}
                    · {job.tab} · {timeAgo(job.at)}
                  </span>
                </p>
                <div className="ui-done-links">
                  {job.links.map((link) =>
                    link.external ? (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="ui-done-link"
                      >
                        {link.label}
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <Link key={link.href} href={link.href} className="ui-done-link">
                        {link.label}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The machinery, in one quiet line at the foot of the page: which builder is
 * on, and the two things a person occasionally needs here — a new project and
 * the settings (autopilot, refresh, builder detail).
 */
export function ControlFoot({
  builderLabel,
  builderOk,
  onNewProject,
  onOpenSettings,
}: {
  builderLabel: string;
  builderOk: boolean;
  onNewProject: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="ui-now-foot">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span
          className={cn("ui-now-dot", builderOk ? "ui-now-dot-ok" : "ui-now-dot-you")}
          aria-hidden="true"
        />
        <span className="min-w-0">{builderLabel}</span>
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
        <button type="button" onClick={onNewProject} className="ui-btn-ghost ui-btn-sm">
          New project
        </button>
        <button type="button" onClick={onOpenSettings} className="ui-btn-ghost ui-btn-sm">
          Settings
        </button>
      </span>
    </div>
  );
}
