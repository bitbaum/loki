"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { APP_SLUG } from "@/config/brand";
import { themeColorFor } from "@/lib/palette";

/** Keeps <meta name="theme-color"> on the theme actually rendered. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = themeColorFor(resolvedTheme);
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
      meta.removeAttribute("media");
    });
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      // `class` drives Tailwind's dark: variants; `data-theme` is the fleet
      // convention bip-kit's styles.css keys its dark scopes on (shiki token
      // colors, callout palettes). Both mirror the same resolved theme.
      attribute={["class", "data-theme"]}
      // Dark-first brand (x.ai / grok / SpaceX language). Users who haven't
      // explicitly picked a theme get dark instead of following the OS — the
      // Settings → Appearance toggle (incl. System) still overrides per-user.
      defaultTheme="dark"
      enableSystem={true}
      storageKey={`${APP_SLUG}-theme`}
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}
