"use client";

import Link from "next/link";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useControlInbox } from "@/hooks/use-control-inbox";

export type FlaggedProject = {
  /** React key only. NOT assumed to be linkable — see `href`. */
  id: string;
  name: string;
  /** What the flag says, already truncated by the server. */
  reason: string;
  /**
   * Where to send the reader, or null when there is nowhere to send them.
   *
   * /projects/[id] resolves by ENTITY id, and a catalog project need not have
   * an entity row yet. Guessing a URL for those would put a 404 behind a row
   * that says something needs you — so a project with no destination is still
   * NAMED (it genuinely needs you) and simply is not a link. Dropping it
   * instead would make the front door quietly incomplete, which is the bug
   * this component exists to end.
   */
  href: string | null;
};

/**
 * The answer, at the front door.
 *
 * /today opened with a greeting, the weather, an empty sticky note, and "92
 * runs this week". Measured 2026-09-22: the page mentioned feedback zero
 * times, failures zero times, flagged projects zero times — while its own
 * sidebar badged "Feedback 4". The front door reported VOLUME, and the one
 * question it exists to answer ("what needs me?") was answered three clicks
 * away on Control, and differently again on Activity.
 *
 * ONE OWNER, NOT A THIRD COUNT. This reads `useControlInbox`, the same hook
 * Control's inbox uses, so the two surfaces cannot disagree about the number —
 * two pages showing a different "7" was the original defect. Flagged projects
 * come from the server through the same `hasProjectAttention` the list sorts
 * by.
 *
 * A FAILED FETCH IS NOT "NOTHING". `loadFailed` renders as "couldn't check",
 * never as a calm all-clear: on a page whose whole job is to be trusted when
 * it says you are free, a request that errored must never render as the
 * confident answer "no".
 */
export function NeedsYouVerdict({ flagged }: { flagged: FlaggedProject[] }) {
  const inbox = useControlInbox();
  const total = inbox.total + flagged.length;

  if (inbox.settling) {
    return (
      <section className="ui-verdict" aria-label="What needs you">
        <p className="ui-verdict-line text-text-muted">
          <Loader2 className="ui-spinner-xs" aria-hidden /> Checking what needs you…
        </p>
      </section>
    );
  }

  if (inbox.loadFailed) {
    return (
      <section className="ui-verdict ui-verdict-unknown" aria-label="What needs you">
        <p className="ui-verdict-line">Could not check what needs you.</p>
        <p className="ui-verdict-sub">
          A request failed, so this is not an all-clear.{" "}
          <button type="button" onClick={inbox.refetch} className="underline underline-offset-2">
            Try again
          </button>
        </p>
      </section>
    );
  }

  if (total === 0) {
    /* An empty queue is the best possible state, so it gets said plainly
       rather than rendered as an absence. A page that shows nothing when
       nothing is wrong teaches you to distrust its silence. */
    return (
      <section className="ui-verdict" aria-label="What needs you">
        <p className="ui-verdict-line">
          <Check className="h-4 w-4 shrink-0 text-status-positive" aria-hidden /> Nothing needs you.
        </p>
      </section>
    );
  }

  return (
    <section className="ui-verdict ui-verdict-alert" aria-label="What needs you">
      <p className="ui-verdict-line">
        <AlertTriangle className="h-4 w-4 shrink-0 text-status-warning" aria-hidden />
        {total} {total === 1 ? "thing needs" : "things need"} you
      </p>

      <ul className="ui-verdict-list">
        {inbox.feedbackCount > 0 && (
          <li>
            <Link href="/feedback" className="ui-verdict-item">
              <span>
                {inbox.feedbackCount} feedback {inbox.feedbackCount === 1 ? "report" : "reports"} to
                triage
              </span>
            </Link>
          </li>
        )}
        {inbox.needsWidget.length > 0 && (
          <li>
            <Link href="/feedback" className="ui-verdict-item">
              <span>
                {inbox.needsWidget.length}{" "}
                {inbox.needsWidget.length === 1 ? "site is" : "sites are"} missing the feedback
                widget
              </span>
            </Link>
          </li>
        )}
        {/* Named, not counted. "3 projects flagged" is a number to go and
            decode; "evig — Email verification bypass…" is the sentence you
            actually act on, and it is already in the database. */}
        {flagged.map((p) => {
          const body = (
            <>
              <span className="font-medium text-text-primary">{p.name}</span>
              <span className="ui-verdict-reason">{p.reason}</span>
            </>
          );
          return (
            <li key={p.id}>
              {p.href ? (
                <Link href={p.href} className="ui-verdict-item">
                  {body}
                </Link>
              ) : (
                <span className="ui-verdict-item">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
