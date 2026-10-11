import Link from "next/link";
import { Moon } from "lucide-react";

/**
 * What the autopilot night did, on the morning it did it. The same sentence
 * /feedback shows in its header (lib/autopilot-night-note), so the brief and
 * the inbox cannot disagree about last night. The page decides freshness
 * (config/autopilot-night isFreshNight) and passes null otherwise, which
 * renders nothing.
 */
export function LastNightCard({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <Link href="/feedback" className="ui-today-night">
      <Moon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{note}</span>
    </Link>
  );
}
