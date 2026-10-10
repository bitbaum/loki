"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { compactRelativeDate } from "@/lib/dates";
import { FEEDBACK_SOURCE, FEEDBACK_STATUS } from "@/lib/constants/statuses";
import { deriveFeedbackWork, FEEDBACK_WORK_PHASE } from "@/lib/feedback/work-phase";
import { rowStory } from "@/lib/feedback/row-story";
import type { FeedbackListItem } from "@/db/queries/site-feedback";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import { FeedbackReportText } from "@/components/feedback/FeedbackReportText";
import { WatchFixButton } from "@/components/feedback/WatchFixButton";
import { ProviderSwitch } from "@/components/agents/ProviderSwitch";
import { fleetSurfaceHref, withTerminalView } from "@/lib/fleet-context";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { cn } from "@/lib/utils";

/**
 * One feedback report, everywhere feedback renders.
 *
 * Rebuilt 2026-10-10 from the owner's reading of it on a phone: "It doesn't
 * explain why it needs me and what exactly I need to do … Watch what? Where
 * would I be taken? … I don't know what the star is, and I don't know what
 * that arrow is." The row showed a status word, the report, and buttons —
 * and left every sentence between them to the reader.
 *
 * Now every row is the same five things, in order, and reads top to bottom
 * as one paragraph a person could say aloud:
 *
 *   1. what the state IS      — one bold sentence (lib/feedback/row-story.ts)
 *   2. the report             — the visitor's or Loki's words, clamped
 *   3. where and when         — project · page · who · when, one muted line
 *   4. what happens now       — one sentence: what is wanted of you, or
 *                               that nothing is
 *   5. the moves              — every control is a verb that names its
 *                               destination ("See the fix on the site",
 *                               "Watch in Terminal", "It worked", "File
 *                               away"). No bare icons; the one filled button
 *                               is the move the sentence above asks for.
 *
 * Technical detail (the agent's handoff line, raw errors, screenshots) sits
 * under the moves behind a disclosure, never between the sentence and the
 * button it points at.
 */
