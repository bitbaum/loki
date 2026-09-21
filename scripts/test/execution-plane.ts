// Loki is the EXECUTION plane, and this gate is why that word has to stay.
//
// It read "engineering" until 2026-09-20. That named Loki's deepest capability
// and not the product: Today, People, Crew, Money, Goals and Habits ship here
// too, and OrangeCat — whose dashboard is economic entities — has no surface to
// receive them. Under the narrow label those surfaces read as scope creep, and
// the conclusion drawn from it, twice in one session, was "move the life-ops
// half to the Cat". There is nowhere to move it to.
//
// A rename is only worth making if it cannot quietly roll back, so this pins
// the places it actually lives: the fleet map's layer, the role sentence an
// agent reads, the two assistant prompts a user talks to — and, since
// 2026-09-21, the PUBLIC copy.
//
// The public half was the gap. The 2026-09-20 rename corrected everything an
// agent or a maintainer reads and left /philosophy telling strangers exactly
// the story it had just retired: "infrastructure for builders running many
// agents at once across multiple projects — not a friendly chat assistant".
// The correction reached the machines and not the humans, which is the wrong
// way round. The one-word
// role itself is SSOT in orangecat/src/config/ecosystem.ts → ECOSYSTEM_PILLARS;
// this repo is downstream of that and must not drift from it.
//
// Run: npx tsx scripts/test/execution-plane.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PILLARS } from "@/lib/register/map";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

const loki = PILLARS.find((p) => p.slug === "loki");

check("the public copy does not sell the narrow product back", () => {
  // Not a banned-phrase list: the point is that the PRINCIPLES page must not
  // define Loki as agent infrastructure ALONE, because Today, People, Crew,
  // Money, Goals and Habits ship here and have nowhere else to go.
  // Comments are not copy. Without this the check fails on the very comment
  // recording what was retired — a file has to be able to explain itself, and
  // a detector that cannot tell code from commentary invents work.
  const copy = read("src/config/marketing-content.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(
    !/not a friendly chat assistant/i.test(copy),
    "the retired framing is back in the public copy",
  );
  assert.ok(
    !/Loki is infrastructure for builders running many agents/i.test(copy),
    "the public copy defines Loki as agent infrastructure and nothing else",
  );
});

check("Loki sits on the execution layer of the fleet map", () => {
  assert.ok(loki, "PILLARS must still contain loki");
  assert.equal(loki.layer, "execution");
});

check("no pillar is left on a layer named after what it can do", () => {
  // "capability" was the old layer name, and it described an ability rather
  // than a purpose — which is the same mistake as "engineering", one level up.
  assert.ok(
    !PILLARS.some((p) => (p.layer as string) === "capability"),
    "the capability layer was renamed to execution",
  );
});

check("the role an agent reads names more than the code Loki writes", () => {
  const role = (loki?.role ?? "").toLowerCase();
  // If these stop appearing, the fleet context describes a build tool, and the
  // "that half belongs on OrangeCat" proposal has its premise back.
  for (const surface of ["agents", "people", "commitments", "spending"]) {
    assert.ok(role.includes(surface), `pillar role should name ${surface}: ${loki?.role}`);
  }
});

// Both assistant entry points. A user asking "what is this for?" gets one of
// these two sentences, so they are the copy that matters most.
for (const [file, label] of [
  ["src/lib/loki-core.ts", "the chat assistant"],
  ["src/lib/agent/loop.ts", "the tool-calling agent"],
] as const) {
  check(`${label} introduces Loki as the operator's execution layer`, () => {
    const src = read(file);
    assert.match(src, /execution layer/, `${file} should say what layer Loki is`);
    for (const surface of ["people", "commitments", "spending"]) {
      assert.ok(
        new RegExp(`${surface}`).test(src),
        `${file} should name ${surface} alongside projects and agents`,
      );
    }
  });
}

check("AGENTS.md states the plane and the axis the three products split on", () => {
  const doc = read("AGENTS.md");
  assert.match(doc, /Loki is the \*\*execution plane\*\* of an entity/);
  // The axis is audience, not subject matter. Without it the reader has no way
  // to decide where a new surface belongs, which is how the wrong answer got
  // reached in the first place.
  assert.match(doc, /public by\s+design/);
  assert.match(doc, /private by default/);
  assert.match(doc, /shared with its members/);
});

console.log(`\n${passed} passed${process.exitCode ? " (with failures)" : ""}`);
