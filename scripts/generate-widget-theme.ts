/**
 * The feedback widget's two themes — light and dark — derived from LOKI'S OWN
 * design tokens (src/app/globals.css, `:root` and `.dark`).
 *
 * The widget floats on other people's sites and cannot read our CSS
 * variables, so it needs the values themselves. They used to come from the
 * fleet's shared @bitbaum/design-tokens, whose accent is the warm orange
 * OrangeCat and the public pages spend on calls to action — so the widget
 * wore orange labels, orange rings and orange buttons, and the owner asked why
 * Loki's widget looked like OrangeCat (2026-10-15). Loki is monochrome: its
 * accent is the ink (near-black on light, near-white on dark), and the warm
 * colour is kept for the focus ring. globals.css is where that decision lives,
 * so that is what this reads. A test regenerates and compares, so a token
 * change that was not regenerated fails the build instead of shipping a stale
 * widget.
 *
 *   npx tsx scripts/generate-widget-theme.ts          # write
 *   npx tsx scripts/generate-widget-theme.ts --check  # exit 1 if stale
 *
 * Values are passed through as written (oklch()): every browser Loki itself
 * supports reads them, and converting would only add a place to be wrong.
 * Fonts and radii still come from the fleet tokens — Loki's own font is a
 * next/font variable with no family name a foreign page could use.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LOKI_CSS = join(here, "..", "src", "app", "globals.css");
const FLEET_TOKENS_CSS = require.resolve("@bitbaum/design-tokens/tokens.css");
const OUT = join(here, "..", "src", "lib", "widget-theme.generated.ts");

type Vars = Record<string, string>;

/** `:root { … }` and `.dark { … }` as flat maps of custom property → raw value. */
export function parseTokenBlocks(css: string): { root: Vars; dark: Vars } {
  const block = (selector: string): Vars => {
    const start = css.indexOf(`\n${selector} {`);
    if (start === -1) throw new Error(`no "${selector} {" block`);
    const end = css.indexOf("\n}", start + 1);
    const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    const vars: Vars = {};
    for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[m[1]] = m[2].trim().replace(/\s+/g, " ");
    }
    return vars;
  };
  return { root: block(":root"), dark: block(".dark") };
}

/** A colour the widget can use as written: a literal, never a var() it cannot resolve. */
function literal(key: string, value: string): string {
  if (value.includes("var(")) throw new Error(`--${key} is "${value}": the widget needs a literal`);
  return value;
}

function remToPx(rem: string): string {
  const m = rem.trim().match(/^([\d.]+)rem$/);
  if (!m) return rem.trim();
  return `${Math.round(Number(m[1]) * 16)}px`;
}

/** One theme from one block, the light block filling what the dark one does not redefine. */
function themeFrom(own: Vars, root: Vars, fleet: Vars) {
  const c = (key: string): string => {
    const v = own[key] ?? root[key];
    if (!v) throw new Error(`globals.css is missing --${key}`);
    return literal(key, v);
  };
  const f = (key: string): string => {
    const v = fleet[key];
    if (!v) throw new Error(`design tokens are missing --${key}`);
    return v;
  };
  return {
    // Loki's accent is the ink: the Send fill, a selected chip, a live dot.
    accent: c("accent-primary"),
    accentHover: c("accent-hover"),
    accentMuted: c("accent-muted"),
    inkOnAccent: c("text-inverted"),
    text: c("text-primary"),
    textSecondary: c("text-secondary"),
    textTertiary: c("text-tertiary"),
    textMuted: c("text-muted"),
    /** The panel itself, then a step up (cards, bubbles), then a step further (hover). */
    surface: c("surface-base"),
    surfaceRaised: c("surface-raised"),
    surfaceSubtle: c("surface-overlay"),
    border: c("border-subtle"),
    borderStrong: c("border-default"),
    borderDark: c("border-strong"),
    success: c("status-positive"),
    warning: c("status-warning"),
    error: c("status-negative"),
    errorSurface: c("status-negative-subtle"),
    /** Loki's focus ring — the one place the warm colour appears. */
    focus: c("ring"),
    /** What a picked element on the HOST page is outlined in: it must read on any site. */
    highlight: c("accent-warm"),
    black: c("surface-public"),
    white: "#ffffff",
    radiusControl: remToPx(f("radius-control")),
    radiusSurface: remToPx(f("radius-surface")),
    fontSans: f("font-sans").replace(/\s+/g, " "),
    fontMono: f("font-mono").replace(/\s+/g, " "),
  } as const;
}

export function buildWidgetThemes(lokiCss: string, fleetCss: string) {
  const { root, dark } = parseTokenBlocks(lokiCss);
  const fleet = parseTokenBlocks(fleetCss).root;
  return { light: themeFrom(root, root, fleet), dark: themeFrom(dark, root, fleet) };
}

export function renderModule(themes: ReturnType<typeof buildWidgetThemes>): string {
  const block = (t: Record<string, string>) =>
    Object.entries(t)
      .map(([k, v]) => `    ${k}: ${JSON.stringify(v)},`)
      .join("\n");
  return `// GENERATED by scripts/generate-widget-theme.ts from src/app/globals.css
// — do not edit; change the tokens and regenerate. scripts/test/widget-theme-from-tokens.ts
// fails when this file is stale.
export const WIDGET_THEMES = {
  light: {
${block(themes.light)}
  },
  dark: {
${block(themes.dark)}
  },
} as const;

/** The dark theme — what a surface that is always dark (the preview gate) uses. */
export const WIDGET_THEME = WIDGET_THEMES.dark;

export type WidgetThemeShape = (typeof WIDGET_THEMES)["light" | "dark"];
`;
}

export function generate(): string {
  return renderModule(
    buildWidgetThemes(readFileSync(LOKI_CSS, "utf8"), readFileSync(FLEET_TOKENS_CSS, "utf8")),
  );
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === require("node:path").resolve(process.argv[1]);
if (invokedDirectly) {
  const next = generate();
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (process.argv.includes("--check")) {
    if (current !== next) {
      console.error("widget theme is stale — run: npx tsx scripts/generate-widget-theme.ts");
      process.exit(1);
    }
    console.log("widget theme matches src/app/globals.css");
  } else if (current !== next) {
    writeFileSync(OUT, next);
    console.log(`wrote ${OUT}`);
  } else {
    console.log("widget theme unchanged");
  }
}
