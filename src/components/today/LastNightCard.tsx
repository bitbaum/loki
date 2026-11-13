import Link from "next/link";
import { ChevronRight, Moon } from "lucide-react";
import { NAV } from "@/config/navigation";

/**
 * What the autopilot night did, on the morning it did it. The same sentence
 * /feedback shows in its header (lib/autopilot-night-note), so the brief and
 * the inbox cannot disagree about last night. The page decides freshness
 * (config/autopilot-night isFreshNight) and passes null otherwise, which
 * renders nothing.
 */
export function LastNightCard({
  note,
  notApproved = false,
}: {
  note: string | null;
  /** The plan was never approved: the card leads where nights are allowed
   *  (Autopilot settings), not to the feedback inbox (2026-11-12). */
  notApproved?: boolean;
}) {
  if (!note) return null;
  return (
    <Link
      href={notApproved ? `${NAV.settings.href}#autopilot` : NAV.feedback.href}
      className="ui-today-night"
    >
      <Moon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {note}
        {notApproved && (
          <span className="mt-1 flex items-center gap-1 font-medium text-text-primary">
            Autopilot settings
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </span>
    </Link>
  );
}
