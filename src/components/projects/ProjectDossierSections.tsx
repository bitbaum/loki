/**
 * Server-rendered sections of the full project page (/projects/[id]).
 * Time is the information architecture: Done (changelog + runs), Now
 * (live state + brief), Next (resume state + goals). Everything renders
 * from the ProjectDossier SSOT assembly — no client fetches, no parallel
 * state. The canonical project workspace composes these sections with editors.
 */
import Link from "next/link";
import type { ProjectDossier, ProjectRunRow } from "@/db/queries/project-dossier";
import type { DevLogEntry } from "@/db/schema/user-projects";
import { DevLogList } from "@/components/shared/DevLogList";
import { GoalProgressBar } from "@/components/shared/GoalProgressBar";
import { GoalEditor } from "@/components/projects/GoalEditor";
import { timeAgo, formatDurationMinutes } from "@/lib/dates";
import { DOSSIER_STALE_MS, answer } from "@/lib/project-display";
import { APP_LOCALE } from "@/lib/constants";
import { MINUTE_MS, WEEK_MS } from "@/lib/constants/time";
import { SESSION_STATUS } from "@/lib/constants/statuses";
import { isRuntimeObservationFresh } from "@/lib/project-session";
import { plainWords } from "@/lib/project-display";
import { SectionHeading } from "@/components/ui/section-heading";

/** A run's outcome, in words, and whether it is worth a dot (rule 8). */
const OUTCOME_WORDS: Record<string, { word: string; dot: string | null }> = {
  success: { word: "Done", dot: null },
  partial: { word: "Partly done", dot: null },
  user_abort: { word: "Stopped by you", dot: null },
  error: { word: "Failed", dot: "ui-dot-negative" },
  hang: { word: "Got stuck", dot: "ui-dot-negative" },
  timeout: { word: "Ran out of time", dot: "ui-dot-warning" },
};

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ui-project-detail-block">
      <SectionHeading title={title} />
      {children}
    </section>
  );
}

function runDuration(run: ProjectRunRow): string | null {
  if (!run.finishedAt) return null;
  const mins = Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / MINUTE_MS);
  return formatDurationMinutes(mins);
}

