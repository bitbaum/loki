/**
 * The widget's spiral is the logo's spiral: generated from
 * src/config/brand-mark.ts, never redrawn. Fails when the brand mark changed
 * and widget/brand-mark.generated.ts was not regenerated.
 *
 * Run: npx tsx scripts/test/widget-brand-mark.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../generate-widget-brand-mark";

const committed = readFileSync(join(process.cwd(), "widget/brand-mark.generated.ts"), "utf8");
assert.equal(
  committed,
  generate(),
  "widget/brand-mark.generated.ts is stale — npx tsx scripts/generate-widget-brand-mark.ts",
);
console.log("✓ widget brand mark matches the logo SSOT");
