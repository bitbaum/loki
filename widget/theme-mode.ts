/**
 * Light or dark: the widget follows Loki's mode.
 *
 * The OWNER sees their site's panel in the mode they chose in Loki — saved to
 * their account by Loki (components/shell/ThemeSync.tsx) and handed back with
 * their changes (POST /api/widget/owner/changes → `theme`). This browser
 * keeps the last answer per site, so the panel opens in the right mode on the
 * next visit instead of flashing the other one first.
 *
 * Everyone else has no Loki mode, so they get Loki's "Auto": their device's
 * own setting, followed live when it changes.
 *
 * The mode is one attribute on each shadow host (data-lk-theme), read by the
 * variables theme.ts themeVarsCSS defines. Nothing is redrawn.
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ThemeMode = "light" | "dark";

export const isThemePreference = (v: unknown): v is ThemePreference =>
  typeof v === "string" && (THEME_PREFERENCES as readonly string[]).includes(v);

/** What a preference means on this device right now. */
export function resolveMode(pref: ThemePreference | null, systemDark: boolean): ThemeMode {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}

const storageKey = (token: string) => `loki-theme:${token}`;

function readStored(token: string): ThemePreference | null {
  try {
    const v = localStorage.getItem(storageKey(token));
    return isThemePreference(v) ? v : null;
  } catch {
    return null;
  }
}

export function createThemeMode(token: string) {
  const hosts = new Set<HTMLElement>();
  let pref = readStored(token);
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const mode = (): ThemeMode => resolveMode(pref, media?.matches ?? false);
  const apply = () => {
    const m = mode();
    hosts.forEach((h) => h.setAttribute("data-lk-theme", m));
  };
  media?.addEventListener?.("change", apply);

  return {
    mode,
    /** Keep this host's colours in step with the mode, from now on. */
    bind(host: HTMLElement) {
      hosts.add(host);
      host.setAttribute("data-lk-theme", mode());
    },
    /** The owner's choice in Loki, as the server reported it. */
    setPreference(next: ThemePreference) {
      if (next === pref) return;
      pref = next;
      try {
        localStorage.setItem(storageKey(token), next);
      } catch {
        // Private mode: the mode still applies for this visit.
      }
      apply();
    },
  };
}

export type ThemeModeHandle = ReturnType<typeof createThemeMode>;
