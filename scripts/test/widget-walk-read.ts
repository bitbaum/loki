/**
 * Loki reads a spoken note before it is saved (widget/walk-read.ts): what a
 * read may contain, the card's "did it hear me" line, the walk handed to Ask,
 * and a site-wide finding said once per visit (watch-trail.ts).
 *
 * The fixture is the owner's own walk through Petvity, 2026-10-18.
 * Run: npx tsx scripts/test/widget-walk-read.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanWalkRead, heardLine, itemsAsk, walkPages, walkSession } from "../../widget/walk-read";
import { onceSiteWide } from "../../widget/watch-trail";
import { parseWalkRead, walkReadPrompt } from "../../src/lib/feedback/walk-read-prompt";
import type { ReportMoment } from "../../widget/moments-contract";

const walk: ReportMoment[] = [
  {
    at: 0,
    page: "/de",
    label: "Dein Tier sendet ein Signal. Jetzt kannst du es lesen.",
    said: "I think the design is inconsistent. Here's my homepage, design is one, and then we will go to...",
  },
  {
    at: 22_000,
    page: "/de/features",
    label: "Jede Funktion, die dein Tier wirklich braucht",
    said: "We will actually log in.",
  },
  {
    at: 33_000,
    page: "/portal/dashboard",
    label: "What would you like to do?",
    said: "No, no, I'm just making a coffee.",
  },
  {
    at: 40_000,
    page: "/portal/settings",
    label: "Your data",
    text: "Download my data",
    said: "In general, I would like you to look at all these things and let me know what you think.",
  },
  { at: 43_000, page: "/portal/settings", label: "Profile", marked: true },
];

// ── What a read may contain ────────────────────────────────────────────────
const read = cleanWalkRead({
  ask: "  Look at the design of the home page, Features, the dashboard and Settings,\n say where it is inconsistent, and tell me what you think.  ",
  kind: "question",
  asides: ["No, no, I'm just making a coffee.", "", 42, "We will actually log in."],
});
assert.ok(read);
assert.equal(read.kind, "question");
assert.match(read.ask, /^Look at the design .* what you think\.$/, "whitespace folded");
assert.deepEqual(read.asides, ["No, no, I'm just making a coffee.", "We will actually log in."]);
assert.equal(cleanWalkRead({ ask: "", kind: "change" }), null, "no ask, no read");
assert.equal(cleanWalkRead({ ask: "null" }), null);
assert.equal(cleanWalkRead(null), null);
assert.equal(cleanWalkRead({ ask: "Make the button bigger", kind: "build it" })?.kind, "change");
assert.equal(
  cleanWalkRead({ ask: "x".repeat(2000) })?.items[0].text.length,
  900,
  "a runaway answer is cut to the limit",
);
assert.equal(
  cleanWalkRead({ ask: "a", asides: Array.from({ length: 20 }, (_, i) => `aside ${i}`) })?.asides
    .length,
  6,
);

// The model's answer goes through the same rule, fenced or not.
const parsed = parseWalkRead(
  '```json\n{"ask":"Make the Features link bigger","kind":"change","asides":[]}\n```',
);
assert.deepEqual(parsed, {
  ask: "Make the Features link bigger",
  kind: "change",
  items: [{ text: "Make the Features link bigger", kind: "change", where: null, parts: [] }],
  asides: [],
});

// ── A walk talked about freely is a list, one thing per line ───────────────
// The owner's walk through Loki's own home page, 2026-10-18: one sentence
// about signed-in visitors, cut across two headings, and a question.
const listed = cleanWalkRead(
  {
    items: [
      {
        text: "  Signed-in people should not land on this page; show their chats or the terminal, with an easy way to switch. ",
        kind: "change",
        where: "Home page, signed in",
        parts: [0, 1, 1, 99, -1, 2.5, "3"],
      },
      {
        text: "Check for stale pages and documents.",
        kind: "change",
        where: "Whole site",
        parts: [],
      },
      { text: "Is Fleet Runner still used?", kind: "question", where: "", parts: [4] },
      { text: "", kind: "change" },
    ],
    asides: ["Thank you."],
  },
  5,
);
assert.ok(listed);
assert.equal(listed.items.length, 3, "an empty item is dropped");
assert.deepEqual(listed.items[0].parts, [0, 1], "parts: whole, in range, once");
assert.match(listed.items[0].text, /^Signed-in .* switch\.$/);
assert.equal(listed.items[2].where, null, "no where is null, not empty");
assert.equal(listed.kind, "change", "a list with a change is a change");
assert.equal(
  listed.ask,
  "1. Home page, signed in: Signed-in people should not land on this page; show their chats or the terminal, with an easy way to switch.\n2. Whole site: Check for stale pages and documents.\n3. Is Fleet Runner still used?",
  "an old card shows the list as one instruction",
);
assert.equal(
  cleanWalkRead({ items: [{ text: "What do you think?", kind: "question" }] })?.kind,
  "question",
);
assert.equal(itemsAsk([{ text: "One", kind: "change", where: "Footer", parts: [] }]), "One");
assert.equal(
  cleanWalkRead({ items: Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` })) })?.items.length,
  8,
);
assert.equal(parseWalkRead("I could not read that."), null);

// ── "Did it hear me?" ──────────────────────────────────────────────────────
assert.deepEqual(walkPages(walk), ["/de", "/de/features", "/portal/dashboard", "/portal/settings"]);
assert.equal(heardLine(walk, 45_000), "Loki heard you · 0:45 across 4 pages");
assert.equal(
  heardLine(walk),
  "Loki heard you · 0:43 across 4 pages",
  "the last moment, without a clock",
);
assert.equal(heardLine([{ at: 0, page: "/", label: "Home" }], 12_000), "Loki heard you · 0:12");
assert.equal(heardLine([], 0), "Loki heard you");

// ── Ask sees the whole walk, not only the page the panel is open on ────────
const session = walkSession(walk);
assert.match(session, /^A spoken walk through the site, in order:/);
for (const m of walk) assert.ok(session.includes(m.page), `${m.page} is in the walk`);
assert.match(
  session,
  /0:40 \/portal\/settings — “Your data” \| on screen: Download my data \| said: In general/,
);
assert.match(session, /“Profile” \(marked\)/);
assert.ok(walkSession(walk, 120).length <= 120, "bounded");

// ── The prompt carries the pages and the words, and says what they are ─────
const prompt = walkReadPrompt({ project: "Petvity", note: "On /de — x:\nwords", moments: walk });
assert.match(prompt, /Site: Petvity/);
assert.match(
  prompt,
  /Pages they went through, in order: \/de, \/de\/features, \/portal\/dashboard, \/portal\/settings/,
);
assert.match(prompt, /```\nOn \/de — x:\nwords\n```/);
// The moments are numbered for the items' parts, with what was pointed at.
assert.match(prompt, /#0 0:00 \/de — “Dein Tier/);
assert.match(prompt, /#4 0:43 \/portal\/settings — “Profile” \| marked/);
assert.match(prompt, /#3 .* on screen: Download my data/);

// ── A site-wide finding is said once per visit ─────────────────────────────
const lang =
  "The page does not declare its language (<html lang>), so screen readers guess the pronunciation";
const taps = "6 tap target(s) are under 24px and crowded by their neighbours";
const said = new Set<string>();
const first = onceSiteWide([taps, lang], said);
assert.deepEqual(first.checks, [taps, lang], "said on the first page");
for (const k of first.keys) said.add(k);
const second = onceSiteWide(["3 button(s)/link(s) have no name", lang], said);
assert.deepEqual(second.checks, ["3 button(s)/link(s) have no name"], "not on the next");
assert.deepEqual(second.keys, []);
assert.deepEqual(onceSiteWide([taps], said).checks, [taps], "page findings are always said");
// The page it was first said on keeps it: that page's card is re-read on a
// revisit, and dropping the line there made the finding look fixed.
const onPath = new Set<string>();
for (const k of onceSiteWide([lang], onPath, "/a").keys) onPath.add(k);
assert.deepEqual(onceSiteWide([lang], onPath, "/a").checks, [lang], "back on /a: still said");
assert.deepEqual(onceSiteWide([lang], onPath, "/b").checks, [], "on /b: said once already");

// ── Wiring: the pieces are where they must be ──────────────────────────────
const model = readFileSync("widget/conversation-model.ts", "utf8");
assert.match(model, /understandNote\(/, "a recorded note is read");
assert.match(model, /const untouched = draft\.text === note\.verbatim;/, "edited words are kept");
const view = readFileSync("widget/conversation.ts", "utf8");
assert.match(view, /heardLine\(draft\.moments/, "the card says what it heard");
assert.match(view, /noteExtras\(draft/, "the asides and the words as spoken are drawn");
assert.match(
  readFileSync("widget/voice-note-card.ts", "utf8"),
  /Use my exact words instead/,
  "the words as spoken are one tap away",
);
assert.match(view, /model\.askAboutNote\(text\)/, "Ask takes the whole walk");
assert.match(
  readFileSync("src/proxy.ts", "utf8"),
  /api\/widget\/understand\|/,
  "the route answers cross-origin without a Loki session",
);
assert.match(readFileSync("widget/watch.ts", "utf8"), /onceSiteWide\(checks, said, path\)/);

// The read is one call per note, read before anything is built: the strong
// model, with instructions that say what "these things" must become.
const route = readFileSync("src/app/api/widget/understand/route.ts", "utf8");
assert.match(route, /model: GROQ_STRONG_MODEL/);
assert.match(
  readFileSync("src/lib/feedback/walk-read-prompt.ts", "utf8"),
  /That is only what was on screen\. People talk freely while they scroll/,
  "what was on screen is background, not what they meant",
);
assert.match(view, /model\.sendItems\(contact\.value, intent\)/, "each change is saved on its own");

console.log("widget-walk-read: ok");
