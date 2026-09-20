"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Code2,
  Inbox,
  Layers,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";
import { type ControlInboxState } from "@/hooks/use-control-inbox";
import { patchJson, postJson, throwApiError } from "@/lib/api/fetch";
import { compactRelativeDate } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { SYNTHESIZE_MIN_ITEMS } from "@/lib/feedback/compose-dispatch";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { FeedbackWorkBadge } from "@/components/feedback/FeedbackWorkBadge";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import type { WidgetCoverageItem } from "@/db/queries/widget-tokens";
import { FAILURE_REMEDY, REMEDY_LABEL } from "@/lib/failure-remedy";

/**
 * One inbox for every small thing that wants doing.
 *
 * ── What this replaces, and why ──────────────────────────────────────────────
 * Control used to render FleetWidgetCoverageStrip and FleetFeedbackStrip as two
 * separate full-width panels, stacked mid-page, both unbounded and one of them
 * auto-expanded. Measured on a 390px phone that was ~1,400px of scroll — eight
 * "Enable & install" buttons and five feedback rows — sitting between the fleet
 * status and the projects the operator actually came for.
 *
 * They also disagreed with each other about everything. Widget rows put a filled
 * button next to two bare underlined links in an `items-center` row, so a 36px
 * button was vertically centred against 12px text. Feedback rows put a filled
 * button next to an outlined one next to two unlabelled icon buttons. Both used
 * `ui-btn-save` — a filled accent button at `rounded` and `text-xs`, a shape
 * used nowhere else — so the loudest, most-repeated element on Control was also
 * the only one drawn in that style.
 *
 * The insight is that these are not two features. They are one queue: *small
 * things the fleet noticed that a human has to say yes to.* Treated as one
 * queue, the fix is the obvious one — group it, count it, cap it, collapse it.
 *
 * ── The rules this component holds ───────────────────────────────────────────
 * 1. Nothing auto-expands. The old feedback strip opened the first project's
 *    triage on mount, which is why it dominated the page it was a guest on.
 * 2. Every group is one line until asked. A count answers "is there anything?"
 *    without spending a screen to do it.
 * 3. Lists are capped at PREVIEW_LIMIT. Past that, the answer is the surface
 *    built for it (/feedback, the project's widget card) — not more scroll here.
 * 4. A ROW action is never a primary. This was got wrong once on the way here:
 *    the first build gave every row a filled `ui-btn-primary`, which turned
 *    eight black slabs into three orange ones and changed nothing — a list of
 *    primaries has no primary, whatever colour it is. Filled is reserved for
 *    the action that acts on the whole group ("Implement all"); rows get
 *    outlines. Exactly one filled button can appear per open group.
 * 5. Actions sit in a fixed-width rail, so rows align with each other down the
 *    column instead of each finding its own edge.
 * 6. Per-project feedback is fetched only when its group is open. The old strip
 *    fetched on mount for the auto-opened project whether or not anyone looked.
 */

/** Rows shown before deferring to the full surface. Three is enough to judge
 *  whether the queue needs attention now; more is a list you scroll past. */
const PREVIEW_LIMIT = 3;

type GroupId = "feedback" | "widget";

/**
 * The queue is READ by `useControlInbox`, one level up in ControlPanel, and
 * handed to this component. It used to own the fetches, which meant its count
 * could not be seen by the hero that claims to answer the same question — and
 * so the hero said "Idle — nothing queued" above a panel badged 6.
 */
