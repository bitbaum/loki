/**
 * Inline tests for the ONE model-JSON reader (lib/ai/model-json.ts).
 *
 * This replaced four hand-rolled copies with three different algorithms. The
 * risk of that consolidation is not "the new one is worse" in the abstract —
 * it is that one caller was relying on a quirk of ITS copy. So every shape
 * below is the shape a real caller feeds it:
 *
 *   feedback/digest-producer → {"themes":[…]}       (Groq, no system prompt)
 *   frontier/digest          → {"headline",…}       (fenced by the fast model)
 *   frontier/propose         → {"proposals":[…]}    (reasoning model, </think>)
 *   orchestration/dod-gate   → {"met":…,"gap":…}    (judge model, </think>)
 *   project-brief            → {"name",…}           (fence-wrapped)
 *   business-plan            → {"plan","actions"}   (fence + prose preamble)
 *
 * Run: npx tsx scripts/test/model-json.ts
 */
import {
  extractJson,
  parseModelJson,
  safeParseModelJson,
  salvageTruncatedObject,
} from "@/lib/ai/model-json";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

// ---------------------------------------------------------------- callers

check("digest-producer: a bare clustering answer parses", () => {
  const raw = `{"themes":[{"title":"Checkout is confusing","itemIndexes":[0,2],"proposedChange":"Label the button","where":"/checkout"}]}`;
  const parsed = parseModelJson<{ themes: { itemIndexes: number[] }[] }>(raw);
  assert(parsed.themes.length === 1, "lost the theme");
  assert(parsed.themes[0]!.itemIndexes.join() === "0,2", "lost the item indexes");
});

check("frontier/digest: a fenced digest parses", () => {
  const raw = [
    "Here you go:",
    "```json",
    `{"headline":"Three papers","intro":"A quiet day.","picks":[{"index":0,"summary":"MoE routing"}]}`,
    "```",
  ].join("\n");
  const parsed = safeParseModelJson<{ headline: string; picks: unknown[] }>(raw);
  assert(parsed !== null, "fenced digest read as unparseable");
  assert(parsed!.headline === "Three papers", `wrong headline: ${parsed!.headline}`);
  assert(parsed!.picks.length === 1, "lost the pick");
});

check("frontier/propose: reasoning before the answer is dropped", () => {
  const raw = `We should weigh these. {"proposals":[{"title":"decoy"}]}</think>{"proposals":[{"title":"Real","rationale":"r","sourceUrls":["https://x"]}]}`;
  const parsed = safeParseModelJson<{ proposals: { title: string }[] }>(raw);
  assert(parsed !== null, "reasoning-prefixed reply read as unparseable");
  assert(
    parsed!.proposals[0]!.title === "Real",
    `read the model's scratchpad as the answer: ${parsed!.proposals[0]!.title}`,
  );
});

check("dod-gate: a verdict whose gap text contains a brace survives", () => {
  // The naive depth counter every copy used closed the object on the `}` inside
  // this string and handed JSON.parse `{"met":false,"gap":"drop the }` .
  const raw = `</think>{"met":false,"gap":"the handoff says 'remove the } from line 4' but line 4 is unchanged"}`;
  const parsed = safeParseModelJson<{ met: boolean; gap: string }>(raw);
  assert(parsed !== null, "verdict with a braced gap read as unparseable");
  assert(parsed!.met === false, "lost the verdict");
  assert(parsed!.gap.includes("line 4 is unchanged"), `gap truncated: ${parsed!.gap}`);
});

check("project-brief: a fenced profile parses and prose after it is ignored", () => {
  const raw = [
    "```json",
    `{"name":"Loki","one_liner":"Fleet control"}`,
    "```",
    "",
    "Hope that helps!",
  ].join("\n");
  const parsed = parseModelJson<{ name: string; one_liner: string }>(raw);
  assert(parsed.name === "Loki", `wrong name: ${parsed.name}`);
  assert(parsed.one_liner === "Fleet control", "lost the one-liner");
});

