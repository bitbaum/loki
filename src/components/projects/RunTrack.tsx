"use client";

/**
 * The delivery track, drawn: asked → a builder has it → the agent works →
 * pull request → merged → live. One vertical list with a rail, because on a
 * phone a row of six steps cannot be read; each mark says done / now / next /
 * needs you / failed in shape as well as colour. Facts only — the words and
 * states come from lib/run-track on the server; nothing here decides.
 *
 * Each row carries its time: "took 1m 20s" once a stage is behind, a running
 * clock on the one happening now, so a person can see the process is moving
 * and how long each step takes "by the moment I'm looking at it" (owner,
 * 2026-10-17). A tap opens the row: what exactly happened, when, and where
 * to look — and for the working stage, the agent's screen as Watch last saw
 * it, so "is it working?" has the screen as its answer.
 */
import { useEffect, useState } from "react";
import { AlertCircle, ArrowUpRight, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatStageSeconds,
  stageTimings,
  type RunTrack as RunTrackData,
  type TrackStage,
  type TrackStageState,
} from "@/lib/run-track";

const STATE_WORD: Record<TrackStageState, string> = {
  done: "Done",
  now: "Happening now",
  next: "Not yet",
  attention: "Needs you",
  failed: "Did not happen",
};

function Mark({ state }: { state: TrackStageState }) {
  if (state === "done") return <Check className="h-3 w-3" aria-hidden="true" />;
  if (state === "attention") return <AlertCircle className="h-3 w-3" aria-hidden="true" />;
  if (state === "failed") return <X className="h-3 w-3" aria-hidden="true" />;
  if (state === "now") return <span className="ui-watch-live-dot" aria-hidden="true" />;
  return null;
}

/** "11:52" in the reader's own clock — what a timestamp beside a fact says. */
function clock(at: string | null | undefined): string | null {
  if (!at) return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A one-second tick, only while a stage is live — a finished track is still. */
function useTick(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return now;
}

export function RunTrack({
  track,
  screen,
  terminalHref,
  collapsible = false,
}: {
  track: RunTrackData;
  /** The agent's screen as Watch last peeked it, shown inside the working row. */
  screen?: string[] | null;
  terminalHref?: string | null;
  /**
   * In a chat thread every past dispatch draws a card; a track that has
   * settled folds to its one sentence there, and opens on a tap. A track
   * that can still move is always drawn in full.
   */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const live = track.stages.some((s) => s.state === "now" || s.state === "attention");
  const now = useTick(live);
  // A road that ended in a failure stops there. Drawing "Pull request",
  // "Checks and merge" and "Live" as empty circles under a run that never
  // started read as work still to come (owner, 2026-10-20).
  const failedAt = track.stages.findIndex((s) => s.state === "failed");
  const stages =
    failedAt < 0
      ? track.stages
      : track.stages.filter((s, i) => i <= failedAt || s.state !== "next");
  const timings = stageTimings(stages, now);
  const folded = collapsible && track.settled && !unfolded;

  if (folded)
    return (
      <button
        type="button"
        className="ui-track-fold"
        onClick={() => setUnfolded(true)}
        aria-expanded={false}
      >
        <span className="ui-track-fold-text">{track.summary}</span>
        <ChevronDown className="ui-track-chevron" aria-hidden="true" />
      </button>
    );

  return (
    <ol className="ui-track" aria-label="Where the change is">
      {stages.map((stage, i) => {
        const timing = timings[i]!;
        const expandable =
          stage.facts.length > 0 ||
          Boolean(stage.href) ||
          (stage.id === "working" && (screen?.length || terminalHref));
        const isOpen = open === stage.id;
        const when = clock(stage.at);
        return (
          <li key={stage.id} className={`ui-track-item ui-track-${stage.state}`}>
            <span className="ui-track-mark">
              <Mark state={stage.state} />
              <span className="sr-only">{STATE_WORD[stage.state]}: </span>
            </span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="ui-track-row"
                onClick={() => expandable && setOpen(isOpen ? null : stage.id)}
                aria-expanded={expandable ? isOpen : undefined}
                disabled={!expandable}
              >
                <span className="ui-track-label">{stage.label}</span>
                <span className="ui-track-time">
                  {timing.soFar !== null ? (
                    <span className="ui-track-clock">{formatStageSeconds(timing.soFar)}</span>
                  ) : timing.took !== null && timing.took > 0 ? (
                    <>took {formatStageSeconds(timing.took)}</>
                  ) : (
                    when
                  )}
                </span>
                {expandable && (
                  <ChevronDown
                    className={cn("ui-track-chevron", isOpen && "rotate-180")}
                    aria-hidden="true"
                  />
                )}
              </button>
              {stage.note && <p className="ui-track-note">{stage.note}</p>}
              {isOpen && (
                <StageDetail
                  stage={stage}
                  screen={stage.id === "working" ? screen : null}
                  terminalHref={stage.id === "working" ? terminalHref : null}
                />
              )}
              {!isOpen && stage.href && stage.linkLabel && (
                <a
                  href={stage.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-track-link"
                >
                  {stage.linkLabel}
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageDetail({
  stage,
  screen,
  terminalHref,
}: {
  stage: TrackStage;
  screen: string[] | null | undefined;
  terminalHref: string | null | undefined;
}) {
  const when = clock(stage.at);
  return (
    <div className="ui-track-detail">
      {/* The stage's own time, only when no fact below carries one — under
          "You asked", "11:36 Done." above "11:36 Sent to Grok" said nothing. */}
      {when && stage.state !== "next" && !stage.facts.some((f) => f.at) && (
        <p className="ui-track-fact">
          <span className="ui-track-fact-at">{when}</span>
          {stage.state === "done" ? "Done." : "Began."}
        </p>
      )}
      {stage.facts.map((fact, i) => (
        <p key={`${fact.text}-${i}`} className="ui-track-fact">
          {clock(fact.at) && <span className="ui-track-fact-at">{clock(fact.at)}</span>}
          {fact.href ? (
            <a href={fact.href} target="_blank" rel="noopener noreferrer" className="underline">
              {fact.text}
            </a>
          ) : (
            fact.text
          )}
        </p>
      ))}
      {screen && screen.length > 0 && (
        <div className="ui-track-screen" aria-label="The agent's screen">
          <p className="ui-track-fact-at">Its screen, just now</p>
          <pre className="ui-track-screen-text">{screen.slice(-8).join("\n")}</pre>
        </div>
      )}
      {terminalHref && (
        <a href={terminalHref} className="ui-track-link">
          Open the full screen
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      {stage.href && stage.linkLabel && (
        <a href={stage.href} target="_blank" rel="noopener noreferrer" className="ui-track-link">
          {stage.linkLabel}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
