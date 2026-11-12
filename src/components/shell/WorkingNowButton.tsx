"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MonitorPlay } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { NAV } from "@/config/navigation";
import { workingNow } from "@/lib/session-list";
import type { SessionSnapshot } from "@/app/api/sessions/snapshot/route";

/**
 * The top bar's answer to "is anything running?": on every page, only while
 * an agent is working — a count on a screen icon that opens the session to
 * watch (lib/session-list `workingNow`). Nothing working, nothing drawn: an
 * empty icon would be one more thing to learn.
 *
 * Reads /api/sessions/snapshot, the Sessions drawer's DB-only list (no runner,
 * no git), once a minute.
 */
export function WorkingNowButton() {
  const { data } = useFetch<SessionSnapshot>("/api/sessions/snapshot", { intervalMs: 60_000 });
  const pathname = usePathname() ?? "";
  const now = workingNow(data?.projects ?? [], NAV.terminal.href);
  // On the terminal the sessions are the page: the icon would point at itself.
  if (!now || pathname.startsWith(NAV.terminal.href)) return null;
  return (
    <Link href={now.href} className="ui-topbar-btn" aria-label={now.label} title={now.label}>
      <MonitorPlay className="h-5 w-5" aria-hidden="true" />
      {/* One working: a green dot. More: the count, in the same corner. */}
      {now.count === 1 ? (
        <span className="ui-topbar-btn-dot ui-dot-positive" aria-hidden="true" />
      ) : (
        <span className="ui-topbar-btn-count" aria-hidden="true">
          {now.count > 9 ? "9+" : now.count}
        </span>
      )}
    </Link>
  );
}
