import { getTodayHabits } from "@/db/queries/habits";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { Section } from "@/components/ui/section-heading";
import { HabitsList } from "./HabitsList";
import { NAV } from "@/config/navigation";

/**
 * Today's habits, as a section of rows you tick off — no card around them
 * (design reset, 2026-10). Behind the PIN it says nothing: Today's one locked
 * line (LockedZoneBanner) already says what is hidden and how to open it.
 */
export async function HabitsCard() {
  const userId = await requirePageUserId();
  if (await isPrivateZoneLocked(userId)) return null;
  const habits = await getTodayHabits(userId);
  const done = habits.filter((h) => h.doneToday).length;

  return (
    <div id="habits" className="scroll-mt-24">
      <Section
        title={habits.length > 0 ? `Habits · ${done} of ${habits.length} done` : "Habits"}
        link={habits.length > 0 ? { href: NAV.habits.href, label: "See all" } : undefined}
      >
        <HabitsList initialHabits={habits} />
      </Section>
    </div>
  );
}
