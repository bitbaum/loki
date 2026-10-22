// The launcher is always fully opaque and tappable — on every viewport, while
// scrolling, and as the edge tab. A launcher that faded to 30% and ignored taps
// while the page scrolled, or sat at 70% as a tab, read as "sometimes
// transparent, sometimes not" (G, 2026-10-22).
// Run: npx tsx scripts/test/widget-launcher-solid.ts
import assert from "node:assert/strict";
import { buildShadowCSS, varTheme } from "../../widget/theme";
import { WIDGET_THEMES } from "../../src/lib/widget-theme.generated";

const css = buildShadowCSS(varTheme(WIDGET_THEMES));
// Every rule whose selector targets the launcher (.fab…, not .fab-talk/.fabmenu).
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }))
  .filter((r) => /(^|[\s,])\.fab(?![-\w])/.test(r.sel));
assert.ok(rules.length > 3, "found the launcher's rules");
for (const r of rules) {
  const op = r.body.match(/(?:^|;|\s)opacity\s*:\s*([\d.]+)/);
  if (op) assert.equal(Number(op[1]), 1, `${r.sel} keeps opacity 1 (got ${op[1]})`);
  assert.ok(!/pointer-events\s*:\s*none/.test(r.body), `${r.sel} stays tappable`);
}
assert.ok(!/\.fab[^{]*\.scrolling/.test(css), "no scroll-state styling on the launcher");
console.log("✓ launcher always solid and tappable");
