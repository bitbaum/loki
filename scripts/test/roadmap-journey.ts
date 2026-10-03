// The roadmap as a journey (src/lib/register/roadmap-journey.ts).
// Run: npx tsx scripts/test/roadmap-journey.ts
import { buildJourney, phaseOf, toStop } from "@/lib/register/roadmap-journey";
import type { MapRoadmapItem } from "@/lib/register/map";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const item = (
  title: string,
  status: string | null,
  steps: [string, boolean][] = [],
): MapRoadmapItem => ({
  title,
  line: null,
  status,
  progress: null,
  targetDate: null,
  milestones: steps.map(([t, done]) => ({ title: t, done })),
  source: null,
});

ok(phaseOf("in progress") === "now" && phaseOf("done") === "shipped", "status → phase");
ok(phaseOf(null) === "next" && phaseOf("something new") === "next", "unknown status reads as next");

const s = toStop(
  item("Chat", "in progress", [
    ["a", true],
    ["b", false],
    ["c", false],
  ]),
);
ok(s.done === 1 && s.total === 3 && s.percent === 33, "percent from ticked steps only");
ok(s.nextStep === "b", "next step is the first unticked one");
ok(toStop(item("x", "planned")).percent === null, "no steps → no invented percentage");
ok(toStop(item("x", "done")).percent === 100, "shipped is 100");

const j = buildJourney([
  item("A", "done"),
  item("B", "done"),
  item("C", "in progress", [
    ["1", true],
    ["2", false],
  ]),
  item("D", "planned", [["1", false]]),
  item("E", "later"),
]);
ok(
  j.shipped.length === 2 && j.now.length === 1 && j.next.length === 1 && j.later.length === 1,
  "grouped by phase",
);
ok(j.stepsDone === 1 && j.stepsTotal === 3, "steps counted on the road, not on shipped items");
ok(j.percentShipped === 40, "headline: shipped over all items");
ok(buildJourney([]).percentShipped === 0, "empty record is 0, not NaN");

console.log(`${pass}/${pass + fail} roadmap-journey cases passed`);
if (fail > 0) process.exit(1);
