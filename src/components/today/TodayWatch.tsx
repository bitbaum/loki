import Link from "next/link";
import { Eye, ArrowRight, CheckCircle2 } from "lucide-react";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { getTodayWatch, type WatchFocus } from "@/db/queries/today-watch";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { LokiNudge } from "./LokiNudge";

const KIND_LABEL: Record<WatchFocus["kind"], string> = {
  "overdue-commitment": "Overdue commitment",
  "overdue-goal": "Overdue goal",
  "habit-at-risk": "Streak at risk",
  "imminent-bill": "Renewal coming up",
  "imminent-event": "Approaching deadline",
  "stale-contact": "Relationship going stale",
  "stalled-goal": "Stalled goal",
};

/**
 * Today's Watch — synthesizes signals across the private zone into one
 * concrete focus item plus a totals strip. Sits at the top of /today
 * when the private zone is unlocked.
 *
 * The point: prove the AI is paying attention to the user's life, not just
 * showing them dashboards. One specific thing to look at right now, with
 * context and a one-click handoff to Loki for a longer conversation.
 */
export async function TodayWatch() {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) return null;

  const { focus, totals } = await getTodayWatch(userId);

  const totalStrip = buildTotalStrip(totals);
  const allClear = !focus && !totalStrip;

  return (
    <div className="ui-today-watch">
      {/* ONE eyebrow, not two. This card stacked "LOKI IS WATCHING" above
          "OVERDUE COMMITMENT" — two rows of small caps before a single word of
          content, and the first said nothing the eye icon doesn't. When there
          is a focus, its kind is the label; "Loki is watching" is kept only for
          the states where there is no kind to name. */}
      <div className="ui-today-watch-head">
        <Eye className="h-4 w-4 shrink-0 text-accent-text" />
        <span
          className={focus ? "ui-today-watch-focus-kind" : "ui-today-watch-eyebrow"}
          title={focus ? "Loki is watching" : undefined}
        >
          {focus ? KIND_LABEL[focus.kind] : "Loki is watching"}
        </span>
      </div>

      {focus ? (
        <>
          {/* The title is a heading, not a paragraph: this one ran to four
              lines on a 390px phone. Clamped on the inner span because the
              link itself is the flex row holding the arrow. */}
          <Link href={focus.href} className="ui-today-watch-focus-title group">
            <span className="line-clamp-2" title={focus.title}>
              {focus.title}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="ui-today-watch-focus-context">{focus.context}</p>
          <LokiNudge kind={focus.kind} title={focus.title} context={focus.context} />
        </>
      ) : allClear ? (
        <div className="ui-today-watch-clear">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-positive" />
          <span>Nothing pressing in your goals, people or money right now.</span>
        </div>
      ) : (
        <div className="ui-today-watch-clear">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-positive" />
          <span>No single focus stands out — see the totals below.</span>
        </div>
      )}

      {/* "Also: 1 more overdue · 3 overdue goals · 6 more imminent bills · 25
          relationships going stale · 19 stalled goals." ran to three lines of
          things you are behind on, under the one thing this card picked for
          you. Two lines; the rest is on hover and on the pages that own it. */}
      {totalStrip && (
        <p className="ui-today-watch-totals line-clamp-2" title={totalStrip}>
          {totalStrip}
        </p>
      )}

      {focus && (
        <div className="ui-today-watch-action">
          <LokiDispatchButton
            prompt={focus.lokiPrompt}
            label="Brief Loki on this"
            title="Hand this focus to Loki"
            className="ui-btn-secondary"
          />
        </div>
      )}
    </div>
  );
}

function buildTotalStrip(totals: {
  overdueCommitments: number;
  overdueGoals: number;
  imminentBills: number;
  imminentEvents: number;
  staleContacts: number;
  habitsAtRisk: number;
  stalledGoals: number;
}): string | null {
  const parts: string[] = [];
  if (totals.overdueCommitments > 1) parts.push(`${totals.overdueCommitments - 1} more overdue`);
  if (totals.overdueGoals > 0)
    parts.push(`${totals.overdueGoals} overdue goal${totals.overdueGoals === 1 ? "" : "s"}`);
  if (totals.habitsAtRisk > 1)
    parts.push(
      `${totals.habitsAtRisk - 1} more streak${totals.habitsAtRisk - 1 === 1 ? "" : "s"} at risk`,
    );
  if (totals.imminentBills > 1)
    parts.push(
      `${totals.imminentBills - 1} more imminent bill${totals.imminentBills - 1 === 1 ? "" : "s"}`,
    );
  if (totals.imminentEvents > 0)
    parts.push(
      `${totals.imminentEvents} imminent deadline${totals.imminentEvents === 1 ? "" : "s"}`,
    );
  if (totals.staleContacts > 0)
    parts.push(
      `${totals.staleContacts} relationship${totals.staleContacts === 1 ? "" : "s"} going stale`,
    );
  if (totals.stalledGoals > 0)
    parts.push(`${totals.stalledGoals} stalled goal${totals.stalledGoals === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return `Also: ${parts.join(" · ")}.`;
}
