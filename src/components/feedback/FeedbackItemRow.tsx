"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Check, Loader2, PenLine, Rocket, Star, Undo2 } from "lucide-react";
import { compactRelativeDate } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import type { FeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import { FeedbackReportText } from "@/components/feedback/FeedbackReportText";
import { FeedbackWorkBadge } from "@/components/feedback/FeedbackWorkBadge";
import { FeedbackWatchButton, FeedbackWatchPanel } from "@/components/feedback/FeedbackWatch";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { livePageHref } from "@/lib/feedback/fix-shipping";

/**
 * One feedback item, everywhere feedback renders: the per-project section and
 * the cross-project /feedback inbox. Layout rule: every fragment is LABELED by
 * placement or wording — the message leads, context (page · reporter · age)
 * reads as a sentence, the element target is humanized ("image — 'Send'")
 * with the raw CSS selector demoted to a hover title. The old card printed
 * the selector as a naked mono line, which read as debug output.
 */
export function FeedbackItemRow({
  feedback: f,
  projectName,
  project,
  busy,
  onDispatch,
  onResolve,
  onArchive,
  onReopen,
  onFeature,
}: {
  feedback: FeedbackListItemWithWork | FeedbackListItem;
  projectName: string;
  /** Set on cross-project surfaces: renders a project chip linking home. */
  project?: { id: string; name: string } | null;
  busy: boolean;
  /** Queue the fix. `agent` switches provider and records the preference. */
  onDispatch: (opts?: { note?: string; agent?: string }) => void;
  onResolve: () => void;
  onArchive: () => void;
  onReopen: () => void;
  onFeature: () => void;
}) {
  // "Comment then implement" without a comment thread: the note IS an edit to
  // the dispatch prompt. Plain Implement stays one-click.
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  // Persist "just implemented" across list refetch remounts — otherwise Watch
  // opens for one frame and vanishes when the inbox reloads (live walk 2026-09-16).
  const followKey = `loki:follow-implement:${f.id}`;
  const [followAfterImplement, setFollowAfterImplement] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(followKey) === "1";
    } catch {
      return false;
    }
  });
  const [watchOpen, setWatchOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(followKey) === "1";
    } catch {
      return false;
    }
  });
  const work = "work" in f && f.work ? f.work : deriveFeedbackWork(f.status, null);
  // Let Terminal resolve source (This computer vs cloud); do not force cloud.
  // A run given a parallel lane runs in its own tab; the project's tab holds
  // a different agent. Open the one this row is about.
  const terminalHref = fleetSurfaceHref(
    "terminal",
    work.terminalTab ?? projectName,
    undefined,
    work.runId,
  );
  const chatHref = fleetSurfaceHref("chat", projectName);
  // Terminal when there is a PTY to look at (the prompt reached an agent),
  // Control when there is not — Terminal is empty until a session exists.
  const watchLive = work.watchable === true;
  const terminalReady = work.terminalReady === true;
  // Watch is the primary control whenever a run exists (Queued included),
  // and immediately after the operator clicks Implement/Retry.
  // Terminal + Chat live inside the Watch panel AND on a path strip after Implement.
  const showWatch = watchLive || followAfterImplement;
  const markFollowing = () => {
    try {
      sessionStorage.setItem(followKey, "1");
    } catch {
      /* private mode */
    }
    setFollowAfterImplement(true);
    setWatchOpen(true);
  };
  const startImplement = (opts?: { note?: string; agent?: string }) => {
    markFollowing();
    onDispatch(opts);
  };
  // Somewhere for an agent to work. Rows from the per-project inbox carry no
  // flag and keep the one-click Implement; the server refuses the same case.
  const runnable = "runnable" in f ? f.runnable !== false : true;
  const projectHref = `/projects/${f.projectId}`;
  // The live page: the project's public origin plus the reported path. The
  // visitor's host is only a fallback — they may have reported from a preview.
  const liveHref = livePageHref("liveUrl" in f ? f.liveUrl : null, f.url, f.page);
  const ship = work.ship ?? null;
  const showCheckLive = work.checkLive === true && !!liveHref;
  // Agent-filed rows get a typed badge instead of their magic contact string.
  const agentBadge =
    f.source === FEEDBACK_SOURCE.AI_REVIEW
      ? "AI review"
      : f.source === FEEDBACK_SOURCE.SYNTHESIZER
        ? "brief"
        : null;
  // One line of context: where, who, when. The scope is implied by the
  // element chip (element) or by its absence (page); the run id is a lookup
  // key, not something a reader can act on, so it stays out of the line.
  const pageLabel = f.page || (f.url ? f.url.replace(/^https?:\/\/[^/]+/, "") || f.url : null);
  const submittedAt = new Date(f.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const meta = [
    pageLabel,
    !agentBadge && f.contact,
    f.status === FEEDBACK_STATUS.RESOLVED && f.resolvedAt
      ? `submitted ${submittedAt} · resolved ${compactRelativeDate(f.resolvedAt)}`
      : `submitted ${submittedAt}`,
  ].filter(Boolean);
  const failed =
    work.phase === FEEDBACK_WORK_PHASE.FAILED || work.phase === FEEDBACK_WORK_PHASE.STUCK;
  // The badge is the status; a "Not started" chip on every untouched report
  // said nothing the Implement button did not.
  const showBadge = work.phase !== FEEDBACK_WORK_PHASE.NOT_STARTED;
  const badge = showCheckLive ? (
    <a
      href={liveHref!}
      target="_blank"
      rel="noreferrer"
      className="shrink-0"
      title="Open the reported page"
    >
      <FeedbackWorkBadge work={work} />
    </a>
  ) : (
    <FeedbackWorkBadge work={work} />
  );

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          {/* The message leads, alone on its line. Status, source and repeat
              count sit on the context line beneath it, where they read as
              facts about the report instead of interrupting it. */}
          <FeedbackReportText text={f.suggestion} />
          {/* TWO lines, each holding one kind of fact.
              They were one `flex-wrap` line carrying six heterogeneous items:
              a wide status badge, an agent tag, a repeat count, the project
              link, an element chip and a long "page · contact · submitted …"
              run. At 390px that wrapped into three ragged lines with items
              landing wherever they fit — the project name floating alone
              mid-line above its own status. Splitting them does not change
              what is said, only whether the order survives a narrow screen. */}
          {(showBadge || agentBadge || f.duplicateCount > 1) && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
              {showBadge && badge}
              {agentBadge && <span className="ui-tag shrink-0">{agentBadge}</span>}
              {f.duplicateCount > 1 && (
                <span className="ui-badge shrink-0" title={`Reported ${f.duplicateCount} times`}>
                  ×{f.duplicateCount}
                </span>
              )}
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
            {project && (
              <Link
                href={`/projects/${project.id}#feedback`}
                className="font-medium text-text-secondary underline-offset-2 hover:underline"
              >
                {project.name}
              </Link>
            )}
            {f.selectedElements && f.selectedElements.length > 0 && (
              <span
                className="inline-flex max-w-full items-baseline gap-1 truncate"
                title={f.selectedElements.map((el) => el.selector).join("\n")}
              >
                <span className="font-mono text-micro">
                  {f.selectedElements.length > 1
                    ? `${f.selectedElements.length} elements`
                    : f.selectedElements[0].elementType || "element"}
                </span>
                {f.selectedElements.length === 1 && f.selectedElements[0].elementText && (
                  <span className="truncate">
                    “
                    {f.selectedElements[0].elementText.length > 48
                      ? `${f.selectedElements[0].elementText.slice(0, 48)}…`
                      : f.selectedElements[0].elementText}
                    ”
                  </span>
                )}
              </span>
            )}
            <span className="text-text-muted">{meta.join(" · ")}</span>
          </p>
          {/* Primary surface: badge + one next action. No walls of text while
              the machine moves — dig-in holds the why (diagnostic below). */}
          {(failed || work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY) && work.detail && (
            <p className="mt-1 text-xs text-text-secondary">{work.detail}</p>
          )}
          {(work.phase === FEEDBACK_WORK_PHASE.QUEUED ||
            work.phase === FEEDBACK_WORK_PHASE.WORKING) && (
            <p className="mt-1 text-xs text-text-muted">
              {work.stepSummary ? work.stepSummary : "Moving — Telegram when you need to"}
            </p>
          )}
          {work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY && work.didLine && (
            <p className="mt-0.5 text-xs text-text-tertiary" title="The agent's own account">
              Agent: {work.didLine}
            </p>
          )}
          {/* The run's raw error, opened on purpose rather than printed at the
            reader. It used to be the detail line itself, which is how an
            engineer's note ("...acked verified:false and never started")
            ended up addressed to whoever filed the feedback. */}
          {failed && work.diagnostic && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-micro text-text-muted hover:text-text-secondary">
                Technical details
              </summary>
              <p className="mt-1 whitespace-pre-wrap break-words font-mono text-micro text-text-muted">
                {work.diagnostic}
              </p>
            </details>
          )}
          {f.hasScreenshots && <ScreenshotsThumbnails feedbackId={f.id} />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {work.phase === FEEDBACK_WORK_PHASE.NOT_STARTED && !runnable ? (
            <>
              <Link
                href={projectHref}
                className="ui-btn-save gap-1"
                title="This project has no repository or folder yet — the agent has nowhere to work. Add a Git URL, then Implement."
              >
                Connect a repository
              </Link>
              <button
                type="button"
                onClick={onResolve}
                disabled={busy}
                className="ui-btn-icon"
                title="Mark resolved"
                aria-label="Mark resolved"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          ) : work.phase === FEEDBACK_WORK_PHASE.NOT_STARTED ? (
            <>
              <button
                type="button"
                onClick={() => startImplement()}
                disabled={busy}
                className="ui-btn-save gap-1.5"
                title="Ask the agent to fix this — Watch opens so you can follow"
              >
                {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
                Implement
              </button>
              {showWatch && (
                <FeedbackWatchButton open={watchOpen} onToggle={() => setWatchOpen((v) => !v)} />
              )}
              <button
                type="button"
                onClick={() => setNoteOpen((v) => !v)}
                disabled={busy}
                className="ui-btn-icon"
                title="Add an instruction, then implement"
                aria-label="Add an instruction"
                aria-expanded={noteOpen}
              >
                <PenLine className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onResolve}
                disabled={busy}
                className="ui-btn-icon"
                title="Mark resolved"
                aria-label="Mark resolved"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          ) : work.phase === FEEDBACK_WORK_PHASE.QUEUED ||
            work.phase === FEEDBACK_WORK_PHASE.WORKING ? (
            <>
              {showWatch && (
                <FeedbackWatchButton open={watchOpen} onToggle={() => setWatchOpen((v) => !v)} />
              )}
              <button
                type="button"
                onClick={onResolve}
                disabled={busy}
                className="ui-btn-secondary gap-1"
                title="Mark resolved"
              >
                <Check className="h-3 w-3" /> Resolve
              </button>
            </>
          ) : work.phase === FEEDBACK_WORK_PHASE.STUCK ||
            work.phase === FEEDBACK_WORK_PHASE.FAILED ? (
            <>
              {showWatch && (
                <FeedbackWatchButton open={watchOpen} onToggle={() => setWatchOpen((v) => !v)} />
              )}
              {/* A run that needs you is most often a run that ran out of
                  quota, and the fix is a different provider — not the same one
                  again. So the switch is the PRIMARY control here and Retry
                  steps down beside it. ProviderSwitch renders nothing when it
                  has no provider that can answer, and Retry is promoted back. */}
              <ProviderSwitch
                projectId={f.projectId}
                busy={busy}
                onSwitch={(agent) => startImplement({ agent })}
              />
              <button
                type="button"
                onClick={() => startImplement()}
                disabled={busy}
                className="ui-btn-secondary gap-1.5"
                title="Queue again on the same provider — Watch opens so you can follow"
              >
                {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
                Retry
              </button>
              <button
                type="button"
                onClick={onResolve}
                disabled={busy}
                className="ui-btn-icon"
                title="Mark resolved"
                aria-label="Mark resolved"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </>
          ) : work.phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY ? (
            <>
              {showCheckLive ? (
                <a
                  href={liveHref!}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-save gap-1"
                  title="Open the live page and confirm the visitor's point is fixed"
                >
                  Check live
                </a>
              ) : ship?.pr ? (
                <a
                  href={ship.pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-save gap-1"
                  title={ship.pr.title}
                >
                  Review PR
                </a>
              ) : ship?.push ? (
                <a
                  href={ship.push.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-btn-secondary gap-1"
                  title={ship.push.title}
                >
                  Open branch
                </a>
              ) : ship ? (
                <button
                  type="button"
                  onClick={() => startImplement()}
                  disabled={busy}
                  className="ui-btn-save gap-1.5"
                  title="Queue again — Watch opens so you can follow"
                >
                  {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                onClick={onResolve}
                disabled={busy}
                className="ui-btn-secondary gap-1"
                title={
                  showCheckLive
                    ? "You looked at the live page and the point is fixed"
                    : "Mark resolved without a live check"
                }
              >
                <Check className="h-3 w-3" /> Confirm
              </button>
              <button
                type="button"
                onClick={onReopen}
                disabled={busy}
                className="ui-btn-icon"
                title="Not fixed — reopen so it can be implemented again with a note"
                aria-label="Not fixed"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : f.status === FEEDBACK_STATUS.RESOLVED ? (
            <>
              <button
                type="button"
                onClick={onFeature}
                disabled={busy}
                className="ui-btn-icon"
                title={
                  f.featuredAt
                    ? "Remove from the public 'shipped thanks to feedback' strip"
                    : "Feature on the public 'shipped thanks to feedback' strip"
                }
                aria-label={f.featuredAt ? "Unfeature" : "Feature publicly"}
                aria-pressed={!!f.featuredAt}
              >
                <Star className="h-3.5 w-3.5" fill={f.featuredAt ? "currentColor" : "none"} />
              </button>
            </>
          ) : null}
          {f.status === FEEDBACK_STATUS.RESOLVED ? (
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              className="ui-btn-icon"
              title="Reopen"
              aria-label="Reopen"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              disabled={busy}
              className="ui-btn-icon"
              title="Archive"
              aria-label="Archive"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {noteOpen && work.phase === FEEDBACK_WORK_PHASE.NOT_STARTED && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Instruction for the agent, e.g. 'only fix the mobile layout'"
            className="ui-input-compact flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) startImplement({ note: note.trim() });
            }}
          />
          <button
            type="button"
            onClick={() => startImplement(note.trim() ? { note: note.trim() } : undefined)}
            disabled={busy}
            className="ui-btn-save gap-1.5"
          >
            {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
            Implement
          </button>
        </div>
      )}

      {followAfterImplement && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface-secondary/40 px-3 py-2 text-xs">
          <span className="font-medium text-text-primary">Watching this run</span>
          <span className="text-text-muted">— pick where to look:</span>
          <button
            type="button"
            className="ui-btn-save gap-1"
            onClick={() => setWatchOpen(true)}
            title="Open progress on this row"
          >
            Watch here
          </button>
          <a
            href={terminalHref}
            className="ui-btn-secondary gap-1"
            title="Open Loki Terminal for this project"
          >
            Terminal
          </a>
          <a
            href={chatHref}
            className="ui-btn-secondary gap-1"
            title="Open Loki chat for this project"
          >
            Chat
          </a>
        </div>
      )}
      {watchOpen && showWatch && (
        <FeedbackWatchPanel
          feedbackId={f.id}
          fallbackTerminalHref={terminalHref}
          chatHref={chatHref}
          stepSummary={
            work.stepSummary ??
            (followAfterImplement && !watchLive
              ? "Starting — follow here, or open Terminal / Chat"
              : null)
          }
          queueReason={work.queueReason}
          terminalReady={terminalReady}
        />
      )}
    </div>
  );
}
function ScreenshotsThumbnails({ feedbackId }: { feedbackId: string }) {
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/feedback/${feedbackId}/screenshot`)
      .then((res) => res.json())
      .then((data: { screenshots?: string[] }) => {
        setScreenshots(data.screenshots ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [feedbackId]);

  if (loading) return null;
  if (screenshots.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-2 pl-4">
      {screenshots.map((dataUrl, i) => (
        <a
          key={i}
          href={dataUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block"
          title={`Screenshot ${i + 1} of ${screenshots.length}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from API */}
          <img
            src={dataUrl}
            alt={`Visitor screenshot ${i + 1}`}
            className="h-14 w-auto rounded-md border border-border-subtle"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}
