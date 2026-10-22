"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCheck, Loader2, MessagesSquare, X } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { postJson } from "@/lib/api/fetch";
import type { FeedbackRead } from "@/lib/feedback/read-report";
import { compactDurationHours, compactRelativeDate } from "@/lib/dates";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { FEEDBACK_WORK_PHASE, WAITING_ON } from "@/lib/feedback/work-phase";
import type { FeedbackLoopMetrics, UserFeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackWorkView } from "@/lib/feedback/work-phase";
import { decisionFacts } from "@/lib/feedback/decision-facts";
import { rowStory } from "@/lib/feedback/row-story";
import { projectTitle } from "@/lib/project-display";
import { EmptyState } from "@/components/ui/empty-state";
import { PageLayout } from "@/components/ui/page-layout";
import { PageActionButton } from "@/components/ui/page-action";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { ChoiceMenu } from "@/components/ui/choice-menu";
import { Modal } from "@/components/ui/modal";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { DecisionCard } from "@/components/feedback/DecisionCard";
import { useFeedbackActions } from "@/components/feedback/use-feedback-actions";
import {
  RECOMMEND,
  doAllLabel,
  looksLine,
  recommendFor,
  summarizeDecisions,
  decisionKey,
  type Recommendation,
} from "@/lib/feedback/recommend";

type InboxItem = UserFeedbackListItem & { work: FeedbackWorkView };

/** Reads asked for per page load — a long queue is read as the owner scrolls back. */
const READS_PER_VISIT = 8;

