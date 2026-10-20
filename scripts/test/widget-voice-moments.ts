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
  wholeSentences,
  joinTakes,
  MOMENTS_MAX,
  momentsForReport,
  timeline,
  type Moment,
} from "../../widget/voice-moments";
import { clampMoments, MOMENT_LIMITS } from "../../widget/moments-contract";
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
      { start: 0, text: "a." },
      { start: 3.8, text: "b." },
    ],
    [m(0, "X"), m(4000, "Y")],
  ),
  /On “Y”:\nb\./,
);
// A sentence is never cut: Whisper paused mid-sentence while the page
// scrolled, and the second half used to land under the next heading.
assert.equal(
  alignNote(
    "I'm not sure this should be the first screen that the logged-in user sees. Fine.",
    [
      { start: 0, text: "I'm not sure this should be the first screen that the" },
      { start: 2, text: "logged-in user sees." },
      { start: 6, text: "Fine." },
    ],
    [m(0, "X"), m(1500, "Y"), m(5500, "Z")],
  ),
  "On “X”:\nI'm not sure this should be the first screen that the logged-in user sees.\n\nOn “Z”:\nFine.",
);
assert.deepEqual(
  wholeSentences([
    { start: 0, text: "Is this" },
    { start: 1, text: "right? Yes" },
    { start: 2, text: "it is…" },
    { start: 3, text: "trailing" },
  ]),
  [
    { start: 0, text: "Is this right? Yes it is…" },
    { start: 3, text: "trailing" },
  ],
);
// Across pages, each heading says which page.
assert.match(
  alignNote(
    "a b",
    [
      { start: 0, text: "a." },
      { start: 5, text: "b." },
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

// The receipt never quotes a cut sentence: a long note is NAMED, and shown
// whole under it (clamped to whole lines with "Show all"). "Saved “3 changes:
// Make it possible for users to hear what is…”" had nothing to open
// (owner's phone, 2026-10-20).
const long = "word ".repeat(200).trim();
const sent = { kind: "sent", owner: true, text: long } as Parameters<typeof receiptText>[0];
assert.ok(!receiptText(sent).includes("…"), "no sentence is cut short");
assert.match(receiptText(sent), /^Saved your note\./);
assert.equal(receiptFull(sent), long, "the whole note is still there to read");
const several = {
  ...sent,
  text: "• Make it louder\n• Add a pause button\n• Say the time",
  changes: 3,
};
assert.match(receiptText(several), /^Saved your 3 changes\./, "several changes are named as such");
assert.equal(receiptFull(several), several.text, "and listed whole, one per line");
assert.match(
  receiptText({ ...several, building: true }),
  /^On it — your 3 changes are being built\./,
);
assert.equal(
  receiptText({ ...sent, text: "Make it louder" }).startsWith("Saved “Make it louder”"),
  true,
);
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

// ── What was seen, per moment (2026-10-17) ───────────────────────────────────
// A tap on the same part replaces the part's tap; the view follows the latest look.
let seen: Moment[] = [];
seen = addMoment(seen, m(0, "Nutzen", { scrollY: 0, text: "Werde Teil der Community" }));
seen = addMoment(
  seen,
  m(2000, "Nutzen", { scrollY: 120, tap: { text: "Jetzt starten", selector: "#start" } }),
);
seen = addMoment(seen, m(3000, "Nutzen", { tap: { text: "Mehr", selector: "a.more" } }));
assert.equal(seen.length, 1);
assert.equal(seen[0].scrollY, 120, "the scroll follows the latest look at the part");
assert.equal(seen[0].text, "Werde Teil der Community", "the reading text is kept");
assert.equal(seen[0].tap?.text, "Mehr", "the latest tap on the part wins");
assert.equal(seen[0].at, 0, "and the moment keeps when it began");

// The structured list beside the note: each moment with what was said then.
const report = momentsForReport(
  "This card is empty. Add a photo. Is the shop open?",
  [
    { start: 0.4, text: "This card is empty." },
    { start: 2.1, text: "Add a photo." },
    { start: 5, text: "Is the shop open?" },
  ],
  [
    m(0, "Nutzen", { scrollY: 0, tap: { text: "Jetzt starten", selector: "#start" } }),
    m(4000, "Unterstützen", { marked: true, scrollY: 900, text: "Shop" }),
  ],
);
assert.equal(report.length, 2);
assert.equal(report[0].said, "This card is empty. Add a photo.");
assert.equal(report[0].tap?.selector, "#start");
assert.equal(report[1].said, "Is the shop open?");
assert.equal(report[1].marked, true);
assert.equal(report[1].scrollY, 900);
// One part, or no timings: the whole text belongs to the first moment.
const flat = momentsForReport("All of it.", [], [m(0, "Nutzen"), m(5000, "Shop")]);
assert.equal(flat[0].said, "All of it.");
assert.equal(flat[1].said, undefined);
assert.deepEqual(momentsForReport("x", [], []), []);

// The contract clamps: over-long strings are cut, junk is dropped, the count is capped.
const clamped = clampMoments([
  {
    at: 10,
    page: "/p",
    label: "L".repeat(200),
    text: "t".repeat(500),
    tap: { text: "x", selector: "s" },
  },
  { at: -1, page: "/p", label: "bad" },
  { page: "/p", label: "no at" },
  "junk",
  ...Array.from({ length: 40 }, (_, i) => ({ at: i, page: "/p", label: `H${i}` })),
]);
assert.equal(clamped.length, MOMENT_LIMITS.count);
assert.equal(clamped[0].label.length, MOMENT_LIMITS.label);
assert.equal(clamped[0].text?.length, MOMENT_LIMITS.text);
assert.equal(clamped[0].tap?.text, "x");

// Takes chain onto one clock: the second take's timings are shifted by its offset.
const joined = joinTakes([
  { offsetMs: 0, text: "First take.", segments: [{ start: 1, text: "First take." }] },
  { offsetMs: 110_000, text: "Second take.", segments: [{ start: 2, text: "Second take." }] },
]);
assert.equal(joined.text, "First take. Second take.");
assert.equal(joined.segments[1].start, 112, "shifted by the take's offset, in seconds");
// A take without timings drops ALL timings: half-timed is worse than untimed.
assert.deepEqual(
  joinTakes([
    { offsetMs: 0, text: "A.", segments: [{ start: 0, text: "A." }] },
    { offsetMs: 110_000, text: "B.", segments: [] },
  ]).segments,
  [],
);

console.log("widget-voice-moments: ok");
