/**
 * The widget's chat agents: the UI list (widget/agents.ts) and the server
 * personas (src/config/widget-agents.ts) must name the same agents, and the
 * helpers that shape what leaves the page must respect the server's caps.
 *
 * Run: npx tsx scripts/test/widget-agents.ts
 */
import assert from "node:assert/strict";
import {
  CHAT_MAX_TURN_CHARS,
  CHAT_MAX_TURNS,
  clampHistory,
  conversationBrief,
  defaultWidgetAgent,
  handoffHref,
  isWidgetAgentId,
  WIDGET_AGENT_IDS,
  WIDGET_AGENTS,
  type ChatTurn,
} from "../../widget/agents";
import { WIDGET_AGENT_PERSONAS, WIDGET_AGENT_SERVER_IDS } from "../../src/config/widget-agents";

assert.deepEqual(
  [...WIDGET_AGENT_IDS],
  [...WIDGET_AGENT_SERVER_IDS],
  "UI and server agent ids match",
);
assert.equal(defaultWidgetAgent(), "loki");
assert.ok(isWidgetAgentId("cat"));
assert.ok(!isWidgetAgentId("admin"));

// Exactly one agent builds; Cat and Solon hand off, and only Solon pre-fills.
assert.equal(WIDGET_AGENTS.loki.action.kind, "build");
assert.deepEqual(
  WIDGET_AGENT_IDS.filter((id) => WIDGET_AGENTS[id].action.kind === "build"),
  ["loki"],
);
assert.equal(WIDGET_AGENTS.cat.action.kind === "link" && WIDGET_AGENTS.cat.action.prefill, false);
assert.equal(
  WIDGET_AGENTS.solon.action.kind === "link" && WIDGET_AGENTS.solon.action.prefill,
  true,
);
for (const id of WIDGET_AGENT_IDS)
  assert.ok(WIDGET_AGENTS[id].starters.length > 0, `${id} has starters`);

// Personas carry their boundaries.
const loki = WIDGET_AGENT_PERSONAS.loki({ projectName: "Heidi", pageTitle: "Chat" });
assert.match(loki, /Heidi/);
assert.match(loki, /Send to Loki to build/);
const cat = WIDGET_AGENT_PERSONAS.cat({ projectName: "Heidi" });
assert.match(cat, /cannot send, receive or hold money/);
assert.doesNotMatch(cat, /donation(?!")/i);
const solon = WIDGET_AGENT_PERSONAS.solon({ projectName: "Heidi" });
assert.match(solon, /cannot open a vote, cast one/);
assert.match(solon, /humans only/);

// Solon handoff: the conversation lands in /propose's title + body.
const talk: ChatTurn[] = [
  { role: "user", content: "Should supporters vote on the roadmap?\nI think so." },
  { role: "assistant", content: "That is an OPERATIONS proposal." },
];
const href = new URL(handoffHref("https://solon.example/propose", true, talk, "Solon"));
assert.equal(href.searchParams.get("title"), "Should supporters vote on the roadmap?");
assert.match(href.searchParams.get("body") ?? "", /Solon's reading:\nThat is an OPERATIONS/);
assert.ok(href.toString().length < 8000);
assert.equal(handoffHref("https://cat.example/", false, talk, "Cat"), "https://cat.example/");

// History: newest turns kept, each clamped.
const long: ChatTurn[] = Array.from({ length: CHAT_MAX_TURNS + 5 }, (_, i) => ({
  role: i % 2 ? "assistant" : "user",
  content: `${i}:${"x".repeat(CHAT_MAX_TURN_CHARS + 10)}`,
}));
const clamped = clampHistory(long);
assert.equal(clamped.length, CHAT_MAX_TURNS);
assert.ok(clamped[0]!.content.startsWith("5:"));
assert.ok(clamped.every((t) => t.content.length <= CHAT_MAX_TURN_CHARS));

// Brief: the visitor's words first, Loki's reading last, within the ingest cap.
const brief = conversationBrief(
  [
    { role: "user", content: "The menu covers the text on my phone" },
    { role: "assistant", content: "Which page?" },
    { role: "user", content: "The chat page" },
    { role: "assistant", content: "Make the header menu close after a tap on mobile." },
  ],
  2000,
);
assert.ok(brief.indexOf("menu covers") < brief.indexOf("Loki's reading"));
assert.match(brief, /close after a tap/);
assert.doesNotMatch(brief, /Which page\?/);
assert.ok(conversationBrief([{ role: "user", content: "y".repeat(5000) }], 2000).length <= 2000);

console.log("widget-agents: ok");