export function ControlInbox({ inbox }: { inbox: ControlInboxState }) {
  // Collapsed until asked — see rule 1. `null` is a real state, not "unset":
  // there is no auto-open to fall back to.
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  const { summary, needsWidget, feedbackCount, total, loadFailed, settling } = inbox;

  // Silence is the correct rendering of an empty queue. An "Inbox (0)" panel is
  // a permanent reminder that a feature exists, which is not the same as being
  // useful — and on a phone it costs the same rows as a full one.
  //
  // Silence is NOT the correct rendering of a queue we failed to read. While
  // requests are still in flight we stay quiet (a failure that resolves in
  // 300ms should not flash), but once they have settled and we still have
  // nothing, say which of the two happened.
  if (total === 0) {
    if (settling || !loadFailed) return null;
    return (
      <section className="ui-inbox" aria-label="Needs you">
        <header className="ui-inbox-head">
          <AlertTriangle className="h-4 w-4 shrink-0 text-status-negative" aria-hidden="true" />
          <h2 className="ui-inbox-title">Needs you</h2>
        </header>
        <div className="ui-inbox-group px-4 py-3">
          <p className="ui-inbox-row-blocked" role="status">
            Couldn&apos;t load the inbox — this is not a claim that nothing needs you.
          </p>
          <button type="button" className="ui-btn-xs mt-2" onClick={inbox.refetch}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  const toggle = (id: GroupId) => setOpenGroup((cur) => (cur === id ? null : id));

  return (
    <section className="ui-inbox" aria-label="Needs you">
      <header className="ui-inbox-head">
        <Inbox className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <h2 className="ui-inbox-title">Needs you</h2>
        <span className="ui-inbox-total">{total}</span>
      </header>

      {/* One list loaded and the other did not: the total above is real but
          incomplete. Saying so is cheaper than an operator trusting a count
          that silently dropped a whole category. */}
      {loadFailed && (
        <p className="ui-inbox-row-blocked px-4 pb-2" role="status">
          One list failed to load — the count may be low.
        </p>
      )}

      {feedbackCount > 0 && (
        <GroupRow
          icon={<MessageSquare className="h-4 w-4" aria-hidden="true" />}
          label="Feedback to triage"
          count={feedbackCount}
          open={openGroup === "feedback"}
          onToggle={() => toggle("feedback")}
        >
          <div className="ui-inbox-projects">
            {summary.map((s) => (
              <button
                key={s.projectId}
                type="button"
                onClick={() => setOpenProjectId((v) => (v === s.projectId ? null : s.projectId))}
                aria-expanded={openProjectId === s.projectId}
                className={cn(
                  "ui-inbox-project",
                  openProjectId === s.projectId && "ui-inbox-project-active",
                )}
              >
                {s.projectName}
                <span className="ui-inbox-project-count">
                  {s.newCount > 0 ? s.newCount : s.openCount}
                </span>
              </button>
            ))}
          </div>
          {openProjectId && (
            <FeedbackTriage
              key={openProjectId}
              projectId={openProjectId}
              projectName={summary.find((s) => s.projectId === openProjectId)?.projectName ?? ""}
              onChanged={inbox.refetch}
            />
          )}
          {!openProjectId && (
            <p className="ui-inbox-empty">Pick a project to triage its reports.</p>
          )}
        </GroupRow>
      )}

      {needsWidget.length > 0 && (
        <GroupRow
          icon={<Code2 className="h-4 w-4" aria-hidden="true" />}
          label="Widget not on live site"
          count={needsWidget.length}
          open={openGroup === "widget"}
          onToggle={() => toggle("widget")}
        >
          <WidgetCoverage items={needsWidget} onChanged={inbox.refetch} />
        </GroupRow>
      )}
    </section>
  );
}

/** A one-line group that opens in place. The chevron, not a separate control,
 *  is the affordance — the whole row is the button, so a thumb cannot miss it. */
function GroupRow({
  icon,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="ui-inbox-group">
      <button type="button" onClick={onToggle} aria-expanded={open} className="ui-inbox-group-btn">
        <span className="shrink-0 text-text-tertiary">{icon}</span>
        <span className="ui-inbox-group-label">{label}</span>
        <span className="ui-inbox-group-count">{count}</span>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-text-muted transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && <div className="ui-inbox-group-body">{children}</div>}
    </div>
  );
}

/** The action rail every inbox row ends with: one filled primary, then icons at
 *  a fixed width. Fixed, so the primary buttons line up down the column even
 *  when their labels differ ("Implement" / "Retry" / "Enable & install"). */
function ActionRail({ children }: { children: React.ReactNode }) {
  return <div className="ui-inbox-actions">{children}</div>;
}

function WidgetCoverage({
  items,
  onChanged,
}: {
  items: WidgetCoverageItem[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, PREVIEW_LIMIT);

  async function install(projectId: string, projectName: string) {
    setBusyId(projectId);
    setOutcomes((p) => {
      const n = { ...p };
      delete n[projectId];
      return n;
    });
    try {
      const res = await postJson(`/api/projects/${projectId}/widget-token/install`, {
        mode: "install",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
        nextStep?: string;
      };
      if (!res.ok) {
        setOutcomes((p) => ({
          ...p,
          [projectId]: {
            ok: false,
            message:
              [body.error, body.hint].filter(Boolean).join(" ") || "Install could not start.",
          },
        }));
        return;
      }
      setOutcomes((p) => ({
        ...p,
        [projectId]: {
          ok: true,
          message:
            body.nextStep ??
            // Same correction as the terminal's empty state: for "the agent
            // never started" Attention offers START_SESSION, never Retry.
            `Queued for ${projectName}. If the agent never started, Attention offers “${REMEDY_LABEL[FAILURE_REMEDY.START_SESSION]}”.`,
        },
      }));
      onChanged();
    } catch (e) {
      setOutcomes((p) => ({
        ...p,
        [projectId]: {
          ok: false,
          message: e instanceof Error ? e.message : "Install could not start.",
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(projectId: string, resume: boolean) {
    setBusyId(projectId);
    try {
      const res = await postJson(`/api/projects/${projectId}/widget-token`, {
        status: resume ? "active" : "paused",
      });
      if (!res.ok) await throwApiError(res, "Could not update the widget");
      onChanged();
    } catch (e) {
      setOutcomes((p) => ({
        ...p,
        [projectId]: {
          ok: false,
          message: e instanceof Error ? e.message : "Could not update the widget.",
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <ul className="ui-inbox-list">
        {shown.map((p) => {
          const outcome = outcomes[p.projectId];
          const reason = !p.hasToken
            ? "not enabled"
            : p.tokenStatus !== "active"
              ? "token paused"
              : "never seen a boot from the live site";
          return (
            <li key={p.projectId} className="ui-inbox-row">
              <div className="ui-inbox-row-main">
                <p className="ui-inbox-row-title">{p.projectName}</p>
                <p className="ui-inbox-row-meta">
                  {[reason, p.productionUrl || p.gitUrl].filter(Boolean).join(" · ")}
                </p>
                {/* The blocked case is the only one that needs a sentence: the
                    button is disabled and the reason is not on screen anywhere
                    else. Everything else the meta line already says. */}
                {!p.canInstall && (
                  <p className="ui-inbox-row-blocked">
                    No repo URL or local directory — one-click install has nowhere to land code.
                    Paste the snippet from the project&apos;s Widget card instead.
                  </p>
                )}
                {outcome && (
                  <p className={outcome.ok ? "ui-inbox-row-ok" : "ui-inbox-row-blocked"}>
                    {outcome.message}
                  </p>
                )}
              </div>
              <ActionRail>
                <button
                  type="button"
                  onClick={() => install(p.projectId, p.projectName)}
                  disabled={busyId === p.projectId || !p.canInstall}
                  className="ui-btn-secondary ui-btn-sm"
                  title={
                    p.canInstall
                      ? "Mint a token if needed and queue an agent to embed the widget"
                      : "Blocked — no repo URL and no local runner directory"
                  }
                >
                  {busyId === p.projectId ? (
                    <Loader2 className="ui-spinner-xs" />
                  ) : (
                    <Rocket className="h-3 w-3" />
                  )}
                  Install
                </button>
                {/* A token that exists but is paused does not need installing —
                    it needs turning back on, which was previously a trip into
                    the project page. One click, from the list that told you it
                    was off. */}
                {p.hasToken && (
                  <button
                    type="button"
                    onClick={() => toggle(p.projectId, p.tokenStatus !== "active")}
                    disabled={busyId === p.projectId}
                    className="ui-btn-secondary ui-btn-sm"
                    title={
                      p.tokenStatus === "active"
                        ? "Pause — hides the launcher and stops accepting feedback"
                        : "Resume — the launcher reappears within about a minute"
                    }
                  >
                    {p.tokenStatus === "active" ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {p.tokenStatus === "active" ? "Pause" : "Resume"}
                  </button>
                )}
                <Link
                  href={`/projects/${p.projectId}#feedback`}
                  className="ui-btn-icon"
                  title="Widget card — copy the snippet by hand"
                  aria-label={`Open ${p.projectName}'s widget card`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                </Link>
              </ActionRail>
            </li>
          );
        })}
      </ul>
      {items.length > PREVIEW_LIMIT && !showAll && (
        <button type="button" className="ui-inbox-more" onClick={() => setShowAll(true)}>
          Show all {items.length}
        </button>
      )}
    </>
  );
}

function FeedbackTriage({
  projectId,
  projectName,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  onChanged: () => void;
}) {
  const { data, loading, refetch } = useFetch<{ feedback: FeedbackListItemWithWork[] }>(
    `/api/projects/${projectId}/feedback`,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [synthState, setSynthState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const items = (data?.feedback ?? [])
    .filter((f) => f.status === FEEDBACK_STATUS.NEW || f.status === FEEDBACK_STATUS.DISPATCHED)
    .map((f) => ({ ...f, work: f.work ?? deriveFeedbackWork(f.status, null) }));
  const newItems = items.filter(
    (f) => f.status === FEEDBACK_STATUS.NEW && f.source !== FEEDBACK_SOURCE.SYNTHESIZER,
  );
  const shown = showAll ? items : items.slice(0, PREVIEW_LIMIT);

  async function act(id: string, run: () => Promise<Response>, fallback: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) await throwApiError(res, fallback);
      refetch();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusyId(null);
    }
  }

  async function batch(path: string, fallback: string, done?: () => void) {
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/feedback/${path}`, {});
      if (!res.ok) await throwApiError(res, fallback);
      done?.();
      refetch();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    }
  }

  if (loading) {
    return (
      <p className="ui-inbox-empty">
        <Loader2 className="ui-spinner-xs mr-1.5 inline" /> Loading {projectName}&apos;s reports…
      </p>
    );
  }
  if (items.length === 0) return <p className="ui-inbox-empty">Nothing open for {projectName}.</p>;

  return (
    <>
      {error && <p className="ui-error mb-2">{error}</p>}

      {newItems.length >= 2 && (
        <div className="ui-inbox-batch">
          <button
            type="button"
            onClick={async () => {
              setBatchBusy(true);
              await batch("dispatch-batch", "Implement all failed");
              setBatchBusy(false);
            }}
            disabled={batchBusy || busyId !== null}
            className="ui-btn-primary ui-btn-sm"
            title="One agent run for every not-started report"
          >
            {batchBusy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
            Implement all ({newItems.length})
          </button>
          {newItems.length >= SYNTHESIZE_MIN_ITEMS && (
            <button
              type="button"
              onClick={async () => {
                setSynthState("busy");
                await batch("synthesize", "Synthesize failed", () => setSynthState("done"));
              }}
              disabled={synthState !== "idle"}
              className="ui-btn-secondary ui-btn-sm"
              title="Cluster these reports into theme briefs"
            >
              {synthState === "busy" ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              {synthState === "done" ? "Queued" : "Synthesize"}
            </button>
          )}
        </div>
      )}

      <ul className="ui-inbox-list">
        {shown.map((f) => {
          const work = f.work;
          const notStarted = work.phase === FEEDBACK_WORK_PHASE.NOT_STARTED;
          const broken =
            work.phase === FEEDBACK_WORK_PHASE.STUCK || work.phase === FEEDBACK_WORK_PHASE.FAILED;
          // Same rule as the Feedback row: a terminal exists once the prompt reached
          // an agent PTY — Working, and Stalled too (it may be waiting on a person).
          const watchable = work.watchable === true;
          const needsVerify = work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY;
          const liveHref = livePageHref(f.liveUrl, f.url, f.page);
          return (
            <li key={f.id} className="ui-inbox-row">
              <div className="ui-inbox-row-main">
                <div className="flex items-start gap-2">
                  <p className="ui-inbox-row-title line-clamp-2">{f.suggestion}</p>
                  <FeedbackWorkBadge work={work} />
                </div>
                <p className="ui-inbox-row-meta">
                  {[f.page || f.url, f.scope, compactRelativeDate(f.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {/* Short next-action only when waiting on the operator. Moving
                    work stays badge-only — Telegram is the interrupt. */}
                {work.waitingOn === "you" && work.detail && (
                  <p className="ui-inbox-row-detail line-clamp-2">{work.detail}</p>
                )}
              </div>
              <ActionRail>
                {/* Same chooser the Feedback row and the Terminal rail use, so
                    a blocked run is one tap from a provider that can answer
                    without leaving Control for deep project settings. */}
                {broken && (
                  <ProviderSwitch
                    projectId={projectId}
                    busy={busyId === f.id || batchBusy}
                    compact
                    onSwitch={(agent) =>
                      act(
                        f.id,
                        () => postJson(`/api/feedback/${f.id}/dispatch`, { agent }),
                        "Provider switch failed",
                      )
                    }
                  />
                )}
                {(notStarted || broken) && (
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        f.id,
                        () => postJson(`/api/feedback/${f.id}/dispatch`, {}),
                        broken ? "Retry failed" : "Implement failed",
                      )
                    }
                    disabled={busyId === f.id || batchBusy}
                    className="ui-btn-secondary ui-btn-sm"
                  >
                    {busyId === f.id ? (
                      <Loader2 className="ui-spinner-xs" />
                    ) : (
                      <Rocket className="h-3 w-3" />
                    )}
                    {broken ? "Retry" : "Implement"}
                  </button>
                )}
                {watchable && (
                  <a
                    href={fleetSurfaceHref("terminal", projectName, "cloud")}
                    className="ui-btn-secondary ui-btn-sm"
                    title={work.detail ?? "Open the agent's terminal"}
                  >
                    Watch
                  </a>
                )}
                {needsVerify ? (
                  <>
                    {work.checkLive && liveHref ? (
                      <a
                        href={liveHref}
                        target="_blank"
                        rel="noreferrer"
                        className="ui-btn-save ui-btn-sm"
                        title="Open the live page and confirm the visitor's point is fixed"
                      >
                        Check live
                      </a>
                    ) : work.ship?.pr ? (
                      <a
                        href={work.ship.pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ui-btn-secondary ui-btn-sm"
                        title={work.ship.pr.title}
                      >
                        Review PR
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        act(
                          f.id,
                          () =>
                            patchJson(`/api/feedback/${f.id}`, {
                              status: FEEDBACK_STATUS.RESOLVED,
                            }),
                          "Update failed",
                        )
                      }
                      disabled={busyId === f.id || batchBusy}
                      className={
                        work.checkLive ? "ui-btn-secondary ui-btn-sm gap-1" : "ui-btn-icon"
                      }
                      title={
                        work.checkLive
                          ? "You looked at the live page and it is fixed"
                          : "Mark resolved"
                      }
                      aria-label="Confirm fixed"
                    >
                      <Check className="h-3 w-3" />
                      {work.checkLive ? "Confirm" : null}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      act(
                        f.id,
                        () =>
                          patchJson(`/api/feedback/${f.id}`, { status: FEEDBACK_STATUS.RESOLVED }),
                        "Update failed",
                      )
                    }
                    disabled={busyId === f.id || batchBusy}
                    className="ui-btn-icon"
                    title="Mark resolved"
                    aria-label="Mark resolved"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    act(
                      f.id,
                      () =>
                        patchJson(`/api/feedback/${f.id}`, { status: FEEDBACK_STATUS.ARCHIVED }),
                      "Update failed",
                    )
                  }
                  disabled={busyId === f.id || batchBusy}
                  className="ui-btn-icon"
                  title="Archive"
                  aria-label="Archive"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </ActionRail>
            </li>
          );
        })}
      </ul>

      <div className="ui-inbox-foot">
        {items.length > PREVIEW_LIMIT && !showAll && (
          <button type="button" className="ui-inbox-more" onClick={() => setShowAll(true)}>
            Show all {items.length}
          </button>
        )}
        <Link
          href={`/feedback?project=${encodeURIComponent(projectName)}`}
          className="ui-inbox-more"
        >
          Full inbox →
        </Link>
      </div>
    </>
  );
}
