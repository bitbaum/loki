// The widget's Chat mode answers strangers on other people's sites, from the
// public fleet map. What it must never get wrong is pinned here: it routes to
// real URLs from the map (never ones the model typed), it never offers a
// retired project, it never calls a pilot owner a client, and when no model can
// answer it STILL routes by the visitor's words instead of saying "try later".
// Run: npx tsx scripts/test/widget-chat-concierge.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FleetMap, FleetMapEntry } from "@/lib/register/map";
import {
  EXPERIMENT_NAME_RE,
  FACTS_BUDGET_CHARS,
  STUDIO_DOORS,
  displayName,
  stem,
  splitSpeakers,
  conciergePrompt,
  conciergeSystemPrompt,
  fallbackAnswer,
  linksForReply,
  renderConciergeFacts,
  stageWord,
} from "@/lib/widget-chat/concierge";

const BASE = "https://loki.example";

function entry(p: Partial<FleetMapEntry> & Pick<FleetMapEntry, "slug" | "name">): FleetMapEntry {
  return {
    what: null,
    stack: null,
    layer: "product",
    status: "live",
    owner: "bitbaum",
    since: null,
    urls: { live: null, repo: null, orangecat: null, solon: null },
    identity: { problem: null, solution: null, mission: null, vision: null },
    roadmap: [],
    changelog: [],
    next: null,
    now: { openRuns: 0, lastRun: null, lastLog: null },
    ...p,
  };
}

const map: FleetMap = {
  generatedAt: "2026-09-24T00:00:00Z",
  thesis: "One person plus Bitcoin …",
  pillars: [{ slug: "orangecat", layer: "economic", role: "Move value." }],
  summary: { projects: 4, live: 2, clients: 1, inFlight: 0 },
  projects: [
    entry({
      slug: "heidi",
      name: "Heidi",
      what: "Learn to understand and text in Zurich Swiss German.",
      identity: {
        problem: "Swiss people switch to English.",
        solution: "Calibrated exposure.",
        mission: null,
        vision: null,
      },
      urls: { live: "https://heidi.example", repo: null, orangecat: null, solon: null },
    }),
    entry({
      slug: "dogfood-bridge-test-2026-09-06b",
      name: "Dogfood Bridge Test",
      status: "not live",
      what: "a test",
      identity: { problem: "p", solution: "s", mission: null, vision: null },
    }),
    entry({ slug: "unwritten", name: "Unwritten", status: "not live", what: "Just a name." }),
    entry({
      slug: "draftapp",
      name: "Draftapp",
      status: "not live",
      what: "A draft.",
      identity: {
        problem: "Drafts get lost.",
        solution: "Keep them.",
        mission: null,
        vision: null,
      },
    }),
    entry({
      slug: "orangecat",
      name: "orangecat",
      what: "Your AI economic agent; Bitcoin settles.",
      urls: { live: "https://orangecat.example", repo: null, orangecat: null, solon: null },
    }),
    entry({
      slug: "aoz-housing",
      name: "AOZ Housing",
      what: "Housing search for refugees.",
      owner: "aoz",
      status: "demo",
    }),
    entry({
      slug: "oldthing",
      name: "Oldthing",
      what: "Swiss German flashcards.",
      status: "retired",
      urls: { live: "https://old.example", repo: null, orangecat: null, solon: null },
    }),
  ],
};

// Stage words: beta, never "live"; a pilot, never a client.
assert.equal(stageWord({ status: "live", owner: "bitbaum" }), "running, in beta");
assert.match(stageWord({ status: "demo", owner: "aoz" }), /pilot built with aoz/);

const facts = renderConciergeFacts(map);
assert.ok(!/client/i.test(facts), "facts never say client");
assert.ok(!facts.includes("Oldthing"), "retired projects are not offered");
assert.ok(!facts.includes("Dogfood"), "a throwaway run is not offered");
assert.ok(
  !facts.includes("Unwritten"),
  "a project that is not running and has no written problem is not offered",
);
assert.ok(
  facts.includes("Draftapp"),
  "a project that is not running but has a written profile is offered",
);
assert.ok(!facts.includes("One person"), "the map thesis (solo framing) is not fed to the model");
assert.ok(
  facts.includes("Problem: Swiss people switch to English."),
  "problems are included so needs can be matched",
);
assert.ok(
  !/https?:\/\//.test(facts),
  "no URLs in the facts: links are attached from the map, not typed by the model",
);
assert.ok(
  facts.includes("* OrangeCat — "),
  "pillars carry their titles, not the slug the register fell back to",
);
for (const d of STUDIO_DOORS) assert.ok(facts.includes(d.label), `studio door ${d.label} is known`);
assert.equal(displayName({ slug: "orangecat", name: "orangecat" }), "OrangeCat");
assert.equal(displayName({ slug: "heidi", name: "Heidi" }), "Heidi");

