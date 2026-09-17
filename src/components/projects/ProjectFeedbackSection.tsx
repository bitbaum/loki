"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  ScanEye,
  Undo2,
  X,
} from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { useClipboard } from "@/hooks/use-clipboard";
import { deleteJson, patchJson, postJson, throwApiError } from "@/lib/api/fetch";
import { compactDurationHours, compactRelativeDate } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { SYNTHESIZE_MIN_ITEMS } from "@/lib/feedback/compose-dispatch";
import { FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import type { FeedbackLoopMetrics } from "@/db/queries/site-feedback";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { useFeedbackActions } from "@/components/feedback/use-feedback-actions";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { EXECUTOR_COPY } from "@/config/executor-copy";
import { DispatchedNote } from "@/components/projects/ProjectActionButtons";
import { WidgetPlacementControl } from "@/components/projects/WidgetPlacementControl";
import { cn } from "@/lib/utils";
import { ProjectMembersPanel } from "@/components/projects/ProjectMembersPanel";

type WidgetTokenInfo = {
  token: string;
  snippet: string;
  status: string;
  origins: string[] | null;
  lastSeenAt: string | null;
  lastSeenOrigin: string | null;
  /** Unknown rather than WidgetPlacement: rows written before the column
   *  existed are null, and the SSOT normalizer is what interprets it. */
  placement: unknown;
};

/**
 * Visitor-feedback inbox for one project — submissions from the embeddable
 * widget (docs/architecture/feedback-widget.md). The one thing that matters
 * per row is Implement: feedback becomes fleet work without leaving the
 * row. The empty state IS the widget setup card — discovery and activation
 * in one place.
 */
export function ProjectFeedbackSection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const feedbackFetch = useFetch<{
    feedback: FeedbackListItemWithWork[];
    metrics: FeedbackLoopMetrics | null;
  }>(`/api/projects/${projectId}/feedback`);
  const tokenFetch = useFetch<{ token: WidgetTokenInfo | null }>(
    `/api/projects/${projectId}/widget-token`,
  );
  const [setupOpen, setSetupOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { busyId, error, setError, dispatchFix, setStatus, feature } = useFeedbackActions(
    feedbackFetch.refetch,
  );
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesized, setSynthesized] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const items = (feedbackFetch.data?.feedback ?? []).filter(
    (f) => f.status !== FEEDBACK_STATUS.ARCHIVED,
  );
  const metrics = feedbackFetch.data?.metrics ?? null;
  const newCount = items.filter((f) => f.status === FEEDBACK_STATUS.NEW).length;
  // What the batch routes will actually accept: NEW, non-synthesizer. Gating
  // the buttons on anything wider renders a button whose every click 400s.
  const batchable = items.filter(
    (f) => f.status === FEEDBACK_STATUS.NEW && f.source !== FEEDBACK_SOURCE.SYNTHESIZER,
  ).length;
  const token = tokenFetch.data?.token ?? null;
  // A failed token GET also yields `null`, which previously read as "no token
  // exists" and offered to enable a widget that may already be live on the
  // customer's site. Not knowing is its own state: never show setup on the
  // strength of a request that never answered.
  const tokenUnknown = Boolean(tokenFetch.error);
  const showSetup = setupOpen || (!tokenFetch.loading && !tokenUnknown && !token);
  // Same derivation WidgetSetupCard uses, hoisted so the always-visible status
  // line can state it without opening the card. "Live" is the observed boot
  // heartbeat, never install intent — a token that exists but has never been
  // seen is a third state, and saying so is the whole point of the line.
  const live = !!token?.lastSeenAt && token.status !== "paused";
  const paused = token?.status === "paused";
  const site = token?.lastSeenOrigin ?? token?.origins?.[0] ?? null;

  // Keep work labels honest while something is in flight.
  useEffect(() => {
    const live = items.some((f) => {
      const w = "work" in f && f.work ? f.work.phase : null;
      return w === FEEDBACK_WORK_PHASE.QUEUED || w === FEEDBACK_WORK_PHASE.WORKING;
    });
    if (!live) return;
    const t = window.setInterval(() => feedbackFetch.refetch(), 8_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll while any row is live; refetch identity is stable enough
  }, [items.map((f) => ("work" in f && f.work ? f.work.phase : f.status)).join("|")]);

  // High-volume inbox: shift the unit of action from item to theme. An agent
  // clusters the NEW items into briefs and files them back into this inbox.
  async function synthesize() {
    setSynthesizing(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/feedback/synthesize`, {});
      if (!res.ok) await throwApiError(res, "Synthesize failed");
      setSynthesized(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Synthesize failed");
    } finally {
      setSynthesizing(false);
    }
  }

  async function dispatchAll() {
    setBatchBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/feedback/dispatch-batch`, {});
      if (!res.ok) await throwApiError(res, "Implement all failed");
      feedbackFetch.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Implement all failed");
    } finally {
      setBatchBusy(false);
    }
  }
  return (
    <section className="ui-project-section" aria-labelledby="project-feedback-title">
      <ProjectMembersPanel projectId={projectId} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id="project-feedback-title" className="text-lg font-semibold text-text-primary">
            Visitor feedback
          </h2>
          {newCount > 0 && <span className="ui-badge">{newCount} new</span>}
          {metrics && metrics.resolved > 0 && (
            <span className="text-xs text-text-tertiary">
              {metrics.resolved} resolved
              {metrics.medianResolutionHours != null &&
                ` · median ${compactDurationHours(metrics.medianResolutionHours)} report→fix`}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {token && batchable >= 2 && (
            <button
              type="button"
              onClick={dispatchAll}
              disabled={batchBusy || busyId !== null}
              className="ui-btn-save gap-1.5"
              title="One agent run covering every new report (local Fleet Runner or cloud builder)"
            >
              {batchBusy ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              Implement all as one
            </button>
          )}
          {token && batchable >= SYNTHESIZE_MIN_ITEMS && (
            <button
              type="button"
              onClick={synthesize}
              disabled={synthesizing || synthesized}
              className="ui-btn-secondary gap-1.5"
              title="Queue an agent to cluster the new items into structured briefs, filed back into this inbox"
            >
              {synthesizing ? (
                <Loader2 className="ui-spinner-xs" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              {synthesized ? "Synthesis queued" : "Synthesize"}
            </button>
          )}
          {token && (
            <button
              type="button"
              onClick={() => setReviewOpen((v) => !v)}
              className="ui-btn-secondary gap-1.5"
              title="Queue an agent to visually review a page and file findings here"
            >
              <ScanEye className="h-3.5 w-3.5" />
              AI review
            </button>
          )}
          <button
            type="button"
            onClick={() => setSetupOpen((v) => !v)}
            className="ui-btn-secondary gap-1.5"
            aria-expanded={setupOpen}
          >
            <Code2 className="h-3.5 w-3.5" />
            {setupOpen ? "Hide widget setup" : "Widget setup"}
          </button>
        </div>
      </div>

      {/* Widget STATE is always on screen; only its controls are behind a
          click. This is the fix for a real report: someone came to this page
          to put the widget on a site, saw a thousand words of feedback items
          and an unlabelled "Widget" button, and concluded the project had no
          widget. It had one, and it was live.
          A status line costs one row and answers the question that brought
          them here without requiring a click to find out. */}
      {token && !showSetup && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-base px-3 py-2">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              live ? "bg-status-positive" : "bg-status-warning",
            )}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-text-primary">
            {live ? "Widget live" : paused ? "Widget paused" : "Widget enabled, not seen yet"}
          </span>
          {site && (
            <span className="truncate text-xs text-text-tertiary">
              {site.replace(/^https:\/\//, "")}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="ui-btn-ghost ml-auto text-xs"
          >
            Manage
          </button>
        </div>
      )}

      <AutoShipToggle projectId={projectId} />
      {reviewOpen && token && (
        <AiReviewCard
          projectId={projectId}
          projectName={projectName}
          defaultUrl={items.find((f) => f.url)?.url ?? ""}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {synthesized && (
        <p className="mb-3">
          <DispatchedNote workspaceKey={projectName} />
        </p>
      )}

      {tokenUnknown && (
        <p className="mb-3 text-xs text-status-negative" role="status">
          Couldn&apos;t check whether the widget is enabled — showing neither state rather than
          guessing.{" "}
          <button
            type="button"
            onClick={tokenFetch.refetch}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </p>
      )}

      {showSetup && (
        <WidgetSetupCard
          projectId={projectId}
          projectName={projectName}
          token={token}
          loading={tokenFetch.loading}
          onChanged={() => {
            // Keep the card open across the refetch — right after "Enable
            // widget" the whole point is showing the snippet to copy.
            setSetupOpen(true);
            tokenFetch.refetch();
          }}
          onClose={token ? () => setSetupOpen(false) : undefined}
        />
      )}

      {error && <p className="mb-3 ui-error">{error}</p>}

      {feedbackFetch.loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-tertiary">
          <Loader2 className="ui-spinner-xs" /> Loading feedback…
        </div>
      ) : items.length === 0 ? (
        token && (
          <p className="py-4 text-sm text-text-muted">
            No feedback yet. Once the widget is on your site, visitor submissions land here.
          </p>
        )
      ) : (
        <div className="divide-y divide-border-subtle">
          {items.map((f) => (
            <FeedbackItemRow
              key={f.id}
              feedback={f}
              projectName={projectName}
              busy={busyId === f.id}
              onDispatch={(note) => dispatchFix(f.id, note)}
              onResolve={() => setStatus(f.id, FEEDBACK_STATUS.RESOLVED)}
              onArchive={() => setStatus(f.id, FEEDBACK_STATUS.ARCHIVED)}
              onReopen={() => setStatus(f.id, FEEDBACK_STATUS.NEW)}
              onFeature={() => feature(f.id, !f.featuredAt)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WidgetSetupCard({
  projectId,
  projectName,
  token,
  loading,
  onChanged,
  onClose,
}: {
  projectId: string;
  projectName: string;
  token: WidgetTokenInfo | null;
  loading: boolean;
  onChanged: () => void;
  onClose?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentPhase, setAgentPhase] = useState<"idle" | "queued" | "failed">("idle");
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { copied, copy } = useClipboard();

  const controlHref = fleetSurfaceHref("control", projectName);
  const terminalHref = fleetSurfaceHref("terminal", projectName);
  const activityHref = fleetSurfaceHref("activity", projectName);
  const site = token?.lastSeenOrigin ?? token?.origins?.[0] ?? null;
  const live = !!token?.lastSeenAt && token.status !== "paused";
  const paused = token?.status === "paused";

  async function dispatchAgent(mode: "install" | "uninstall") {
    setAgentBusy(true);
    setError(null);
    setAgentNote(null);
    setAgentPhase("idle");
    try {
      const res = await postJson(`/api/projects/${projectId}/widget-token/install`, { mode });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        hint?: string;
        nextStep?: string;
        watchUrl?: string;
      };
      if (!res.ok) {
        setAgentPhase("failed");
        setError(
          [body.error, body.hint].filter(Boolean).join(" ") || `Could not start the ${mode}`,
        );
        return;
      }
      setAgentPhase("queued");
      setAgentNote(
        body.nextStep ||
          `${EXECUTOR_COPY.honesty.watchQueued} ${EXECUTOR_COPY.honesty.notificationWhenDone}`,
      );
      onChanged();
    } catch (e) {
      setAgentPhase("failed");
      setError(e instanceof Error ? e.message : `Could not start the ${mode}`);
    } finally {
      setAgentBusy(false);
    }
  }

  async function mutate(run: () => Promise<Response>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) await throwApiError(res, fallback);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    mutate(
      () => postJson(`/api/projects/${projectId}/widget-token`, {}),
      "Could not create widget token",
    );
  const rotate = () =>
    mutate(
      () => postJson(`/api/projects/${projectId}/widget-token`, { rotate: true }),
      "Could not rotate widget token",
    );
  const revoke = () =>
    mutate(() => deleteJson(`/api/projects/${projectId}/widget-token`), "Could not disable widget");
  const setTokenStatus = (status: "active" | "paused") =>
    mutate(
      () => postJson(`/api/projects/${projectId}/widget-token`, { status }),
      "Could not update widget",
    );

  const statusCallout = live
    ? "ui-callout-positive flex-col sm:flex-row sm:items-center"
    : paused
      ? "ui-callout-warning flex-col sm:flex-row sm:items-center"
      : "ui-callout-accent flex-col sm:flex-row sm:items-center";

  return (
    <section className="ui-panel mb-5 p-5 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="ui-page-title text-lg sm:text-xl">Feedback widget</h2>
            <p className="ui-page-subtitle">
              Visitors point at the broken element. Reports land here. One click sends the fix to
              the project agent.
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="ui-btn-icon shrink-0"
              aria-label="Close widget setup"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <Loader2 className="ui-spinner-xs" /> Loading…
          </div>
        ) : (
          <>
            <div className={statusCallout}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary">
                  {paused
                    ? "Paused on the live site"
                    : live
                      ? `Live${site ? ` · ${site.replace(/^https:\/\//, "")}` : ""}`
                      : token
                        ? "Token ready — not seen on the live site yet"
                        : "Not enabled"}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {paused
                    ? "Resume to show the FAB again — no deploy needed."
                    : live
                      ? `Last boot ${compactRelativeDate(new Date(token!.lastSeenAt!))}`
                      : token
                        ? `The script must run on ${site ?? "the live origin"} (CSP must allow loki.orangecat.ch). A boot heartbeat is Live — HTML containing the tag is not.`
                        : "Enable a token, then add the script to the site (copy, or queue an agent)."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!token ? (
                  <>
                    <button
                      type="button"
                      onClick={() => dispatchAgent("install")}
                      disabled={agentBusy}
                      className="ui-btn-save gap-1.5"
                    >
                      {agentBusy ? (
                        <Loader2 className="ui-spinner-xs" />
                      ) : (
                        <Rocket className="h-3.5 w-3.5" />
                      )}
                      Enable & install
                    </button>
                    <button
                      type="button"
                      onClick={create}
                      disabled={busy}
                      className="ui-btn-secondary gap-1.5"
                    >
                      Enable only
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => copy(token.snippet)}
                      className="ui-btn-save gap-1.5"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copied ? "Copied" : "Copy snippet"}
                    </button>
                    {!live && (
                      <button
                        type="button"
                        onClick={() => dispatchAgent("install")}
                        disabled={agentBusy || agentPhase === "queued"}
                        className="ui-btn-secondary gap-1.5"
                        title="Queues an agent on Control. Does not mean the widget is live."
                      >
                        {agentBusy ? (
                          <Loader2 className="ui-spinner-xs" />
                        ) : (
                          <Rocket className="h-3.5 w-3.5" />
                        )}
                        {agentPhase === "queued" ? "Install queued" : "Install via agent"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {token && (
              <details className="ui-list-row" open={!live}>
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">
                  Snippet
                </summary>
                <code className="mt-2 block overflow-x-auto whitespace-pre font-mono text-micro leading-relaxed text-text-tertiary">
                  {token.snippet}
                </code>
              </details>
            )}

            {(agentNote || agentPhase === "queued") && (
              <div className="ui-callout-warning flex-col items-stretch">
                <p className="text-xs font-medium text-text-primary">
                  {agentPhase === "queued" ? "Queued — not confirmed working" : "Install"}
                </p>
                {agentNote && (
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{agentNote}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <Link
                    href={activityHref}
                    className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline"
                  >
                    Activity <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link
                    href={controlHref}
                    className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline"
                  >
                    Control <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link
                    href={terminalHref}
                    className="inline-flex items-center gap-1 text-text-tertiary underline-offset-2 hover:underline"
                  >
                    Terminal · Cloud <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <p className="mt-2 text-micro text-text-muted">
                  {EXECUTOR_COPY.honesty.watchQueued} {EXECUTOR_COPY.honesty.notificationWhenDone}{" "}
                  Activity shows every inject attempt and the real error.
                </p>
              </div>
            )}

            {token && (
              <div className="border-t border-border-subtle pt-3">
                <WidgetPlacementControl
                  value={token.placement}
                  busy={busy}
                  onSave={(placement) =>
                    mutate(
                      () => postJson(`/api/projects/${projectId}/widget-token`, { placement }),
                      "Could not move the launcher",
                    )
                  }
                />
              </div>
            )}

            {token && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
                <button
                  type="button"
                  onClick={() => setTokenStatus(paused ? "active" : "paused")}
                  disabled={busy}
                  className="ui-btn-secondary gap-1.5"
                >
                  {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="ui-btn-ghost text-xs text-text-tertiary"
                  aria-expanded={moreOpen}
                >
                  {moreOpen ? "Fewer actions" : "More"}
                </button>
                {moreOpen && (
                  <>
                    <button
                      type="button"
                      onClick={() => dispatchAgent("uninstall")}
                      disabled={agentBusy}
                      className="ui-btn-secondary gap-1.5"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Remove via agent
                    </button>
                    <button
                      type="button"
                      onClick={rotate}
                      disabled={busy}
                      className="ui-btn-secondary gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Rotate token
                    </button>
                    <button
                      type="button"
                      onClick={revoke}
                      disabled={busy}
                      className="ui-btn-danger"
                    >
                      Disable
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="ui-error">{error}</p>}
      </div>
    </section>
  );
}

/**
 * Observed truth only: "Live" means the widget's boot heartbeat actually
 * arrived from the site — never that we handed out a snippet.
 */
function AiReviewCard({
  projectId,
  projectName,
  defaultUrl,
  onClose,
}: {
  projectId: string;
  projectName: string;
  defaultUrl: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dispatchReview() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/feedback/ai-review`, { url });
      if (!res.ok) await throwApiError(res, "Could not queue the review");
      setQueued(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-card-shell mb-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <ScanEye className="h-4 w-4" />
            AI page review
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            An agent opens the page in a headless browser, reviews it on desktop and mobile, and
            files each issue into this inbox — you triage and implement fixes as usual.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ui-btn-icon"
          aria-label="Close AI review"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {queued ? (
        <div className="mt-3">
          <DispatchedNote workspaceKey={projectName} />
        </div>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void dispatchReview();
          }}
        >
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-site.com/page-to-review"
            className="ui-input-compact min-w-0 flex-1 basis-56"
            aria-label="Page URL to review"
          />
          <button type="submit" disabled={busy || !url} className="ui-btn-save gap-1.5">
            {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
            Review
          </button>
        </form>
      )}
      {error && <p className="mt-2 ui-error">{error}</p>}
    </div>
  );
}

/**
 * "Ship fixes automatically" — who presses merge on an agent's fix for this
 * project. Lives here because it belongs to the same loop as the widget: the
 * widget collects the report, this decides whether the fix reaches the site
 * without a person clicking.
 *
 * Three states, and the never-chosen one matters: a project nobody has decided
 * about gets an invitation, not a switch sitting in the off position that
 * looks like somebody's decision. Off is the effective default either way, so
 * client sites — which Loki cannot distinguish from its own — never ship
 * themselves by accident.
 */
function AutoShipToggle({ projectId }: { projectId: string }) {
  const { data, refetch } = useFetch<{ autoShip: boolean | null; hasRepo: boolean }>(
    `/api/projects/${projectId}/auto-ship`,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || !data.hasRepo) return null;
  const on = data.autoShip === true;
  const neverChosen = data.autoShip === null || data.autoShip === undefined;
  const set = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await patchJson(`/api/projects/${projectId}/auto-ship`, { autoShip: next });
      refetch();
    } catch {
      setError("Couldn't save that — the setting is unchanged.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mb-3 flex items-start justify-between gap-4 rounded-xl border border-border-subtle bg-surface-base px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">Ship fixes automatically</p>
        <p className="mt-0.5 text-xs text-text-tertiary">
          {on
            ? "When an agent's pull request passes its checks, Loki merges it and the site deploys. A repository with no checks is never merged, and one broken deploy pauses this."
            : neverChosen
              ? "Right now a fix waits for you to merge its pull request. Loki can do that itself once the checks pass — it only ever merges the pull request it opened for this project."
              : "A fix waits for you to merge its pull request."}
        </p>
        {error && <p className="mt-1 text-xs text-status-negative">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Ship fixes automatically"
        onClick={() => void set(!on)}
        disabled={saving}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-accent-primary" : "border border-border-subtle bg-surface-overlay"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
