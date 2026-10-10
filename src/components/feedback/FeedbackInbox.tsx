"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, MessagesSquare } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { compactDurationHours } from "@/lib/dates";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { WAITING_ON } from "@/lib/feedback/work-phase";
import type { FeedbackLoopMetrics, UserFeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackWorkView } from "@/lib/feedback/work-phase";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { DecisionCard } from "@/components/feedback/DecisionCard";
import { useFeedbackActions } from "@/components/feedback/use-feedback-actions";
import {
  RECOMMEND,
  doAllLabel,
  looksLine,
  recommendFor,
  summarizeDecisions,
  type Recommendation,
} from "@/lib/feedback/recommend";

type InboxItem = UserFeedbackListItem & { work: FeedbackWorkView };

/**
 * /feedback — a queue of decisions Loki has already made, waiting for a yes.
 *
 * Rebuilt 2026-10-10 on the owner's rule: "if my involvement is needed, it
 * shouldn't take me more than 10 milliseconds … I should be able to tap
 * once and have some confidence that this tap leads to the correct
 * improvement, because all the evaluation was done before that one option
 * was given to me."
 *
 * So the page is not an inbox. It opens with how many decisions there are
 * and ONE button that takes all of them (saying what it spends). Each
 * decision is a card: Loki's recommendation as the verb, the reason in one
 * sentence, the report beneath in smaller type, one filled button. Reading
 * is optional; disagreeing is one tap away ("Something else" opens the full
 * row). Everything that is not a decision — agents at work, fixes you
 * confirmed, reports filed away — sits in collapsed lines under the queue.
 *
 * The project picker is part of the heading, so the count it changes is
 * the count beside it.
 */
