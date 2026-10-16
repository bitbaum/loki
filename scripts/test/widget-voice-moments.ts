/**
 * Speaking while scrolling: which words go with which part of the page, and
 * the receipt keeping the whole of what was said.
 *
 * Run: npx tsx scripts/test/widget-voice-moments.ts
 */
import assert from "node:assert/strict";
import {
  addMoment,
  alignNote,
  MOMENTS_MAX,
  timeline,
  type Moment,
} from "../../widget/voice-moments";
import { RECEIPT_QUOTE, receiptFull, receiptText } from "../../widget/receipt";
import { spokenSegments } from "../../src/lib/voice/whisper-silence";
import { fromSiteWidget, keepCallback } from "../../src/config/auth";

const m = (at: number, label: string, extra: Partial<Moment> = {}): Moment => ({
  at,
  label,
  page: "/mitmachen",
  ...extra,
});

// Scrolling back and forth past one heading is one moment.
let list: Moment[] = [];
list = addMoment(list, m(0, "Nutzen"));
list = addMoment(list, m(900, "Nutzen"));
assert.equal(list.length, 1, "the same part twice is one moment");
// A Mark on the part already noted marks it, rather than adding a second.
list = addMoment(list, m(1500, "Nutzen", { marked: true }));
assert.equal(list.length, 1);
assert.equal(list[0].marked, true, "Mark turns the moment into a marked one");
assert.equal(list[0].at, 0, "and keeps when it began");
list = addMoment(list, m(41_000, "Mithelfen"));
assert.equal(timeline(list), "0:00 Nutzen (marked) → 0:41 Mithelfen");
// Only the newest are kept.
let many: Moment[] = [];
for (let i = 0; i < 30; i++) many = addMoment(many, m(i * 1000, `H${i}`));
assert.equal(many.length, MOMENTS_MAX);
assert.equal(many.at(-1)?.label, "H29", "the newest survive");
assert.ok(timeline(many, 50).length <= 50, "the line is capped");

// Each sentence lands under the part in view when it was said.
const note = alignNote(
  "This card is empty. Add a photo. Is the shop open?",
  [
    { start: 0.4, text: "This card is empty." },
    { start: 2.1, text: "Add a photo." },
    { start: 5, text: "Is the shop open?" },
  ],
  [m(0, "Nutzen"), m(4000, "Unterstützen", { marked: true })],
);
assert.equal(
  note,
  "On “Nutzen”:\nThis card is empty. Add a photo.\n\nOn “Unterstützen” (marked):\nIs the shop open?",
);
// A sentence started just before scrolling settled still belongs to the new part.
assert.match(
  alignNote(
    "a b",
    [
      { start: 0, text: "a" },
      { start: 3.8, text: "b" },
    ],
    [m(0, "X"), m(4000, "Y")],
  ),
  /On “Y”:\nb/,
);
// Across pages, each heading says which page.
assert.match(
  alignNote(
    "a b",
    [
      { start: 0, text: "a" },
      { start: 5, text: "b" },
    ],
    [m(0, "X"), { at: 4000, label: "Y", page: "/shop" }],
  ),
  /On \/shop — “Y”:/,
);
// Nothing to line up: the words as said.
assert.equal(alignNote("hello", [{ start: 0, text: "hello" }], [m(0, "X")]), "hello");
assert.equal(alignNote("hello", [], [m(0, "X"), m(5000, "Y")]), "hello", "no timings, no guessing");

// Whisper's timings survive; silence it put words to does not.
assert.deepEqual(
  spokenSegments({
    segments: [
      { start: 0, text: " Fix the header.", no_speech_prob: 0.01, avg_logprob: -0.2 },
      { start: 4, text: " Thank you.", no_speech_prob: 0.8, avg_logprob: -1.4 },
      { start: 6.5, text: " And the footer.", no_speech_prob: 0.02, avg_logprob: -0.3 },
    ],
  }),
  [
    { start: 0, text: "Fix the header." },
    { start: 6.5, text: "And the footer." },
  ],
);
assert.deepEqual(spokenSegments({ text: "no segments" }), []);

// The receipt quotes the start and keeps the whole.
const long = "word ".repeat(200).trim();
const sent = { kind: "sent", text: long } as Parameters<typeof receiptText>[0];
assert.ok(receiptText(sent).includes("…”"), "a long note is quoted with an ellipsis");
assert.ok(!receiptText(sent).includes("wor…"), "and cut at a word");
assert.equal(receiptFull(sent), long, "the whole note is still there to read");
assert.equal(
  receiptFull({ ...sent, text: "short" }),
  null,
  "a short note is quoted whole, nothing more to show",
);
assert.ok(RECEIPT_QUOTE < 300);

// Sign-in from a site keeps its way back through "create an account".
const cb = "/api/widget/owner?token=abc&return=https%3A%2F%2Fevig.orangecat.ch%2F";
assert.ok(fromSiteWidget(cb));
assert.ok(!fromSiteWidget("/control"));
assert.equal(
  keepCallback("/sign-up", cb, "/control"),
  `/sign-up?callbackUrl=${encodeURIComponent(cb)}`,
);
assert.equal(keepCallback("/sign-up", "/control", "/control"), "/sign-up");

console.log("widget-voice-moments: ok");