check("business-plan: a prose preamble before the fence is ignored", () => {
  const raw = [
    "Sure — here is the plan.",
    "```json",
    `{"plan":"## Problem & Solution\\nIt is hard.","actions":[{"title":"Ship","prompt":"do it"}]}`,
    "```",
  ].join("\n");
  const parsed = parseModelJson<{ plan: string; actions: unknown[] }>(raw);
  assert(parsed.plan.startsWith("## Problem"), `lost the markdown: ${parsed.plan.slice(0, 40)}`);
  assert(parsed.actions.length === 1, "lost the action");
});

// --------------------------------------------------------------- the edges

check("a reply cut off mid-object reads as unreadable, not as half an object", () => {
  // propose.ts's salvage path depends on this: a truncated reply must return
  // null so salvageProposals gets its turn, not a plausible-looking slice.
  const raw = `{"proposals":[{"title":"Calendar adapter","rationale":"It is`;
  assert(extractJson(raw) === null, "truncated reply produced a slice");
  assert(safeParseModelJson(raw) === null, "truncated reply parsed");
});

check("a refusal with no JSON at all reads as unreadable", () => {
  assert(extractJson("I cannot help with that.") === null, "found JSON in a refusal");
  assert(safeParseModelJson("I cannot help with that.") === null, "parsed a refusal");
});

check("the JSON is found even when the only fence holds something else", () => {
  const raw = ["Run this first:", "```bash", "pnpm install", "```", `{"met":true,"gap":""}`].join(
    "\n",
  );
  const parsed = safeParseModelJson<{ met: boolean }>(raw);
  assert(parsed !== null && parsed.met === true, "a shell fence hid the JSON");
});

check("a trailing comma is repaired, but only after a strict parse failed", () => {
  const parsed = safeParseModelJson<{ met: boolean; gap: string }>(`{"met":true,"gap":"",}`);
  assert(parsed !== null, "trailing comma read as unparseable");
  assert(parsed!.met === true, "lost the verdict repairing the comma");
  // A comma inside a value must survive the repair untouched.
  const kept = safeParseModelJson<{ gap: string }>(`{"gap":"first, second]",}`);
  assert(kept !== null && kept.gap === "first, second]", `repair ate a real comma: ${kept?.gap}`);
});

check("parseModelJson throws where safeParseModelJson returns null", () => {
  let threw = false;
  try {
    parseModelJson("no json here");
  } catch {
    threw = true;
  }
  assert(threw, "parseModelJson swallowed an unreadable reply");
});

// ------------------------------------------------------ truncation salvage

check("salvage: a profile cut off mid-value keeps every finished member", () => {
  const raw = `{"mission":"Keep sublets legal","stack":"Next.js, Postgres","problem":{"a":"b, c"},"vision":"Every Zurich subl`;
  const got = salvageTruncatedObject<Record<string, unknown>>(raw);
  assert(got !== null, "salvaged nothing");
  assert(got!.mission === "Keep sublets legal", "lost mission");
  assert(got!.stack === "Next.js, Postgres", "a comma inside a value moved the cut");
  assert(typeof got!.problem === "object", "lost the nested member");
  assert(!("vision" in got!), "kept a half-written value");
});

check("salvage: a fenced, reasoning-prefixed truncation still reads", () => {
  const raw = '<think>{ignore}</think>```json\n{"a":"x","b":"y","c":"tr';
  const got = salvageTruncatedObject<Record<string, string>>(raw);
  assert(
    got?.a === "x" && got?.b === "y" && !("c" in got),
    `wrong salvage: ${JSON.stringify(got)}`,
  );
});

check("salvage: nothing complete means null, never an empty object", () => {
  assert(salvageTruncatedObject(`{"mission":"half`) === null, "invented an answer");
  assert(salvageTruncatedObject("no json") === null, "read prose as JSON");
});

check("salvage is opt-in: safeParseModelJson still rejects truncation", () => {
  assert(safeParseModelJson(`{"a":"x","b":"tr`) === null, "strict reader started salvaging");
});

console.log(`\n✓ model-json tests passed (${passed} assertions)`);
