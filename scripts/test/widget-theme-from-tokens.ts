// The widget's theme is DERIVED from @bitbaum/design-tokens, never typed.
// This fails when the committed generated file no longer matches the tokens
// (someone bumped the package or edited the generated file by hand), and it
// pins the conversion so a wrong HSL→hex cannot ship a wrong colour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssColorToConcrete, buildWidgetTheme, generate } from "../generate-widget-theme";
import { buildShadowCSS, buildDocCSS } from "../../widget/theme";
import { PALETTE } from "../../src/lib/palette";
import { WIDGET_THEME } from "../../src/lib/widget-theme.generated";

// conversion
assert.equal(cssColorToConcrete("0 0% 4%"), "#0a0a0a");
assert.equal(cssColorToConcrete("0 0% 100%"), "#ffffff");
assert.equal(cssColorToConcrete("#FF5C00"), "#ff5c00");
assert.equal(cssColorToConcrete("0 75% 60%"), "#e64c4c");
assert.equal(cssColorToConcrete("0 75% 60% / 0.12"), "rgba(230,76,76,0.12)");

// a tiny tokens file is enough to prove the mapping picks the right block
const tiny = `:root {\n  --public-accent: #ff5c00;\n  --on-accent: 0 0% 8%;\n  --surface-public: 0 0% 4%;\n  --radius-control: 0.375rem;\n  --radius-surface: 0.5rem;\n  --font-sans: 'Inter', system-ui, sans-serif;\n  --font-mono: 'IBM Plex Mono', monospace;\n  --text-primary: 0 0% 10%;\n}\n.dark {\n  --accent-hover: #ff7a33;\n  --text-primary: 0 0% 92%;\n  --text-secondary: 0 0% 65%;\n  --text-tertiary: 0 0% 48%;\n  --text-muted: 0 0% 32%;\n  --surface-page: 0 0% 7%;\n  --surface-hover: 0 0% 13%;\n  --border-subtle: 0 0% 13%;\n  --border-default: 0 0% 20%;\n  --border-strong: 0 0% 24%;\n  --status-positive: 145 55% 50%;\n  --status-negative: 0 75% 60%;\n  --status-negative-subtle: 0 75% 60% / 0.12;\n}\n`;
const t = buildWidgetTheme(tiny);
assert.equal(t.text, "#ebebeb", "dark text, not the light block's #1a1a1a");
assert.equal(t.surface, "#0a0a0a");
assert.equal(t.inkOnAccent, "#141414");
assert.equal(t.accentMuted, "rgba(255,92,0,0.16)");
assert.equal(t.radiusSurface, "8px");
assert.ok(t.fontSans.startsWith("'Inter'"));

// the committed file is what the tokens produce today
const committed = readFileSync(join(process.cwd(), "src/lib/widget-theme.generated.ts"), "utf8");
assert.equal(committed, generate(), "src/lib/widget-theme.generated.ts is stale — regenerate");

// and it is what the server ships to every widget
assert.deepEqual(
  PALETTE.widget,
  WIDGET_THEME,
  "PALETTE.widget must be the generated theme, not a hand copy",
);

// ---- the stylesheets the widget actually ships ----
// Two faults shipped together in #734 and neither was catchable by tsc: the
// .modes / .mode rules were pasted INSIDE the .dot rule's declaration block
// (killing .dot's own declarations and every mode chip on every customer
// site), and they carried literal hex fallbacks. Pin both.
const theme = { ...WIDGET_THEME } as unknown as Parameters<typeof buildShadowCSS>[0];
const sheets: Array<[string, string]> = [
  ["shadow", buildShadowCSS(theme)],
  ["doc", buildDocCSS(theme)],
];

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
    // The widget's Shadow DOM sets `all: initial` and defines no custom
    // properties, so any var() resolves to its fallback — a hardcoded colour
    // wearing a token's clothes. There is nothing for var() to read here.
    assert.ok(
      !body.includes("var("),
      `${name}: rule "${selector}" uses var() — the widget defines no custom properties, so the fallback is what ships`,
    );
  }

  // Every hex colour in the emitted CSS must be one the tokens supplied.
  const allowed = new Set(
    Object.values(WIDGET_THEME)
      .flatMap((v) => (typeof v === "string" ? (v.match(/#[0-9a-fA-F]{3,8}/g) ?? []) : []))
      .map((h) => h.toLowerCase()),
  );
  for (const hex of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
    const h = hex.toLowerCase();
    // `${theme.accent}55` — a token colour with an alpha suffix, still derived.
    const base = h.length === 9 ? h.slice(0, 7) : h;
    assert.ok(
      allowed.has(h) || allowed.has(base),
      `${name}: literal colour ${hex} is not in the generated theme — change the tokens, never type a colour into widget/`,
    );
  }
}

// The mode chips are styled at all (the #734 regression rendered them naked).
const shadow = buildShadowCSS(theme);
for (const sel of [".modes", ".mode", ".mode.on", ".mode:disabled", ".mode-hint"]) {
  assert.ok(
    ruleBodies(shadow).some((r) => r.selector === sel),
    `shadow: "${sel}" is not a rule of its own`,
  );
}

console.log("widget-theme-from-tokens: ok");
