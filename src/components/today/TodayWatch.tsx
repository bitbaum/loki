import { Eye } from "lucide-react";
import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { getTodayWatch, type WatchFocus } from "@/db/queries/today-watch";
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
 * concrete focus item. Sits on /today when the private zone is unlocked.
 *
 * The point: prove the AI is paying attention to the user's life, not just
 * showing them dashboards. One specific thing to look at right now, with
 * context and a one-click handoff to Loki for a longer conversation.
 */
export async function TodayWatch() {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) return null;

  const { focus } = await getTodayWatch(userId);
  // Nothing stands out: say nothing. The day's counts are the sentence under
  // the greeting (SummaryBar), so the "Also: 2 more overdue · 9 relationships
  // going stale" strip that used to sit here said them a second time.
  if (!focus) return null;

  // One section, one row, one way to hand it to Loki (design reset,
  // 2026-10). It was a bordered card with an orange "OVERDUE COMMITMENT"
  // eyebrow in capitals, a large title, the counts again, and two Loki
  // buttons ("Ask Loki for a next step" and "Brief Loki on this").
  return (
    <Section title="In focus">
      <List aria-label="In focus">
        <ListRow
          href={focus.href}
          icon={Eye}
          title={focus.title}
          secondary={`${KIND_LABEL[focus.kind]} · ${focus.context}`}
          chevron
        />
      </List>
      <LokiNudge kind={focus.kind} title={focus.title} context={focus.context} />
    </Section>
  );
}
