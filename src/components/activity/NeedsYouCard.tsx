import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { ActivityEvent } from "@/lib/activity-events";
import type { DigestWindow } from "@/db/queries/digests";
import { ActivityRetryButton } from "./ActivityRetryButton";
import { activityHref, formatClockTime } from "./activity-shared";

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
  const shown = events.slice(0, MAX_SHOWN);

  return (
    <section className="ui-needs-you">
      <h2 className="ui-needs-you-title">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Needs you
      </h2>

      <ul className="ui-needs-you-list">
        {shown.map((event) => (
          <li key={event.id} className="ui-needs-you-item">
            <div className="ui-needs-you-head">
              <span className="ui-needs-you-project">{event.projectKey}</span>
              <span className="ui-needs-you-outcome">{event.outcomeLabel}</span>
              <span className="ui-needs-you-meta">
                {formatClockTime(event.occurredAt)}
                {event.durationLabel && <> · {event.durationLabel}</>}
              </span>
            </div>

            {/* The cause, in the agent's own words. This is the line that tells
                you whether it is a five-second fix or a real problem. */}
            {event.error ? (
              <p className="ui-needs-you-why line-clamp-2">{event.error}</p>
            ) : (
              <p className="ui-needs-you-why line-clamp-2">
                {event.outcomeLabel} with no recorded reason
                {/* "asked" is a claim about WHO asked, and for an autopilot row
                    nobody did — the prompt's own first sentence says it was not
                    typed by a human. Name the loop instead of implying the
                    operator wrote it. */}
                {event.ask?.preview
                  ? `${
                      event.ask.autopilotLoop
                        ? ` — autopilot (${event.ask.autopilotLoop}) ran: `
                        : " — asked: "
                    }${event.ask.preview}`
                  : "."}
              </p>
            )}

            {/* The primary action RUNS the work again from here. It used to be
                a link labelled "Retry from Control", which navigated to a page
                whose retry acts on a different table and therefore usually did
                not list this failure at all. Watching stays secondary: reading
                the session is what you do when re-running did not help. */}
            <div className="ui-needs-you-actions">
              <ActivityRetryButton event={event} />
              <Link
                href={`/terminal?project=${encodeURIComponent(event.projectKey)}`}
                className="ui-needs-you-action-quiet"
              >
                Open session <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {events.length > MAX_SHOWN && (
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