export function reportsSubLine(m: {
  total: number;
  open: number;
  resolved: number;
  archived: number;
}): string {
  const parts = [
    m.open > 0 ? `${m.open} still open` : null,
    m.archived > 0 ? `${m.archived} archived` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(" · ") : "all handled";
}

export function FeedbackInbox() {
  const {
    data,
    loading,
    error: loadError,
    refetch,
  } = useFetch<{
    feedback: InboxItem[];
    metrics: FeedbackLoopMetrics | null;
    night: { night: string; note: string } | null;
  }>("/api/feedback/inbox");
  const searchParams = useSearchParams();
  const requestedProject = searchParams.get("project");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const { busyId, error, notice, dispatchFix, runInCloud, setStatus, feature } =
    useFeedbackActions(refetch);
  /** Decisions taken on this screen: the card says "Done" until the list refreshes. */
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const all = useMemo(() => data?.feedback ?? [], [data]);
  const metrics = data?.metrics ?? null;
  const night = data?.night ?? null;

  useEffect(() => {
    if (!requestedProject || all.length === 0) return;
    const match = all.find(
      (f) => f.projectName === requestedProject || f.projectId === requestedProject,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving a URL param against fetched data
    setProjectFilter(match ? match.projectName : null);
  }, [requestedProject, all]);

  // While any fix is in flight, keep the phases fresh.
  useEffect(() => {
    const live = all.some(
      (f) => f.status !== FEEDBACK_STATUS.RESOLVED && f.work.waitingOn === WAITING_ON.MACHINE,
    );
    if (!live) return;
    const t = window.setInterval(() => refetch(), 8_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while any row is live
  }, [all.map((f) => `${f.work.phase}:${f.work.waitingOn}`).join("|")]);

  const projects = useMemo(() => {
    const byName = new Map<string, { name: string; id: string; open: number }>();
    for (const f of all) {
      if (f.status === FEEDBACK_STATUS.ARCHIVED) continue;
      const entry = byName.get(f.projectName) ?? { name: f.projectName, id: f.projectId, open: 0 };
      if (f.status === FEEDBACK_STATUS.NEW || f.status === FEEDBACK_STATUS.DISPATCHED)
        entry.open += 1;
      byName.set(f.projectName, entry);
    }
    return [...byName.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  }, [all]);

  const filtered = projectFilter ? all.filter((f) => f.projectName === projectFilter) : all;

  // The clock the recommendations are judged against: taken once per load
  // of the list (a render must not read the clock, and a decision does not
  // change by the second).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-stamp when the list reloads
    setNow(Date.now());
  }, [data]);
  // Loki's decision per row, surest and cheapest first.
  const decisions = useMemo(() => {
    return filtered
      .map((f) => ({
        f,
        rec: recommendFor(
          {
            status: f.status,
            work: f.work,
            source: f.source ?? null,
            createdAt: f.createdAt,
            duplicateCount: f.duplicateCount,
            runnable: f.runnable !== false,
            page: f.page ?? null,
          },
          now,
        ),
      }))
      .filter((d): d is { f: InboxItem; rec: Recommendation } => d.rec !== null)
      .sort((a, b) => b.rec.priority - a.rec.priority);
  }, [filtered, now]);
  const decided = new Set(decisions.map((d) => d.f.id));
  const underWay = filtered.filter(
    (f) =>
      f.status !== FEEDBACK_STATUS.RESOLVED &&
      f.status !== FEEDBACK_STATUS.ARCHIVED &&
      !decided.has(f.id),
  );
  const done = filtered.filter((f) => f.status === FEEDBACK_STATUS.RESOLVED);
  const archived = filtered.filter((f) => f.status === FEEDBACK_STATUS.ARCHIVED);
  const summary = summarizeDecisions(decisions.filter((d) => !taken.has(d.f.id)).map((d) => d.rec));

  /** Take one decision — the same routes the full row uses. */
  const take = async (f: InboxItem, rec: Recommendation) => {
    switch (rec.kind) {
      case RECOMMEND.CONFIRM:
        await setStatus(f.id, FEEDBACK_STATUS.RESOLVED);
        break;
      case RECOMMEND.BUILD:
      case RECOMMEND.RETRY:
        await dispatchFix(f.id, {});
        break;
      case RECOMMEND.CLOUD:
        if (f.work.commandId) await runInCloud(f.id, f.work.commandId);
        else await dispatchFix(f.id, {});
        break;
      case RECOMMEND.FILE:
        await setStatus(f.id, FEEDBACK_STATUS.ARCHIVED, rec.archiveReason);
        break;
      case RECOMMEND.CONNECT:
      case RECOMMEND.LOOK:
        return;
    }
    setTaken((s) => new Set(s).add(f.id));
  };

  const takeAll = async () => {
    const todo = decisions.filter(
      (d) =>
        d.rec.kind !== RECOMMEND.CONNECT && d.rec.kind !== RECOMMEND.LOOK && !taken.has(d.f.id),
    );
    setBatch({ done: 0, total: todo.length });
    for (const [i, d] of todo.entries()) {
      await take(d.f, d.rec);
      setBatch({ done: i + 1, total: todo.length });
    }
    setBatch(null);
  };

  if (loading && all.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-text-tertiary">
        <Loader2 className="ui-spinner-xs" /> Loading…
      </div>
    );
  }
  if (all.length === 0 && loadError) {
    return (
      <EmptyState icon={AlertTriangle} title="Couldn't load feedback">
        The request failed, so this is not a claim that nothing is waiting.{" "}
        <button type="button" onClick={refetch} className="ui-link-muted">
          Try again
        </button>
        .
      </EmptyState>
    );
  }
  if (all.length === 0) {
    return (
      <EmptyState icon={MessagesSquare} title="No feedback yet">
        Reports land here from every project&apos;s widget, each with Loki&apos;s recommended next
        step. Enable the widget on a project page, or read{" "}
        <Link href="/docs/feedback-widget" className="ui-link-muted">
          how the widget works
        </Link>
        .
      </EmptyState>
    );
  }

  const current = projectFilter ? projects.find((p) => p.name === projectFilter) : null;
  const rowFor = (f: InboxItem) => ({
    onDispatch: (opts?: { note?: string; agent?: string }) => dispatchFix(f.id, opts ?? {}),
    onRunInCloud: f.work.commandId ? () => runInCloud(f.id, f.work.commandId!) : undefined,
    onResolve: () => setStatus(f.id, FEEDBACK_STATUS.RESOLVED),
    onArchive: () => setStatus(f.id, FEEDBACK_STATUS.ARCHIVED),
    onReopen: () => setStatus(f.id, FEEDBACK_STATUS.NEW),
    onFeature: () => feature(f.id, !f.featuredAt),
  });
  const projectOf = (f: InboxItem) =>
    projectFilter || projects.length <= 1 ? null : { id: f.projectId, name: f.projectName };
  const open = summary.total - [...taken].filter((id) => decided.has(id)).length;

  return (
    <div className="space-y-5">
      {/* The heading IS the count and the scope: "6 decisions · substrata ▾". */}
      <div className="ui-fb-head">
        <h2 className="ui-fb-head-count">
          {open === 0 ? "Nothing to decide" : `${open} ${open === 1 ? "decision" : "decisions"}`}
        </h2>
        {projects.length > 1 && (
          <select
            value={projectFilter ?? ""}
            onChange={(e) => setProjectFilter(e.target.value || null)}
            className="ui-fb-select"
            aria-label="Which project"
          >
            <option value="">all projects</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {night && <p className="ui-fb-night">{night.note}</p>}

      {open > 0 && (
        <div className="ui-fb-doall">
          <p className="ui-fb-doall-text">
            Loki has already decided each one. Tap a card to agree, or take them all at once.
            {looksLine(summary) && <> {looksLine(summary)}</>}
          </p>
          <button
            type="button"
            onClick={() => void takeAll()}
            disabled={batch !== null || busyId !== null || summary.takeable === 0}
            className="ui-btn-save"
          >
            {batch ? (
              <>
                <Loader2 className="ui-spinner-xs" /> {batch.done} of {batch.total}
              </>
            ) : (
              doAllLabel(summary)
            )}
          </button>
        </div>
      )}

      {error && <p className="ui-error">{error}</p>}
      {notice && <p className="ui-callout-warning">{notice}</p>}

      {open === 0 ? (
        <p className="ui-fb-quiet-line">
          {current ? `${current.name}: ` : ""}
          {underWay.length
            ? `nothing waits on you — ${underWay.length} ${underWay.length === 1 ? "is" : "are"} under way.`
            : "nothing waits on you."}
        </p>
      ) : (
        <div className="ui-fb-decisions">
          {decisions.map(({ f, rec }) => (
            <DecisionCard
              key={f.id}
              item={f}
              rec={rec}
              busy={busyId === f.id}
              taken={taken.has(f.id)}
              project={projectOf(f)}
              onTake={() => void take(f, rec)}
              rowProps={rowFor(f)}
            />
          ))}
        </div>
      )}

      {/* Everything that is not a decision: one line each, open on demand. */}
      <Section
        title={`Under way · ${underWay.length}`}
        hint="Agents and deploys at work. Loki tells you when one needs you."
        items={underWay}
        rowFor={rowFor}
        projectOf={projectOf}
        busyId={busyId}
      />
      <Section
        title={`Done · ${done.length}`}
        hint="Fixes you confirmed. The walkthrough on the site stays one tap away."
        items={done}
        rowFor={rowFor}
        projectOf={projectOf}
        busyId={busyId}
        limit={10}
      />
      <Section
        title={`Filed away · ${archived.length}`}
        hint="Closed without a change, each with its reason. Reopen any of them."
        items={archived}
        rowFor={rowFor}
        projectOf={projectOf}
        busyId={busyId}
        limit={10}
      />

      <p className="ui-fb-foot">
        <span className="min-w-0">
          {metrics && metrics.total > 0 ? metricsLine(metrics) : null}
        </span>
        <Link href="/feedback/studio" className="ui-link-muted whitespace-nowrap">
          Studio requests →
        </Link>
      </p>
    </div>
  );
}

function Section({
  title,
  hint,
  items,
  rowFor,
  projectOf,
  busyId,
  limit,
}: {
  title: string;
  hint: string;
  items: InboxItem[];
  rowFor: (
    f: InboxItem,
  ) => Omit<Parameters<typeof FeedbackItemRow>[0], "feedback" | "projectName" | "project" | "busy">;
  projectOf: (f: InboxItem) => { id: string; name: string } | null;
  busyId: string | null;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = limit && !all ? items.slice(0, limit) : items;
  return (
    <details className="ui-fb-section">
      <summary>
        <span className="ui-fb-section-title">{title}</span>
        <span className="ui-fb-section-hint">{hint}</span>
      </summary>
      <div className="ui-fb-list">
        {shown.map((f) => (
          <FeedbackItemRow
            key={f.id}
            feedback={f}
            projectName={f.projectName}
            project={projectOf(f)}
            busy={busyId === f.id}
            {...rowFor(f)}
          />
        ))}
        {limit && items.length > limit && (
          <button type="button" onClick={() => setAll((v) => !v)} className="ui-fb-more">
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
      </div>
    </details>
  );
}

/** The fleet-wide loop as one sentence. Pure; pinned by feedback-numbers-add-up. */
export function metricsLine(m: FeedbackLoopMetrics): string {
  const parts = [
    `${m.total} reports`,
    m.open > 0 ? `${m.open} open` : null,
    `${m.resolved} done${m.resolved30d > 0 ? ` (${m.resolved30d} in the last 30 days)` : ""}`,
    m.archived > 0 ? `${m.archived} archived` : null,
    m.medianResolutionHours != null
      ? `${compactDurationHours(m.medianResolutionHours)} median to confirmed`
      : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ");
}
