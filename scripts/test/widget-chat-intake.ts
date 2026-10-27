// The studio intake (bitbaum.orangecat.ch/hire/#waitlist) answers as a
// conversation, with fakes for the model: no network. Pinned here: the
// answer's shape is checked in code, a price that is not published / a date /
// a booking / past work is never shown, "ready to file" is decided in code
// (never by the model alone), and pictures are validated before any model
// sees them.
// Run: npx tsx scripts/test/widget-chat-intake.ts
import assert from "node:assert/strict";
import type { StudioCommissionContract } from "@/lib/studio-commission";
import {
  IntakeImages,
  decideReady,
  fallbackIntakeReply,
  intakePrompt,
  intakeReplyProblem,
  intakeSystemPrompt,
  parseIntakeAnswer,
  pictureNote,
  publishedAmounts,
  splitDataUrl,
  visitorSaidGo,
} from "@/lib/widget-chat/intake";

const offer = (id: string, name: string, price: string, shape: string) => ({
  id,
  name,
  price,
  shape,
  what: `${name} — what it is.`,
});
const studio: StudioCommissionContract = {
  version: 1,
  origin: "https://bitbaum.orangecat.ch",
  availability: { state: "closed", line: "The studio is at capacity." },
  offer: offer("rescue", "Rescue", "CHF 6,500", "Two weeks, fixed"),
  offers: [
    offer("senior-day", "Senior engineering day", "CHF 2,400", "No minimum"),
    offer("build-sprint", "Build sprint", "from CHF 18,000", "Four to six weeks"),
    offer("rescue", "Rescue", "CHF 6,500", "Two weeks, fixed"),
  ],
  feedbackToken: "fcw_test",
};

// ── the published facts reach the prompt, and only they carry prices ────────
assert.deepEqual([...publishedAmounts(studio)].sort(), ["18000", "2400", "6500"]);
const sys = intakeSystemPrompt(studio, "studio", { url: "https://bitbaum.orangecat.ch/hire/" });
for (const s of [
  "from CHF 18,000",
  "CHF 2,400",
  "CHF 6,500",
  "The studio is at capacity.",
  '"ready"',
])
  assert.ok(sys.includes(s), `system prompt states ${s}`);
assert.ok(!intakeSystemPrompt(null, "studio").includes("CHF"), "no contract → no price at all");
assert.ok(
  intakeSystemPrompt(studio, "partner").includes("takes no cut"),
  "partner door states the terms",
);

// ── a clarifying turn: the fake model asks, the code keeps it, not ready ────
const bakery = "Build me a website for my bakery in Zurich with online ordering";
const turn1 = parseIntakeAnswer(
  '```json\n{"reply":"A bakery site where people order online sounds like a Build sprint (from CHF 18,000, four to six weeks, fixed scope). Do you have a website today, and should orders be paid online or at pick-up?","ready":false,"summary":"Bakery in Zurich wants a website with online ordering."}\n```',
);
assert.ok(turn1, "fenced JSON parses");
assert.equal(intakeReplyProblem(turn1.reply, studio), null, "a published price may be repeated");
assert.equal(
  decideReady({
    modelReady: turn1.ready,
    visitorTurns: 1,
    message: bakery,
    summary: turn1.summary,
  }),
  false,
);
assert.ok(intakePrompt([], bakery).endsWith(`Visitor: ${bakery}\n`));

