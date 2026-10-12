"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

/** SSOT for theme modes. "system" renders as Auto in the UI (follows OS). */
export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];

function useThemeControl() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes SSR hydration guard
  useEffect(() => setMounted(true), []);

  const current = (mounted ? theme : undefined) ?? "dark";
  const currentIndex = THEME_OPTIONS.findIndex((o) => o.value === current);
  const currentOption = THEME_OPTIONS[currentIndex >= 0 ? currentIndex : 1];
  const nextOption = THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];

  const cycle = () => setTheme(nextOption.value);

  return { mounted, current, currentOption, nextOption, setTheme, cycle };
}

/**
 * One control for Light / Dark / Auto — not three separate buttons.
 *
 * - `cycle` (default): single tap cycles modes; used in shell chrome + mobile.
 * - `select`: one dropdown in Settings → Appearance.
 */
export function ThemeToggle({
  variant = "cycle",
  showLabel = false,
  className,
}: {
  variant?: "cycle" | "select";
  /** Show the current mode name beside the icon (cycle variant). */
  showLabel?: boolean;
  className?: string;
}) {
  const { mounted, current, currentOption, nextOption, setTheme, cycle } = useThemeControl();
  const Icon = currentOption.icon;

  if (variant === "select") {
    return (
      <select
        className={cn("ui-input max-w-xs", className)}
        value={current}
        disabled={!mounted}
        onChange={(e) => setTheme(e.target.value as ThemeValue)}
        aria-label="Theme"
      >
        {THEME_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={!mounted}
      className={cn("ui-theme-cycle-btn", showLabel && "ui-theme-cycle-btn-labeled", className)}
      aria-label={
        mounted ? `Theme: ${currentOption.label}. Switch to ${nextOption.label}.` : "Theme"
      }
      title={mounted ? `${currentOption.label} — switch to ${nextOption.label}` : "Theme"}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {showLabel && <span className="truncate">{currentOption.label}</span>}
    </button>
  );
}
