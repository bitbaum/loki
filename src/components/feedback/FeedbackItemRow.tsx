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
import { WatchFixButton } from "@/components/feedback/WatchFixButton";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { fleetSurfaceHref } from "@/lib/fleet-context";
import { livePageHref } from "@/lib/feedback/fix-shipping";

/**
 * One feedback item, everywhere feedback renders: the per-project section and
 * the cross-project /feedback inbox.
 *
 * Every row has the same four parts, in the same order, whatever its phase:
 *
 *   context  — status · project · page · who · when   (one muted line)
 *   message  — the report itself, clamped to three lines
 *   why      — one line on what is happening or what went wrong
 *   actions  — the decision (labelled) … utilities (icons, trailing edge)
 *
 * The status used to sit BELOW the message on a line of its own, the context
 * on another, and the buttons came in three heights and two fills depending
 * on which component drew them — so no two rows looked like the same kind of
 * thing (reported from a phone, 2026-10-03: "a bunch of random elements").
 * The parts are fixed now; only their content changes with the phase.
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
  /** Set on cross-project surfaces: renders a project link in the context line. */
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
  const [followAfterImplement, setFollowAfterImplement] = useState(() => readFollow(followKey));
  const [watchOpen, setWatchOpen] = useState(() => readFollow(followKey));
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
  const watchLive = work.watchable === true;
  // Watch exists whenever a run exists (Queued included), and immediately
  // after Implement/Retry. Terminal + Chat live inside the Watch panel — the
  // separate "Watching this run — pick where to look" strip repeated them.
  const showWatch = watchLive || followAfterImplement;
  const startImplement = (opts?: { note?: string; agent?: string }) => {
    try {
      sessionStorage.setItem(followKey, "1");
    } catch {
      /* private mode */
    }
    setFollowAfterImplement(true);
    setWatchOpen(true);
    onDispatch(opts);
  };
  // Somewhere for an agent to work. Rows from the per-project inbox carry no
  // flag and keep the one-click Implement; the server refuses the same case.
  const runnable = "runnable" in f ? f.runnable !== false : true;
  // The live page: the project's public origin plus the reported path. The
  // visitor's host is only a fallback — they may have reported from a preview.
  const liveHref = livePageHref("liveUrl" in f ? f.liveUrl : null, f.url, f.page);
  const ship = work.ship ?? null;
  const showCheckLive = work.checkLive === true && !!liveHref;
  const phase = work.phase;
  const failed = phase === FEEDBACK_WORK_PHASE.FAILED || phase === FEEDBACK_WORK_PHASE.STUCK;
  const moving = phase === FEEDBACK_WORK_PHASE.QUEUED || phase === FEEDBACK_WORK_PHASE.WORKING;
  const resolved = f.status === FEEDBACK_STATUS.RESOLVED;

  const watchToggle = (primary = true) =>
    showWatch ? (
      <FeedbackWatchButton
        open={watchOpen}
        onToggle={() => setWatchOpen((v) => !v)}
        primary={primary}
      />
    ) : null;
  const implementButton = (label: string, primary: boolean, title: string) => (
    <button
      type="button"
      onClick={() => startImplement()}
      disabled={busy}
      className={primary ? "ui-btn-save" : "ui-btn-secondary"}
      title={title}
    >
      {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
      {label}
    </button>
  );
  const resolveIcon = (
    <IconAction
      icon={Check}
      label="Mark resolved"
      onClick={onResolve}
      busy={busy}
      title={moving ? "Mark resolved — the run is not needed any more" : "Mark resolved"}
    />
  );

  // The decision: labelled buttons, at most one filled.
  let decision: React.ReactNode = null;
  // The utilities: icon buttons at the trailing edge, in a fixed order.
  let utility: React.ReactNode = null;

  if (phase === FEEDBACK_WORK_PHASE.NOT_STARTED && !runnable) {
    decision = (
      <Link
        href={`/projects/${f.projectId}`}
        className="ui-btn-save"
        title="This project has no repository or folder yet — the agent has nowhere to work. Add a Git URL, then Implement."
      >
        Connect a repository
      </Link>
    );
    utility = resolveIcon;
  } else if (phase === FEEDBACK_WORK_PHASE.NOT_STARTED) {
    decision = (
      <>
        {implementButton(
          "Implement",
          true,
          "Ask the agent to fix this — Watch opens so you can follow",
        )}
        {watchToggle()}
      </>
    );
    utility = (
      <>
        <IconAction
          icon={PenLine}
          label="Add an instruction, then implement"
          onClick={() => setNoteOpen((v) => !v)}
          busy={busy}
          expanded={noteOpen}
        />
        {resolveIcon}
      </>
    );
  } else if (moving) {
    decision = watchToggle();
    utility = resolveIcon;
  } else if (failed) {
    // A run that needs you is most often a run that ran out of quota, and the
    // fix is a different provider — not the same one again. So the switch is
    // the PRIMARY control and Retry steps down beside it. ProviderSwitch
    // renders nothing when no provider can answer.
    decision = (
      <>
        <ProviderSwitch
          projectId={f.projectId}
          busy={busy}
          onSwitch={(agent) => startImplement({ agent })}
        />
        {implementButton(
          "Retry",
          false,
          "Queue again on the same provider — Watch opens so you can follow",
        )}
        {watchToggle(false)}
      </>
    );
    utility = resolveIcon;
  } else if (phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY) {
    decision = (
      <>
        {showCheckLive ? (
          <WatchFixButton feedbackId={f.id} liveHref={liveHref!} />
        ) : ship?.pr ? (
          <a
            href={ship.pr.url}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-save"
            title={ship.pr.title}
          >
            Review PR
          </a>
        ) : ship?.push ? (
          <a
            href={ship.push.url}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary"
            title={ship.push.title}
          >
            Open branch
          </a>
        ) : ship ? (
          implementButton("Retry", true, "Queue again — Watch opens so you can follow")
        ) : null}

        <button
          type="button"
          onClick={onResolve}
          disabled={busy}
          className="ui-btn-secondary"
          title={
            showCheckLive
              ? "You looked at the live page and the point is fixed"
              : "Mark resolved without a live check"
          }
        >
          <Check className="h-3 w-3" /> Confirm
        </button>
      </>
    );
    utility = (
      <IconAction
        icon={Undo2}
        label="Not fixed"
        title="Not fixed — reopen so it can be implemented again with a note"
        onClick={onReopen}
        busy={busy}
      />
    );
  } else if (resolved) {
    utility = (
      <IconAction
        icon={Star}
        label={f.featuredAt ? "Unfeature" : "Feature publicly"}
        title={
          f.featuredAt
            ? "Remove from the public 'shipped thanks to feedback' strip"
            : "Feature on the public 'shipped thanks to feedback' strip"
        }
        onClick={onFeature}
        busy={busy}
        pressed={!!f.featuredAt}
      />
    );
  }

  return (
    <article className="ui-fb-row">
      <RowContext f={f} work={work} project={project} />
      <FeedbackReportText text={f.suggestion} />
      <ElementTarget f={f} />

      {(failed || phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY) && work.detail && (
        <p className="ui-fb-row-why">{work.detail}</p>
      )}
      {moving && (
        <p className="ui-fb-row-why-quiet">
          {work.stepSummary ? work.stepSummary : "Moving — Telegram when you need to"}
        </p>
      )}
      {phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY &&
        (work.didLine || (showCheckLive && ship?.pr)) && (
          <p className="ui-fb-row-why-quiet">
            {work.didLine && <span title="The agent's own account">Agent: {work.didLine}</span>}
            {/* With the live page as the primary action, the pull request is a
              reference, not a second decision — a link on the agent's line
              rather than a third labelled button. */}
            {showCheckLive && ship?.pr && (
              <>
                {work.didLine && " · "}
                <a
                  href={ship.pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ui-link-muted"
                  title={ship.pr.title}
                >
                  What changed ↗
                </a>
              </>
            )}
          </p>
        )}
      {/* The run's raw error, opened on purpose rather than printed at the
          reader — an engineer's note is not addressed to whoever filed it. */}
      {failed && work.diagnostic && (
        <details>
          <summary className="cursor-pointer text-micro text-text-muted hover:text-text-secondary">
            Technical details
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-micro text-text-muted">
            {work.diagnostic}
          </p>
        </details>
      )}
      {f.hasScreenshots && <ScreenshotsThumbnails feedbackId={f.id} />}

      <div className="ui-fb-row-actions">
        {decision}
        <div className="ui-fb-row-utility">
          {utility}
          {resolved ? (
            <IconAction icon={Undo2} label="Reopen" onClick={onReopen} busy={busy} />
          ) : (
            <IconAction icon={Archive} label="Archive" onClick={onArchive} busy={busy} />
          )}
        </div>
      </div>

      {noteOpen && phase === FEEDBACK_WORK_PHASE.NOT_STARTED && (
        <div className="ui-fb-row-actions">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Instruction for the agent, e.g. 'only fix the mobile layout'"
            className="ui-input-compact min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) startImplement({ note: note.trim() });
            }}
          />
          <button
            type="button"
            onClick={() => startImplement(note.trim() ? { note: note.trim() } : undefined)}
            disabled={busy}
            className="ui-btn-save"
          >
            {busy ? <Loader2 className="ui-spinner-xs" /> : <Rocket className="h-3 w-3" />}
            Implement
          </button>
        </div>
      )}

      {watchOpen && showWatch && (
        <FeedbackWatchPanel
          feedbackId={f.id}
          fallbackTerminalHref={terminalHref}
          stepSummary={
            work.stepSummary ??
            (followAfterImplement && !watchLive
              ? "Starting — follow here, or open Terminal / Chat"
              : null)
          }
          queueReason={work.queueReason}
          terminalReady={work.terminalReady === true}
        />
      )}
    </article>
  );
}

