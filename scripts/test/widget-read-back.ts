// "Here's what I heard": a spoken note, read back part by part.
// Run: npx tsx scripts/test/widget-read-back.ts
import assert from "node:assert/strict";
import { heardParts, heardSpeech, heardTitle } from "../../widget/read-back";
import { alignNote } from "../../widget/voice-moments";

const note = [
  "On “Nutzen”:",
  "This card is empty, there should be a picture.",
  "",
  "On “Unterstützen” (marked):",
  "Is the shop open?",
  "And the button is too small.",
].join("\n");
const parts = heardParts(note);
assert.deepEqual(parts, [
  {
    page: null,
    where: "Nutzen",
    marked: false,
    said: "This card is empty, there should be a picture.",
  },
  {
    page: null,
    where: "Unterstützen",
    marked: true,
    said: "Is the shop open? And the button is too small.",
  },
]);
assert.equal(heardTitle(parts), "Here's what I heard — 2 things on this page");
assert.equal(
  heardSpeech(parts),
  "Here's what I heard. About Nutzen: This card is empty, there should be a picture. About Unterstützen: Is the shop open? And the button is too small.",
);

// Across pages: the page leads the heading (voice-moments writes it so).
const across = heardParts("On /pricing — “Plans”:\nShow CHF.\n\nOn /about — “Team”:\nAdd photos.");
assert.deepEqual(
  across.map((p) => [p.page, p.where]),
  [
    ["/pricing", "Plans"],
    ["/about", "Team"],
  ],
);
assert.equal(heardTitle(across), "Here's what I heard — 2 things, on 2 pages");

// A note without sections is one thing heard; an empty one is nothing.
assert.deepEqual(heardParts("Just make it faster."), [
  { page: null, where: "", marked: false, said: "Just make it faster." },
]);
assert.equal(heardTitle(heardParts("Just make it faster.")), "Here's what I heard");
assert.deepEqual(heardParts("On “X”:\n\n"), []);

// The headings this parses are the ones voice-moments actually writes —
// one page, and across pages with a Mark.
{
  const segments = [
    { start: 0, text: "The hero is blurry." },
    { start: 5, text: "Prices should be in CHF." },
  ];
  const one = alignNote("", segments, [
    { at: 0, label: "Hero", page: "/" },
    { at: 4000, label: "Pricing", page: "/" },
  ]);
  assert.deepEqual(
    heardParts(one).map((p) => [p.where, p.said]),
    [
      ["Hero", "The hero is blurry."],
      ["Pricing", "Prices should be in CHF."],
    ],
  );
  const two = alignNote("", segments, [
    { at: 0, label: "Hero", page: "/" },
    { at: 4000, label: "Plans", page: "/pricing", marked: true },
  ]);
  assert.deepEqual(
    heardParts(two).map((p) => [p.page, p.where, p.marked]),
    [
      ["/", "Hero", false],
      ["/pricing", "Plans", true],
    ],
  );
}
console.log("✓ widget-read-back: ok");