// The budget holds however large the map grows.
const huge: FleetMap = {
  ...map,
  projects: Array.from({ length: 200 }, (_, i) =>
    entry({
      slug: `p${i}`,
      name: `Project ${i}`,
      what: "x".repeat(300),
      identity: { problem: "y".repeat(300), solution: "z", mission: null, vision: null },
    }),
  ),
};
assert.ok(renderConciergeFacts(huge).length <= FACTS_BUDGET_CHARS);

// Same throwaway pattern as the register's litter gate — two copies, kept equal here.
const here = dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(join(here, "..", "ci", "check-no-experiment-litter.sh"), "utf8");
const shellRe = gate.match(/^EXPERIMENT_RE='(.+)'$/m)?.[1];
assert.equal(
  EXPERIMENT_NAME_RE.source,
  shellRe,
  "EXPERIMENT_NAME_RE drifted from check-no-experiment-litter.sh",
);
for (const slug of ["dogfood-bridge-test-2026-09-06b", "factory-sep11-0040", "probe-x"]) {
  assert.ok(EXPERIMENT_NAME_RE.test(slug), slug);
}
for (const slug of ["heidi", "kivvi", "open-accounting"])
  assert.ok(!EXPERIMENT_NAME_RE.test(slug), slug);

const system = conciergeSystemPrompt(facts, { url: "https://bitbaum.example/", title: "bitbaum" });
assert.match(system, /'Cat:' or 'Loki:'/, "each agent speaks as itself, labelled");
assert.ok(
  !/You are the Cat and Loki/.test(system),
  "no joint persona: it is a chat the two live in",
);
assert.match(system, /Do not write URLs yourself/);
assert.match(system, /https:\/\/bitbaum\.example\//);

const prompt = conciergePrompt(
  Array.from(
    { length: 20 },
    (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` }) as const,
  ),
  "hello",
);
assert.ok(
  !prompt.includes("turn 7") && prompt.includes("turn 8"),
  "only the last 12 turns are sent",
);
assert.ok(
  prompt.endsWith("Visitor: hello\n"),
  'the agents label their own lines; no joint "You:" speaker',
);

// Links come from the map, in the order the reply names them, deduped.
const links = linksForReply(
  "Try Heidi first. OrangeCat can pay you; heidi again. Or join the waitlist.",
  map,
  BASE,
);
assert.deepEqual(
  links.map((l) => l.url),
  [
    "https://heidi.example",
    "https://orangecat.example",
    "https://bitbaum.orangecat.ch/hire/#waitlist",
  ],
);
assert.deepEqual(
  linksForReply("Oldthing was nice", map, BASE),
  [],
  "a retired project gets no link",
);
assert.deepEqual(
  linksForReply("Visit https://evil.example now", map, BASE),
  [],
  "a URL in the reply is not a link",
);
// A name inside another word is not a mention.
assert.deepEqual(linksForReply("heidiland", map, BASE), []);

// The fallback still routes.
const fb = fallbackAnswer("I want to learn Swiss German", map, BASE);
assert.equal(fb.links[0]?.url, "https://heidi.example");
assert.ok(!fb.links.some((l) => l.url === "https://old.example"));
const none = fallbackAnswer("zzzz qqqq", map, BASE);
assert.equal(none.links.length, 2);
assert.ok(none.links.some((l) => l.url.endsWith("/work/")));

// Suffixes do not hide a match: "voting" is "vote", "transparently" is "transparent".
assert.equal(stem("voting"), stem("vote"));
assert.equal(stem("transparently"), stem("transparent"));
assert.equal(stem("decisions"), stem("decision"));

// Who said what: labels open messages, continuation lines stay with them, and
// text before any label is kept unattributed rather than dropped or guessed.
assert.deepEqual(
  splitSpeakers("Cat: I can help you earn.\nTry OrangeCat.\n\nLoki: I can build it."),
  [
    { speaker: "cat", text: "I can help you earn.\nTry OrangeCat." },
    { speaker: "loki", text: "I can build it." },
  ],
);
assert.deepEqual(splitSpeakers("**Loki:** Heidi fits."), [
  { speaker: "loki", text: "Heidi fits." },
]);
assert.deepEqual(splitSpeakers("Heidi fits.\nLoki: really."), [
  { speaker: null, text: "Heidi fits." },
  { speaker: "loki", text: "really." },
]);
assert.deepEqual(
  splitSpeakers("Catalogue: see all"),
  [{ speaker: null, text: "Catalogue: see all" }],
  "'Catalogue:' is not the Cat",
);
assert.ok(!fallbackAnswer("x", map, BASE).reply.includes("assistant"));

console.log("widget-chat-concierge: ok");