function readFollow(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Display name from a contact string: "Fufa <f@x.ch>, CCSF" → "Fufa". */
export function contactName(contact: string | null | undefined): string | null {
  const c = contact?.trim();
  if (!c) return null;
  const named = /^([^<]+?)\s*</.exec(c);
  return named ? named[1].trim() : c;
}

/**
 * The context line: status first, because it is the first thing a reader
 * needs to sort the row; then where (project · page), who, and when — the
 * age relative, the exact instant on hover.
 */
function RowContext({
  f,
  work,
  project,
}: {
  f: FeedbackListItemWithWork | FeedbackListItem;
  work: ReturnType<typeof deriveFeedbackWork>;
  project?: { id: string; name: string } | null;
}) {
  // Agent-filed rows get a typed tag instead of their magic contact string.
  const agentTag =
    f.source === FEEDBACK_SOURCE.AI_REVIEW
      ? "AI review"
      : f.source === FEEDBACK_SOURCE.SYNTHESIZER
        ? "Brief"
        : null;
  const pageLabel = f.page || (f.url ? f.url.replace(/^https?:\/\/[^/]+/, "") || f.url : null);
  const who = agentTag ? null : contactName(f.contact);
  const resolved = f.status === FEEDBACK_STATUS.RESOLVED && f.resolvedAt;
  const at = resolved ? f.resolvedAt! : f.createdAt;
  const exact = new Date(f.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const parts: React.ReactNode[] = [];
  if (project)
    parts.push(
      <Link key="p" href={`/projects/${project.id}#feedback`} className="ui-fb-row-project">
        {project.name}
      </Link>,
    );
  if (pageLabel)
    parts.push(
      <span key="pg" className="max-w-48 truncate">
        {pageLabel}
      </span>,
    );
  if (who)
    parts.push(
      <span key="w" className="max-w-40 truncate" title={f.contact ?? undefined}>
        {who}
      </span>,
    );
  parts.push(
    <time key="t" dateTime={new Date(at).toISOString()} title={`Submitted ${exact}`}>
      {resolved ? `resolved ${compactRelativeDate(at)}` : compactRelativeDate(at)}
    </time>,
  );

  return (
    <div className="ui-fb-row-context">
      {/* "Not started" said nothing the Implement button did not. The badge
          is a status, never a link. */}
      {work.phase !== FEEDBACK_WORK_PHASE.NOT_STARTED && <FeedbackWorkBadge work={work} />}
      {agentTag && <span className="ui-tag shrink-0">{agentTag}</span>}
      {f.duplicateCount > 1 && (
        <span className="ui-badge shrink-0" title={`Reported ${f.duplicateCount} times`}>
          ×{f.duplicateCount}
        </span>
      )}
      {parts.map((p, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="ui-fb-row-context-sep">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

/** The element the reporter pointed at, humanized; the raw selector on hover. */
function ElementTarget({ f }: { f: FeedbackListItemWithWork | FeedbackListItem }) {
  const els = f.selectedElements;
  if (!els || els.length === 0) return null;
  const text = els.length === 1 ? els[0].elementText : null;
  return (
    <p
      className="flex min-w-0 items-baseline gap-1 text-xs text-text-tertiary"
      title={els.map((el) => el.selector).join("\n")}
    >
      <span className="shrink-0 font-mono text-micro">
        {els.length > 1 ? `${els.length} elements` : els[0].elementType || "element"}
      </span>
      {text && (
        <span className="truncate">“{text.length > 48 ? `${text.slice(0, 48)}…` : text}”</span>
      )}
    </p>
  );
}

function IconAction({
  icon: Icon,
  label,
  title,
  onClick,
  busy,
  expanded,
  pressed,
}: {
  icon: typeof Check;
  label: string;
  title?: string;
  onClick: () => void;
  busy: boolean;
  expanded?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="ui-btn-icon"
      title={title ?? label}
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
    >
      <Icon className="h-3.5 w-3.5" fill={pressed ? "currentColor" : "none"} />
    </button>
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
    <div className="flex flex-wrap gap-2">
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
