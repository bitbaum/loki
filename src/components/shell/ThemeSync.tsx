"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { isThemeModeValue } from "@/config/theme";

/**
 * Keeps the account's light/dark choice in step with the one this browser
 * shows. next-themes keeps the choice in localStorage on Loki's origin; the
 * widget on the owner's own site lives on another origin and cannot read it,
 * so the choice is also saved to the account (PUT /api/me/theme), where the
 * widget asks for it (widget/theme-mode.ts). Once per page load and on every
 * change — one small idempotent write, never cached per browser, because a
 * browser can be signed into more than one account. Renders nothing.
 */
export function ThemeSync() {
  const { theme } = useTheme();
  useEffect(() => {
    if (!isThemeModeValue(theme)) return;
    void fetch("/api/me/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    }).catch(() => {
      // Offline: the next change, or the next load, tries again.
    });
  }, [theme]);
  return null;
}
