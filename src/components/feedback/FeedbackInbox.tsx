"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, MessagesSquare } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { compactDurationHours } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS, type FeedbackStatus } from "@/lib/constants/statuses";
import { WAITING_ON } from "@/lib/feedback/work-phase";
import { StatRow } from "@/components/ui/stat-row";
import { StatCard } from "@/components/ui/card";
import type { FeedbackLoopMetrics, UserFeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackWorkView } from "@/lib/feedback/work-phase";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { useFeedbackActions } from "@/components/feedback/use-feedback-actions";
import { cn } from "@/lib/utils";

type InboxItem = UserFeedbackListItem & { work: FeedbackWorkView };

const SOURCE_FILTERS = [
  { key: null, label: "All sources" },
  { key: FEEDBACK_SOURCE.VISITOR, label: "Visitors" },
  { key: FEEDBACK_SOURCE.AI_REVIEW, label: "AI review" },
  { key: FEEDBACK_SOURCE.SYNTHESIZER, label: "Briefs" },
] as const;

/**
 * The cross-project feedback inbox behind /feedback. Separation of concerns:
 * Control stays operations (what is running), Projects stays the catalog —
 * this page owns the ironing-out loop: every report across the fleet, what
 * phase its fix is in, and the next action, without opening a project first.
 *
 * Three groups, keyed on WHO IS BLOCKED (work.waitingOn), never on DB status:
 * Needs you (your move — triage, retry, or look at a fix that is live), Under
 * way (an agent is generating, a green pull request is merging, a deploy is
 * running — nothing for you to do), Shipped (resolved). Archived stays behind a
 * toggle. Status could not answer the page's one question: `dispatched` covers
 * both an agent mid-run and a fix that deployed an hour ago.
 */
