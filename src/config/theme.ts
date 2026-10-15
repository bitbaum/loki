/**
 * Loki's light / dark choice — the values, once. The theme control
 * (components/shell/ThemeToggle.tsx) offers them, the account stores one
 * (user_preferences.theme), and the site widget follows it
 * (widget/theme-mode.ts mirrors this list: the widget bundle imports nothing
 * from src/, and scripts/test/widget-theme-mode.ts fails if the two differ).
 */
export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeModeValue = (typeof THEME_MODES)[number];

/** What a Loki account that never chose is shown — ThemeProvider's defaultTheme. */
export const DEFAULT_THEME_MODE: ThemeModeValue = "dark";

export const isThemeModeValue = (v: unknown): v is ThemeModeValue =>
  typeof v === "string" && (THEME_MODES as readonly string[]).includes(v);
