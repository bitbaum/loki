// Light or dark: the widget follows Loki's mode (widget/theme-mode.ts).
// The owner sees the mode they chose in Loki; everyone else their device's.
// Run: npx tsx scripts/test/widget-theme-mode.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THEME_PREFERENCES,
  createThemeMode,
  isThemePreference,
  resolveMode,
} from "../../widget/theme-mode";
import { THEME_MODES, DEFAULT_THEME_MODE } from "../../src/config/theme";
import { themesFrom } from "../../widget/theme";
import { WIDGET_THEMES } from "../../src/lib/widget-theme.generated";

// ---- the values are one list in three places ----
assert.deepEqual([...THEME_PREFERENCES], [...THEME_MODES], "widget mirrors src/config/theme.ts");
const toggle = readFileSync("src/components/shell/ThemeToggle.tsx", "utf8");
for (const m of THEME_MODES)
  assert.ok(toggle.includes(`value: "${m}"`), `Loki's control offers ${m}`);
const provider = readFileSync("src/components/shell/ThemeProvider.tsx", "utf8");
assert.ok(
  provider.includes(`defaultTheme="${DEFAULT_THEME_MODE}"`),
  "an owner who never chose is shown what Loki shows them",
);

// ---- resolving ----
assert.equal(resolveMode("dark", false), "dark", "an explicit choice wins over the device");
assert.equal(resolveMode("light", true), "light");
assert.equal(resolveMode("system", true), "dark", "Auto follows the device");
assert.equal(resolveMode(null, false), "light", "a visitor has no Loki mode: their device's");
assert.ok(isThemePreference("system") && !isThemePreference("blue") && !isThemePreference(null));

// ---- a handle: hosts follow the preference, the choice is remembered per site ----
{
  const store = new Map<string, string>();
  const listeners: Array<() => void> = [];
  let systemDark = false;
  const g = globalThis as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
  g.matchMedia = () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  });
  const host = () => {
    const attrs = new Map<string, string>();
    return {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      mode: () => attrs.get("data-lk-theme"),
    };
  };

  const visitor = createThemeMode("fcw_a");
  const a = host();
  visitor.bind(a as unknown as HTMLElement);
  assert.equal(a.mode(), "light", "a visitor on a light device gets light");
  systemDark = true;
  listeners.forEach((l) => l());
  assert.equal(a.mode(), "dark", "and follows the device when it changes, live");

  const owner = createThemeMode("fcw_b");
  const b = host();
  owner.bind(b as unknown as HTMLElement);
  owner.setPreference("light");
  assert.equal(b.mode(), "light", "the owner's Loki choice wins over a dark device");
  assert.equal(store.get("loki-theme:fcw_b"), "light", "and is remembered for this site");
  const again = createThemeMode("fcw_b");
  assert.equal(again.mode(), "light", "the next visit opens in it, no flash of the other mode");
  assert.equal(createThemeMode("fcw_c").mode(), "dark", "another site has its own memory");
}

// ---- boot responses old and new ----
assert.deepEqual(themesFrom({ themes: WIDGET_THEMES }), WIDGET_THEMES);
const single = themesFrom({ theme: WIDGET_THEMES.dark });
assert.equal(single?.light, WIDGET_THEMES.dark, "an older server's one theme serves both modes");
assert.equal(themesFrom({}), null, "no theme, no widget — never a guessed palette");

console.log("widget-theme-mode: ok");
