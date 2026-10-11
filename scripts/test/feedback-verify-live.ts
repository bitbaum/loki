/**
 * Loki looks before it asks: the page as text, the question it asks the
 * model, and how it reads the answer. Run: npx tsx scripts/test/feedback-verify-live.ts
 */
import assert from "node:assert/strict";
import {
  pageText,
  parseVerdict,
  verifyPrompt,
  picturePrompt,
  pointedAtLine,
  wantsPicture,
  needsVerify,
  FIX_VERDICT,
} from "@/lib/feedback/verify-live-rules";
import { FIX_SHIP_STATE } from "@/lib/feedback/fix-shipping";
import { FEEDBACK_STATUS } from "@/lib/constants/statuses";

// Scripts, styles and tags go; entities and block breaks survive as text.
const text = pageText(
  "<html><head><style>.x{}</style><script>var a=1</script></head><body><h1>Farm &amp; stay</h1><p>From 120&nbsp;a night.</p><footer>&#169; 2026</footer></body></html>",
);
assert.equal(text, "Farm & stay\nFrom 120 a night.\n© 2026");
assert.ok(pageText("<p>" + "x".repeat(10_000) + "</p>").length <= 6_001, "capped");

// The prompt carries the report, the agent's word, and the page — nothing else.
const prompt = verifyPrompt({
  report: "The footer year still says 2024.",
  didLine: "Updated the footer year.",
  text,
});
assert.match(prompt, /^The report: The footer year still says 2024\./);
assert.match(prompt, /The agent said it did: Updated the footer year\./);
assert.match(prompt, /© 2026/);

// The answer, however it is wrapped; nonsense is null, never a verdict.
assert.deepEqual(
  parseVerdict('```json\n{"verdict":"looks_fixed","evidence":"The footer reads © 2026."}\n```'),
  { verdict: FIX_VERDICT.LOOKS_FIXED, evidence: "The footer reads © 2026." },
);
assert.deepEqual(
  parseVerdict('<think>hm</think>{"verdict":"cannot_tell","evidence":"Layout is not in text."}'),
  { verdict: FIX_VERDICT.CANNOT_TELL, evidence: "Layout is not in text." },
);
assert.equal(parseVerdict('{"verdict":"maybe"}'), null);
assert.equal(parseVerdict("I looked and it seems fine."), null);

// Only a deployed, still-open fix with a page to read, and only once.
const fix = (state: string, verify?: object) => ({ state, checkedAt: "", verify });
const row = (over: object) =>
  ({
    status: FEEDBACK_STATUS.DISPATCHED,
    liveUrl: "https://farm.example",
    url: null,
    page: "/",
    work: { ship: fix(FIX_SHIP_STATE.DEPLOYED) },
    ...over,
  }) as never;
assert.equal(needsVerify(row({})), true);
assert.equal(
  needsVerify(row({ work: { ship: fix(FIX_SHIP_STATE.DEPLOYED, { verdict: "cannot_tell" }) } })),
  false,
  "looked once",
);
assert.equal(needsVerify(row({ work: { ship: fix(FIX_SHIP_STATE.PR_OPEN) } })), false);
assert.equal(needsVerify(row({ status: FEEDBACK_STATUS.RESOLVED })), false);
assert.equal(needsVerify(row({ liveUrl: null })), false, "nowhere to read");

// A picture is taken only when text left the question open — never to
// second-guess a verdict text already settled.
assert.equal(wantsPicture(null), true, "no text answer: look");
assert.equal(wantsPicture({ verdict: FIX_VERDICT.CANNOT_TELL }), true);
assert.equal(wantsPicture({ verdict: FIX_VERDICT.LOOKS_FIXED }), false);
assert.equal(wantsPicture({ verdict: FIX_VERDICT.NOT_VISIBLE }), false);

// The picture's question names what the reporter pointed at, so the model
// looks there; with nothing pointed at it says nothing about it.
assert.equal(
  pointedAtLine([{ elementType: "footer", elementText: "© 2024 Harbourlight" }]),
  "footer reading “© 2024 Harbourlight”",
);
assert.equal(pointedAtLine([{ elementType: "img", elementText: "" }]), "img");
assert.equal(pointedAtLine(null), null);
const pic = picturePrompt({
  report: "The cards are squeezed into one row.",
  didLine: "One column on phones.",
  pointedAt: pointedAtLine([{ elementType: "section", elementText: "Plans" }]),
});
assert.match(pic, /The reporter pointed at: section reading “Plans”/);
assert.match(pic, /The agent said it did: One column on phones\./);
assert.doesNotMatch(picturePrompt({ report: "x", didLine: null, pointedAt: null }), /pointed at/);

console.log("✓ feedback verify-live tests passed");
