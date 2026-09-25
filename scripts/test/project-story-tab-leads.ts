/**
 * A project's story is the second thing on its page, and it is called Story.
 *
 * The fields on this tab (mission, customers, problem, solution…) brief EVERY
 * agent dispatched to the project. It used to be "Context", tab 4 of 6, behind
 * Feedback and Plan, and the owner looking for where to tell Skif's story
 * could not find it (2026-09-25). The overhaul plan had called for it to lead
 * for three days before anyone moved it; this pins it.
 *
 * Run: npx tsx scripts/test/project-story-tab-leads.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(__dirname, "../../src/components/projects/ProjectWorkspaceView.tsx"),
  "utf8",
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Every tab id in declaration order: plain entries and the conditional spreads.
const ids = [...src.matchAll(/^\s+id: "([a-z]+)",\s*$/gm)].map((m) => m[1]);
assert(ids.length >= 5, `expected the project tabs, found ${JSON.stringify(ids)}`);
assert(ids[0] === "now", `Now opens the page (got ${JSON.stringify(ids)})`);
assert(
  ids[1] === "context",
  `the story tab comes straight after Now, before Feedback and Plan (got ${JSON.stringify(ids)})`,
);

// The label is what a person reads; the id is what links use.
const story = src.slice(src.indexOf('id: "context"'), src.indexOf('id: "context"') + 200);
assert(/label: "Story"/.test(story), 'the tab is labelled "Story", not engineer-speak');

console.log("✓ project story tab leads");
