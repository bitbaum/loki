"use client";

/**
 * The delivery track, drawn: asked → a builder has it → the agent works →
 * pull request → merged → live. One vertical list with a rail, because on a
 * phone a row of six steps cannot be read; each mark says done / now / next /
 * needs you / failed in shape as well as colour. Facts only — the words and
 * states come from lib/run-track on the server; nothing here decides.
 */
import { AlertCircle, ArrowUpRight, Check, X } from "lucide-react";
import type { RunTrack as RunTrackData, TrackStageState } from "@/lib/run-track";

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

export function RunTrack({ track }: { track: RunTrackData }) {
  return (
    <ol className="ui-track" aria-label="Where the change is">
      {track.stages.map((stage) => (
        <li key={stage.id} className={`ui-track-item ui-track-${stage.state}`}>
          <span className="ui-track-mark">
            <Mark state={stage.state} />
            <span className="sr-only">{STATE_WORD[stage.state]}: </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="ui-track-label">{stage.label}</p>
            {stage.note && <p className="ui-track-note">{stage.note}</p>}
            {stage.href && stage.linkLabel && (
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
      ))}
    </ol>
  );
}
