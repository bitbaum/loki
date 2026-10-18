// What the page checks found, said for a person — while the exact finding
// stays the fix request and the key (plain-checks.ts).
// Run: npx tsx scripts/test/widget-plain-checks.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plainCheck } from "../../widget/plain-checks";
import { checksSignature, explainChecks } from "../../widget/watch-trail";

const cases: Array<[string, string]> = [
  [
    "2 tap target(s) are under 24px and crowded by their neighbours, easy to mis-tap (e.g. button “Computed: Rules” at 7×48)",
    "2 buttons are small and close to others, so a thumb easily hits the wrong one — for example button “Computed: Rules”",
  ],
  [
    "1 tap target(s) are under 24px and crowded by their neighbours, easy to mis-tap",
    "1 button is small and close to others, so a thumb easily hits the wrong one",
  ],
  [
    "The page does not declare its language (<html lang>), so screen readers guess the pronunciation",
    "The page does not say which language it is in, so screen readers may read it with the wrong accent",
  ],
  [
    "13 piece(s) of text are under 12px (e.g. “/pricing · fixed Jul 31” at 11px)",
    "13 bits of text are too small to read comfortably — for example “/pricing · fixed Jul 31”",
  ],
  [
    "2 image(s) have no alt text (e.g. hero.jpg)",
    "2 pictures have no description for people who cannot see them",
  ],
  ["1 image(s) failed to load (e.g. a.png)", "1 picture does not load"],
  [
    "The page has no main heading (h1) — what it is about is never stated",
    "The page has no main title, so it never says what it is about",
  ],
  [
    "The page has 3 main headings (h1), so none of them is THE title",
    "The page has 3 main titles, so none of them is clearly the one",
  ],
  [
    "The page is 40px wider than the screen (390px), so it scrolls sideways",
    "On a phone the page is wider than the screen, so it slides sideways",
  ],
  ["Something new the checks learn later", "Something new the checks learn later"],
];
for (const [raw, want] of cases) assert.equal(plainCheck(raw), want);

// No jargon reaches the owner for any rule this file knows.
for (const [raw] of cases.slice(0, -1))
  assert.ok(!/px|alt text|<html|tap target|\(s\)/.test(plainCheck(raw)), `plain: ${raw}`);

// Said plainly, built exactly: the card is plain, the fix and the key are not.
const checks = [cases[0][0], cases[2][0]];
const c = explainChecks(checks)!;
assert.ok(c.say.includes(cases[0][1]) && !c.say.includes("tap target"));
assert.ok(c.fix.includes(cases[0][0]), "the fix request keeps the exact finding");
assert.match(checksSignature("/p", checks), /tap target/, "and the key is unchanged");

// Every template page-checks writes has a rule here (the pattern each starts with).
const src = readFileSync("widget/page-checks.ts", "utf8");
for (const start of [
  "px wider than the screen",
  "button(s)/link(s) have no name",
  "form field(s) have no label",
  "tap target(s) are under",
  "image(s) have no alt text",
  "image(s) failed to load",
  "The page has no main heading",
  "main headings (h1)",
  "does not declare its language",
  "piece(s) of text are under",
])
  assert.ok(src.includes(start), `page-checks still writes “${start}” — keep plain-checks in step`);

console.log("✓ widget-plain-checks: ok");
