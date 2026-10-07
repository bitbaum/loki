// The roadmap and the changelog link to each other through `{#id}` tokens
// (bip-kit linkDevelopment). These cases pin what Loki does with them: the
// token never reaches a reader (the fleet profile printed "Events, end to end
// {#events}" before recordText existed), a step links to the changelog days
// that delivered it, and a changelog line names the step it delivered.
// Run: npx tsx scripts/test/record-links.ts
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recordLinks, recordText } from "@/lib/register/record-links";
import { buildJourney } from "@/lib/register/roadmap-journey";
import { RoadmapJourney } from "@/components/public/RoadmapJourney";
import type { MapRoadmapItem } from "@/lib/register/map";

const roadmap: MapRoadmapItem[] = [
  {
    title: "Events, end to end {#events}",
    line: null,
    status: "in progress",
    progress: null,
    targetDate: null,
    milestones: [
      { title: "Pay the crew {#crew-pay}", done: true },
      { title: "Guests without an account", done: false },
    ],
    source: null,
  },
];
const changelog = [
  {
    date: "2026-10-07",
    done: "Pay your crew {#crew-pay}\nRefunds too {#crew-pay}\nA plain fix (#1240)",
  },
  { date: "2026-10-05", done: "The plan {#events}" },
];

assert.equal(recordText("Events, end to end {#events}"), "Events, end to end");
assert.equal(recordText("A plain fix (#1240)"), "A plain fix (#1240)", "PR numbers are not tokens");

const links = recordLinks(roadmap, changelog);
assert.deepEqual(
  links.deliveredIn("Pay the crew {#crew-pay}").map((c) => c.anchor),
  ["change-2026-10-07"],
  "two lines on one day are one link",
);
assert.equal(links.stepAnchor("Pay the crew {#crew-pay}"), "step-crew-pay");
assert.equal(links.stepAnchor("Guests without an account"), null);
assert.deepEqual(links.advances("Pay your crew {#crew-pay}"), [
  {
    goal: "Events, end to end",
    goalAnchor: "goal-events",
    step: "Pay the crew",
    stepAnchor: "step-crew-pay",
    done: true,
  },
]);
assert.equal(links.advances("The plan {#events}")[0].step, null, "a line may cite the goal itself");
assert.deepEqual(links.advances("A plain fix (#1240)"), []);

const html = renderToStaticMarkup(
  createElement(RoadmapJourney, { journey: buildJourney(roadmap), links }),
);
assert.ok(html.includes('id="step-crew-pay"'), "the step is an anchor the changelog links to");
assert.ok(html.includes('href="/changelog#change-2026-10-07"'), "the step links to its day");
assert.ok(!html.includes("{#"), "no token is printed");
console.log("record-links: ok");
