"use client";

import { Search, LayoutPanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { NotificationsPill } from "./NotificationsPill";
import { FleetRunnerStatusPill } from "@/components/desktop/FleetRunnerStatusPill";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { MOBILE_NAV_ITEMS, NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath } from "@/lib/navigation";

/**
 * Slim app-shell top bar. Universal across every authenticated route.
 *
 * Hosts, left to right: where you are (mobile) or where you can go (search),
 * then live state (Fleet Runner, notifications), then who you are
 * (AccountMenu). Pages still own their own page headers; this bar is
 * intentionally quiet — chrome that signals state, not content.
 *
 * Ordering rule: state before identity. Everything to the left of the avatar
 * changes on its own; the avatar never does. A control that only changes when
 * the user changes it does not belong among live indicators — which is the
 * mistake the theme toggle made here, drawn heavier than every signal beside
 * it. It now sits inside the account menu.
 *
 * Mobile shape: the full-width search button collapses to a header that
 * shows the current page name on the left and an icon-only search trigger
 * on the right. Phone users get a clear "where am I?" cue without
 * sacrificing the search affordance.
 */
export function AppTopBar({
  onOpenSessions,
}: {
  /** Toggles the cross-page Sessions drawer (project inventory + status).
   *  Optional so AppTopBar can also be rendered in isolation/storybook. */
  onOpenSessions?: () => void;
}) {
  const { setOpen } = useCommandPalette();
  const pathname = usePathname();
  const platformHint =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // Resolve the active route to the same label the sidebar/More sheet uses.
  // Falls back to empty string for pages outside the nav config (sign-in,
  // /u/<username>, etc.) so the top bar stays clean rather than guessing.
  const currentNavItem = NAV_ITEMS.find((item) => isCurrentPath(pathname, item.href));

  // Say where you are ONLY when nothing else on screen already does.
  //
  // Below md the bottom bar carries Today / Loki / Control as labelled,
  // highlighted tabs — so on those three pages the top bar's title was the
  // third simultaneous answer to "where am I?", after the bottom tab and the
  // page's own heading. It earns its place on every OTHER page, where the
  // bottom bar can only show "Menu" and genuinely cannot tell you.
  const onBottomBarTab = MOBILE_NAV_ITEMS.some((item) => isCurrentPath(pathname, item.href));
  const pageLabel = onBottomBarTab ? "" : (currentNavItem?.label ?? "");

  return (
    <header className="ui-app-topbar">
      {/* Mobile-only page title — bottom nav already tells "where", but a
          glance up should confirm it. md+ users see the full sidebar so the
          title is redundant there. */}
      {pageLabel && (
        <h1 className="truncate text-base font-semibold text-text-primary md:hidden">
          {pageLabel}
        </h1>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ui-app-topbar-search hidden md:flex"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span className="ui-app-topbar-search-label">Search prompts, pages, dispatch…</span>
        <kbd className="ui-palette-kbd ml-auto">{platformHint}</kbd>
      </button>
      <div className="ui-app-topbar-right">
        {/* Mobile-only icon search — same palette, just less chrome. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-raised hover:text-text-secondary md:hidden"
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* Sessions drawer toggle — cross-page project inventory + status. */}
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="ui-topbar-btn"
            aria-label="Open Sessions drawer"
            title="Sessions"
          >
            <LayoutPanelLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <FleetRunnerStatusPill />
        <NotificationsPill />
        {/* Identity is the LAST thing in the bar and the only bordered one:
            it is the anchor a user looks for when they want to leave, and
            "where do I sign out?" had no answer in this bar at all. The theme
            toggle it replaced now lives inside the menu. */}
        <AccountMenu />
      </div>
    </header>
  );
}
