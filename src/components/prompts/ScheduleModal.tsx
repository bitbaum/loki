"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, X } from "lucide-react";
import { createCronJob } from "@/lib/api/crons";
import type { PromptTemplate } from "@/config/prompt-library";
import type { Project } from "./types";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { MODAL_AUTO_CLOSE_MS } from "@/lib/constants/timings";
import { needsProject, renderPromptBody, parsePromptVariables } from "@/lib/prompt-vars";
import {
  MONTH_DAY_MAX,
  WEEKDAY_NAMES,
  cronFromPick,
  cronProblem,
  describeCron,
  pickFromCron,
  timeZoneInWords,
  type ScheduleKind,
  type SchedulePick,
} from "@/lib/cron-words";
import { PromptProjectField, usePromptProject } from "./PromptProjectField";

/** The four picks in words, as an even 2 × 2: five cells in one row on a
 *  phone broke "Weekdays" mid-word. A cron line is the expert's way, one tap
 *  below, not a fifth cell. */
const KIND_OPTIONS: { id: Exclude<ScheduleKind, "custom">; label: string; means: string }[] = [
  { id: "daily", label: "Every day", means: "Every day, at the time below." },
  { id: "weekdays", label: "Weekdays", means: "Monday to Friday, at the time below." },
  { id: "weekly", label: "Every week", means: "Once a week, on the day below." },
  { id: "monthly", label: "Every month", means: "Once a month, on the date below." },
];

/** Monday first, the way a week reads; the value is cron's (Sunday = 0).
 *  Two letters, as a calendar heads its columns: seven cells must fit one
 *  row of a phone without a word breaking. The full day is in the sentence
 *  under the picker. */
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
  id: String(d),
  label: WEEKDAY_NAMES[d]!.slice(0, 2),
  title: WEEKDAY_NAMES[d]!,
}));