/**
 * /feedback — a queue of decisions Loki has already made, waiting for a yes.
 *
 * Rebuilt 2026-10-10 on the owner's rule: "if my involvement is needed, it
 * shouldn't take me more than 10 milliseconds … I should be able to tap
 * once and have some confidence that this tap leads to the correct
 * improvement, because all the evaluation was done before that one option
 * was given to me."
 *
 * Rebuilt again 2026-10-21 to the design reset (rows, not cards): the page's
 * one action is "Do all" (the round button in the top bar, confirmed in a
 * sheet that says what it spends). Each decision is ONE row — the report in
 * the reporter's words, the project and Loki's call in one grey line — with
 * the yes as the row's own small button, still one tap. Tapping the row opens
 * the whole decision (Loki's read, the facts, every other move) in a sheet.
 * Under way, Done and Filed away are rows too, their state in plain words;
 * they were cards of badges and collapsed boxes.
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
  /**
   * Decisions taken on this screen, keyed by the decision itself (item + kind
   * + the run it was about), not the item alone. Keyed by item, a "Build it"
   * tap stayed "taken" after that run failed and the item came back as a new
   * "Try again" decision — the card then read "Done — try again" over a
   * failure (2026-10-21, Substrata). A new run or a new kind is a new decision.
   */
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const isTaken = (f: { id: string; dispatchedRunId?: string | null }, rec: Recommendation) =>
    taken.has(decisionKey(f, rec));
  /** The report opened in the sheet, and whether "Do all" is being confirmed. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // Every project named the way a person names it, never its folder key.
  const titleOf = (name: string) => projectTitle({ name });
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  // Loki's read of each new report (lib/feedback/read-report), asked for one
  // at a time as the queue is open: the owner should never tap "Build" on a
  // report they have not had explained. Bounded per page load.
  const [reads, setReads] = useState<Record<string, FeedbackRead | null>>({});
  const [readingId, setReadingId] = useState<string | null>(null);

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
            reporterName: f.reporterName ?? null,
            reporterIsOwner: f.reporterUserId ? f.reporterUserId === f.userId : undefined,
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
  const summary = summarizeDecisions(
    decisions.filter((d) => !isTaken(d.f, d.rec)).map((d) => d.rec),
  );

  /** Take one decision — the same routes the full row uses. */
  const inFlight = useRef<string | null>(null);
  useEffect(() => {
    if (inFlight.current) return;
    const next = decisions.find(
      (d) =>
        d.rec.kind === RECOMMEND.BUILD && !d.f.read && !(d.f.id in reads) && !isTaken(d.f, d.rec),
    );
    if (!next || Object.keys(reads).length >= READS_PER_VISIT) return;
    const id = next.f.id;
    inFlight.current = id;
    // State moves in the request's own callbacks, never in the effect body.
    Promise.resolve()
      .then(() => setReadingId(id))
      .then(() => postJson(`/api/feedback/${id}/read`, {}))
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { read?: FeedbackRead | null };
        setReads((r) => ({ ...r, [id]: body.read ?? null }));
      })
      .catch(() => setReads((r) => ({ ...r, [id]: null })))
      .finally(() => {
        inFlight.current = null;
        setReadingId(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isTaken reads `taken`
  }, [decisions, reads, taken]);

  const take = async (f: InboxItem, rec: Recommendation, ask?: string) => {
    switch (rec.kind) {
      case RECOMMEND.CONFIRM:
        await setStatus(f.id, FEEDBACK_STATUS.RESOLVED);
        break;
      case RECOMMEND.BUILD:
      case RECOMMEND.RETRY:
        await dispatchFix(f.id, ask ? { ask } : {});
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
    setTaken((s) => new Set(s).add(decisionKey(f, rec)));
  };

  const takeAll = async () => {
    const todo = decisions.filter(
      (d) =>
        d.rec.kind !== RECOMMEND.CONNECT && d.rec.kind !== RECOMMEND.LOOK && !isTaken(d.f, d.rec),
    );
    setBatch({ done: 0, total: todo.length });
    for (const [i, d] of todo.entries()) {
      await take(d.f, d.rec);
      setBatch({ done: i + 1, total: todo.length });
    }
    setBatch(null);
  };

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
  const open = summary.total;
  const opened = openId ? all.find((f) => f.id === openId) : null;
  const openedDecision = opened ? decisions.find((d) => d.f.id === opened.id) : null;

  const doAll =
    open > 0 && summary.takeable > 0 ? (
      <PageActionButton
        label={batch ? `${batch.done} of ${batch.total}` : doAllLabel(summary)}
        icon={CheckCheck}
        onClick={() => setConfirmAll(true)}
        disabled={batch !== null || busyId !== null}
      />
    ) : undefined;

  const body = (() => {
    if (loading && all.length === 0) {
      return (
        <p className="flex items-center gap-2 text-sm text-text-tertiary">
          <Loader2 className="ui-spinner-xs" /> Loading…
        </p>
      );
    }
    if (all.length === 0 && loadError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your feedback"
          action={
            <button type="button" onClick={refetch} className="ui-btn-secondary">
              Try again
            </button>
          }
        />
      );
    }
    if (all.length === 0) {
      return (
        <EmptyState
          icon={MessagesSquare}
          title="Reports from your sites land here"
          action={
            <Link href="/docs/feedback-widget" className="ui-btn-secondary">
              Add the feedback button to a site
            </Link>
          }
        />
      );
    }
    return (
      <>
        <div className="flex flex-col gap-2">
          {projects.length > 1 && (
            <ChoiceMenu
              label="Project"
              value={projectFilter ?? ALL_PROJECTS}
              align="start"
              options={[
                { value: ALL_PROJECTS, label: "All projects" },
                ...projects.map((p) => ({ value: p.name, label: titleOf(p.name) })),
              ]}
              onChange={(v) => setProjectFilter(v === ALL_PROJECTS ? null : v)}
            />
          )}
          <div>
            <p className="ui-activity-lede">
              {open === 0
                ? underWay.length
                  ? `Nothing waits on you. ${underWay.length} ${underWay.length === 1 ? "is" : "are"} under way.`
                  : "Nothing waits on you."
                : `${open} ${open === 1 ? "report needs" : "reports need"} a yes.`}
            </p>
            {(night || (open > 0 && looksLine(summary))) && (
              <p className="ui-activity-lede-sub">
                {[open > 0 ? looksLine(summary) : null, night?.note].filter(Boolean).join(" ")}
              </p>
            )}
          </div>
        </div>

        {error && <p className="ui-prompt-sheet-error">{error}</p>}
        {notice && <p className="text-sm text-text-secondary">{notice}</p>}

        {open > 0 && (
          <Section title="Needs a yes">
            <List aria-label="Needs a yes">
              {decisions.map(({ f, rec }) => (
                <ListRow
                  key={f.id}
                  onClick={() => setOpenId(f.id)}
                  title={reportTitle(f)}
                  // Where, and when — Loki's call is the button at the end, and
                  // named here only when it is not the button's own word.
                  secondary={
                    isTaken(f, rec)
                      ? `Done: ${rec.label.toLowerCase()}`
                      : [
                          projectOf(f) ? titleOf(f.projectName) : null,
                          rec.kind === RECOMMEND.BUILD ? null : kindWord(rec),
                          compactRelativeDate(f.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")
                  }
                  menu={
                    isTaken(f, rec) || !oneTap(rec) ? undefined : (
                      <button
                        type="button"
                        onClick={() => void take(f, rec, f.read?.ask ?? undefined)}
                        disabled={busyId !== null}
                        className="ui-row-verb"
                        aria-label={`${rec.label}: ${reportTitle(f)}`}
                      >
                        {busyId === f.id && <Loader2 className="ui-spinner-xs" />}
                        {rec.label}
                      </button>
                    )
                  }
                />
              ))}
            </List>
          </Section>
        )}

        <ItemSection
          title="Under way"
          items={underWay}
          limit={10}
          onOpen={setOpenId}
          titleOf={titleOf}
          showProject={!projectFilter && projects.length > 1}
        />
        <ItemSection
          title="Done"
          items={done}
          limit={5}
          onOpen={setOpenId}
          titleOf={titleOf}
          showProject={!projectFilter && projects.length > 1}
        />
        <ItemSection
          title="Filed away"
          items={archived}
          limit={5}
          onOpen={setOpenId}
          titleOf={titleOf}
          showProject={!projectFilter && projects.length > 1}
        />

        <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-text-tertiary">
          <span className="min-w-0">
            {metrics && metrics.total > 0 ? metricsLine(metrics) : null}
          </span>
          <Link href="/feedback/studio" className="ui-link-muted whitespace-nowrap">
            Studio requests
          </Link>
        </p>
      </>
    );
  })();

  return (
    <PageLayout title="Feedback" maxWidth="max-w-2xl" action={doAll}>
      {body}

      {/* One report, opened: Loki's decision with everything behind it, or the
          report's own row with its moves. */}
      {opened &&
        createPortal(
          <Modal
            onClose={() => setOpenId(null)}
            size="xl"
            position="bottom-mobile"
            padded={false}
            className="flex flex-col"
          >
            <div className="ui-prompt-sheet-head">
              <h2 className="ui-prompt-sheet-title">{titleOf(opened.projectName)}</h2>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="ui-topbar-btn shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="ui-prompt-sheet-body">
              {openedDecision ? (
                <DecisionCard
                  item={opened}
                  rec={openedDecision.rec}
                  busy={busyId === opened.id}
                  taken={isTaken(opened, openedDecision.rec)}
                  project={projectOf(opened)}
                  onTake={(ask) => void take(opened, openedDecision.rec, ask)}
                  read={reads[opened.id] ?? opened.read ?? null}
                  reading={readingId === opened.id}
                  rowProps={rowFor(opened)}
                />
              ) : (
                <FeedbackItemRow
                  feedback={opened}
                  projectName={opened.projectName}
                  project={projectOf(opened)}
                  busy={busyId === opened.id}
                  {...rowFor(opened)}
                />
              )}
            </div>
          </Modal>,
          document.body,
        )}

      {confirmAll &&
        createPortal(
          <Modal
            onClose={() => setConfirmAll(false)}
            size="sm"
            position="bottom-mobile"
            padded={false}
            className="flex flex-col"
          >
            <div className="ui-prompt-sheet-head">
              <h2 className="ui-prompt-sheet-title">{doAllLabel(summary)}</h2>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="ui-topbar-btn shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="ui-prompt-sheet-body">
              <p className="text-sm text-text-secondary">
                Loki takes its own advice on every report in the list. Anything filed away comes
                back with one tap.
              </p>
            </div>
            <div className="ui-sheet-foot">
              <button
                type="button"
                onClick={() => {
                  setConfirmAll(false);
                  void takeAll();
                }}
                className="ui-btn-primary min-h-12 w-full"
              >
                Do it
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </PageLayout>
  );
}

const ALL_PROJECTS = "__all__";

/** What was reported, in the reporter's words — the row's title. */
function reportTitle(f: InboxItem): string {
  return decisionFacts(f).asked || "A report with no words";
}

/** The kinds a row's own button can take in one tap; the rest open the sheet. */
function oneTap(rec: Recommendation): boolean {
  return rec.kind !== RECOMMEND.CONNECT && rec.kind !== RECOMMEND.LOOK;
}

/** Loki's recommendation, as the row says it. */
function kindWord(rec: Recommendation): string {
  switch (rec.kind) {
    case RECOMMEND.CONFIRM:
      return "Live, close it";
    case RECOMMEND.BUILD:
      return rec.runs ? "Build it, one agent run" : "Build it";
    case RECOMMEND.RETRY:
      return "Last try failed";
    case RECOMMEND.CLOUD:
      return "Waiting for this computer";
    case RECOMMEND.FILE:
      return "Old, file it away";
    case RECOMMEND.CONNECT:
      return "Needs a repository";
    case RECOMMEND.LOOK:
      return "Live, needs your eyes";
  }
}

/** Under way / Done / Filed away: rows with the state in words, opened on tap. */
function ItemSection({
  title,
  items,
  limit,
  onOpen,
  titleOf,
  showProject,
}: {
  title: string;
  items: InboxItem[];
  limit: number;
  onOpen: (id: string) => void;
  titleOf: (name: string) => string;
  showProject: boolean;
}) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, limit);
  return (
    <Section
      title={`${title} · ${items.length}`}
      right={
        items.length > limit ? (
          <button type="button" onClick={() => setAll((v) => !v)} className="ui-section-link">
            {all ? "Show fewer" : "See all"}
          </button>
        ) : undefined
      }
    >
      <List aria-label={title}>
        {shown.map((f) => {
          const story = rowStory({
            work: f.work,
            page: f.page ?? null,
            runnable: f.runnable !== false,
            hadRun: !!f.dispatchedRunId,
            resolvedAt: f.resolvedAt ?? null,
            archiveReason: f.archiveReason ?? null,
          });
          return (
            <ListRow
              key={f.id}
              onClick={() => onOpen(f.id)}
              title={reportTitle(f)}
              status={
                f.work.phase === FEEDBACK_WORK_PHASE.FAILED ||
                f.work.phase === FEEDBACK_WORK_PHASE.STUCK
                  ? "negative"
                  : undefined
              }
              secondary={[
                showProject ? titleOf(f.projectName) : null,
                story.headline.replace(/\.$/, ""),
              ]
                .filter(Boolean)
                .join(" · ")}
              trailing={compactRelativeDate(f.createdAt)}
            />
          );
        })}
      </List>
    </Section>
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
