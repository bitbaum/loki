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
import {
  CommandPaletteProvider,
  useCommandPaletteHotkey,
  useCommandPaletteState,
} from "@/hooks/use-command-palette";
import { SIDEBAR_COLLAPSE_STORAGE_KEY } from "@/config/shell";

export function AppShell({
  children,
  orangecatEnabled = false,
}: {
  children: React.ReactNode;
  /** Whether the OrangeCat provider is configured (server fact from the layout). */
  orangecatEnabled?: boolean;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const paletteApi = useCommandPaletteState();
  useCommandPaletteHotkey(paletteApi);

  // Hydrate from localStorage on mount — deferred so server and client agree on initial render.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      if (stored !== null) {
        setSidebarCollapsed(stored === "true"); // eslint-disable-line react-hooks/set-state-in-effect
      } else {
        setSidebarCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(sidebarCollapsed));
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  return (
    <CommandPaletteProvider value={paletteApi}>
      <div className="app-shell-frame flex min-h-screen bg-surface-page text-text-primary">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        />
        <div className="app-main-column">
          <AppTopBar onOpenSessions={() => setSessionsOpen(true)} />
          <DemoBanner />
          <EmailVerificationBanner />
          <OrangeCatConnectBanner enabled={orangecatEnabled} />
          <FleetSurfaceGuide />
          <main className="app-main">{children}</main>
          <AppFooter />
        </div>
        <MobileNav />
        <AskLokiButton />
        <RefreshOnFocus />
        <CommandPalette />
        <FleetRunnerAutoMint />
        <UpdateBanner />
        <SessionsDrawer open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
      </div>
    </CommandPaletteProvider>
  );
}