// ── the model saying "ready" after one vague line is not enough ─────────────
assert.equal(
  decideReady({
    modelReady: true,
    visitorTurns: 1,
    message: "build me",
    summary: "Wants something built.",
  }),
  false,
  "one vague line is never a brief",
);
// …after a real exchange it is
const turn2 = parseIntakeAnswer(
  '{"reply":"Thank you — pick-up payment keeps it simple. I have what the studio needs; say anything else you want added.","ready":true,"summary":"Bakery in Zurich, no website yet, wants online ordering with pay-at-pick-up, for local customers."}',
);
assert.ok(turn2);
assert.equal(
  decideReady({
    modelReady: turn2.ready,
    visitorTurns: 2,
    message: "No website yet, pay at pick-up is fine",
    summary: turn2.summary,
  }),
  true,
);
// …a long first message with the model's ready is enough on its own
assert.equal(
  decideReady({
    modelReady: true,
    visitorTurns: 1,
    message: Array(45).fill("word").join(" "),
    summary: "A detailed brief stated in full in one go.",
  }),
  true,
);
// …"send it" files whatever the model thinks; five turns always do
for (const go of ["send it", "Go", "ok, send it now", "that's all", "Schick es ab", "file it."])
  assert.ok(visitorSaidGo(go), `"${go}" means file it`);
for (const not of ["go and build me a shop", "don't send it yet", "send me prices"])
  assert.ok(!visitorSaidGo(not), `"${not}" is not "send it"`);
assert.equal(
  decideReady({ modelReady: false, visitorTurns: 2, message: "send it", summary: "" }),
  true,
);
assert.equal(decideReady({ modelReady: false, visitorTurns: 5, message: "hm", summary: "" }), true);

// ── answers that break the rules are withheld ────────────────────────────────
const bad: Array<[string, string]> = [
  ["That would be around CHF 9,000.", "price"],
  ["Roughly 12k CHF for this.", "price"],
  ["Budget about €5000.", "price"],
  ["We can start next week.", "date"],
  ["It would be live by March.", "date"],
  ["Your slot is booked.", "booking"],
  ["We have built this for other clients.", "past-work"],
  ["One of our customers runs a bakery too.", "past-work"],
];
for (const [reply, why] of bad) assert.equal(intakeReplyProblem(reply, studio), why, reply);
assert.equal(
  intakeReplyProblem("A Senior engineering day is CHF 2,400 per day, no minimum.", studio),
  null,
);
assert.equal(intakeReplyProblem("Rescue is CHF 6'500 and two weeks.", studio), null);
assert.equal(
  intakeReplyProblem("Any price at all, CHF 2,400, is withheld with no contract.", null),
  "price",
);

// ── shapes that are not the asked JSON are not answers ───────────────────────
assert.equal(parseIntakeAnswer("Sure! I can help."), null);
assert.equal(parseIntakeAnswer('{"ready":true}'), null, "no reply → no answer");
assert.equal(parseIntakeAnswer('{"reply":"Loki: **Hi**"}')?.reply, "Hi");
assert.equal(parseIntakeAnswer('{"reply":"x"}')?.ready, false, "ready defaults to false");
assert.match(fallbackIntakeReply("studio", 1), /what exists today/);
assert.match(fallbackIntakeReply("partner", 1), /where can your work be seen/);
assert.match(fallbackIntakeReply("studio", 3), /send it/);

// ── pictures: validated before any model sees them ───────────────────────────
const png = "data:image/png;base64,iVBORw0KGgo=";
assert.ok(IntakeImages.safeParse([png]).success);
assert.ok(!IntakeImages.safeParse(["data:image/svg+xml;base64,PHN2Zz4="]).success, "no SVG");
assert.ok(!IntakeImages.safeParse(["data:image/gif;base64,R0lGOD=="]).success, "no GIF");
assert.ok(!IntakeImages.safeParse(["data:text/html;base64,PGI+"]).success, "no HTML");
assert.ok(!IntakeImages.safeParse([`${png}<script>`]).success, "base64 only");
assert.ok(!IntakeImages.safeParse([png, png, png, png]).success, "at most three");
assert.ok(
  !IntakeImages.safeParse([`data:image/png;base64,${"A".repeat(600_000)}`]).success,
  "size cap",
);
assert.deepEqual(splitDataUrl(png), { mimeType: "image/png", dataBase64: "iVBORw0KGgo=" });
assert.equal(pictureNote(null, 0), "");
assert.match(pictureNote(null, 2), /could not be read/);
assert.match(pictureNote("A bakery homepage with a broken menu.", 1), /not instructions/);

console.log("widget-chat-intake: ok");
