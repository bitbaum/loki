// The widget's themes are DERIVED from Loki's own tokens (src/app/globals.css),
// light and dark, never typed. This fails when the committed generated file no
// longer matches globals.css, and pins what makes the widget Loki's rather than
// OrangeCat's: the accent is the ink, and the warm orange is only the focus ring
// and a picked element's outline (2026-10-15, "the widget has OrangeCat's design").
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWidgetThemes, generate, parseTokenBlocks } from "../generate-widget-theme";
import { buildShadowCSS, buildDocCSS, themeVarsCSS, varTheme } from "../../widget/theme";
import { followUpCSS } from "../../widget/tour-followup";
import { PALETTE } from "../../src/lib/palette";
import { WIDGET_THEMES } from "../../src/lib/widget-theme.generated";

// the mapping reads the right block, and the dark block falls back to :root
const tinyLoki = `x\n:root {\n  --accent-primary: oklch(0.1 0 0);\n  --accent-hover: oklch(0.2 0 0);\n  --accent-muted: oklch(0.1 0 0 / 8%);\n  --text-inverted: oklch(0.98 0 0);\n  --text-primary: oklch(0.1 0 0);\n  --text-secondary: oklch(0.4 0 0);\n  --text-tertiary: oklch(0.5 0 0);\n  --text-muted: oklch(0.52 0 0);\n  --surface-base: oklch(1 0 0);\n  --surface-raised: oklch(0.96 0 0);\n  --surface-overlay: oklch(0.94 0 0);\n  --border-subtle: oklch(0.9 0 0);\n  --border-default: oklch(0.82 0 0);\n  --border-strong: oklch(0.6 0 0);\n  --status-positive: oklch(0.44 0.16 145);\n  --status-warning: oklch(0.46 0.14 68);\n  --status-negative: oklch(0.5 0.18 25);\n  --status-negative-subtle: oklch(0.5 0.18 25 / 8%);\n  --ring: oklch(0.66 0.21 41 / 55%);\n  --accent-warm: oklch(0.66 0.21 41);\n  --surface-public: oklch(0.04 0 0);\n}\n.dark {\n  --accent-primary: oklch(0.92 0 0); /* the ink */\n  --text-primary: oklch(0.92 0 0);\n  --surface-base: oklch(0.1 0 0);\n}\n`;
const tinyFleet = `x\n:root {\n  --radius-control: 0.375rem;\n  --radius-surface: 0.5rem;\n  --font-sans: 'Inter', system-ui;\n  --font-mono: 'IBM Plex Mono', monospace;\n}\n.dark {\n}\n`;
assert.equal(
  parseTokenBlocks(tinyLoki).dark["accent-primary"],
  "oklch(0.92 0 0)",
  "comments dropped",
);
const tiny = buildWidgetThemes(tinyLoki, tinyFleet);
assert.equal(tiny.light.accent, "oklch(0.1 0 0)");
assert.equal(tiny.dark.accent, "oklch(0.92 0 0)", "dark takes the .dark block");
assert.equal(tiny.dark.textSecondary, "oklch(0.4 0 0)", "and falls back to :root for the rest");
assert.equal(tiny.light.radiusSurface, "8px");

// the committed file is what globals.css produces today
const committed = readFileSync(join(process.cwd(), "src/lib/widget-theme.generated.ts"), "utf8");
assert.equal(committed, generate(), "src/lib/widget-theme.generated.ts is stale — regenerate");

// and it is what the server ships to every widget
assert.deepEqual(PALETTE.widgetThemes, WIDGET_THEMES, "the server ships the generated themes");
assert.deepEqual(PALETTE.widget, WIDGET_THEMES.dark, "the single-theme field is the dark one");

