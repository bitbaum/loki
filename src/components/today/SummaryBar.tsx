import {
  Target,
  Bell,
  Inbox,
  AlertCircle,
  Clock,
  Calendar,
  Users,
  Repeat2,
  Bot,
  Activity,
  CirclePause,
} from "lucide-react";
import { ScrollAffordance } from "@/components/ui/scroll-affordance";
import { buildTodayBriefPrompt } from "@/lib/today-brief";
import Link from "next/link";
import { LokiDispatchButton } from "@/components/shared/LokiDispatchButton";
import { getTodaySummary, getFleetSummary } from "@/db/queries/today";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { APP_LOCALE } from "@/lib/constants";
import { NAV } from "@/config/navigation";

/** Placeholder shown while SummaryBar's DB queries run. */
export function SummaryBarSkeleton() {
  const widths = ["5rem", "7rem", "6rem", "5rem", "5rem"];
  return (
    <ScrollAffordance childCount={0}>
      <div className="flex gap-3 overflow-x-auto ui-scroll-fade-right [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible">
        {widths.map((w, i) => (
          <div
            key={i}
            style={{ width: w }}
            className="h-8 animate-pulse rounded-full border border-border-default bg-surface-raised"
          />
        ))}
      </div>
    </ScrollAffordance>
  );
}

export async function SummaryBar() {
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

  // The prompt lives in lib/today-brief.ts so it can be tested. Inline here it
  // carried two silent bugs — see that file.
  const todayBriefPrompt = buildTodayBriefPrompt(
    `Daily brief — ${new Date().toLocaleDateString(APP_LOCALE, { weekday: "long", month: "long", day: "numeric" })}`,
    s,
    fleet,
  );

  // Group chips by semantic so the row reads as: "what I have" → "what wants me"
  // → "what my fleet is doing" → "ask Loki." Previously 10+ mixed chips with
  // unit confusion ("0/2 habits" next to "1 urgent") and the action button
  // styled identically to a status chip. Three counts arrays + thin dividers
  // give scannable hierarchy while still wrapping cleanly on mobile.
  const counters = [
    s.activeGoals > 0 && (
      <Pill
        key="g"
        icon={Target}
        value={`${s.activeGoals} goals · ${s.avgGoalProgress}%`}
        href={NAV.goals.href}
      />
    ),
    s.habitsTotal > 0 && (
      <Pill
        key="h"
        icon={Repeat2}
        value={`${s.habitsDone}/${s.habitsTotal} habits`}
        variant={s.habitsDone === s.habitsTotal ? "green" : undefined}
        href="#habits"
      />
    ),
    s.staleContacts > 0 && (
      <Pill
        key="c"
        icon={Users}
        value={`${s.staleContacts} contacts`}
        variant="amber"
        href="/people?health=stale"
      />
    ),
  ].filter(Boolean);

  const alerts = [
    s.overdueCommitments > 0 && (
      <Pill
        key="o"
        icon={AlertCircle}
        value={`${s.overdueCommitments} overdue`}
        variant="red"
        href="#commitments"
      />
    ),
    s.urgentAlerts > 0 && (
      <Pill key="u" icon={Bell} value={`${s.urgentAlerts} urgent`} variant="red" href="#alerts" />
    ),
    s.goalsDueSoon > 0 && (
      <Pill
        key="gd"
        icon={Clock}
        value={`${s.goalsDueSoon} goal${s.goalsDueSoon > 1 ? "s" : ""} due soon`}
        variant="amber"
        href={NAV.goals.href}
      />
    ),
    s.stuckGoals > 0 && (
      <Pill
        key="gs"
        icon={CirclePause}
        value={`${s.stuckGoals} goal${s.stuckGoals > 1 ? "s" : ""} stalled`}
        variant="amber"
        href="#stuck-goals"
      />
    ),
    s.eventsDueSoon > 0 && (
      <Pill
        key="ed"
        icon={Calendar}
        value={`${s.eventsDueSoon} deadline${s.eventsDueSoon > 1 ? "s" : ""}`}
        variant="amber"
        href={NAV.events.href}
      />
    ),
    s.pendingDrafts > 0 && (
      <Pill
        key="pd"
        icon={Inbox}
        value={`${s.pendingDrafts} drafts`}
        variant="amber"
        href="#actions"
      />
    ),
  ].filter(Boolean);

  const fleetPills = [
    fleet.running > 0 && (
      <Pill
        key="fr"
        icon={Bot}
        value={`${fleet.running} running`}
        variant="accent"
        href={NAV.control.href}
      />
    ),
    fleet.waiting > 0 && (
      <Pill
        key="fw"
        icon={Bot}
        value={`${fleet.waiting} waiting`}
        variant="green"
        href={NAV.control.href}
      />
    ),
    fleet.degraded > 0 && (
      <Pill
        key="fd"
        icon={Activity}
        value={`${fleet.degraded} degraded`}
        variant="amber"
        href={NAV.control.href}
      />
    ),
  ].filter(Boolean);

  // Hairline divider — vertical line between groups when wrapped on desktop,
  // invisible-but-spacing on horizontal-scroll mobile. Inlined (not a local
  // component) to satisfy react-hooks/static-components.
  const divider = (
    <span
      aria-hidden
      className="hidden sm:inline-block h-6 w-px bg-border-subtle self-center mx-1"
    />
  );

  const totalChipCount = counters.length + alerts.length + fleetPills.length;

  return (
    <ScrollAffordance childCount={totalChipCount} threshold={3}>
      <div className="flex gap-3 overflow-x-auto ui-scroll-fade-right [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible">
        {counters}
        {counters.length > 0 && (alerts.length > 0 || fleetPills.length > 0) && divider}
        {alerts}
        {alerts.length > 0 && fleetPills.length > 0 && divider}
        {fleetPills}
        {(counters.length > 0 || alerts.length > 0 || fleetPills.length > 0) && divider}
        <LokiDispatchButton
          prompt={todayBriefPrompt}
          title="Brief Loki on today"
          label="Brief Loki"
          className="inline-flex items-center gap-1.5 rounded-full border border-status-positive/30 bg-status-positive-subtle/40 px-3 py-2 text-xs font-semibold text-status-positive hover:bg-status-positive-subtle transition-colors ui-tap shrink-0"
        />
      </div>
    </ScrollAffordance>
  );
}

function Pill({
  icon: Icon,
  value,
  variant,
  href,
}: {
  icon: typeof Target;
  value: string;
  variant?: "amber" | "red" | "green" | "accent";
  href?: string;
}) {
  const colors =
    variant === "red"
      ? "border-status-negative/20 bg-status-negative-subtle text-status-negative"
      : variant === "amber"
        ? "border-status-warning/20 bg-status-warning-subtle text-status-warning"
        : variant === "green"
          ? "border-status-positive/20 bg-status-positive-subtle text-status-positive"
          : variant === "accent"
            ? "border-accent-primary/20 bg-accent-muted text-accent-text"
            : "border-border-default bg-surface-base text-text-secondary";

  const inner = (
    <>
      <Icon className="h-3 w-3" />
      <span>{value}</span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-opacity hover:opacity-80 ui-tap shrink-0 ${colors}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium shrink-0 ${colors}`}
    >
      {inner}
    </div>
  );
}
