"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { AskLokiButton } from "./AskLokiButton";
import { AppTopBar } from "./AppTopBar";
import { AppFooter } from "./AppFooter";
import { CommandPalette } from "./CommandPalette";
import { SessionsDrawer } from "./SessionsDrawer";
import { RefreshOnFocus } from "@/components/shared/RefreshOnFocus";
import { FleetRunnerAutoMint } from "@/components/desktop/FleetRunnerAutoMint";
import { UpdateBanner } from "@/components/desktop/UpdateBanner";
import { EmailVerificationBanner } from "@/components/shell/EmailVerificationBanner";
import { OrangeCatConnectBanner } from "@/components/shell/OrangeCatConnectBanner";
import { DemoBanner } from "@/components/shell/DemoBanner";
import { FleetSurfaceGuide } from "@/components/shell/FleetSurfaceGuide";
import { ThemeSync } from "@/components/shell/ThemeSync";
import {
  CommandPaletteProvider,
  useCommandPaletteHotkey,
  useCommandPaletteState,
} from "@/hooks/use-command-palette";
import {
  SIDEBAR_COLLAPSE_COOKIE,
  SIDEBAR_COLLAPSE_STORAGE_KEY,
  SIDEBAR_COLLAPSED_BY_DEFAULT,
} from "@/config/shell";
import { OwnSitePass } from "./OwnSitePass";

export function AppShell({
  children,
  orangecatEnabled = false,
  feedbackWidget = false,
  viewerId = null,
  ownerPass = null,
  initialSidebarCollapsed = SIDEBAR_COLLAPSED_BY_DEFAULT,
}: {
  children: React.ReactNode;
  /** The signed-in owner's pass for Loki's own widget (server fact), else null. */
  ownerPass?: { token: string; pass: string } | null;
  /** The signed-in person's id (server fact), the floating assistant's storage scope. */
  viewerId?: string | null;
  /** Whether the OrangeCat provider is configured (server fact from the layout). */
  orangecatEnabled?: boolean;
  /** Whether Loki's own feedback widget is loaded here (server fact): the top
   *  bar then draws its launcher (FeedbackLauncher). */
  feedbackWidget?: boolean;
  /** The sidebar's width as the server read it from the cookie, so the first
   *  paint is already right and nothing slides after hydration. */
  initialSidebarCollapsed?: boolean;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const paletteApi = useCommandPaletteState();
  useCommandPaletteHotkey(paletteApi);

  // A choice made before the cookie existed lives in localStorage only. Read
  // it once: the page moves this one time for that person, the cookie is
  // written below, and every later load is drawn right by the server.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      if (stored !== null && (stored === "true") !== initialSidebarCollapsed) {
        setSidebarCollapsed(stored === "true"); // eslint-disable-line react-hooks/set-state-in-effect
      }
    } catch {
      /* ignore */
    }
    // Only on mount: the prop is the server's reading of this same choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(sidebarCollapsed));
      document.cookie = `${SIDEBAR_COLLAPSE_COOKIE}=${sidebarCollapsed}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  return (
    <CommandPaletteProvider value={paletteApi}>
      <ThemeSync />
      {/* First Tab stop on every signed-in page. Without it the page's first
          control was the 22nd stop, after the whole sidebar and the top bar. */}
      <a href="#content" className="ui-skip-link">
        Skip to content
      </a>
      <div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        />
        <div className="app-main-column">
          <AppTopBar onOpenSessions={() => setSessionsOpen(true)} feedbackWidget={feedbackWidget} />
          <DemoBanner />
          <OrangeCatConnectBanner
            enabled={orangecatEnabled}
            fallback={<EmailVerificationBanner />}
          />
          <FleetSurfaceGuide />
          <main id="content" tabIndex={-1} className="app-main">
            {children}
          </main>
          <AppFooter />
        </div>
        <MobileNav />
        <AskLokiButton viewerId={viewerId} />
        {ownerPass && <OwnSitePass token={ownerPass.token} pass={ownerPass.pass} />}
        <RefreshOnFocus />
        <CommandPalette />
        <FleetRunnerAutoMint />
        <UpdateBanner />
        <SessionsDrawer open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
      </div>
    </CommandPaletteProvider>
  );
}
