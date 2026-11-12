// Home's status card speaks only when it has news (control/home-parts).
import assert from "node:assert/strict";
import { heroHasNewsFor } from "../../src/components/control/home-parts";

const known = { countsKnown: true };
// Failures with nobody waiting and no rows naming them: the card says so.
assert.equal(heroHasNewsFor(known, "failing", 0, 0), true);
// "Done" already lists the failed runs with "Ask it to finish": the card
// repeating them was the same fact twice, with two fixes (2026-11-12).
assert.equal(heroHasNewsFor(known, "failing", 0, 2), false);
assert.equal(heroHasNewsFor(known, "failing", 1, 0), false);
// A stall and an unknown fleet are always news.
assert.equal(heroHasNewsFor(known, "stalled", 0, 2), true);
assert.equal(heroHasNewsFor({ countsKnown: false }, "idle", 0, 0), true);
assert.equal(heroHasNewsFor(known, "building", 0, 0), false);
console.log("✓ hero-has-news");
