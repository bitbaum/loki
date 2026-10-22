"use client";

import { useSyncExternalStore } from "react";
import { TopbarActionSlot, TopbarSlot } from "./TopbarSlot";
import { Search, LayoutPanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { NotificationsPill } from "./NotificationsPill";
import { FeedbackLauncher } from "./FeedbackLauncher";
import { FleetRunnerStatusPill } from "@/components/desktop/FleetRunnerStatusPill";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { NAV_ITEMS } from "@/config/navigation";
import { isCurrentPath, isProjectWorkspacePath } from "@/lib/navigation";

/**
 * Slim app-shell top bar. Universal across every authenticated route.
 *
 * On a phone, left to right — the reference apps' shape (Claude, ChatGPT,
 * Grok; docs/development/design-reset-2026-10.md):
 *
 *   [page's own controls] Page name ·········· search · feedback · bell · [+] · avatar
 *
 * Every icon is a 40px circle with no border (ui-topbar-btn). The page's one
 * primary action, when it has one, renders into the slot before the avatar
 * (PageAction). From md up the sidebar names the page and this bar holds the
 * search field and the same live icons.
 *
 * Ordering rule: state before identity. Everything left of the avatar changes
 * on its own (or is the page's action); the avatar never does.
 *
 * Not here on a phone: the Sessions drawer's icon. It opened a list of every
 * project's session — the Sessions page again, one tap away in More — and was
 * the one icon in the bar whose meaning nobody could guess. It stays on wide
 * screens, where the drawer beside the page is the point.
 */
export function AppTopBar({
  onOpenSessions,
  feedbackWidget = false,
}: {
  /** Toggles the cross-page Sessions drawer (project inventory + status).
   *  Optional so AppTopBar can also be rendered in isolation/storybook. */
  onOpenSessions?: () => void;
  /** Loki's own feedback widget is configured here (server fact). */
  feedbackWidget?: boolean;
}) {
  const { setOpen } = useCommandPalette();
  const pathname = usePathname();
  const platformHint =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // The page's name: the label the sidebar and the More sheet use. Pages
  // outside the nav config (sign-in, /u/<username>) get none rather than a
  // guess, and a project's own workspace names itself in its header.
  const currentNavItem = NAV_ITEMS.find((item) => isCurrentPath(pathname, item.href));
  const pageLabel = isProjectWorkspacePath(pathname) ? "" : (currentNavItem?.label ?? "");

  // Exactly one <h1> per page, at every width (rule 1). When the page draws
  // its own h1 (PageTitle — sr-only on a phone when it says the same as this
  // bar), the name here is plain text; when the page has none, this IS the h1.
  const pageHasHeading = useMainHasHeading();

  return (
    <header className="ui-app-topbar">
      <TopbarSlot />
      {pageLabel &&
        (pageHasHeading ? (
          <p className="ui-app-topbar-title md:hidden" aria-hidden="true">
            {pageLabel}
          </p>
        ) : (
          <h1 className="ui-app-topbar-title md:sr-only">{pageLabel}</h1>
        ))}
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
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ui-topbar-btn md:hidden"
          aria-label="Search"
          title="Search"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
        {onOpenSessions && (
          <button
            type="button"
            onClick={onOpenSessions}
            className="ui-topbar-btn max-md:hidden"
            aria-label="Open Sessions drawer"
            title="Sessions"
          >
            <LayoutPanelLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <FleetRunnerStatusPill />
        <FeedbackLauncher enabled={feedbackWidget} />
        <NotificationsPill />
        <TopbarActionSlot />
        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * Does the page in <main> draw its own <h1>? Watched, because a client page
 * can mount its heading after the shell. The server answer is "yes", so a
 * page with a heading never renders two h1s, even before hydration.
 */
function useMainHasHeading(): boolean {
  return useSyncExternalStore(subscribeMain, mainHasHeading, () => true);
}

function subscribeMain(onChange: () => void): () => void {
  const main = document.querySelector(".app-main");
  if (!main) return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(main, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function mainHasHeading(): boolean {
  return document.querySelector(".app-main h1") !== null;
}
