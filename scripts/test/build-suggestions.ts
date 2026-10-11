// The /loki suggestion row is ranked from a person's own records. Pinned here:
// report fixes outrank everything; project work dispatches (carries `project`)
// while new builds open the create flow (carries `href`); visitor-written text
// never reaches a prompt; one busy project cannot fill the row; demand that
// matches what the person builds outranks demand that does not; a brand-new
// account gets starters instead of an empty row; refresh rotates the window.
// Run: npx tsx scripts/test/build-suggestions.ts
import assert from "node:assert/strict";
import {
  rankBuildSuggestions,
  newProjectHref,
  type SuggestionInputs,
  type SuggestionProject,
} from "@/lib/build-suggestions/rank";
import { BUILD_STARTERS } from "@/config/build-starters";
import { planRetrieval } from "@/lib/agent/plan";
import { parseCreateProjectRequest } from "@/lib/loki-fleet-commands";

function project(over: Partial<SuggestionProject> & { name: string }): SuggestionProject {
  return {
    description: null,
    stack: null,
    liveUrl: "https://example.org",
    runnable: true,
    nextStep: null,
    nextStepDate: null,
    ...over,
  };
}

const empty: SuggestionInputs = {
  projects: [],
  openFeedback: {},
  stuckGoals: [],
  commitmentsDue: [],
  captures: [],
  demand: [],
};

// ---- a brand-new account gets starters, each opening the create flow ----
{
  const { suggestions } = rankBuildSuggestions(empty);
  assert.equal(suggestions.length, BUILD_STARTERS.length);
  for (const s of suggestions) {
    assert.equal(s.kind, "starter");
    assert.ok(s.href?.startsWith("/projects?new=1&"), "a starter opens the create dialog");
    assert.equal(s.prompt, null);
  }
}

// ---- report fixes lead, and dispatch into their project ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [
      project({ name: "sink", nextStep: "add search" }),
      project({ name: "heidi", liveUrl: null }),
    ],
    openFeedback: { sink: 3 },
  });
  assert.equal(suggestions[0].kind, "fix");
  assert.equal(suggestions[0].project, "sink");
  assert.match(suggestions[0].label, /3 reports/);
  assert.ok(suggestions.some((s) => s.kind === "ship" && s.project === "heidi"));
  assert.ok(suggestions.some((s) => s.kind === "continue" && /add search/.test(s.prompt ?? "")));
  assert.ok(
    !suggestions.some((s) => s.kind === "starter"),
    "starters are only for an account with nothing to work on",
  );
  for (const s of suggestions) {
    assert.ok(s.why.length > 0, `${s.id} names the fact it came from`);
    assert.ok(s.prompt || s.href, `${s.id} leads somewhere`);
  }
}

// ---- a project without code cannot be dispatched to ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [project({ name: "idea-only", runnable: false, liveUrl: null })],
    openFeedback: { "idea-only": 2 },
  });
  assert.ok(!suggestions.some((s) => s.project === "idea-only"));
}

// ---- one busy project cannot fill the row ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [
      project({ name: "busy", liveUrl: null, nextStep: "x" }),
      project({ name: "quiet", liveUrl: null }),
    ],
    openFeedback: { busy: 9 },
  });
  assert.equal(
    suggestions.slice(0, 3).filter((s) => s.project === "busy").length,
    2,
    "variety before repetition: the quiet project gets a seat before a third busy one",
  );
}

// ---- relevant demand outranks unrelated demand ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [project({ name: "bakery-site", description: "website for a bakery in Zurich" })],
    demand: [
      { id: "a", title: "Tax advice", text: "need an accountant", url: "https://oc/a" },
      { id: "b", title: "Bakery website", text: "our bakery needs a website", url: "https://oc/b" },
    ],
  });
  const demand = suggestions.filter((s) => s.kind === "demand");
  assert.equal(demand[0].id, "demand:b");
  assert.match(demand[0].prompt ?? "", /external text/, "external text is labelled as such");
}

// ---- a sticky note that reads like a build becomes a new project; a reminder does not ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [project({ name: "p" })],
    captures: [
      { body: "app that tracks my plants", ageDays: 2 },
      { body: "call mum", ageDays: 1 },
      { body: "build a recipe site", ageDays: 400 },
    ],
  });
  const ideas = suggestions.filter((s) => s.kind === "idea");
  assert.equal(ideas.length, 1);
  assert.ok(ideas[0].href?.includes("description=app+that+tracks+my+plants"));
}

// ---- refresh rotates the window through everything that qualified ----
{
  const inputs: SuggestionInputs = {
    ...empty,
    projects: Array.from({ length: 6 }, (_, i) =>
      project({ name: `p${i}`, liveUrl: null, nextStep: "next" }),
    ),
  };
  const first = rankBuildSuggestions(inputs, { limit: 4, offset: 0 });
  const second = rankBuildSuggestions(inputs, { limit: 4, offset: 1 });
  assert.equal(first.total, 12);
  assert.notDeepEqual(
    first.suggestions.map((s) => s.id),
    second.suggestions.map((s) => s.id),
  );
}

// ---- labels fit a phone row ----
{
  const { suggestions } = rankBuildSuggestions({
    ...empty,
    projects: [project({ name: "p", nextStep: "a".repeat(300) })],
  });
  for (const s of suggestions) assert.ok(s.label.length <= 44, s.label);
}

assert.equal(
  newProjectHref("x", "y z"),
  "/projects?new=1&name=x&description=y+z",
  "the create dialog's deep link",
);

// ---- asking for direction leads with the ranked suggestions; asking about a
// visitor's "suggestion" (the feedback column) does not ----
for (const q of [
  "what should I build next",
  "any ideas?",
  "what should we do next",
  "what do you suggest",
]) {
  assert.equal(planRetrieval(q).sources[0], "builds", q);
}
for (const q of ["what was the latest suggestion from visitors on sink", "what's next today"]) {
  assert.notEqual(planRetrieval(q).sources[0], "builds", q);
}

// ---- the line Loki hands back for a new build carries its scope to the agent ----
{
  const req = parseCreateProjectRequest(
    "create project plant-log and build it: a page that logs when I water each plant",
  );
  assert.equal(req?.name, "plant-log");
  assert.equal(req?.dispatchAfter, true);
  assert.equal(req?.task, "a page that logs when I water each plant");
  assert.equal(parseCreateProjectRequest("create project plant-log and build it")?.task, null);
  assert.equal(parseCreateProjectRequest("create project plant-log")?.dispatchAfter, false);
}

console.log("build-suggestions: ok");