export function FeedbackItemRow({
  feedback: f,
  projectName,
  project,
  busy,
  onDispatch,
  onRunInCloud,
  onResolve,
  onArchive,
  onReopen,
  onFeature,
}: {
  feedback: FeedbackListItemWithWork | FeedbackListItem;
  projectName: string;
  /** Set on cross-project surfaces: renders a project link in the where line. */
  project?: { id: string; name: string } | null;
  busy: boolean;
  /** Queue the fix. `agent` switches provider and records the preference. */
  onDispatch: (opts?: { note?: string; agent?: string }) => void;
  /** Hand the queued row to the cloud builder — offered when the row waits
   *  for this computer and the cloud is online (work.rerouteTo). */
  onRunInCloud?: () => void;
  onResolve: () => void;
  onArchive: () => void;
  onReopen: () => void;
  onFeature: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const work = "work" in f && f.work ? f.work : deriveFeedbackWork(f.status, null);
  const runnable = "runnable" in f ? f.runnable !== false : true;
  const liveHref = livePageHref("liveUrl" in f ? f.liveUrl : null, f.url, f.page);
  const story = rowStory({
    work,
    page: f.page ?? null,
    runnable,
    hadRun: !!f.dispatchedRunId,
    resolvedAt: f.resolvedAt ?? null,
    archiveReason: f.archiveReason ?? null,
  });
  // The run this row is about — its own lane's tab when it got one.
  const runHref = fleetSurfaceHref(
    "terminal",
    work.terminalTab ?? projectName,
    undefined,
    work.runId,
  );
  const phase = work.phase;
  const ship = work.ship ?? null;
  const moving = phase === FEEDBACK_WORK_PHASE.QUEUED || phase === FEEDBACK_WORK_PHASE.WORKING;
  const broken = phase === FEEDBACK_WORK_PHASE.FAILED || phase === FEEDBACK_WORK_PHASE.STUCK;
  const live = phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY && work.checkLive === true && !!liveHref;
  const done = f.status === FEEDBACK_STATUS.RESOLVED;
  const archived = f.status === FEEDBACK_STATUS.ARCHIVED;

  const build = (label: string, primary: boolean, opts?: { note?: string; agent?: string }) => (
    <button
      type="button"
      onClick={() => onDispatch(opts)}
      disabled={busy}
      className={primary ? "ui-btn-save" : "ui-btn-secondary"}
      title="Queue an agent run for this on your builder"
    >
      {busy && <Loader2 className="ui-spinner-xs" />}
      {label}
    </button>
  );
  /** Where to watch: the run's session, as its chat or its raw terminal. */
  const watchLinks = work.watchable ? (
    <>
      <a
        href={withTerminalView(runHref, "terminal")}
        className="ui-btn-secondary"
        title={
          work.terminalReady
            ? "Open this run's terminal and watch the agent work, live"
            : "Open this run's terminal — it fills once the agent starts"
        }
      >
        Watch in Terminal
      </a>
      <a
        href={withTerminalView(runHref, "chat")}
        className="ui-btn-secondary"
        title="The same run as a conversation: what the agent says it is doing"
      >
        Agent&apos;s chat
      </a>
    </>
  ) : null;

  // The moves: the one the headline asks for, filled; the alternatives, plain;
  // the ways out (file away, reopen, feature), as quiet text.
  let moves: React.ReactNode = null;
  let quiet: React.ReactNode = null;
  if (archived) {
    quiet = <QuietMove onClick={onReopen} busy={busy} label="Reopen" />;
  } else if (done) {
    moves = f.dispatchedRunId && liveHref && (
      <WatchFixButton feedbackId={f.id} liveHref={liveHref} />
    );
    quiet = (
      <>
        <QuietMove
          onClick={onFeature}
          busy={busy}
          label={f.featuredAt ? "Remove from the public strip" : "Show on the public strip"}
          title="The site's 'shipped thanks to feedback' strip"
        />
        <QuietMove onClick={onReopen} busy={busy} label="Not fixed after all" />
      </>
    );
  } else if (phase === FEEDBACK_WORK_PHASE.NOT_STARTED && !runnable) {
    moves = (
      <Link href={`/projects/${f.projectId}`} className="ui-btn-save">
        Connect a repository
      </Link>
    );
    quiet = <QuietMove onClick={onArchive} busy={busy} label="File away" />;
  } else if (phase === FEEDBACK_WORK_PHASE.NOT_STARTED) {
    moves = (
      <>
        {build("Build it", true)}
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          disabled={busy}
          className="ui-btn-secondary"
          aria-expanded={noteOpen}
          title="Tell the agent something first, then build"
        >
          Add a note first
        </button>
      </>
    );
    quiet = (
      <>
        <QuietMove onClick={onResolve} busy={busy} label="Already done" />
        <QuietMove onClick={onArchive} busy={busy} label="File away" />
      </>
    );
  } else if (moving) {
    moves = watchLinks;
    quiet = <QuietMove onClick={onResolve} busy={busy} label="Not needed any more" />;
  } else if (broken && work.rerouteTo === "cloud" && onRunInCloud) {
    moves = (
      <>
        <button
          type="button"
          onClick={onRunInCloud}
          disabled={busy}
          className="ui-btn-save"
          title="Move this to the cloud builder — it starts now, nothing is lost"
        >
          {busy && <Loader2 className="ui-spinner-xs" />}
          Run it in the cloud
        </button>
        {watchLinks}
      </>
    );
    quiet = <QuietMove onClick={onArchive} busy={busy} label="File away" />;
  } else if (broken) {
    moves = (
      <>
        <ProviderSwitch
          projectId={f.projectId}
          busy={busy}
          onSwitch={(agent) => onDispatch({ agent })}
        />
        {build("Try again", false)}
        {watchLinks}
      </>
    );
    quiet = (
      <>
        <QuietMove onClick={onResolve} busy={busy} label="Mark done anyway" />
        <QuietMove onClick={onArchive} busy={busy} label="File away" />
      </>
    );
  } else if (phase === FEEDBACK_WORK_PHASE.NEEDS_VERIFY) {
    moves = (
      <>
        {live ? (
          <WatchFixButton feedbackId={f.id} liveHref={liveHref!} />
        ) : ship?.pr ? (
          <a
            href={ship.pr.url}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary"
            title={ship.pr.title}
          >
            Read the change on GitHub ↗
          </a>
        ) : ship?.push ? (
          <a
            href={ship.push.url}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary"
            title={ship.push.title}
          >
            Open the branch ↗
          </a>
        ) : ship ? (
          build("Try again", true)
        ) : null}
        {story.tone === "you" && (
          <>
            <button
              type="button"
              onClick={onResolve}
              disabled={busy}
              className={live ? "ui-btn-secondary" : "ui-btn-secondary"}
              title={live ? "You looked and the point is fixed" : "Close it as done"}
            >
              {live ? "It worked" : "Mark done"}
            </button>
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              className="ui-btn-secondary"
              title="Put it back so it can be built again, with a note"
            >
              Not fixed
            </button>
          </>
        )}
      </>
    );
    quiet =
      story.tone === "you" ? null : <QuietMove onClick={onResolve} busy={busy} label="Mark done" />;
  }

  return (
    <article className={cn("ui-fb-row", archived && "opacity-70")}>
      <p className={cn("ui-fb-row-headline", `ui-fb-row-headline-${story.tone}`)}>
        {story.headline}
      </p>
      <FeedbackReportText text={f.suggestion} />
      <ElementTarget f={f} />
      <WhereLine f={f} project={project} />
      {story.next && <p className="ui-fb-row-next">{story.next}</p>}

      {(moves || quiet) && (
        <div className="ui-fb-row-actions">
          {moves}
          {quiet && <span className="ui-fb-row-quiet">{quiet}</span>}
        </div>
      )}

      {noteOpen && phase === FEEDBACK_WORK_PHASE.NOT_STARTED && (
        <div className="ui-fb-row-actions">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="For the agent, e.g. 'only fix the mobile layout'"
            className="ui-input-compact min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) onDispatch({ note: note.trim() });
            }}
          />
          {build("Build it", true, note.trim() ? { note: note.trim() } : undefined)}
        </div>
      )}

      <RowDetails f={f} work={work} />
    </article>
  );
}