export function ScheduleModal({
  template,
  projects,
  timeZone,
  pinnedProjectId,
  onClose,
}: {
  template: PromptTemplate;
  projects: Project[];
  /** The zone the job runs in — the person's Loki time zone. */
  timeZone: string;
  pinnedProjectId?: string | null;
  onClose: () => void;
}) {
  const needed = needsProject(template);
  const { project, projectId, setProjectId } = usePromptProject(projects, pinnedProjectId);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  // A person picks a schedule in words; the cron line is written for them.
  // The prompt's suggested line opens as the pick it stands for.
  const [pick, setPick] = useState<SchedulePick>(() =>
    pickFromCron(template.suggestedSchedule ?? "0 9 * * 1"),
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A scheduled job stores its message as text, so whatever is unfilled here
  // is baked in and re-sent on every tick: every declared variable must have
  // a value before Create.
  const declared = parsePromptVariables(template.template);
  const extraVars = declared.filter((v) => v.name !== "project_name");
  const values: Record<string, string> = { ...varValues };
  if (project) values.project_name = project.name;
  const resolvedMessage = renderPromptBody(template.template, values);
  const missingVars = extraVars.filter(
    (v) => !varValues[v.name]?.trim() && v.defaultValue === undefined,
  );

  const cron = cronFromPick(pick);
  const problem = cronProblem(cron);
  const inWords = problem ? null : (describeCron(cron) ?? `On the schedule “${cron}”`);
  const zone = timeZoneInWords(timeZone);

  // Why Create cannot be pressed yet, said beside it — the button used to sit
  // there faint and grey with no reason given (2026-10-20).
  const blocked =
    needed && !project
      ? "Pick a project first."
      : missingVars.length > 0
        ? `Fill in ${missingVars.map((v) => v.name.replace(/_/g, " ")).join(", ")} first.`
        : problem
          ? "Fix the schedule first."
          : null;

  const jobName = project && needed ? `${project.title} — ${template.name}` : template.name;

  const set = (patch: Partial<SchedulePick>) => setPick((prev) => ({ ...prev, ...patch }));

  const handleCreate = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createCronJob({
        name: jobName,
        scheduleExpr: cron,
        message: resolvedMessage,
        tz: timeZone,
        ...(project && needed ? { projectId: project.id, projectName: project.name } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          typeof data.error === "string" ? data.error : "Could not create the job — try again.",
        );
        return;
      }
      setDone(true);
      setTimeout(onClose, MODAL_AUTO_CLOSE_MS);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} size="lg" padded={false} className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle p-5">
        <div className="text-xl font-semibold text-text-primary">Schedule this prompt</div>
        <button onClick={onClose} className="ui-btn-overlay p-2" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="ui-card-shell p-4">
          <div className="mb-1 text-base font-medium text-text-primary">{template.name}</div>
          <div className="text-sm text-text-secondary">{template.description}</div>
        </div>

        {needed && (
          <PromptProjectField
            id="schedule-project"
            projects={projects}
            value={projectId}
            onChange={setProjectId}
            required
            hint="Each run goes to this project's session."
          />
        )}

        {extraVars.length > 0 && (
          <div className="space-y-3">
            <div className="ui-kicker text-text-tertiary">Fill in</div>
            {extraVars.map((v) => (
              <div key={v.name}>
                <label className="ui-micro-label mb-1 block" htmlFor={`sched-var-${v.name}`}>
                  {v.name.replace(/_/g, " ")}
                  {v.defaultValue !== undefined && (
                    <span className="text-text-muted"> · defaults to {v.defaultValue}</span>
                  )}
                </label>
                <input
                  id={`sched-var-${v.name}`}
                  value={varValues[v.name] ?? ""}
                  onChange={(e) => setVarValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  placeholder={v.defaultValue ?? `Value for ${v.name.replace(/_/g, " ")}`}
                  className="ui-input"
                />
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="ui-kicker text-text-tertiary">How often</div>
          {pick.kind !== "custom" && (
            <Segmented
              label="How often"
              options={KIND_OPTIONS}
              value={pick.kind}
              columns={2}
              onChange={(id) => set({ kind: id as ScheduleKind })}
            />
          )}

          {pick.kind === "weekly" && (
            <Segmented
              label="Day of the week"
              options={DAY_OPTIONS}
              value={String(pick.weekday)}
              onChange={(id) => set({ weekday: Number(id) })}
            />
          )}

          {pick.kind === "custom" ? (
            <div>
              <label className="ui-micro-label mb-1 block" htmlFor="schedule-cron">
                Cron line — minute, hour, day of the month, month, day of the week
              </label>
              <input
                id="schedule-cron"
                value={pick.cron}
                onChange={(e) => set({ cron: e.target.value })}
                className="ui-input font-mono"
                placeholder="0 9 * * 1"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {problem && <p className="ui-error-xs mt-1.5">{problem}</p>}
              <button
                type="button"
                // Back to words keeps what the line says when it has a shape
                // the words can hold.
                onClick={() => setPick(pickFromCron(problem ? null : cron))}
                className="ui-btn-ghost mt-1 min-h-11 text-xs"
              >
                Pick it in words instead
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {pick.kind === "monthly" && (
                <div>
                  <label className="ui-micro-label mb-1 block" htmlFor="schedule-day">
                    Date
                  </label>
                  <select
                    id="schedule-day"
                    value={pick.monthDay}
                    onChange={(e) => set({ monthDay: Number(e.target.value) })}
                    className="ui-input"
                  >
                    {Array.from({ length: MONTH_DAY_MAX }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="ui-micro-label mb-1 block" htmlFor="schedule-time">
                  Time
                </label>
                <input
                  id="schedule-time"
                  type="time"
                  value={pick.time}
                  onChange={(e) => set({ time: e.target.value || pick.time })}
                  className="ui-input"
                />
              </div>
            </div>
          )}

          {pick.kind !== "custom" && (
            <button
              type="button"
              // Starts from the line the words made, so an expert edits rather
              // than retypes.
              onClick={() => set({ kind: "custom", cron })}
              className="ui-btn-ghost min-h-11 text-xs"
            >
              Write it as a cron line instead
            </button>
          )}
        </div>
      </div>

      {/* Pinned under the form, so on a phone the schedule in words — and
          whose clock it keeps — sits right above Create, never a scroll away. */}
      <div className="shrink-0 space-y-3 border-t border-border-subtle p-5">
        {inWords && (
          <p className="text-sm text-text-primary">
            {inWords}, {zone}.{" "}
            <Link
              href="/settings#location"
              className="text-xs text-text-tertiary underline underline-offset-2"
            >
              Change time zone
            </Link>
          </p>
        )}
        {error && <p className="ui-error-xs">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={handleCreate}
            disabled={!!blocked || saving || done}
            className="ui-btn-primary min-h-11 shrink-0"
          >
            {done ? (
              <Check className="h-4 w-4" />
            ) : saving ? (
              <Loader2 className="ui-spinner" />
            ) : (
              <Clock className="h-4 w-4" />
            )}
            {done ? "Scheduled" : saving ? "Creating…" : "Create scheduled job"}
          </button>
          {blocked && <p className="min-w-0 text-xs text-text-secondary">{blocked}</p>}
        </div>
      </div>
    </Modal>
  );
}
