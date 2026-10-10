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
 * Three lenses, keyed on WHO IS BLOCKED (work.waitingOn), never on DB status:
 * Needs you (your move — triage, retry, or look at a fix that is live), Under
 * way (an agent is generating, a green pull request is merging, a deploy is
 * running — nothing for you to do), Done (resolved). One lens shows at a
 * time, as one list — they used to stack as three bordered cards with grey
 * headers, which on a phone read as three unrelated widgets (2026-10-03).
 * Archived stays behind a toggle. Status could not answer the page's one question: `dispatched` covers
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
  const [chosenLens, setChosenLens] = useState<Lens | null>(null);
  const { busyId, error, notice, dispatchFix, runInCloud, setStatus, feature } =
    useFeedbackActions(refetch);

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

  // Filters earn their place only when they can change what is shown: one
  // project needs no project chips, one source needs no source picker. On a
  // project-scoped view (?project=…) the project is named once in the filter
  // line and the rows stop repeating it.
  const sourcesPresent = new Set(all.map((f) => f.source ?? FEEDBACK_SOURCE.VISITOR));
  const showProjectChips = projects.length > 1;
  const hideProject = !!projectFilter || projects.length <= 1;
  const showSourcePicker = sourcesPresent.size > 1;
  const current = projectFilter ? projects.find((p) => p.name === projectFilter) : null;
  const counts: Record<Lens, number> = {
    [LENS.NEEDS_YOU]: needsYou.length,
    [LENS.UNDER_WAY]: underWay.length,
    [LENS.SHIPPED]: shipped.length,
  };
  // The lens follows the work unless the reader chose one: open on the first
  // view that holds something, so an empty "Needs you" never greets a page
  // whose agents are busy.
  const lens: Lens = chosenLens ?? defaultLens(counts);
  const rowProps = { busyId, dispatchFix, runInCloud, setStatus, feature, hideProject };

  return (
    <div className="space-y-4">
      <div className="ui-fb-filters">
        {showProjectChips && (
          <div
            className="ui-inbox-projects ui-scroll-fade-right mb-0"
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
        {/* One quiet line: what you are looking at, how to narrow it, and the
            sibling page. The loop's numbers live here instead of in cards; the
            Studio requests link lives here instead of in a lone bordered
            button above everything. */}
        <div className="ui-fb-filterline">
          <span className="min-w-0">
            {current
              ? `${current.name} · ${current.open > 0 ? `${current.open} open` : "nothing open"}`
              : metrics && metrics.total > 0
                ? metricsLine(metrics)
                : null}
          </span>
          <span className="ui-fb-filterline-tools">
            {showSourcePicker && (
              <select
                value={sourceFilter ?? ""}
                onChange={(e) => setSourceFilter(e.target.value || null)}
                className="ui-fb-select"
                aria-label="Filter reports by source"
              >
                {SOURCE_FILTERS.filter((s) => s.key === null || sourcesPresent.has(s.key)).map(
                  (s) => (
                    <option key={s.label} value={s.key ?? ""}>
                      {s.label}
                    </option>
                  ),
                )}
              </select>
            )}
            <Link href="/feedback/studio" className="ui-link-muted whitespace-nowrap">
              Studio requests →
            </Link>
          </span>
        </div>
      </div>

      <div>
        <div className="ui-fb-lens" role="tablist" aria-label="Which reports">
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={lens === l.key}
              onClick={() => setChosenLens(l.key)}
              className="ui-fb-lens-tab"
            >
              <span
                className={cn(
                  "ui-fb-lens-count",
                  l.key === LENS.NEEDS_YOU && counts[l.key] > 0 && "ui-fb-lens-count-due",
                )}
              >
                {counts[l.key]}
              </span>
              <span className="ui-fb-lens-label">{l.label}</span>
            </button>
          ))}
        </div>
        <p className="ui-fb-lens-hint">{LENSES.find((l) => l.key === lens)!.hint}</p>
      </div>

      {error && <p className="ui-error">{error}</p>}
      {notice && <p className="ui-callout-warning">{notice}</p>}

      {counts[lens] === 0 ? (
        <LensEmpty
          lens={lens}
          counts={counts}
          projectName={projectFilter}
          projectId={current?.id ?? null}
          onLens={setChosenLens}
          onAllProjects={() => setProjectFilter(null)}
        />
      ) : lens === LENS.NEEDS_YOU ? (
        <div className="ui-fb-list">
          {needsYouFolded.rows.map((f) => (
            <Row key={f.id} f={f} {...rowProps} />
          ))}
          {/* Failures that share one reason fold into one line that says the
              reason once; each report is still its own row, one tap away, with
              its own Retry — there is deliberately no "retry all": one tap
              starting dozens of agent runs is a decision, not a default. */}
          {needsYouFolded.folds.map((fold) => (
            <details key={fold.cause} className="ui-fb-fold">
              <summary>
                <span className="ui-inbox-fold-count">
                  {fold.items.length} fixes failed the same way
                </span>
                <span className="ui-inbox-fold-cause">{fold.cause}</span>
              </summary>
              {fold.items.map((f) => (
                <Row key={f.id} f={f} {...rowProps} />
              ))}
            </details>
          ))}
        </div>
      ) : lens === LENS.UNDER_WAY ? (
        <div className="ui-fb-list">
          {underWay.map((f) => (
            <Row key={f.id} f={f} {...rowProps} />
          ))}
        </div>
      ) : (
        <div className="ui-fb-list">
          {/* Nothing here asks for a decision, so the newest few stand for the
              rest — all 36 rendered in full were most of a 17,000px page. */}
          {(showAllShipped ? shipped : shipped.slice(0, SHIPPED_SHOWN)).map((f) => (
            <Row key={f.id} f={f} {...rowProps} />
          ))}
          {shipped.length > SHIPPED_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAllShipped((v) => !v)}
              aria-expanded={showAllShipped}
              className="ui-fb-more"
            >
              {showAllShipped ? "Show fewer" : `Show all ${shipped.length} done`}
            </button>
          )}
        </div>
      )}

      {/* Archived is not a lens: it is filed away, not a question you ask the
          inbox. It stays one quiet toggle under whichever list is showing. */}
      {archived.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="ui-link-muted"
            aria-expanded={showArchived}
          >
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </button>
          {showArchived && (
            <div className="ui-fb-list opacity-70" aria-label="Archived">
              {archived.map((f) => (
                <Row key={f.id} f={f} {...rowProps} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const LENS = { NEEDS_YOU: "needs-you", UNDER_WAY: "under-way", SHIPPED: "shipped" } as const;
type Lens = (typeof LENS)[keyof typeof LENS];

/** Order is the loop's order: your move → moving on its own → done. */
const LENSES: { key: Lens; label: string; hint: string }[] = [
  {
    key: LENS.NEEDS_YOU,
    label: "Needs you",
    hint: "Your move — implement, retry, or confirm a fix that is live.",
  },
  {
    key: LENS.UNDER_WAY,
    label: "Under way",
    hint: "Agents and deploys at work. Nothing for you to do — Telegram when there is.",
  },
  {
    key: LENS.SHIPPED,
    label: "Done",
    hint: "Fixes you confirmed. Star one to feature it on the public strip.",
  },
];

/** The first lens that holds something; Needs you when all are empty. Pure. */
export function defaultLens(counts: Record<Lens, number>): Lens {
  return LENSES.find((l) => counts[l.key] > 0)?.key ?? LENS.NEEDS_YOU;
}

/**
 * An empty lens says so AND names the way forward on the same screen (a bare
 * "Nothing waiting on you for <project>." left the owner asking what to do —
 * 2026-09-28): the next lens that has something, or the whole fleet.
 */
function LensEmpty({
  lens,
  counts,
  projectName,
  projectId,
  onLens,
  onAllProjects,
}: {
  lens: Lens;
  counts: Record<Lens, number>;
  projectName: string | null;
  projectId: string | null;
  onLens: (l: Lens) => void;
  onAllProjects: () => void;
}) {
  const elsewhere = LENSES.filter((l) => l.key !== lens && counts[l.key] > 0);
  const title =
    lens === LENS.NEEDS_YOU
      ? "Nothing waiting on you"
      : lens === LENS.UNDER_WAY
        ? "Nothing under way"
        : "Nothing done yet";
  return (
    <EmptyState
      icon={Inbox}
      title={title}
      size="sm"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {elsewhere.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => onLens(l.key)}
              className="ui-btn-secondary ui-btn-sm"
            >
              {l.label} ({counts[l.key]})
            </button>
          ))}
          {projectName && (
            <button type="button" onClick={onAllProjects} className="ui-btn-secondary ui-btn-sm">
              All projects
            </button>
          )}
          {projectName && projectId && (
            <Link href={`/projects/${projectId}`} className="ui-btn-secondary ui-btn-sm">
              Open {projectName}
            </Link>
          )}
        </div>
      }
    >
      {lens === LENS.NEEDS_YOU
        ? "Every report is either shipped or with an agent. New ones appear here as they arrive."
        : lens === LENS.UNDER_WAY
          ? "No agent or deploy is working on a report right now."
          : "Fixes you confirm land here."}
    </EmptyState>
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

function Row({
  f,
  busyId,
  dispatchFix,
  runInCloud,
  setStatus,
  feature,
  hideProject,
}: {
  f: InboxItem;
  busyId: string | null;
  dispatchFix: (id: string, opts?: { note?: string; agent?: string }) => void;
  runInCloud: (id: string, commandId: string) => void;
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
      onRunInCloud={f.work.commandId ? () => runInCloud(f.id, f.work.commandId!) : undefined}
      onResolve={() => setStatus(f.id, FEEDBACK_STATUS.RESOLVED)}
      onArchive={() => setStatus(f.id, FEEDBACK_STATUS.ARCHIVED)}
      onReopen={() => setStatus(f.id, FEEDBACK_STATUS.NEW)}
      onFeature={() => feature(f.id, !f.featuredAt)}
    />
  );
}
