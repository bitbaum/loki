"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { RECOMMEND, type Recommendation } from "@/lib/feedback/recommend";
import { ROLE_LABELS } from "@/lib/project-capabilities";
import type { FeedbackListItemWithWork } from "@/lib/feedback/attach-work";
import { FeedbackItemRow } from "@/components/feedback/FeedbackItemRow";
import { WatchFixButton } from "@/components/feedback/WatchFixButton";
import { LookedPicture } from "@/components/feedback/LookedPicture";
import { livePageHref } from "@/lib/feedback/fix-shipping";
import { compactRelativeDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { fleetSurfaceHref, withTerminalView } from "@/lib/fleet-context";
import { decisionFacts } from "@/lib/feedback/decision-facts";
import { NOTE_NONE } from "@/lib/feedback/fix-note";
import { READ_SIZE_WORD, type FeedbackRead } from "@/lib/feedback/read-report";
import { ReadBlock } from "@/components/feedback/ReadBlock";
import { projectTitle } from "@/lib/project-display";

/**
 * One decision Loki has already made, waiting for a yes.
 *
 * The card leads with the tap (Loki's recommendation, as a verb) and the
 * reason in one short sentence. Under it, each fact on its own line — what
 * was asked, what was done, what could come next, what Loki saw on the live
 * page — so the card reads in a glance instead of as one long string. One
 * filled button is the yes; "More" opens the full row — every other move,
 * sharing the walkthrough, the terminal — for the reader who disagrees. Nothing on the card needs to be
 * read for the tap to be right: that is the contract the recommendation
 * engine (lib/feedback/recommend.ts) signs.
 */
export function DecisionCard({
  item: f,
  rec,
  busy,
  taken,
  project,
  onTake,
  rowProps,
  read,
  reading,
}: {
  item: FeedbackListItemWithWork & { projectName: string; projectId: string };
  rec: Recommendation;
  busy: boolean;
  /** Just taken, on this screen: the card says so and fades. */
  taken: boolean;
  project: { id: string; name: string } | null;
  /** The yes — with the ask as the owner edited it, when Loki read the report. */
  onTake: (ask?: string) => void;
  /** Loki's read of the report (lib/feedback/read-report), when it has one. */
  read?: FeedbackRead | null;
  reading?: boolean;
  rowProps: Parameters<typeof FeedbackItemRow>[0] extends infer P
    ? Omit<P, "feedback" | "projectName" | "project" | "busy">
    : never;
}) {
  const [other, setOther] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const cost =
    rec.kind === RECOMMEND.LOOK
      ? "your eyes"
      : rec.runs
        ? read
          ? READ_SIZE_WORD[read.size].split(" — ")[0].toLowerCase()
          : "one agent run"
        : "free";
  const showRead = rec.kind === RECOMMEND.BUILD && (read || reading);
  // The role in the words the roster uses ("Builder", never the stored "editor").
  const roleWord =
    f.reporterRole && f.reporterRole in ROLE_LABELS
      ? ROLE_LABELS[f.reporterRole as keyof typeof ROLE_LABELS].label
      : f.reporterRole;
  const reporter = f.reporterName ? `${f.reporterName}${roleWord ? ` · ${roleWord}` : ""}` : null;
  const liveHref = livePageHref(f.liveUrl, f.url, f.page);
  const facts = decisionFacts(f);
  // A run exists (Queued onward, or the failed one this card is about): the
  // card links to it, so "where do I watch?" is never a hunt.
  const watchHref = f.work.runId
    ? withTerminalView(
        fleetSurfaceHref("terminal", f.work.terminalTab ?? f.projectName, undefined, f.work.runId),
        "terminal",
      )
    : null;
  return (
    <article className={cn("ui-fb-decision", taken && "ui-fb-decision-taken")}>
      <div className="ui-fb-decision-top">
        <p className="ui-fb-decision-kicker">
          {kindWord(rec)} · {cost}
        </p>
        <span className="ui-fb-decision-where">
          {project ? `${projectTitle({ name: project.name })} · ` : ""}
          {f.page && f.page !== "/" ? f.page : "home"} · {compactRelativeDate(f.createdAt)}
        </span>
      </div>
      <p className="ui-fb-decision-why">{rec.why}</p>
      <dl className="ui-fb-decision-facts">
        <dt className="ui-fb-decision-fact-label">{reporter ? "From" : "Asked"}</dt>
        <dd className="ui-fb-decision-fact-quote">
          {reporter && <span className="ui-fb-decision-reporter">{reporter} · </span>}“{facts.asked}
          ”
        </dd>
        {f.moments && f.moments.length > 0 && (
          <>
            <dt className="ui-fb-decision-fact-label">Walked</dt>
            <dd className="ui-fb-decision-fact-quiet">{walkWords(f.moments)}</dd>
          </>
        )}
        {facts.done && (
          <>
            <dt className="ui-fb-decision-fact-label">Done</dt>
            <dd className="ui-fb-decision-fact">{facts.done}</dd>
          </>
        )}
        {facts.helps && (
          <>
            <dt className="ui-fb-decision-fact-label">Helps</dt>
            <dd className="ui-fb-decision-fact">{facts.helps}</dd>
          </>
        )}
        {facts.us && (
          <>
            <dt className="ui-fb-decision-fact-label">For us</dt>
            <dd className="ui-fb-decision-fact">{facts.us}</dd>
          </>
        )}
        {facts.noTradeoffs ? (
          <>
            <dt className="ui-fb-decision-fact-label">Downsides</dt>
            <dd className="ui-fb-decision-fact-none">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              None — no downsides, no extra cost
            </dd>
          </>
        ) : (
          <>
            {facts.downsides && (
              <>
                <dt className="ui-fb-decision-fact-label">Downsides</dt>
                <TradeoffValue value={facts.downsides} />
              </>
            )}
            {facts.costs && (
              <>
                <dt className="ui-fb-decision-fact-label">Costs</dt>
                <TradeoffValue value={facts.costs} />
              </>
            )}
          </>
        )}
        {facts.notStated.length > 0 && (
          <>
            <dt className="ui-fb-decision-fact-label">Not stated</dt>
            <dd className="ui-fb-decision-fact-quiet">{facts.notStated.join(", ")}</dd>
          </>
        )}
        {facts.proof && (
          <>
            <dt className="ui-fb-decision-fact-label">Proof</dt>
            <dd className="ui-fb-decision-fact">{facts.proof}</dd>
          </>
        )}
        {facts.next && (
          <>
            <dt className="ui-fb-decision-fact-label">Next</dt>
            <dd className="ui-fb-decision-fact">{facts.next}</dd>
          </>
        )}
        {rec.evidence && (
          <>
            <dt className="ui-fb-decision-fact-label">Loki saw</dt>
            <dd className="ui-fb-decision-fact-quiet">{rec.evidence}</dd>
          </>
        )}
      </dl>
      {showRead && (
        <ReadBlock read={read ?? null} reading={Boolean(reading)} ask={ask} onAsk={setAsk} />
      )}
      {rec.kind === RECOMMEND.LOOK && (
        // Loki could not settle it, but it took the picture: the owner can
        // often answer from here, without the trip to the site.
        <LookedPicture feedbackId={f.id} verify={f.work.ship?.verify} lead />
      )}
      <div className="ui-fb-decision-actions">
        {taken ? (
          <span className="ui-fb-decision-done">{takenWords(rec)}</span>
        ) : rec.kind === RECOMMEND.CONNECT ? (
          <Link href={`/projects/${f.projectId}`} className="ui-btn-save">
            {rec.label}
          </Link>
        ) : rec.kind === RECOMMEND.LOOK ? (
          // Look first — the walkthrough opens the live page and points at
          // the change — then answer. Both answers are one tap, right here.
          <>
            {liveHref && <WatchFixButton feedbackId={f.id} liveHref={liveHref} share={false} />}
            <button
              type="button"
              onClick={rowProps.onResolve}
              disabled={busy}
              className="ui-btn-secondary"
              title="You looked and the point is fixed"
            >
              It worked
            </button>
            <button
              type="button"
              onClick={rowProps.onReopen}
              disabled={busy}
              className="ui-btn-secondary"
              title="Put it back so it can be built again"
            >
              Not fixed
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onTake(ask ?? read?.ask ?? undefined)}
            disabled={busy}
            className="ui-btn-save"
            title={
              rec.runs
                ? "Starts one agent run on your runner"
                : "Free — and one step brings it back"
            }
          >
            {busy && <Loader2 className="ui-spinner-xs" />}
            {rec.label}
          </button>
        )}
        {watchHref && (
          <a
            href={watchHref}
            className="ui-btn-secondary"
            title="Open this run's terminal and watch the agent, live"
          >
            Watch
          </a>
        )}
        {!taken && (
          <button
            type="button"
            onClick={() => setOther((v) => !v)}
            className="ui-fb-row-quiet-btn"
            aria-expanded={other}
          >
            {other ? "Less" : "More"}
          </button>
        )}
      </div>
      {other && (
        <div className="ui-fb-decision-row">
          <FeedbackItemRow
            feedback={f}
            projectName={f.projectName}
            project={project}
            busy={busy}
            {...rowProps}
          />
        </div>
      )}
    </article>
  );
}