/** A way out, as quiet text: never an icon the reader has to decode. */
function QuietMove({
  onClick,
  busy,
  label,
  title,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="ui-fb-row-quiet-btn"
      title={title}
    >
      {label}
    </button>
  );
}

/** Display name from a contact string: "Fufa <f@x.ch>, CCSF" → "Fufa". */
export function contactName(contact: string | null | undefined): string | null {
  const c = contact?.trim();
  if (!c) return null;
  const named = /^([^<]+?)\s*</.exec(c);
  return named ? named[1].trim() : c;
}

/** Where and when: project · page · who · when, as one sentence that wraps like one. */
function WhereLine({
  f,
  project,
}: {
  f: FeedbackListItemWithWork | FeedbackListItem;
  project?: { id: string; name: string } | null;
}) {
  const source =
    f.source === FEEDBACK_SOURCE.AI_REVIEW
      ? "Loki's own read"
      : f.source === FEEDBACK_SOURCE.SYNTHESIZER
        ? "a brief"
        : null;
  const rawPage = f.page || (f.url ? f.url.replace(/^https?:\/\/[^/]+/, "") || f.url : null);
  const pageLabel = rawPage === "/" ? "home" : rawPage;
  const who = source ?? contactName(f.contact);
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
  if (pageLabel) parts.push(<span key="pg">{pageLabel}</span>);
  if (who)
    parts.push(
      <span key="w" title={f.contact ?? undefined}>
        from {who}
      </span>,
    );
  parts.push(
    <time key="t" dateTime={new Date(f.createdAt).toISOString()} title={`Reported ${exact}`}>
      {compactRelativeDate(f.createdAt)}
    </time>,
  );
  if (f.duplicateCount > 1) parts.push(<span key="d">reported {f.duplicateCount} times</span>);
  return (
    <p className="ui-fb-row-where">
      {parts.map((w, i) => (
        <span key={i}>
          {i > 0 && <span className="ui-fb-row-where-sep"> · </span>}
          {w}
        </span>
      ))}
    </p>
  );
}

/** The element the reporter pointed at, humanized; the raw selector on hover. */
function ElementTarget({ f }: { f: FeedbackListItemWithWork | FeedbackListItem }) {
  const els = f.selectedElements;
  if (!els || els.length === 0) return null;
  const text = els.length === 1 ? els[0].elementText : null;
  const what = els.length > 1 ? `${els.length} elements` : els[0].elementType || "an element";
  return (
    <p className="ui-fb-row-target" title={els.map((el) => el.selector).join("\n")}>
      Pointed at {text ? `“${text.length > 48 ? `${text.slice(0, 48)}…` : text}”` : what}
    </p>
  );
}

/**
 * What an engineer might want and the owner did not ask for: the agent's own
 * account, the pull request, the raw error, screenshots. One disclosure,
 * after the moves, so it never sits between a sentence and its button.
 */
function RowDetails({
  f,
  work,
}: {
  f: FeedbackListItemWithWork | FeedbackListItem;
  work: ReturnType<typeof deriveFeedbackWork>;
}) {
  const pr = work.ship?.pr ?? null;
  const items: React.ReactNode[] = [];
  if (work.didLine) items.push(<li key="did">The agent said: “{work.didLine}”</li>);
  if (pr)
    items.push(
      <li key="pr">
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="ui-link-muted"
          title={pr.title}
        >
          The change on GitHub (PR #{pr.number}) ↗
        </a>
      </li>,
    );
  if (work.queueReason && work.queueReason !== work.detail)
    items.push(<li key="q">{work.queueReason}</li>);
  if (work.diagnostic)
    items.push(
      <li key="diag" className="whitespace-pre-wrap break-words font-mono">
        {work.diagnostic}
      </li>,
    );
  if (items.length === 0 && !f.hasScreenshots) return null;
  return (
    <details className="ui-fb-row-details">
      <summary>Details</summary>
      {items.length > 0 && <ul>{items}</ul>}
      {f.hasScreenshots && <ScreenshotsThumbnails feedbackId={f.id} />}
    </details>
  );
}

function ScreenshotsThumbnails({ feedbackId }: { feedbackId: string }) {
  const [screenshots, setScreenshots] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/feedback/${feedbackId}/screenshot`)
      .then((res) => res.json())
      .then((data: { screenshots?: string[] }) => setScreenshots(data.screenshots ?? []))
      .catch(() => {});
  }, [feedbackId]);
  if (screenshots.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {screenshots.map((dataUrl, i) => (
        <a key={i} href={dataUrl} target="_blank" rel="noreferrer" className="inline-block">
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
