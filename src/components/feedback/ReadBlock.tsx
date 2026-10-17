"use client";

/**
 * Loki's read of a report, on the decision card, before the one tap: what the
 * person means, what it would change, how big it is, what could go wrong —
 * and the ask Loki would give the agent, which the owner can edit in place.
 * The tap then sends the edited ask, so a collaborator's feedback is built as
 * the owner understood it, never verbatim (lib/feedback/read-report).
 */
import { useState } from "react";
import { AlertCircle, Loader2, Pencil } from "lucide-react";
import { READ_SIZE_WORD, READ_ASK_MAX, type FeedbackRead } from "@/lib/feedback/read-report";

export function ReadBlock({
  read,
  reading,
  ask,
  onAsk,
}: {
  read: FeedbackRead | null;
  reading: boolean;
  /** The owner's edit of the ask, or null to use Loki's. */
  ask: string | null;
  onAsk: (ask: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!read) {
    return (
      <p className="ui-fb-read-waiting">
        {reading ? (
          <>
            <Loader2 className="ui-spinner-xs" /> Loki is reading it…
          </>
        ) : (
          "Loki could not read this one — the report is below."
        )}
      </p>
    );
  }
  const current = ask ?? read.ask;
  return (
    <div className="ui-fb-read">
      <dl className="ui-fb-decision-facts">
        <dt className="ui-fb-decision-fact-label">Means</dt>
        <dd className="ui-fb-decision-fact">{read.meaning}</dd>
        {read.impact && (
          <>
            <dt className="ui-fb-decision-fact-label">Impact</dt>
            <dd className="ui-fb-decision-fact">{read.impact}</dd>
          </>
        )}
        <dt className="ui-fb-decision-fact-label">Size</dt>
        <dd className="ui-fb-decision-fact">{READ_SIZE_WORD[read.size]}</dd>
        {read.risk && (
          <>
            <dt className="ui-fb-decision-fact-label">Careful</dt>
            <dd className="ui-fb-decision-fact ui-fb-read-risk">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{read.risk}</span>
            </dd>
          </>
        )}
        <dt className="ui-fb-decision-fact-label">The ask</dt>
        <dd className="ui-fb-decision-fact">
          {editing ? (
            <textarea
              value={current}
              onChange={(e) => onAsk(e.target.value)}
              maxLength={READ_ASK_MAX}
              rows={4}
              className="ui-fb-read-ask"
              aria-label="What the agent will be asked to do"
              autoFocus
            />
          ) : (
            <span className="ui-fb-read-ask-text">{current}</span>
          )}
          <span className="ui-fb-read-ask-actions">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="ui-fb-row-quiet-btn"
            >
              {editing ? (
                "Done editing"
              ) : (
                <>
                  <Pencil className="h-3 w-3" aria-hidden /> Change the ask
                </>
              )}
            </button>
            {ask !== null && ask !== read.ask && !editing && (
              <button type="button" onClick={() => onAsk(null)} className="ui-fb-row-quiet-btn">
                Back to Loki&apos;s
              </button>
            )}
          </span>
        </dd>
      </dl>
    </div>
  );
}