/** NOW — live session state + the latest handoff's health signals + brief. */
export function NowSection({
  dossier,
  interactive = true,
  showBrief = true,
}: {
  dossier: ProjectDossier;
  interactive?: boolean;
  showBrief?: boolean;
}) {
  const { state, detail } = dossier;
  const attrs = detail.attrs;

  // A handoff older than DOSSIER_STALE_MS is a week-old freeze, not the live
  // present. Never claim "running"/"ready" (or show that snapshot's health
  // checks as current) once it's stale — say idle + when it was last active.
  const handoffMs = state?.sessionUpdatedAt?.getTime() ?? null;
  const stale = handoffMs != null && dossier.builtAtMs - handoffMs > DOSSIER_STALE_MS;
  // "Last active" must not ignore the repo: work landing as commits (outside
  // Loki-dispatched sessions) is activity. A profile once claimed
  // "Idle · last active 1mo ago" while 17 commits landed in two days.
  const lastCommitMs = dossier.commits?.[0]?.atMs ?? null;
  const commitFresher = lastCommitMs != null && (handoffMs == null || lastCommitMs > handoffMs);
  // `agentRunning` is a runner's claim at push time; past the runner-offline
  // threshold it is an expired claim. A slug-keyed row still said "running"
  // two hours after its agent died and would have read as "Agent process
  // running" here forever — sessionUpdatedAt was null, so `stale` never fired.
  const agentLive = !!state?.agentRunning && isRuntimeObservationFresh(state, dossier.builtAtMs);
  // An old handoff cannot overrule a fresh runner observation. A new agent
  // may be working before it has written its first handoff.
  const liveLabel = agentLive
    ? state?.currentPromptLabel
      ? `Working on ${state.currentPromptLabel}`
      : "An agent is working"
    : stale
      ? "Nothing running"
      : state?.sessionStatus === SESSION_STATUS.READY
        ? "Ready for the next thing"
        : "Nothing running";
  const liveActive = agentLive;

  // Stack is shown in the Technology card below — don't repeat it here.
  const briefRows: Array<[string, string]> = showBrief
    ? (
        [
          ["Mission", attrs.mission],
          ["Status", attrs.status],
        ] as Array<[string, string | undefined]>
      ).filter((row): row is [string, string] => Boolean(row[1]))
    : [];

  const goalMaxTurns = (() => {
    const n = parseInt(attrs.goal_max_turns ?? "", 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : null;
  })();

  return (
    <SectionShell title="Right now">
      <div className="space-y-1.5">
        <p className="text-sm text-text-primary">
          <span
            className={
              liveActive ? "ui-dot ui-dot-positive mr-1.5" : "ui-dot ui-dot-neutral mr-1.5"
            }
            aria-hidden="true"
          />
          {liveLabel}
          {commitFresher ? (
            <span className="text-xs text-text-muted">
              {" · "}last change {timeAgo(lastCommitMs)}
            </span>
          ) : handoffMs != null ? (
            <span className="text-xs text-text-muted">
              {" · "}
              {`last report ${timeAgo(handoffMs)}`}
            </span>
          ) : null}
        </p>
        {(() => {
          if (!dossier.commits?.length) return null;
          const weekAgo = dossier.builtAtMs - WEEK_MS;
          const weekCount = dossier.commits.filter((c) => c.atMs >= weekAgo).length;
          if (weekCount === 0) return null;
          return (
            <p className="text-xs text-text-muted">
              {weekCount} {weekCount > 1 ? "changes" : "change"} saved this week
            </p>
          );
        })()}
      </div>
      {(briefRows.length > 0 || interactive) && (
        <dl className="space-y-2 border-t border-border-subtle pt-3">
          {briefRows.map(([label, value]) => (
            <div key={label}>
              <dt className="ui-micro-label">{label}</dt>
              <dd className="text-sm leading-relaxed text-text-secondary">{value}</dd>
            </div>
          ))}
          {interactive && (
            <GoalEditor
              projectKey={detail.project.name}
              definitionOfDone={attrs.definition_of_done ?? null}
              maxTurns={goalMaxTurns}
            />
          )}
        </dl>
      )}
    </SectionShell>
  );
}

/** NEXT — the resume state from the latest handoff + linked goals. */
export function NextSection({
  dossier,
  interactive = true,
  showGoals = true,
  ownerView = false,
}: {
  dossier: ProjectDossier;
  interactive?: boolean;
  showGoals?: boolean;
  /** Owner view: the empty-state copy may point at the page's own controls.
   *  The dispatch button itself lives in ProjectBuildStatus above — one CTA. */
  ownerView?: boolean;
}) {
  const latest = latestDevLog(dossier);
  const goals = dossier.detail.linkedGoals;
  // A stale handoff's "next" is a week-old verification chore (and it's already
  // echoed in the changelog). Only trust it when fresh; otherwise fall back to
  // the project's planned next step, then the top unfinished goal.
  const handoffMs = dossier.state?.sessionUpdatedAt?.getTime() ?? null;
  const staleHandoff = handoffMs != null && dossier.builtAtMs - handoffMs > DOSSIER_STALE_MS;
  const topOpenGoal = goals.find((g) => (g.progress ?? 0) < 100);
  const next =
    (staleHandoff ? null : latest?.next?.trim()) ||
    answer(dossier.detail.attrs.next_step) ||
    (topOpenGoal ? `Advance: ${topOpenGoal.title}` : null);

  return (
    <SectionShell title="Next step">
      {next ? (
        <p className="text-base leading-relaxed text-text-primary">{plainWords(next)}</p>
      ) : (
        // The old copy here sent people to another page to do the one thing
        // this page exists for. Point at the controls that are already on it.
        <p className="text-sm text-text-muted">
          {ownerView
            ? "Nothing planned yet. Set it under Plan, or press Make it happen."
            : "Nothing planned yet."}
        </p>
      )}
      {showGoals && goals.length > 0 && (
        <div className="space-y-2.5 border-t border-border-subtle pt-3">
          {goals.map((goal) => (
            <div key={goal.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-text-secondary">{goal.title}</span>
                <span className="text-xs text-text-muted">{goal.progress ?? 0}%</span>
              </div>
              <GoalProgressBar value={goal.progress ?? 0} />
            </div>
          ))}
        </div>
      )}
      {interactive && (
        <div className="pt-1">
          <Link href="/control" className="ui-btn-secondary inline-flex">
            Dispatch from Control
          </Link>
        </div>
      )}
    </SectionShell>
  );
}

/** DONE — the report: changelog (dev log) + run history with outcomes/commits. */
export function DoneSection({ dossier }: { dossier: ProjectDossier }) {
  const entries = dedupeDevLog(devLogNewestFirst(dossier));
  const runs = dossier.runs.filter((run) => run.finishedAt);
  // Cap the inline list: a dossier once buried its shipped changelog under
  // ~30 stale timeout rows from the box-credential outage. Show the recent few;
  // the full timeline lives one click away in Activity.
  const RUN_HISTORY_LIMIT = 6;
  const shownRuns = runs.slice(0, RUN_HISTORY_LIMIT);
  const hiddenRunCount = runs.length - shownRuns.length;

  return (
    <SectionShell title="Recent work">
      {entries.length === 0 && runs.length === 0 && (dossier.commits?.length ?? 0) === 0 && (
        <p className="text-sm text-text-muted">
          Nothing yet. Each piece of work shows up here when it is done.
        </p>
      )}
      {(dossier.commits?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="ui-project-subhead">Saved changes</p>
          <ul className="space-y-1">
            {dossier.commits!.slice(0, 5).map((commit) => (
              <li
                key={commit.sha}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
              >
                <span className="text-text-muted tabular-nums">{timeAgo(commit.atMs)}</span>
                <span
                  className="min-w-0 flex-1 truncate text-text-secondary"
                  title={commit.message}
                >
                  {commit.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {entries.length > 0 && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="ui-project-subhead">What changed</p>
          <DevLogList entries={entries} />
        </div>
      )}
      {runs.length > 0 && (
        <div className="space-y-2 border-t border-border-subtle pt-3">
          <p className="ui-project-subhead">Past work</p>
          <ul className="space-y-1.5">
            {shownRuns.map((run) => {
              const errorText = typeof run.payload?.error === "string" ? run.payload.error : null;
              const outcome = OUTCOME_WORDS[run.outcome ?? ""] ?? {
                word: run.finishedAt ? "Finished" : "Running",
                dot: null,
              };
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                >
                  <span className="text-text-muted tabular-nums">
                    {run.startedAt.toLocaleDateString(APP_LOCALE, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-text-secondary">
                    {outcome.dot && <span className={`ui-dot ${outcome.dot}`} aria-hidden />}
                    {outcome.word}
                  </span>
                  {runDuration(run) && <span className="text-text-muted">{runDuration(run)}</span>}
                  {run.outcome !== "success" && errorText && (
                    <span className="w-full truncate text-text-muted">{plainWords(errorText)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <Link
            href={`/activity?window=month&project=${encodeURIComponent(dossier.detail.project.name)}`}
            className="inline-block text-xs text-accent-text underline-offset-2 hover:underline"
          >
            {hiddenRunCount > 0 ? `See all activity (${hiddenRunCount} more)` : "See all activity"}
          </Link>
        </div>
      )}
    </SectionShell>
  );
}

function devLogNewestFirst(dossier: ProjectDossier): DevLogEntry[] {
  return [...((dossier.detail.devLog ?? []) as DevLogEntry[])].reverse();
}

/** Collapse near-duplicate changelog entries (an agent re-writing the same
 *  handoff verbatim) by a normalized prefix of the `done` line, and cap the
 *  visible list so one fix's step-by-step handoffs don't read as a wall. */
function dedupeDevLog(entries: DevLogEntry[], limit = 5): DevLogEntry[] {
  const seen = new Set<string>();
  const out: DevLogEntry[] = [];
  for (const e of entries) {
    const key = (e.done ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 48);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

function latestDevLog(dossier: ProjectDossier): DevLogEntry | null {
  return devLogNewestFirst(dossier)[0] ?? null;
}
