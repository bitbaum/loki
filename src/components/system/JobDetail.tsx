"use client";

import { useState } from "react";
import { X, Bot, Send, AlertTriangle, CheckCircle2, Play } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { CronJob } from "@/lib/crons-shared";
import { humanCronSchedule } from "@/lib/crons-shared";
import { Drawer } from "@/components/ui/modal";
import { postJson } from "@/lib/api/fetch";
import { FEEDBACK_MEDIUM_MS } from "@/lib/constants/timings";

export function JobDetail({
  job,
  onClose,
  onToggle,
  onSavePrompt,
}: {
  job: CronJob;
  onClose: () => void;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onSavePrompt: (id: string, message: string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(job.payload.message);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<{ ok: boolean; text: string } | null>(null);

  const isDirty = prompt !== job.payload.message;

  const handleRunNow = async () => {
    setRunning(true);
    setRunOutput(null);
    try {
      const res = await postJson("/api/crons/run", { id: job.id });
      const data = await res.json();
      setRunOutput({ ok: data.ok, text: data.output ?? data.error ?? "Done" });
    } catch (e) {
      setRunOutput({ ok: false, text: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await onSavePrompt(job.id, prompt);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), FEEDBACK_MEDIUM_MS);
  };

  const handleToggle = async () => {
    setToggling(true);
    await onToggle(job.id, !job.enabled);
    setToggling(false);
  };

  const lastRun = job.state?.lastRunAtMs;
  const nextRun = job.state?.nextRunAtMs;
  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
  const status = job.state?.lastStatus ?? job.state?.lastRunStatus;

  return (
    <Drawer onClose={onClose} size="lg" surface="modal" className="overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 p-4 border-b border-border-subtle bg-surface-modal">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-status-positive shrink-0" />
            <h2 className="text-base font-semibold truncate" title={job.name}>
              {job.name}
            </h2>
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">
            {humanCronSchedule(job.schedule.expr, job.schedule.tz)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Run Now */}
          <button
            onClick={handleRunNow}
            disabled={running}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 transition-colors"
            title="Run now (debug)"
          >
            <Play className="h-3 w-3" />
            {running ? "Running…" : "Run now"}
          </button>
          {/* Enable toggle */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
              job.enabled
                ? "bg-status-positive-subtle text-status-positive hover:bg-status-positive/18"
                : "bg-surface-raised text-text-tertiary hover:bg-surface-overlay"
            }`}
          >
            {job.enabled ? "Enabled" : "Disabled"}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-overlay transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* Status row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="ui-data-cell">
            <div className="ui-micro-label mb-1">Last Run</div>
            {lastRun ? (
              <div className="text-xs text-text-secondary">
                {formatDistanceToNow(new Date(lastRun), { addSuffix: true })}
              </div>
            ) : (
              <div className="text-xs text-text-tertiary">Never</div>
            )}
          </div>
          <div className="ui-data-cell">
            <div className="ui-micro-label mb-1">Status</div>
            {!status || status === "never" ? (
              <div className="text-xs text-text-tertiary">Never run</div>
            ) : hasError ? (
              <div className="flex items-center gap-1 ui-error-xs">
                <AlertTriangle className="h-3 w-3" />
                {job.state?.consecutiveErrors} err
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-status-positive">
                <CheckCircle2 className="h-3 w-3" />
                OK
              </div>
            )}
          </div>
          <div className="ui-data-cell">
            <div className="ui-micro-label mb-1">Next Run</div>
            {nextRun ? (
              <div className="text-xs text-text-secondary">
                {formatDistanceToNow(new Date(nextRun), { addSuffix: true })}
              </div>
            ) : (
              <div className="text-xs text-text-muted">—</div>
            )}
          </div>
        </div>

        {/* Error detail */}
        {hasError && job.state?.lastError && (
          <div className="ui-box-error">
            <div className="flex items-center gap-2 text-xs font-medium mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              Last Error
            </div>
            <div className="text-xs opacity-80">{job.state.lastError}</div>
            {job.state.lastErrorReason && (
              <div className="text-xs opacity-50 mt-1">Reason: {job.state.lastErrorReason}</div>
            )}
          </div>
        )}

        {/* Config */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="ui-data-cell">
            <span className="text-text-tertiary">Model</span>
            <span className="ml-2 text-text-secondary font-mono">{job.payload.model}</span>
          </div>
          <div className="ui-data-cell">
            <span className="text-text-tertiary">Thinking</span>
            <span className="ml-2 text-text-secondary font-mono">{job.payload.thinking}</span>
          </div>
          <div className="ui-data-cell">
            <span className="text-text-tertiary">Timeout</span>
            <span className="ml-2 text-text-secondary">{job.payload.timeoutSeconds}s</span>
          </div>
          <div className="ui-data-cell">
            <span className="text-text-tertiary">Delivery</span>
            <span className="ml-2 text-text-secondary capitalize">{job.delivery.channel}</span>
          </div>
        </div>

        {/* Run output */}
        {runOutput && (
          <div className={runOutput.ok ? "ui-box-success" : "ui-box-error"}>
            <div className="flex items-center gap-2 text-xs font-medium mb-1.5">
              {runOutput.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {runOutput.ok ? "Job triggered" : "Run failed"}
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono opacity-70">{runOutput.text}</pre>
          </div>
        )}

        {/* Prompt editor */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="ui-kicker text-text-secondary">Prompt</span>
            {isDirty && (
              <button onClick={handleSave} disabled={saving} className="ui-btn-confirm">
                <Send className="h-3 w-3" />
                {saving ? "Saving..." : saved ? "Saved!" : "Save"}
              </button>
            )}
            {saved && !isDirty && (
              <span className="flex items-center gap-1 text-xs text-status-positive">
                <CheckCircle2 className="h-3 w-3" />
                Saved
              </span>
            )}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={14}
            className="w-full rounded-md bg-surface-base border border-border-subtle p-3 text-xs font-mono text-text-secondary focus:outline-none focus:border-border-strong resize-y leading-relaxed"
            spellCheck={false}
          />
        </div>
      </div>
    </Drawer>
  );
}
