/**
 * On a Control project card, the composer comes before anything that polls.
 *
 * Banners, session summaries, the previous run and the "Launch agent" row
 * appear and disappear as live state arrives. Stacked above the composer, each
 * one shifted Send under the pointer: twice on 2026-09-25 a click on Skif's
 * Send landed on nothing and the brief stayed in the box.
 *
 * Run: npx tsx scripts/test/control-composer-leads-card.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const src = readFileSync(join(__dirname, "../../src/components/control/ProjectCard.tsx"), "utf8");
// The non-profile branch of the card, where the composer lives.
const body = src.slice(src.indexOf(") : (\n        <>"));
const at = (needle: string) => {
  const i = body.indexOf(needle);
  assert(i >= 0, `expected ${needle} in ProjectCard's card body`);
  return i;
};

const composer = at("<IntentButtonPanel");
for (const volatile of [
  "<ProjectBanners",
  "<SessionSummary",
  "<LatestOrchestrationPanel",
  "Launch agent",
]) {
  assert(
    composer < at(volatile),
    `${volatile} renders above the composer — it will shift Send as live state polls in`,
  );
}

console.log("✓ control composer leads the card");
