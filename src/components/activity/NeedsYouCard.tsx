import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { ActivityEvent } from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { ActivityRetryButton } from "./ActivityRetryButton";
import { activityHref, formatClockTime } from "./activity-shared";
import { NEEDS_YOU_LABELS } from "@/lib/needs-you";
import { groupFailuresByCause } from "@/lib/activity-grouping";

/** Past this, the card stops being a triage list and becomes another feed. */
const MAX_SHOWN = 3;

/**
 * The failures, hoisted above everything else, each with a door out.
 *
 * On the old page a failed run was one red line among nineteen grey ones,
 * roughly a screen and a half down on a phone, and its only affordance was
 * reading it. The single most common reason to open this page had the worst
 * path through it.
 *
 * Renders nothing when nothing is wrong — an "All clear!" panel occupying the
 * top of a healthy page is noise that trains people to scroll past the spot
 * where real alarms appear.
 */
export function NeedsYouCard({
  events,
  digestWindow,
  projectKey,
}: {
  events: ActivityEvent[];
  digestWindow: DigestWindow;
  projectKey: string | null;
}) {
  if (events.length === 0) return null;
  // One entry per CAUSE. Live 2026-10-01 four projects failed with the same
  // sentence ("usage limit is exhausted") and the card listed it four times,
  // one under another — which hid the row that said something different.
  const groups = groupFailuresByCause(events);
  const shown = groups.slice(0, MAX_SHOWN);

  return (
    <section className="ui-needs-you">
      <h2 className="ui-needs-you-title">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {NEEDS_YOU_LABELS.runs}
      </h2>

      <ul className="ui-needs-you-list">
        {shown.map((group) => {
          const first = group.events[0];
          const many = group.events.length > 1;
          return (
            <li key={first.id} className="ui-needs-you-item">
              <div className="ui-needs-you-head">
                {many ? (
                  <span className="ui-needs-you-project">
                    {group.events.length} runs, one cause
                  </span>
                ) : (
                  <>
                    <span className="ui-needs-you-project">{first.projectKey}</span>
                    <span className="ui-needs-you-outcome">{first.outcomeLabel}</span>
                    <span className="ui-needs-you-meta">
                      {formatClockTime(first.occurredAt)}
                      {first.durationLabel && <> · {first.durationLabel}</>}
                    </span>
                  </>
                )}
              </div>

              {/* The cause, in the agent's own words, said once per group. This
                  is the line that tells you whether it is a five-second fix or
                  a real problem. */}
              {first.error ? (
                <p className="ui-needs-you-why line-clamp-2">{group.cause}</p>
              ) : (
                <p className="ui-needs-you-why line-clamp-2">
                  {first.outcomeLabel} with no recorded reason
                  {/* "asked" is a claim about WHO asked, and for an autopilot row
                      nobody did — name the loop instead of implying the operator
                      wrote it. */}
                  {!many && first.ask?.preview
                    ? `${
                        first.ask.autopilotLoop
                          ? ` — autopilot (${first.ask.autopilotLoop}) ran: `
                          : " — asked: "
                      }${first.ask.preview}`
                    : "."}
                </p>
              )}

              {/* The primary action RUNS the work again from here (it used to be
                  a link to a page whose retry acted on a different table).
                  Watching stays secondary. A group keeps one line per project
                  so each can still be re-run on its own. */}
              {many ? (
                <ul className="ui-needs-you-runs">
                  {group.events.map((event) => (
                    <li key={event.id} className="ui-needs-you-run">
                      <span className="ui-needs-you-run-project">{event.projectKey}</span>
                      <span className="ui-needs-you-meta">{formatClockTime(event.occurredAt)}</span>
                      <span className="ui-needs-you-run-actions">
                        <ActivityRetryButton event={event} />
                        <Link
                          href={`/terminal?project=${encodeURIComponent(event.projectKey)}`}
                          className="ui-needs-you-action-quiet"
                          aria-label={`Open the ${event.projectKey} session`}
                        >
                          Session <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ui-needs-you-actions">
                  <ActivityRetryButton event={first} />
                  <Link
                    href={`/terminal?project=${encodeURIComponent(first.projectKey)}`}
                    className="ui-needs-you-action-quiet"
                  >
                    Open session <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {groups.length > MAX_SHOWN && (
        <Link
          href={activityHref({ window: digestWindow, project: projectKey, filter: "attention" })}
          className="ui-needs-you-more"
        >
          See all {events.length} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </section>
  );
}
