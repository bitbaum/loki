// The homepage quotes featured feedback to strangers. Pins that the quote is
// readable: no measurement asides, and never cut inside a word.
import assert from "node:assert/strict";
import { publicFeedbackExcerpt } from "../../src/lib/feedback/public-excerpt";

// The note the homepage actually showed on 2026-10-04.
const real =
  "On mobile (320px wide), the feedback widget's floating action button (fixed, 48x48px, z-index 2147483000, bottom-right corner) permanently overlaps the last pricing card and hides its button, so nobody on a phone can start the plan.";
const out = publicFeedbackExcerpt(real);
assert.ok(!out.includes("("), `asides dropped: ${out}`);
assert.ok(!out.includes("z-index"), `measurements dropped: ${out}`);
assert.ok(
  out.startsWith("On mobile, the feedback widget's floating action button permanently"),
  out,
);
assert.ok(out.length <= 141, `bounded: ${out.length}`);
assert.match(out, /\w…$|[.!?]$/, `ends on a word or a sentence: ${out}`);

// A short first sentence stands alone.
assert.equal(
  publicFeedbackExcerpt(
    "The menu hides the logo. Also the footer links are tiny on my phone and hard to tap.",
  ),
  "The menu hides the logo.",
);

// Short text is returned whole, whitespace tidied.
assert.equal(publicFeedbackExcerpt("  Button   text is cut off  "), "Button text is cut off");

// A long text without spaces still ends with an ellipsis inside the bound.
const long = "x".repeat(300);
assert.equal(publicFeedbackExcerpt(long), `${"x".repeat(140)}…`);

// Cut on a word boundary, never mid-word.
const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const w = publicFeedbackExcerpt(words);
assert.match(w, /word\d+…$/);
assert.ok(words.includes(w.slice(0, -1) + " "), "cut lands between two words");

console.log("feedback-public-excerpt: ok");
