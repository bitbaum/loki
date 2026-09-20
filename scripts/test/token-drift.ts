/**
 * Loki's design tokens, checked against the fleet SSOT.
 *
 * ── The problem this gate exists for ─────────────────────────────────────────
 * `@bitbaum/design-tokens` calls itself "the design single source of truth for
 * OrangeCat, Loki and Solon". Solon proves it: its globals.css is 19 lines and
 * imports the package. Loki's is ~5,800 and declares its own ramp, with the
 * package present only as a devDependency used to generate the widget theme.
 * A comment in globals.css said the quiet part out loud — "Loki still declares
 * its ramp locally, so the value is kept in step by hand."
 *
 * Nothing was keeping it in step. Measured 2026-09-20, Loki and the package
 * disagree on 32 of the 36 tokens they both define, and the disagreement has a
 * shape: somebody transcribed the DIGITS between colour spaces without
 * converting them. `--text-secondary` is `oklch(0.4 0 0)` here and `0 0% 40%`
 * there. Those are not the same colour — they are 30 of 255 apart.
 *
 *   light theme: surfaces agree within 5/255; the TEXT ramp is 20-30 apart
 *                (Loki's is darker — higher contrast)
 *   dark theme:  text agrees within 7/255; the SURFACE ramp is 17-30 apart
 *                (Loki's ground is near-black: #010101 vs the fleet's #121212)
 *
 * ── Why this is a gate and not a migration ───────────────────────────────────
 * Some of that divergence is deliberate. Loki is an operator console that sits
 * next to a terminal, and its near-black ground is a product decision, not a
 * typo. Its typeface is Geist where the fleet's is Inter + Instrument Serif.
 * Adopting the package wholesale would restyle every surface and every glyph
 * of a running product at once.
 *
 * So the rule is not "be identical". The rule is that every difference is
 * DECLARED. A divergence in DIVERGENCES below is a decision somebody made and
 * signed; a divergence that is not listed is drift, and fails this check. New
 * matching tokens are pinned too, so a token that agrees today cannot quietly
 * stop agreeing tomorrow.
 *
 * Run: npx tsx scripts/test/token-drift.ts
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PKG_TOKENS = require.resolve("@bitbaum/design-tokens/tokens.css");
const LOKI_TOKENS = join(here, "..", "..", "src", "app", "globals.css");

type Vars = Record<string, string>;

/** `:root { … }` / `.dark { … }` → flat map of custom property → raw value. */
function block(css: string, selector: string): Vars {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no "${selector} {" block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const vars: Vars = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/**
 * Tokens Loki deliberately does not take from the package, and why.
 *
 * Adding a line here is a design decision. Removing one — by making Loki's
 * value match the package's, or by deleting Loki's declaration so the package
 * supplies it — is the migration, one token at a time, each independently
 * reviewable in a browser. That is the intended direction of travel.
 */
const DIVERGENCES: Record<string, string> = {
  // ── Typeface: Loki is Geist, the fleet is Inter + Instrument Serif ────────
  "font-sans": "Loki ships Geist (loaded in layout.tsx); the fleet face is Inter.",
  "font-mono": "Geist Mono, to match font-sans. The fleet uses IBM Plex Mono.",
  "tracking-display": "-0.03em suits Geist's grotesque; -0.015em suits a high-contrast serif.",

  // ── Colour space: Loki is OKLCH, the package ships HSL channel triplets ───
  // This is the single biggest blocker to adoption and the reason the values
  // above drifted unnoticed: `oklch(0.4 0 0)` and `0 0% 40%` LOOK like the same
  // number. Converging means either the package gains an OKLCH build or Loki
  // converts its ramp; both are their own change, with their own visual review.
  "text-primary": "OKLCH ramp; Loki's light-mode text is deliberately higher-contrast.",
  "text-secondary": "OKLCH ramp — 30/255 darker than the fleet's in light mode.",
  "text-tertiary": "OKLCH ramp — 26/255 darker than the fleet's in light mode.",
  "text-muted": "OKLCH ramp — 20/255 darker than the fleet's in light mode.",
  "text-inverted": "OKLCH ramp.",
  "surface-page": "OKLCH ramp. In dark mode Loki's ground is near-black by design.",
  "surface-base": "OKLCH ramp.",
  "surface-raised": "OKLCH ramp.",
  "surface-overlay": "OKLCH ramp.",
  "surface-modal": "OKLCH ramp.",
  "surface-drawer": "OKLCH ramp.",
  "surface-public": "OKLCH ramp; mirrored into src/lib/palette.ts for the widget.",

  // ── Borders: Loki's are translucent, the fleet's are opaque ───────────────
  // Not a value difference — a mechanism difference. A translucent border
  // composes over whatever surface it sits on; an opaque one does not.
  "border-subtle": "Translucent overlay (white @ 8% in dark), not an opaque grey.",
  "border-default": "Translucent overlay.",
  "border-strong": "Translucent overlay.",
  "border-interactive": "Translucent overlay.",

  // ── Accent: Loki's primary accent is achromatic ───────────────────────────
  // The fleet's --accent-primary IS the orange. Loki's is near-black, and the
  // orange lives in --accent-warm, used sparingly on primary CTAs and focus
  // rings. Same --public-accent value; different role in the system.
  "accent-primary": "Achromatic. Loki's warm accent is --accent-warm, used sparingly.",
  "accent-hover": "Achromatic, paired with accent-primary.",
  "accent-muted": "Achromatic.",
  "accent-text": "Achromatic.",
  "on-accent": "OKLCH equivalent of the fleet's 0 0% 8% — same intent, different notation.",

  // ── Status colours: OKLCH, and Loki's subtle variants use % not decimals ──
  "status-positive": "OKLCH.",
  "status-positive-subtle": "OKLCH.",
  "status-warning": "OKLCH.",
  "status-warning-subtle": "OKLCH.",
  "status-negative": "OKLCH.",
  "status-negative-subtle": "OKLCH.",
  "status-neutral": "OKLCH.",

  // ── Layout ────────────────────────────────────────────────────────────────
  "shell-max": "90rem. Loki's shell carries a sidebar the marketing sites do not.",
};

/**
 * Tokens that currently AGREE. Pinned so agreement cannot quietly lapse:
 * if one of these changes on either side, this check fails and someone
 * decides, rather than the two drifting apart in silence again.
 */
const MUST_MATCH = ["public-accent", "public-nav-height", "tracking-caps", "tracking-label"];

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

const pkgCss = readFileSync(PKG_TOKENS, "utf8");
const lokiCss = readFileSync(LOKI_TOKENS, "utf8");
const pkg = block(pkgCss, ":root");
const loki = block(lokiCss, ":root");
const pkgDark = block(pkgCss, ".dark");
const lokiDark = block(lokiCss, ".dark");

const shared = Object.keys(pkg).filter((k) => k in loki);

// 1. Every shared token either matches, or is a declared divergence.
for (const key of shared) {
  const matches = pkg[key] === loki[key];
  const declared = key in DIVERGENCES;
  if (matches && declared) {
    fail(
      `--${key} now MATCHES the package, but is still listed in DIVERGENCES. ` +
        `Delete the line — and consider deleting Loki's declaration so the ` +
        `package supplies it.`,
    );
  }
  if (!matches && !declared) {
    fail(
      `--${key} differs from @bitbaum/design-tokens and nothing says why.\n` +
        `      loki:    ${loki[key]}\n` +
        `      package: ${pkg[key]}\n` +
        `      Either match the package, or add a line to DIVERGENCES saying ` +
        `which product decision this serves.`,
    );
  }
}

// 2. DIVERGENCES may not name a token that no longer exists on both sides.
for (const key of Object.keys(DIVERGENCES)) {
  if (!(key in pkg)) fail(`DIVERGENCES names --${key}, which the package no longer defines.`);
  else if (!(key in loki)) fail(`DIVERGENCES names --${key}, which Loki no longer defines.`);
}

// 3. The pinned agreements.
for (const key of MUST_MATCH) {
  if (!(key in pkg) || !(key in loki)) {
    fail(`--${key} is pinned as matching but is missing from one side.`);
  } else if (pkg[key] !== loki[key]) {
    fail(
      `--${key} was identical to the package and no longer is.\n` +
        `      loki: ${loki[key]}   package: ${pkg[key]}\n` +
        `      This is drift, not a decision. Restore it, or move it to DIVERGENCES.`,
    );
  }
}

// 4. The text ramp must actually descend, in BOTH themes.
//
// This is not about the package at all — it is the bug the comparison above
// exposed. Loki's documented ramp is primary → secondary → tertiary → muted,
// each quieter than the last. In the DARK theme it inverted: muted sat at
// oklch(0.65) while tertiary sat at 0.59, so text marked "muted" rendered
// BRIGHTER than text marked "tertiary" — the two least-important tiers in the
// system, the wrong way round, on the theme that is the default.
const lightness = (raw: string): number | null => {
  const m = /^oklch\(\s*([0-9.]+)/.exec(raw);
  return m ? Number(m[1]) : null;
};
for (const [theme, vars] of [
  ["light", loki],
  ["dark", lokiDark],
] as const) {
  const ramp = ["text-primary", "text-secondary", "text-tertiary", "text-muted"];
  const ls = ramp.map((k) => lightness(vars[k] ?? ""));
  if (ls.some((v) => v === null)) continue; // not OKLCH any more — the migration happened
  // Light theme: the ramp descends in prominence by getting LIGHTER on white.
  // Dark theme: it descends by getting DARKER on black. Either way, each step
  // must move away from the primary, never back towards it.
  const away = theme === "light" ? 1 : -1;
  for (let i = 1; i < ramp.length; i++) {
    const prev = ls[i - 1] as number;
    const cur = ls[i] as number;
    if ((cur - prev) * away <= 0) {
      fail(
        `${theme} text ramp does not descend: --${ramp[i]} (${cur}) is not quieter ` +
          `than --${ramp[i - 1]} (${prev}). The two tiers are the wrong way round.`,
      );
    }
  }
}

// 5. Dark must not silently omit a ramp token the light theme defines.
for (const key of shared) {
  if (key in pkgDark && !(key in lokiDark) && key in lokiDark === false) {
    const themed = /^(surface|text|border|accent|status)-/.test(key);
    if (themed) fail(`--${key} is themed in the package's .dark but not in Loki's.`);
  }
}

if (failures > 0) {
  console.error(`\n✗ token drift: ${failures} problem(s)\n`);
  process.exit(1);
}
console.log(
  `✓ token drift: ${shared.length} shared tokens — ` +
    `${MUST_MATCH.length} pinned identical, ${Object.keys(DIVERGENCES).length} declared divergent, ` +
    `text ramp descends in both themes`,
);