export function FeedbackInbox() {
  // `loadError` is aliased because `error` below is the *mutation* error from
  // useFeedbackActions. They are different failures and the page shows them in
  // different places; sharing the name is how the load error got dropped.
  const {
    data,
    loading,
    error: loadError,
    refetch,
  } = useFetch<{
    feedback: InboxItem[];
    metrics: FeedbackLoopMetrics | null;
  }>("/api/feedback/inbox");
  const searchParams = useSearchParams();
  const [projectFilter, setProjectFilter] = useState<string | null>(() =>
    searchParams.get("project"),
  );
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { busyId, error, dispatchFix, setStatus, feature } = useFeedbackActions(refetch);

  const all = useMemo(() => data?.feedback ?? [], [data]);
  const metrics = data?.metrics ?? null;

  // Same honesty poll as the project section: while any fix is in flight,
  // keep the phases fresh.
  useEffect(() => {
    const live = all.some(
      (f) => f.status !== FEEDBACK_STATUS.RESOLVED && f.work.waitingOn === WAITING_ON.MACHINE,
    );
    if (!live) return;
    const t = window.setInterval(() => refetch(), 8_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while any row is live; refetch identity is stable enough
  }, [all.map((f) => `${f.work.phase}:${f.work.waitingOn}`).join("|")]);

  // Project chips come from the data itself — a project appears here exactly
  // when it has feedback, with its open count.
  const projects = useMemo(() => {
    const byName = new Map<string, { name: string; open: number }>();
    for (const f of all) {
      if (f.status === FEEDBACK_STATUS.ARCHIVED) continue;
      const entry = byName.get(f.projectName) ?? { name: f.projectName, open: 0 };
      if (f.status === FEEDBACK_STATUS.NEW || f.status === FEEDBACK_STATUS.DISPATCHED)
        entry.open += 1;
      byName.set(f.projectName, entry);
    }
    return [...byName.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  }, [all]);

  const filtered = all.filter((f) => {
    if (projectFilter && f.projectName !== projectFilter) return false;
    if (sourceFilter && (f.source ?? FEEDBACK_SOURCE.VISITOR) !== sourceFilter) return false;
    return true;
  });

  // Grouped by WHO IS BLOCKED, not by DB status. `dispatched` covers both an
  // agent mid-run and a fix that deployed an hour ago and is waiting for you
  // to look — filing both under "In progress" hid the one row that needed a
  // person. work.waitingOn is the SSOT (see work-phase.ts).
  const active = filtered.filter((f) => f.status !== FEEDBACK_STATUS.ARCHIVED);
  const needsYou = active.filter(
    (f) => f.status !== FEEDBACK_STATUS.RESOLVED && f.work.waitingOn === WAITING_ON.YOU,
  );
  const underWay = active.filter(
    (f) => f.status !== FEEDBACK_STATUS.RESOLVED && f.work.waitingOn === WAITING_ON.MACHINE,
  );
  const shipped = filtered.filter((f) => f.status === FEEDBACK_STATUS.RESOLVED);
  const archived = filtered.filter((f) => f.status === FEEDBACK_STATUS.ARCHIVED);

  if (loading && all.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-text-tertiary">
        <Loader2 className="ui-spinner-xs" /> Loading your inbox…
      </div>
    );
  }

  // An empty list because the request failed is not "no feedback yet" — it is
  // an unanswered question, and this page is the one place an operator checks
  // to be sure nothing is waiting. Answer the question that was actually asked.
  if (all.length === 0 && loadError) {
    return (
      <EmptyState icon={AlertTriangle} title="Couldn't load feedback">
        The inbox request failed, so this is not a claim that there is no feedback.{" "}
        <button
          type="button"
          onClick={refetch}
          className="text-accent-text underline-offset-2 hover:underline"
        >
          Try again
        </button>
        .
      </EmptyState>
    );
  }

  if (all.length === 0) {
    return (
      <EmptyState icon={MessagesSquare} title="No feedback yet">
        Feedback lands here from every project&apos;s widget — visitor reports, AI-review findings,
        and synthesized briefs, each with the live status of its fix. Enable the widget on a project
        page (Feedback section → Widget), or read{" "}
        <Link
          href="/docs/feedback-widget"
          className="text-accent-text underline-offset-2 hover:underline"
        >
          how the widget works
        </Link>
        .
      </EmptyState>
    );
  }

  // Filters earn their row only when they can change what is shown: one
  // project needs no project chips, one source needs no source chips. On a
  // project-scoped view (?project=…) the project is the page's subject, so it
  // is named once in the heading and the rows stop repeating it.
  const sourcesPresent = new Set(all.map((f) => f.source ?? FEEDBACK_SOURCE.VISITOR));
  const showProjectChips = projects.length > 1;
  // One project in the whole inbox: naming it on every row is the same noise
  // as naming it in a filter nobody can change.
  const hideProject = !!projectFilter || projects.length <= 1;
  const showSourceChips = sourcesPresent.size > 1;
  const nothingWaiting = needsYou.length === 0 && underWay.length === 0;

  return (
    <div className="space-y-6">
      {(showProjectChips || showSourceChips || projectFilter) && (
        <div className="flex flex-wrap items-center gap-2">
          {projectFilter && !showProjectChips ? (
            <button
              type="button"
              onClick={() => setProjectFilter(null)}
              className="ui-projects-filter-chip ui-projects-filter-chip-active"
              title="Show every project"
            >
              {projectFilter}
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
          {showProjectChips && (
            <>
              <button
                type="button"
                onClick={() => setProjectFilter(null)}
                className={cn(
                  "ui-projects-filter-chip",
                  projectFilter === null && "ui-projects-filter-chip-active",
                )}
              >
                All projects
              </button>
              {projects.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setProjectFilter((v) => (v === p.name ? null : p.name))}
                  className={cn(
                    "ui-projects-filter-chip",
                    projectFilter === p.name && "ui-projects-filter-chip-active",
                  )}
                >
                  {p.name}
                  {p.open > 0 && <span className="ui-projects-filter-count">{p.open}</span>}
                </button>
              ))}
            </>
          )}
          {showProjectChips && showSourceChips && (
            <span className="mx-1 hidden h-4 w-px bg-border-subtle sm:block" aria-hidden="true" />
          )}
          {showSourceChips &&
            SOURCE_FILTERS.filter((s) => s.key === null || sourcesPresent.has(s.key)).map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSourceFilter(s.key)}
                className={cn(
                  "ui-projects-filter-chip",
                  sourceFilter === s.key && "ui-projects-filter-chip-active",
                )}
              >
                {s.label}
              </button>
            ))}
        </div>
      )}

      {error && <p className="ui-error">{error}</p>}
      {/* The loop in three numbers. Fleet-wide, so it is hidden under a
          project filter rather than quietly answering a different question. */}
      {!projectFilter && metrics && metrics.total > 0 && (
        <StatRow>
          <StatCard
            label="Reports"
            value={String(metrics.total)}
            sub={metrics.open > 0 ? `${metrics.open} still open` : "all handled"}
          />
          <StatCard
            label="Shipped"
            value={String(metrics.resolved)}
            sub={
              metrics.resolved30d > 0
                ? `${metrics.resolved30d} in the last 30 days`
                : "none in the last 30 days"
            }
          />
          {/* "Report → fix" overstated it: resolved_at is stamped when the
              operator presses Confirm, so the number is dominated by how long
              they took to look, not by how fast the loop shipped. Name what is
              actually measured. */}
          <StatCard
            label="Report → confirmed"
            value={
              metrics.medianResolutionHours != null
                ? compactDurationHours(metrics.medianResolutionHours)
                : "—"
            }
            sub={metrics.medianResolutionHours != null ? "median" : "nothing confirmed yet"}
          />
        </StatRow>
      )}

      {/* One sentence when the answer is "nothing" — three headed sections each
          saying it was the noise. Sections render only when they hold rows. */}
      {nothingWaiting && (
        <p className="text-sm text-text-tertiary">
          Nothing waiting on you
          {projectFilter ? ` for ${projectFilter}` : ""}.
        </p>
      )}

      {needsYou.length > 0 && (
        <InboxSection title="Needs you" count={needsYou.length}>
          {needsYou.map((f) => (
            <Row
              key={f.id}
              f={f}
              busyId={busyId}
              dispatchFix={dispatchFix}
              setStatus={setStatus}
              feature={feature}
              hideProject={hideProject}
            />
          ))}
        </InboxSection>
      )}

      {underWay.length > 0 && (
        <InboxSection
          title="Under way"
          count={underWay.length}
          aside={
            underWay.some((f) => f.work.phase === "queued")
              ? "Watch for progress — Telegram if it stalls"
              : "moving on its own — Watch if you want to see"
          }
        >
          {underWay.map((f) => (
            <Row
              key={f.id}
              f={f}
              busyId={busyId}
              dispatchFix={dispatchFix}
              setStatus={setStatus}
              feature={feature}
              hideProject={hideProject}
            />
          ))}
        </InboxSection>
      )}

      {shipped.length > 0 && (
        <InboxSection
          title="Shipped"
          count={shipped.length}
          aside={
            metrics &&
            metrics.resolved > 0 &&
            metrics.medianResolutionHours != null &&
            !projectFilter
              ? `median ${compactDurationHours(metrics.medianResolutionHours)} report→fix`
              : undefined
          }
        >
          {shipped.map((f) => (
            <Row
              key={f.id}
              f={f}
              busyId={busyId}
              dispatchFix={dispatchFix}
              setStatus={setStatus}
              feature={feature}
              hideProject={hideProject}
            />
          ))}
        </InboxSection>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-text-muted underline-offset-2 hover:underline"
            aria-expanded={showArchived}
          >
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </button>
          {showArchived && (
            <div className="mt-2 divide-y divide-border-subtle opacity-70">
              {archived.map((f) => (
                <Row
                  key={f.id}
                  f={f}
                  busyId={busyId}
                  dispatchFix={dispatchFix}
                  setStatus={setStatus}
                  feature={feature}
                  hideProject={hideProject}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InboxSection({
  title,
  count,
  aside,
  children,
}: {
  title: string;
  count: number;
  /** A quiet fact for the right edge of the heading, e.g. the median report→fix. */
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1 flex items-baseline gap-2 text-sm font-semibold text-text-primary">
        {title}
        <span className="ui-badge">{count}</span>
        {aside && <span className="ml-auto text-xs font-normal text-text-muted">{aside}</span>}
      </h2>
      <div className="divide-y divide-border-subtle">{children}</div>
    </section>
  );
}

function Row({
  f,
  busyId,
  dispatchFix,
  setStatus,
  feature,
  hideProject,
}: {
  f: InboxItem;
  busyId: string | null;
  dispatchFix: (id: string, opts?: { note?: string; agent?: string }) => void;
  setStatus: (id: string, status: FeedbackStatus) => void;
  feature: (id: string, featured: boolean) => void;
  /** On a project-scoped view the project is the heading, not a per-row chip. */
  hideProject?: boolean;
}) {
  return (
    <FeedbackItemRow
      feedback={f}
      projectName={f.projectName}
      project={hideProject ? null : { id: f.projectId, name: f.projectName }}
      busy={busyId === f.id}
      onDispatch={(opts) => dispatchFix(f.id, opts ?? {})}
      onResolve={() => setStatus(f.id, FEEDBACK_STATUS.RESOLVED)}
      onArchive={() => setStatus(f.id, FEEDBACK_STATUS.ARCHIVED)}
      onReopen={() => setStatus(f.id, FEEDBACK_STATUS.NEW)}
      onFeature={() => feature(f.id, !f.featuredAt)}
    />
  );
}
