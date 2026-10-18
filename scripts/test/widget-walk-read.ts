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
import { cleanWalkRead, heardLine, walkPages, walkSession } from "../../widget/walk-read";
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
  cleanWalkRead({ ask: "x".repeat(2000) })?.ask.length,
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
assert.deepEqual(parsed, { ask: "Make the Features link bigger", kind: "change", asides: [] });
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

// ── Wiring: the pieces are where they must be ──────────────────────────────
const model = readFileSync("widget/conversation-model.ts", "utf8");
assert.match(model, /understandNote\(/, "a recorded note is read");
assert.match(
  model,
  /note\.text === note\.verbatim \? read\.ask : note\.text/,
  "edited words are kept",
);
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
assert.match(readFileSync("widget/watch.ts", "utf8"), /onceSiteWide\(checks, said\)/);

// The read is one call per note, read before anything is built: the strong
// model, with instructions that say what "these things" must become.
const route = readFileSync("src/app/api/widget/understand/route.ts", "utf8");
assert.match(route, /model: GROQ_STRONG_MODEL/);
assert.match(
  readFileSync("src/lib/feedback/walk-read-prompt.ts", "utf8"),
  /Replace this \/ here \/ these things with the pages and parts they refer to/,
);

console.log("widget-walk-read: ok");
