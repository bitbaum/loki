import { Calendar, Clock, ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { getEventsDueSoon } from "@/db/queries/events";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { isPast, format } from "date-fns";
import { deadlineLabel } from "@/lib/dates";
import { EVENTS_DUE_SOON_DAYS } from "@/lib/constants";
import Link from "next/link";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { NAV } from "@/config/navigation";

export async function EventsDueCard() {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) {
    return null;
  }
  const items = await getEventsDueSoon(userId);

  if (items.length === 0) return null;

  const overdueCount = items.filter((e) => e.deadline && isPast(new Date(e.deadline))).length;

  return (
    <Card>
      <CardHeader
        icon={Calendar}
        title="Upcoming Deadlines"
        right={
          overdueCount > 0 ? (
            <span className="text-xs text-status-negative font-medium">{overdueCount} overdue</span>
          ) : (
            <span className="text-xs text-status-warning font-medium">
              {items.length} within {EVENTS_DUE_SOON_DAYS} days
            </span>
          )
        }
      />
      <div className="space-y-3">
        {items.map((event) => {
          const deadline = new Date(event.deadline!);
          const { label: deadlineText, overdue } = deadlineLabel(deadline);

          return (
            <div key={event.id} className="flex items-start gap-3">
              <div className="shrink-0 flex flex-col items-center gap-1 w-14 pt-0.5">
                <span
                  className={`text-xs font-mono font-medium ${overdue ? "text-status-negative" : "text-text-tertiary"}`}
                >
                  {format(deadline, "d MMM")}
                </span>
                {event.category && (
                  <span className="text-xs text-status-positive/60 font-medium">
                    {event.category}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-1.5">
                  <span className="text-sm font-medium leading-snug">{event.name}</span>
                  {event.url && (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-text-muted hover:text-text-secondary transition-colors mt-0.5"
                      title="Open link"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div
                  className={`flex items-center gap-1 text-xs mt-0.5 ${overdue ? "text-status-negative" : "text-status-warning/70"}`}
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  {deadlineText}
                </div>
                {event.type && <span className="ui-kicker">{event.type}</span>}
              </div>
              <LokiDispatchButton
                prompt={[
                  `Event: ${event.name}`,
                  event.type && `Type: ${event.type}`,
                  event.category && `Category: ${event.category}`,
                  `Deadline: ${deadlineText}${overdue ? " (OVERDUE)" : ""}`,
                  event.description && `Description: ${event.description}`,
                  "",
                  `This deadline is ${overdue ? "overdue" : "approaching"}. What should I do about it? What are the key next steps?`,
                ]
                  .filter(Boolean)
                  .join("\n")}
                title="Ask Loki about this deadline"
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-border-subtle">
        <Link href={NAV.events.href} className="ui-link-subtle">
          Open Events →
        </Link>
      </div>
    </Card>
  );
}
