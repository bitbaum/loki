// The widget's Ask mode advises a site's owner about the site someone built for
// them. What it must never get wrong is pinned here: a model that ignores the
// format still yields an answer (never an error); "leave it alone" yields no
// change to request; the prompt tells the model it sees an outline, not pixels,
// and to recommend leaving things alone when that is true; and the widget's
// caps match the route's, so a long page is clamped rather than rejected.
// Run: npx tsx scripts/test/widget-advise.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADVISE_MAX_CHANGES,
  ADVISE_MAX_HISTORY,
  ADVISE_MAX_QUESTION,
  ADVISE_MAX_SNAPSHOT,
  advisePrompt,
  adviseSystemPrompt,
  splitAdvice,
} from "@/lib/widget-advise/advisor";
import {
  ADVISE_MAX_HISTORY as WIDGET_MAX_HISTORY,
  ADVISE_MAX_QUESTION as WIDGET_MAX_QUESTION,
} from "../../widget/advise";
import { SNAPSHOT_MAX_CHARS } from "../../widget/page-snapshot";

// ---- splitting the answer from the changes ----
{
  const { answer, changes } = splitAdvice(
    "The headline is clear.\n\nCHANGES:\n- Change the button text to 'Book'\n* Add opening hours to the footer\n1. Shorten the intro",
  );
  assert.equal(answer, "The headline is clear.");
  assert.deepEqual(changes, [
    "Change the button text to 'Book'",
    "Add opening hours to the footer",
    "Shorten the intro",
  ]);
}
{
  // Markdown-bolded marker, as models like to write it.
  const { answer, changes } = splitAdvice("Fine as is.\n**CHANGES:** none");
  assert.equal(answer, "Fine as is.");
  assert.deepEqual(changes, [], "'none' is no change to request");
}
{
  const { answer, changes } = splitAdvice("Leave it — visitors expect the menu there.");
  assert.equal(answer, "Leave it — visitors expect the menu there.");
  assert.deepEqual(changes, [], "no marker: the whole text is the answer");
}
{
  const many = Array.from({ length: 9 }, (_, i) => `- change ${i}`).join("\n");
  assert.equal(splitAdvice(`x\nCHANGES:\n${many}`).changes.length, ADVISE_MAX_CHANGES);
  const long = splitAdvice(`x\nCHANGES:\n- ${"a".repeat(900)}`).changes[0];
  assert.ok(long.length <= 300, "a change is one line a builder can act on");
}

// ---- the prompt ----
{
  const sys = adviseSystemPrompt({
    scope: "element",
    snapshot: "Title: Farmhouse",
    project: { name: "Farmhouse", description: "Farm stay booking site" },
  });
  assert.match(sys, /Farmhouse/);
  assert.match(sys, /Farm stay booking site/);
  assert.match(sys, /element\(s\) they picked/);
  assert.match(sys, /Recommending to leave something alone is a good answer/);
  assert.match(sys, /not a screenshot/);
  assert.match(sys, /CHANGES: none/);
  assert.match(sys, /language the person wrote in/);
  const huge = adviseSystemPrompt({ scope: "site", snapshot: "z".repeat(50_000), project: null });
  assert.ok(huge.length < ADVISE_MAX_SNAPSHOT + 4000, "the snapshot is capped inside the prompt");
}
{
  const p = advisePrompt(
    [
      { role: "user", content: "Is the menu ok?" },
      { role: "assistant", content: "Yes." },
    ],
    "And the footer?",
  );
  assert.equal(p, "Owner: Is the menu ok?\nLoki: Yes.\nOwner: And the footer?\nLoki:");
}

// ---- the widget clamps to exactly what the route accepts ----
assert.equal(WIDGET_MAX_QUESTION, ADVISE_MAX_QUESTION, "question cap mirrors the route");
assert.equal(WIDGET_MAX_HISTORY, ADVISE_MAX_HISTORY, "history cap mirrors the route");
assert.equal(SNAPSHOT_MAX_CHARS, ADVISE_MAX_SNAPSHOT, "snapshot cap mirrors the route");
const widgetSrc = readFileSync("widget/advise.ts", "utf8");
const routeSrc = readFileSync("src/app/api/widget/advise/route.ts", "utf8");
const historyContent = (src: string) => /content[^\n]*?(\d{3,5})\)/.exec(src)?.[1];
assert.ok(historyContent(widgetSrc), "the widget clamps history content");
assert.equal(
  historyContent(widgetSrc),
  historyContent(routeSrc),
  "per-turn history content cap mirrors the route",
);

console.log("widget-advise: ok");
