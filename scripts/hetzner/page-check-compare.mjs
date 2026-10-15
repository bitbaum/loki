// Did this deploy make the live page worse on a phone?
//
// The deploy used to prove only that the site answered 200. An agent's change
// can pass its tests and its checks, deploy green, and still leave the page
// scrolling sideways on a phone, throwing in the browser, showing broken
// images, or with most of its content gone — and on autopilot nobody looks
// (George, 2026-09-26: "can it get better and better on autopilot?"). This
// compares what a headless phone saw BEFORE the deploy with what it sees
// AFTER, and names what got worse. Pure, so scripts/test/page-check-compare.ts
// pins every rule; page-check.mjs does the looking.
//
// Only deltas: a page that already scrolled sideways, or already logged an
// error from someone else's script, is not this change's fault. A change that
// ADDS the problem is. No baseline (first deploy, or the old page was down)
// means nothing to compare — reported, never treated as a regression.

import fs from "node:fs";

/** Content lost beyond this share of the visible text reads as a broken page. */
export const TEXT_LOSS_LIMIT = 0.5;

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number | null,
 *   overflowX: boolean,
 *   errors: number,
 *   brokenImages: number,
 *   textLength: number,
 *   headings: number,
 *   gated?: boolean,
 * }} PageCheck
 */

/**
 * @param {PageCheck | null} before
 * @param {PageCheck} after
 * @returns {{ regressions: string[], notes: string[] }}
 */
export function comparePageChecks(before, after) {
  const regressions = [];
  const notes = [];
  if (!after.ok) {
    // Verify public URL already failed the deploy for a down site; say it here
    // too so the reason is in one place.
    regressions.push(`the page no longer loads (HTTP ${after.status ?? "no answer"})`);
    return { regressions, notes };
  }
  // A site that goes behind an access code (a client preview) or comes out
  // from behind one is not the same page before and after: one side is the
  // code page. Comparing them read a preview gate as "most of the text
  // disappeared" and rolled it back (farmaciadelparco, 2026-10-15). The gate
  // says so in an X-Access-Gate header; across that change there is no
  // baseline. Gated on BOTH sides is the same page and is compared as usual.
  const gateChanged = !!before && !!before.gated !== !!after.gated;
  if (gateChanged) {
    notes.push(
      after.gated
        ? "the site is now behind an access code — the code page is not compared with the open site"
        : "the site came out from behind its access code — nothing earlier to compare with",
    );
  }
  if (!before || !before.ok || gateChanged) {
    if (!gateChanged) notes.push("no earlier version to compare with — checked on its own");
    if (after.overflowX) notes.push("the page scrolls sideways on a phone");
    if (after.errors > 0) notes.push(`${after.errors} script error(s) in the browser`);
    if (after.brokenImages > 0) notes.push(`${after.brokenImages} broken image(s)`);
    return { regressions, notes };
  }
  if (after.overflowX && !before.overflowX) {
    regressions.push("the page now scrolls sideways on a phone");
  }
  if (after.errors > before.errors) {
    regressions.push(`new script errors in the browser (${before.errors} → ${after.errors})`);
  }
  if (after.brokenImages > before.brokenImages) {
    regressions.push(`images broke (${before.brokenImages} → ${after.brokenImages} broken)`);
  }
  if (before.textLength > 0 && after.textLength < before.textLength * (1 - TEXT_LOSS_LIMIT)) {
    regressions.push(
      `most of the page's text disappeared (${before.textLength} → ${after.textLength} characters)`,
    );
  }
  if (before.headings > 0 && after.headings === 0) {
    regressions.push("every heading disappeared");
  }
  return { regressions, notes };
}

// CLI: node page-check-compare.mjs before.json after.json
// Exit 0 = not worse, 2 = worse (the reasons are printed), 1 = unusable input.
if (import.meta.url === `file://${process.argv[1]}`) {
  const read = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const before = read(process.argv[2]);
  const after = read(process.argv[3]);
  if (!after) {
    console.error("page-check: no reading of the page after the deploy");
    process.exit(1);
  }
  const { regressions, notes } = comparePageChecks(before, after);
  for (const n of notes) console.log(`note: ${n}`);
  for (const r of regressions) console.log(`WORSE: ${r}`);
  process.exit(regressions.length ? 2 : 0);
}
