import type { ReactNode } from "react";
import { todayBriefFacts, todaySentence } from "@/lib/today-brief";
import { DayPhaseDispatch } from "@/components/today/DayPhaseDispatch";
import { getTodaySummary, getFleetSummary } from "@/db/queries/today";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";

/** Placeholder shown while SummaryBar's DB queries run: one line's height. */
export function SummaryBarSkeleton() {
  return <div className="ui-today-summary-skeleton" aria-hidden />;
}

/**
 * Today's counts and the page's ONE Loki action. `children` are the other
 * actions of the row (Log a conversation), so the counts and the actions read
 * as one line instead of a chip row, a lone "Brief Loki" and a second row.
 */
export async function SummaryBar({ children }: { children?: ReactNode }) {
  const userId = await requirePageUserId();
  const [rawSummary, fleet] = await Promise.all([getTodaySummary(userId), getFleetSummary(userId)]);

  // Private-zone gating — when the PIN is configured but not unlocked, zero
  // out the fields that read goals/habits/contacts/events data so even the
  // summary counts stay behind the gate.
  const locked = await isPrivateZoneLocked(userId);
  const s = locked
    ? {
        ...rawSummary,
        // Goals / habits / events / contacts — direct private-zone counts.
        activeGoals: 0,
        avgGoalProgress: 0,
        habitsDone: 0,
        habitsTotal: 0,
        goalsDueSoon: 0,
        stuckGoals: 0,
        eventsDueSoon: 0,
        staleContacts: 0,
        // Commitments + alerts + drafts also leak names / amounts that
        // reference the private zone.
        overdueCommitments: 0,
        urgentAlerts: 0,
        pendingDrafts: 0,
      }
    : rawSummary;

  // The facts live in lib/today-brief.ts so they can be tested; "Plan my day"
  // carries them, so Loki plans from what this bar shows.
  const facts = todayBriefFacts(s, fleet);

  // The counts as ONE sentence (design reset rule 7: "stats are a sentence,
  // not a scrolling row of pills"). It was up to ten coloured chips in a row
  // that scrolled off the phone's edge, each a link to a section below that
  // now says the same thing in its own heading.
  const sentence = todaySentence(s, fleet);

  return (
    <div className="ui-today-summary">
      {sentence && <p className="ui-today-sentence">{sentence}</p>}
      <div className="ui-today-actions">
        <DayPhaseDispatch facts={facts} />
        {children}
      </div>
    </div>
  );
}
