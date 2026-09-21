/**
 * The whitepaper's tier descriptions must agree with the plans SSOT.
 *
 * content/whitepaper.md is dated prose that nothing recomputes, so it drifts
 * silently while the code moves. Checked on 2026-09-21, version 0.3 (published
 * 2026-08-12) against src/lib/plan.ts:
 *
 *   whitepaper: "Pro — for power builders running 10+ active projects"
 *   PLAN_LIMITS: pro = Infinity, and /pricing renders "Unlimited projects"
 *
 *   whitepaper: "Team — for small groups (up to 10 people) sharing a fleet"
 *   codebase:   no seat limit exists anywhere
 *
 * A reader comparing the whitepaper with the pricing page got two different
 * answers about the same tier, and a limit that is not enforced is a promise
 * to somebody.
 *
 * This pins the checkable half — the project ceilings — against PLAN_LIMITS.
 * Prose about who a tier is FOR stays prose.
 *
 * Run: npx tsx scripts/test/whitepaper-matches-plans.ts
 */
import { readFileSync } from "node:fs";
import { PLAN_LIMITS } from "@/lib/plan";

const PAPER = new URL("../../content/whitepaper.md", import.meta.url).pathname;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const paper = readFileSync(PAPER, "utf8");
const tierLine = (name: string) =>
  new RegExp(`\\*\\*${name}\\*\\*[^\\n]*`, "i").exec(paper)?.[0] ?? "";

console.log("whitepaper-matches-plans:");

check("every tier in the SSOT is described", () => {
  for (const plan of Object.keys(PLAN_LIMITS.projects)) {
    const name = plan[0].toUpperCase() + plan.slice(1);
    assert(tierLine(name).length > 0, `the whitepaper never describes ${name}`);
  }
});

check("a finite project ceiling is stated as the SSOT's number", () => {
  // Personal is 5. If that changes, the sentence has to change with it.
  const personal = PLAN_LIMITS.projects.personal;
  assert(Number.isFinite(personal), "personal should have a finite ceiling");
  assert(
    new RegExp(`up to ${personal} projects`, "i").test(tierLine("Personal")),
    `Personal says: ${tierLine("Personal").slice(0, 90)}`,
  );
});

check("an unlimited tier never quotes a number of projects", () => {
  // THE BUG, pinned. "10+ active projects" reads as a threshold on a tier the
  // pricing page calls Unlimited — and "10+" is also just wrong for Infinity.
  for (const [plan, limit] of Object.entries(PLAN_LIMITS.projects)) {
    if (Number.isFinite(limit)) continue;
    const name = plan[0].toUpperCase() + plan.slice(1);
    const line = tierLine(name);
    assert(
      !/\d+\+?\s*(?:active\s*)?projects/i.test(line),
      `${name} is unlimited but its line quotes a project count: ${line.slice(0, 90)}`,
    );
  }
});

check("no tier claims a seat limit the code does not enforce", () => {
  // There is no seat/member limit anywhere in the codebase. Printing one is a
  // promise to somebody about what they may not do.
  const seatClaims = Object.keys(PLAN_LIMITS.projects)
    .map((p) => tierLine(p[0].toUpperCase() + p.slice(1)))
    .filter((l) => /up to \d+\s*(?:people|members|seats|users)/i.test(l));
  assert(seatClaims.length === 0, `unenforced seat limit: ${seatClaims.join(" | ")}`);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
