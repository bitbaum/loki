"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Inbox, Loader2, MessagesSquare } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { compactDurationHours } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS, type FeedbackStatus } from "@/lib/constants/statuses";
import { WAITING_ON } from "@/lib/feedback/work-phase";
import type { FeedbackLoopMetrics, UserFeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackWorkView } from "@/lib/feedback/work-phase";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { useFeedbackActions } from "@/components/feedback/use-feedback-actions";
import { foldSameFailures, SHIPPED_SHOWN } from "@/lib/feedback/inbox-groups";
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
/**
 * The line under the Reports total, which must ACCOUNT for the total.
 *
 * `open` is new + dispatched and `resolved` is shipped, so a reader who
 * subtracts is left holding a remainder with no name. Prod on 2026-09-20:
 * "68 reports · 29 still open" beside "32 shipped" — and 29 + 32 is 61. The
 * other seven were archived: filed away rather than fixed, a state no card
 * admitted existed.
 *
 * Pure and exported so the arithmetic is pinned without rendering: three
 * numbers that do not reconcile look exactly like three numbers that do.
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
  // `?project=` is a name or an entity id — both are handed out as links
  // (My feedback and the claim page know only the id). Resolved against the
  // data once it is here; a value that matches nothing filters nothing,
  // instead of printing an id at the reader (2026-09-28: "Nothing waiting on
  // you for 5936f8fb-…").
  const requestedProject = searchParams.get("project");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showAllShipped, setShowAllShipped] = useState(false);
  const { busyId, error, notice, dispatchFix, setStatus, feature } = useFeedbackActions(refetch);

  const all = useMemo(() => data?.feedback ?? [], [data]);
  const metrics = data?.metrics ?? null;

  useEffect(() => {
    if (!requestedProject || all.length === 0) return;
    const match = all.find(
      (f) => f.projectName === requestedProject || f.projectId === requestedProject,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving a URL param against fetched data
    setProjectFilter(match ? match.projectName : null);
  }, [requestedProject, all]);

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
  const needsYouFolded = foldSameFailures(needsYou);
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
  const hideProject = !!projectFilter || projects.length <= 1;
  const showSourceChips = sourcesPresent.size > 1;
  const nothingWaiting = needsYou.length === 0 && underWay.length === 0;
  const current = projectFilter ? projects.find((p) => p.name === projectFilter) : null;

  return (
    <div className="space-y-5">
      {/* One chip primitive for both filter rows — the Control inbox's
          (`ui-inbox-project`): a 36px pill that never wraps, in a row that
          scrolls sideways on a phone. This page used to draw its project
          chips in one style and its source chips in another, and let a chip
          wrap into two lines ("All / projects") when the row got tight. */}
      {(showProjectChips || showSourceChips) && (
        <div className="space-y-1.5">
          {showProjectChips && (
            <div
              className="ui-inbox-projects ui-scroll-fade-right"
              role="group"
              aria-label="Filter reports by project"
            >
              <FilterChip active={projectFilter === null} onClick={() => setProjectFilter(null)}>
                All projects
              </FilterChip>
              {projects.map((p) => (
                <FilterChip
                  key={p.name}
                  active={projectFilter === p.name}
                  onClick={() => setProjectFilter((v) => (v === p.name ? null : p.name))}
                  count={p.open}
                >
                  {p.name}
                </FilterChip>
              ))}
            </div>
          )}
          {showSourceChips && (
            <div
              className="ui-inbox-projects ui-scroll-fade-right"
              role="group"
              aria-label="Filter reports by source"
            >
              {SOURCE_FILTERS.filter((s) => s.key === null || sourcesPresent.has(s.key)).map(
                (s) => (
                  <FilterChip
                    key={s.label}
                    active={sourceFilter === s.key}
                    onClick={() => setSourceFilter(s.key)}
                  >
                    {s.label}
                  </FilterChip>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* The loop in one quiet line, fleet-wide — three bordered cards holding
          three numbers were the loudest thing on a page whose job is the rows
          under them. Hidden under a project filter rather than quietly
          answering a different question. */}
      {!projectFilter && metrics && metrics.total > 0 && (
        <p className="text-xs text-text-tertiary">{metricsLine(metrics)}</p>
      )}
      {/* Under a project filter the subject is named in words, not only by
          which chip is outlined: the rows below drop their project chip. */}
      {current && !nothingWaiting && (
        <p className="text-xs text-text-tertiary">
          Showing {current.name}
          {current.open > 0 ? ` · ${current.open} open` : ""} ·{" "}
          <button type="button" onClick={() => setProjectFilter(null)} className="ui-link-muted">
            All projects
          </button>
        </p>
      )}

      {error && <p className="ui-error">{error}</p>}
      {notice && <p className="ui-callout-warning">{notice}</p>}

      {/* When the answer is "nothing", say so AND say what to do next: the
          same screen must carry the way forward (a bare "Nothing waiting on
          you for <project>." left the owner asking what to do — 2026-09-28). */}
      {nothingWaiting && (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          size="sm"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {projectFilter && (
                <button
                  type="button"
                  onClick={() => setProjectFilter(null)}
                  className="ui-btn-secondary"
                >
                  Show all projects
                </button>
              )}
              {current && (
                <Link href={`/projects/${current.id}`} className="ui-btn-secondary">
                  Open {current.name}
                </Link>
              )}
            </div>
          }
        >
          {projectFilter
            ? `${projectFilter} has ${shipped.length} shipped and nothing open.`
            : "Every report is either shipped or with an agent. New ones appear here as they arrive."}
        </EmptyState>
      )}

      {needsYou.length > 0 && (
        <InboxSection title="Needs you" count={needsYou.length}>
          {needsYouFolded.rows.map((f) => (
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
          {/* Failures that share one reason fold into one line that says the
              reason once; each report is still its own row, one tap away, with
              its own Retry — there is deliberately no "retry all": one tap
              starting dozens of agent runs is a decision, not a default. */}
          {needsYouFolded.folds.map((fold) => (
            <details key={fold.cause} className="ui-inbox-fold">
              <summary className="ui-inbox-fold-summary">
                <span className="ui-inbox-fold-count">
                  {fold.items.length} fixes failed the same way
                </span>
                <span className="ui-inbox-fold-cause">{fold.cause}</span>
              </summary>
              {fold.items.map((f) => (
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
            </details>
          ))}
        </InboxSection>
      )}

      {underWay.length > 0 && (
        <InboxSection title="Under way" count={underWay.length} note="moving on its own">
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
        <InboxSection title="Shipped" count={shipped.length}>
          {/* Nothing here asks for a decision, so the newest few stand for the
              rest — all 36 rendered in full were most of a 17,000px page. */}
          {(showAllShipped ? shipped : shipped.slice(0, SHIPPED_SHOWN)).map((f) => (
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
          {shipped.length > SHIPPED_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAllShipped((v) => !v)}
              aria-expanded={showAllShipped}
              className="ui-inbox-fold-summary"
            >
              {showAllShipped ? "Show fewer" : `Show all ${shipped.length} shipped`}
            </button>
          )}
        </InboxSection>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="ui-link-muted"
            aria-expanded={showArchived}
          >
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </button>
          {showArchived && (
            <div className="mt-2 opacity-70">
              <InboxSection title="Archived" count={archived.length}>
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
              </InboxSection>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The fleet-wide loop as one sentence. Pure; pinned by feedback-numbers-add-up. */
export function metricsLine(m: FeedbackLoopMetrics): string {
  const parts = [
    `${m.total} reports`,
    m.open > 0 ? `${m.open} open` : null,
    `${m.resolved} shipped${m.resolved30d > 0 ? ` (${m.resolved30d} in the last 30 days)` : ""}`,
    m.archived > 0 ? `${m.archived} archived` : null,
    m.medianResolutionHours != null
      ? `${compactDurationHours(m.medianResolutionHours)} median to confirmed`
      : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ");
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // A chip row scrolls sideways on a phone; a filter set from the URL must
  // not leave its own chip out of sight (rendered at 390px: "All projects"
  // in view, "petvity" three chips off the right edge).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("ui-inbox-project whitespace-nowrap", active && "ui-inbox-project-active")}
    >
      {children}
      {count != null && count > 0 && <span className="ui-inbox-project-count">{count}</span>}
    </button>
  );
}

function InboxSection({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  /** A quiet fact for the heading's right edge. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ui-inbox" aria-label={title}>
      <header className="ui-inbox-head">
        <h2 className="ui-inbox-title">{title}</h2>
        {note && <span className="ui-inbox-group-note">{note}</span>}
        <span className="ui-inbox-total">{count}</span>
      </header>
      <div className="ui-inbox-group-body ui-inbox-list">{children}</div>
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
