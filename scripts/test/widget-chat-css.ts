// The shared chat's stylesheet inside the widget's shadow root, and its
// colours from the widget's theme (widget/chat/shadow-css.ts, chat/theme.ts).
//
// chatkit's CSS assumes it owns the page: defaults on `:root`, which never
// matches in a shadow root, and sizes in rem, which is the HOST's root size.
// The browser test (widget-kit-browser.ts) shows the result on a 10px-root
// page; this pins the transform itself, on the real stylesheet.
//
// Run: npx tsx scripts/test/widget-chat-css.ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PALETTE } from "../../src/lib/palette";
import { shadowChatkitCss } from "../../widget/chat/shadow-css";
import { chatkitVars } from "../../widget/chat/theme";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

ok(
  shadowChatkitCss(".a { padding: 0.375rem 1.25rem; gap: -0.5rem; }") ===
    ".a { padding: 6px 20px; gap: -8px; }",
  "rem becomes px at the widget's 16px, signs and fractions kept",
);
ok(shadowChatkitCss(".a { width: 2remx; }").includes("2remx"), "only whole rem units change");
ok(
  shadowChatkitCss(":where(:root) { --ck-bg: red; }") === ":where(:host) { --ck-bg: red; }",
  "the defaults move from :root to the shadow host",
);

const require = createRequire(import.meta.url);
const real = readFileSync(require.resolve("@bitbaum/chatkit/styles/chat.css"), "utf8");
ok(/\drem\b/.test(real) && real.includes(":where(:root)"), "the real stylesheet has both to fix");
const fixed = shadowChatkitCss(real);
ok(!/\drem\b/.test(fixed), "no rem is left in the shipped chat CSS");
ok(
  !fixed.replace(/\/\*[\s\S]*?\*\//g, "").includes(":root"),
  "no :root rule is left in the shipped chat CSS",
);

// Every variable chatkit reads is set from the widget's theme, so nothing
// falls through to a host page's own tokens.
const vars = chatkitVars(PALETTE.widget);
const read = new Set([...real.matchAll(/var\((--ck-[a-z0-9-]+)/g)].map((m) => m[1]));
const declaredByKit = new Set([...real.matchAll(/(--ck-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
// A variable read with its fallback beside it (`var(--ck-n, 1)`, which chatkit
// sets inline per element) has its default at the point of use.
const fallbackByKit = new Set([...real.matchAll(/var\((--ck-[a-z0-9-]+)\s*,/g)].map((m) => m[1]));
const colours = [...read].filter((v) =>
  /bg|raised|overlay|fg|muted|line|accent|danger|warning/.test(v),
);
const unset = colours.filter((v) => !vars.includes(`${v}:`));
ok(unset.length === 0, `every colour chatkit reads comes from the widget theme (${unset})`);
ok(
  [...read].every((v) => vars.includes(`${v}:`) || declaredByKit.has(v) || fallbackByKit.has(v)),
  "every other variable has chatkit's own default",
);
ok(vars.startsWith(":host {") && !vars.includes("undefined"), "the theme sets them on the host");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