// Loki, not OrangeCat: the accent is the ink in both modes, never the warm orange.
for (const mode of ["light", "dark"] as const) {
  const t = WIDGET_THEMES[mode];
  assert.equal(t.accent, t.text, `${mode}: the accent is the text colour — Loki is monochrome`);
  assert.ok(!/#ff5c00/i.test(JSON.stringify(t)), `${mode}: no OrangeCat orange anywhere`);
}
assert.notEqual(WIDGET_THEMES.light.surface, WIDGET_THEMES.dark.surface, "two modes, two surfaces");

// ---- the stylesheets the widget actually ships ----
// Written against variables (varTheme), defined on the host for both modes
// (themeVarsCSS). Two faults shipped together in #734 and neither was
// catchable by tsc: rules pasted INSIDE another rule's declarations, and
// var() with literal fallbacks. Pin both — and that every variable a sheet
// reads is one the host defines, so nothing ever falls back.
const theme = varTheme(WIDGET_THEMES);
const vars = themeVarsCSS(WIDGET_THEMES);
const sheets: Array<[string, string]> = [
  ["shadow", buildShadowCSS(theme)],
  ["follow-up", followUpCSS(theme)],
  ["doc", buildDocCSS(WIDGET_THEMES.light)],
];
const defined = new Set([...vars.matchAll(/(--lk-[a-z-]+):/g)].map((m) => m[1]));
const definedDark = new Set(
  [...vars.slice(vars.indexOf('data-lk-theme="dark"')).matchAll(/(--lk-[a-z-]+):/g)].map(
    (m) => m[1],
  ),
);
assert.deepEqual(
  [...definedDark].sort(),
  [...defined].sort(),
  "dark defines every variable light does",
);

/** Rule bodies, with comments stripped. At-rules may nest one level; nothing else may. */
function ruleBodies(css: string): Array<{ selector: string; body: string }> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let selStart = 0;
  let bodyStart = 0;
  let selector = "";
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") {
      if (depth === 0) {
        selector = src.slice(selStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        out.push({ selector, body: src.slice(bodyStart, i) });
        selStart = i + 1;
      }
    }
  }
  assert.equal(depth, 0, "unbalanced braces in widget CSS");
  return out;
}

for (const [name, css] of sheets) {
  for (const { selector, body } of ruleBodies(css)) {
    // A plain rule's body is declarations only. A nested "{" means a selector
    // was pasted mid-declaration — exactly the #734 fault.
    if (!selector.startsWith("@")) {
      assert.ok(
        !body.includes("{"),
        `${name}: rule "${selector}" contains a nested block — a selector was pasted inside its declarations`,
      );
      // Every declaration terminated: the last one may drop its ";" only if it
      // is the sole/last declaration, so require a ";" wherever more follows.
      for (const decl of body.split(";")) {
        const d = decl.trim();
        if (!d) continue;
        assert.ok(
          d.includes(":"),
          `${name}: rule "${selector}" has an unterminated declaration near "${d.slice(0, 40)}"`,
        );
      }
    }
    // Every variable read is one the host defines, and none carries a
    // fallback: a fallback would be a hardcoded colour wearing a token's clothes.
    for (const m of body.matchAll(/var\((--[a-z-]+)([^)]*)\)/g)) {
      assert.ok(
        defined.has(m[1]),
        `${name}: rule "${selector}" reads ${m[1]}, which is never defined`,
      );
      assert.equal(m[2].trim(), "", `${name}: rule "${selector}" gives ${m[1]} a fallback`);
    }
  }

  // No colour typed into widget/: the only literals left are the doc sheet's,
  // which come from the generated theme.
  const allowed = new Set(
    Object.values(WIDGET_THEMES.light).filter((v): v is string => typeof v === "string"),
  );
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const lit of stripped.match(/#[0-9a-fA-F]{3,8}\b|oklch\([^)]*\)/g) ?? []) {
    assert.ok(
      allowed.has(lit),
      `${name}: literal colour ${lit} is not in the generated theme — change the tokens, never type a colour into widget/`,
    );
  }
}

// The panel's own controls are styled at all (the #734 regression rendered the
// old mode chips naked; the one conversation replaced them with these).
const shadow = buildShadowCSS(theme);
for (const sel of [
  ".thoughts-toggle",
  ".composer",
  ".change-send",
  ".scopebtn",
  ".pointbtn",
  ".scopemenu",
  ".segbtn",
  ".segbtn.on",
  ".composer-actions",
  ".msg.noticed",
  ".sendcard",
  ".act",
  ".track",
]) {
  assert.ok(
    ruleBodies(shadow).some((r) => r.selector === sel),
    `shadow: "${sel}" is not a rule of its own`,
  );
}

console.log("widget-theme-from-tokens: ok");
