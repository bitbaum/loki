import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";

/**
 * Surfaces the locked state of the private zone on /today.
 *
 * Without this, a locked Today is a quiet collection of empty cards and
 * hidden chips — the user has no inviting prompt to unlock. The banner
 * names what's behind the gate and gives one clear action.
 */
export async function LockedZoneBanner() {
  const userId = await requirePageUserId();
  if (!(await isPrivateZoneLocked(userId))) return null;

  // One calm line, not a card: it names what's gated and gives the one action,
  // without out-reading the actual Today content (minimize-friction: fewer words,
  // reclaim the prime slot below the greeting).
  return (
    <Link href="/unlock" className="ui-locked-banner group gap-2 py-2.5">
      <Lock className="h-4 w-4 shrink-0 text-text-tertiary" />
      {/* Short enough to read whole, and allowed to wrap: truncated, it read
          "Private zone locked — goals, pe…" and never said what was hidden
          (2026-11-12). */}
      <span className="min-w-0 flex-1 text-sm text-text-secondary">
        Goals, people, money, habits and memory are locked.
      </span>
      <span className="ui-locked-banner-cta">
        Unlock
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
