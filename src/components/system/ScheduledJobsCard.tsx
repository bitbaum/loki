"use client";

import { useState } from "react";
import { Bot, CheckCircle2, XCircle, Clock, AlertTriangle, Folder } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDistanceToNow } from "date-fns";
import type { CronJob } from "@/lib/crons-shared";
import { humanCronSchedule, SCHEDULED_JOBS_LABEL } from "@/lib/crons-shared";
import { patchCronJob } from "@/lib/api/crons";
import { JobDetail } from "./JobDetail";

function StatusDot({ status, errors }: { status?: string; errors?: number }) {
  if (!status || status === "never")
    return <span className="h-2 w-2 rounded-full bg-status-neutral shrink-0" title="Never run" />;
  if (status === "ok" || status === "completed")
    return <span className="ui-dot ui-dot-positive shrink-0" title="OK" />;
  if (errors && errors > 0)
    return <span className="ui-dot ui-dot-negative shrink-0" title={`${errors} errors`} />;
  return <span className="ui-dot ui-dot-warning shrink-0" title="Unknown" />;
}

function JobRow({
  job,
  onSelect,
  onToggle,
}: {
  job: CronJob;
  onSelect: () => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const nextRun = job.state?.nextRunAtMs;
  const status = job.state?.lastStatus ?? job.state?.lastRunStatus;
  const errors = job.state?.consecutiveErrors ?? 0;
  const hasError = errors > 0;

  return (
    <div
      onClick={onSelect}
      className="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-surface-raised transition-colors cursor-pointer"
    >
      <StatusDot status={status} errors={errors} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium truncate ${!job.enabled ? "text-text-muted" : ""}`}
            title={job.name}
          >
            {job.name}
          </span>
          {!job.enabled && <span className="ui-micro-label shrink-0">off</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-text-tertiary">{humanCronSchedule(job.schedule.expr)}</span>
          {hasError && job.state?.lastError && (
            <span
              className="flex items-center gap-1 text-micro text-status-negative/70 truncate"
              title={job.state.lastError}
            >
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              {job.state.lastError}
            </span>
          )}
          {!hasError && nextRun && (
            <span className="flex items-center gap-1 text-micro text-text-tertiary shrink-0">
              <Clock className="h-2.5 w-2.5" />
              {formatDistanceToNow(new Date(nextRun), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(job.id, !job.enabled);
        }}
        className={`ui-tap-overlay shrink-0 h-4 w-7 rounded-full transition-colors ${
          job.enabled ? "bg-status-positive" : "bg-surface-overlay"
        }`}
        title={job.enabled ? "Disable" : "Enable"}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-toggle-knob transition-transform ${
            job.enabled ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function ScheduledJobsCard({ initialJobs }: { initialJobs: CronJob[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<CronJob | null>(null);

  const handleToggle = async (id: string, enabled: boolean) => {
    const res = await patchCronJob({ id, enabled });
    if (res.ok) {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, enabled } : j)));
      if (selected?.id === id) setSelected((prev) => prev && { ...prev, enabled });
    }
  };

  const handleSavePrompt = async (id: string, message: string) => {
    const res = await patchCronJob({ id, message });
    if (res.ok) {
      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, payload: { ...j.payload, message } } : j)),
      );
      if (selected?.id === id)
        setSelected((prev) => prev && { ...prev, payload: { ...prev.payload, message } });
    }
  };

  const okCount = jobs.filter(
    (j) => j.state?.lastStatus === "ok" || j.state?.lastRunStatus === "ok",
  ).length;
  const errCount = jobs.filter((j) => (j.state?.consecutiveErrors ?? 0) > 0).length;

  // Group jobs: project-tagged first (grouped by project), then global
  const projectGroups = new Map<string, { name: string; jobs: CronJob[] }>();
  const globalJobs: CronJob[] = [];

  for (const job of jobs) {
    if (job.projectId && job.projectName) {
      const existing = projectGroups.get(job.projectId);
      if (existing) {
        existing.jobs.push(job);
      } else {
        projectGroups.set(job.projectId, { name: job.projectName, jobs: [job] });
      }
    } else {
      globalJobs.push(job);
    }
  }

  return (
    <>
      <SystemBlock>
        <SystemBlockHeader
          icon={Bot}
          title={SCHEDULED_JOBS_LABEL}
          right={
            <div className="flex items-center gap-2 text-xs">
              {okCount > 0 && (
                <span className="flex items-center gap-1 text-status-positive">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {okCount}
                </span>
              )}
              {errCount > 0 && (
                <span className="flex items-center gap-1 text-status-negative">
                  <XCircle className="h-3.5 w-3.5" />
                  {errCount} err
                </span>
              )}
            </div>
          }
        />

        {jobs.length === 0 ? (
          <EmptyState>No scheduled jobs configured</EmptyState>
        ) : (
          <div className="space-y-4">
            {/* Project-scoped job groups */}
            {Array.from(projectGroups.entries()).map(([pid, group]) => (
              <div key={pid}>
                <div className="flex items-center gap-1.5 px-2 mb-1">
                  <Folder className="h-3 w-3 text-text-muted" />
                  <span className="ui-micro-label font-medium">{group.name}</span>
                </div>
                <div className="space-y-0.5 pl-2 border-l border-border-subtle">
                  {group.jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onSelect={() => setSelected(job)}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Global (untagged) jobs */}
            {globalJobs.length > 0 && (
              <div>
                {projectGroups.size > 0 && (
                  <div className="flex items-center gap-1.5 px-2 mb-1">
                    <span className="ui-micro-label font-medium">Global</span>
                  </div>
                )}
                <div className="space-y-0.5">
                  {globalJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onSelect={() => setSelected(job)}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SystemBlock>

      {selected && (
        <JobDetail
          job={selected}
          onClose={() => setSelected(null)}
          onToggle={handleToggle}
          onSavePrompt={handleSavePrompt}
        />
      )}
    </>
  );
}