/** "4 parts of the page · tapped 2 things" — the walk in one line; "More" opens it. */
function walkWords(moments: NonNullable<FeedbackListItemWithWork["moments"]>): string {
  const parts = new Set(moments.map((m) => `${m.page}|${m.label}`)).size;
  const taps = moments.filter((m) => m.tap).length;
  const pages = new Set(moments.map((m) => m.page)).size;
  return [
    `${parts} part${parts === 1 ? "" : "s"} of ${pages > 1 ? `${pages} pages` : "the page"}`,
    taps ? `tapped ${taps} thing${taps === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function kindWord(rec: Recommendation): string {
  switch (rec.kind) {
    case RECOMMEND.CONFIRM:
      return "Confirm";
    case RECOMMEND.BUILD:
      return "Build";
    case RECOMMEND.RETRY:
      return "Try again";
    case RECOMMEND.CLOUD:
      return "Move to the cloud";
    case RECOMMEND.FILE:
      return "File away";
    case RECOMMEND.CONNECT:
      return "Connect";
    case RECOMMEND.LOOK:
      return "Look";
  }
}

/** A downside or cost: the developer's words, or a clear "None". */
function TradeoffValue({ value }: { value: string }) {
  if (value === NOTE_NONE)
    return (
      <dd className="ui-fb-decision-fact-none">
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
        None
      </dd>
    );
  return <dd className="ui-fb-decision-fact">{value}</dd>;
}

/**
 * What the card says once its button was pressed. Never "Done" for a run:
 * starting a build is not finishing it, and "Done — try again" read as
 * success over a failure (2026-10-21). The run's own status takes over.
 */
export function takenWords(rec: Pick<Recommendation, "kind" | "label" | "runs">): string {
  if (rec.runs) return "Queued — watch it under Under way";
  return `Done — ${rec.label.toLowerCase()}`;
}
