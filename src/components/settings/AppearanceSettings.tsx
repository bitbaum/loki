"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Segmented } from "@/components/ui/segmented";
import { SectionHeading } from "@/components/ui/section-heading";
import { THEME_OPTIONS } from "@/components/shell/ThemeToggle";

const MEANS: Record<string, string> = {
  light: "Light, whatever the time of day.",
  dark: "Dark, whatever the time of day.",
  system: "Follows your phone or computer. Remembered in this browser only.",
};

const noop = () => () => {};

/** Settings → Appearance: one row of three, what the chosen one means under it. */
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  // The theme is only known in the browser; until then nothing is marked.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return (
    <section className="ui-settings-section">
      <SectionHeading title="Theme" />
      <Segmented
        label="Theme"
        options={THEME_OPTIONS.map((o) => ({ id: o.value, label: o.label, means: MEANS[o.value] }))}
        value={mounted ? (theme ?? "system") : null}
        onChange={setTheme}
      />
    </section>
  );
}
