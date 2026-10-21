"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { FlaskConical } from "lucide-react";
import { ROUTES } from "@/config/auth";

/**
 * Persistent "you are in the demo" strip.
 *
 * Deliberately NOT dismissible, unlike the email reminder next to it. Two
 * reasons, and the second is the real one:
 *
 *   • The demo resets nightly. A visitor who forgets they are in a demo and
 *     starts organising real work loses it, which is a worse experience than a
 *     strip they cannot close.
 *   • Some controls are inert here — dispatch, terminals, outbound. Without a
 *     standing explanation, a disabled button reads as a broken product rather
 *     than a boundary, and the demo would argue AGAINST the thing it exists to
 *     sell.
 */
export function DemoBanner() {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.isDemo) return null;

  return (
    <div className="ui-callout-accent mx-3 mb-2 mt-2 flex items-center gap-2 py-1.5 text-xs text-text-secondary sm:mx-4">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      {/* One line on a phone: the strip sits above every page and cannot be
          closed, and the long sentence was four lines — a sixth of the screen
          on every page (design reset, 2026-10-21). */}
      <span className="min-w-0 flex-1 sm:hidden">
        Demo — agents and messages are off, resets nightly.
      </span>
      <span className="hidden min-w-0 flex-1 sm:inline">
        You&rsquo;re in the demo — explore freely. Dispatching agents, terminals and outbound
        messages are off, and everything here resets nightly.
      </span>
      <Link href={ROUTES.SIGN_UP} className="ui-btn-secondary ui-btn-xs shrink-0">
        Get your own →
      </Link>
    </div>
  );
}
