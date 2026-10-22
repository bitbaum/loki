"use client";

import Link from "next/link";
import { Lock, X } from "lucide-react";
import {
  MOBILE_NAV_ITEMS,
  SIDEBAR_SECTIONS,
  type NavItem,
  type SidebarSection,
} from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { usePrivateZone } from "@/hooks/use-private-zone";
import { useEscapeToClose } from "@/hooks/use-escape-to-close";
import { useOverlayLock } from "@/hooks/use-overlay-lock";

const TAB_IDS = new Set(MOBILE_NAV_ITEMS.map((item) => item.id));

function sheetItems(section: SidebarSection): NavItem[] {
  return section.items.filter((item) => !TAB_IDS.has(item.id));
}

function MobileNavRow({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const isActive = isCurrentPath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn("ui-mobile-nav-row", isActive && "ui-mobile-nav-row-active")}
      aria-current={isActive ? "page" : undefined}
    >
      <Icon className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
      {/* The name only. Each row used to carry its one-line description,
          cut off with "…" on every phone (owner, 2026-10-21: "Talk to Loki
          with the screen off — it reads the fleet out …"). A menu of places
          is read by name; what a page is for, the page says. */}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </Link>
  );
}

export function MobileNavSheet({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const { configured, unlocked } = usePrivateZone();
  const privateLocked = configured && !unlocked;
  // This is a dialog covering the app, so it owes the same two things every
  // other overlay here provides. Verified against prod before this line existed:
  // Escape left the sheet open, and the page kept scrolling behind it.
  useEscapeToClose(onClose);
  useOverlayLock(true);

  return (
    <>
      <div
        className="fixed inset-0 z-30 ui-backdrop md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="ui-mobile-nav-sheet" role="dialog" aria-label="More">
        <div className="ui-mobile-nav-sheet-header">
          <span className="ui-mobile-nav-sheet-title">More</span>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn-icon min-h-11 min-w-11"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="ui-mobile-nav-sheet-scroll">
          {/* No "Feedback on this page" row: the feedback launcher is in the
              top bar on every page with this sheet (FeedbackLauncher), and
              the same way to the same panel, first in a menu of places, read
              as one more unexplained thing (owner, 2026-10-19). */}
          {SIDEBAR_SECTIONS.map((section) => {
            const items = sheetItems(section);
            if (items.length === 0) return null;

            if (section.private && privateLocked) {
              return (
                <div key={section.id} className="px-3 pb-2">
                  <p className="ui-mobile-nav-sheet-label">{section.label}</p>
                  <Link href="/unlock" onClick={onClose} className="ui-mobile-nav-row">
                    <Lock className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Unlock</span>
                  </Link>
                </div>
              );
            }

            return (
              <div key={section.id} className="px-3 pb-2">
                <p className="ui-mobile-nav-sheet-label">{section.label}</p>
                <div className="space-y-1">
                  {items.map((item) => (
                    <MobileNavRow
                      key={item.id}
                      item={item}
                      pathname={pathname}
                      onNavigate={onClose}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* No footer. This sheet used to end with Appearance + Settings +
            Sign out — a second account menu, duplicating the sidebar footer's,
            with neither of them called one and no account menu in the header
            at all. All three now live in AccountMenu, which is in the top bar
            on every viewport including this one. */}
      </div>
    </>
  );
}
