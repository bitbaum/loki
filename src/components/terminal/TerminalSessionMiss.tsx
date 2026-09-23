"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * What a ?tab= deep link that matched nothing gets instead of somebody else's
 * session.
 *
 * The old behaviour was a one-line warning above a live terminal already
 * attached to `tabs[0]`, with the mode bar underneath it still reading
 * "Keystrokes go straight to the session. Ctrl-C, arrows and paste all work."
 * Observed on a phone 2026-08-18: a Loki dispatch link for `orangecat` landed
 * on `sbb-lost-found` and said so in small orange text three rows above the
 * cursor. Everything the operator typed — including Ctrl-C — would have gone
 * into an unrelated agent's session.
 *
 * A miss is a decision point, not a notice. Nothing is attached until the
 * operator picks, and the alternatives are named rather than assumed.
 */
export function TerminalSessionMiss({
  requestedTab,
  sourceLabel,
  otherSourceLabel,
  available,
  onAttach,
  onSwitchSource,
}: {
  requestedTab: string;
  /** Where we looked — "Cloud" / "This computer". */
  sourceLabel: string;
  /** The one place we haven't looked, offered as the next thing to try. */
  otherSourceLabel: string | null;
  available: string[];
  onAttach: (tab: string) => void;
  onSwitchSource: () => void;
}) {
  return (
    <div className="ui-term-miss">
      <SearchX className="h-6 w-6 text-status-warning" aria-hidden="true" />
      <p className="ui-term-miss-title">
        No session named “{requestedTab}” on {sourceLabel}
      </p>
      <p className="ui-term-miss-body">
        Nothing is attached yet. This page shows agent sessions started by Loki builders. If you
        just dispatched work, check its status in Control; a session appears here when the selected
        builder starts it. Choose another running session only if you mean to type there.
      </p>

      {available.length > 0 && (
        <div className="ui-term-miss-options">
          <span className="ui-micro-label">Running on {sourceLabel}</span>
          <div className="ui-term-miss-grid">
            {available.map((tab) => (
              <button
                key={tab}
                type="button"
                className="ui-term-miss-chip"
                onClick={() => onAttach(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ui-term-miss-actions">
        {otherSourceLabel && (
          <button type="button" className="ui-btn-secondary" onClick={onSwitchSource}>
            Look on {otherSourceLabel}
          </button>
        )}
        <Link
          href={`/loki?project=${encodeURIComponent(requestedTab)}`}
          className="ui-btn-secondary"
        >
          Start “{requestedTab}” from Loki
        </Link>
      </div>
    </div>
  );
}
