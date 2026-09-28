// "Watch the fix": the walkthrough ticket, its script, and the failure line.
//
// 2026-09-28: the owner tapped a green "Live · confirm" chip expecting to watch
// the work and landed on the site's homepage with no idea where to look; a
// failed Petvity run said only "Retry" above a Retry button. These pin the
// pieces that replaced both.
import assert from "node:assert/strict";

import {
  createTourToken,
  verifyTourToken,
  tourSiteUrl,
  TOUR_HASH_KEY,
} from "../../src/lib/feedback/tour-token";
import { fallbackTourSteps, parseTourSteps, tourPrompt } from "../../src/lib/feedback/tour-plan";
import { explainRunFailure } from "../../src/lib/feedback/failure-reason";

// Read at call time, so setting it after the imports is enough.
process.env.AUTH_SECRET ??= "test-secret-for-tour-token";

// ---- ticket ----
{
  const id = "3f0c7a52-1111-4222-8333-944455556666";
  const now = Date.now();
  const token = createTourToken(id, now);
  assert.equal(verifyTourToken(token, now), id);
  assert.equal(verifyTourToken(token, now + 25 * 60 * 60 * 1000), null, "expires within a day");
  assert.equal(verifyTourToken(`${token}x`, now), null, "a tampered signature is refused");
  const [, exp, sig] = token.split(".");
  assert.equal(verifyTourToken(`other-id.${exp}.${sig}`, now), null, "bound to its feedback id");
  const url = tourSiteUrl("https://farmhouse.orangecat.ch/#old", token);
  assert.ok(
    url.startsWith(`https://farmhouse.orangecat.ch/#${TOUR_HASH_KEY}=`),
    "rides the fragment",
  );
  assert.ok(!url.includes("#old"), "the page's own fragment is replaced, not doubled");
}

// ---- script ----
const outline = [
  { i: 0, tag: "h1", text: "Farmhouse" },
  { i: 1, tag: "a", text: "About → #about" },
  { i: 2, tag: "footer", text: "© Farmhouse" },
  { i: 3, tag: "a", text: "Back to top → #top" },
];
{
  const steps = parseTourSteps(
    'Sure! {"steps":[{"target":3,"action":"point","say":"Down here — the new Back to top link."},' +
      '{"target":3,"action":"click","say":"Tapping it takes you up."},' +
      '{"target":null,"action":"scroll","say":"And we are back at the menu."},' +
      '{"target":99,"action":"point","say":"Invented"},{"target":null,"action":"point","say":"Nowhere"}]}',
    outline.length,
  );
  assert.equal(steps.length, 3, "out-of-range and targetless non-scroll steps are dropped");
  assert.equal(steps[1].action, "click");
  assert.equal(steps[2].target, null);
  assert.deepEqual(parseTourSteps("not json", 4), []);
  assert.deepEqual(
    parseTourSteps('{"steps":[{"target":null,"action":"scroll","say":"Up"}]}', 4),
    [],
    "a walkthrough that points at nothing is no walkthrough",
  );
}
{
  const input = {
    suggestion:
      'At the very bottom of the page, add a small "Back to top" link so people on phones can get back to the menu quickly.',
    didLine: null,
    prTitle: "Add back-to-top link to footer",
    selectors: [],
    outline,
  };
  const steps = fallbackTourSteps(input);
  assert.ok(
    steps.some((s) => s.target === 3),
    "no model: finds the element by the report's words",
  );
  assert.ok(
    tourPrompt(input).includes("3. <a> Back to top → #top"),
    "the model sees numbered rows",
  );
  const picked = fallbackTourSteps({ ...input, selectors: ["footer > a.top"] });
  assert.equal(picked[0].selector, "footer > a.top", "a picked element outranks guessing");
}

// ---- failure line ----
{
  for (const error of [
    null,
    "",
    "some unknown thing",
    "You've hit your usage limit",
    "Timed out — run exceeded maximum duration and was cleaned up",
    "fatal: could not read from remote repository",
  ]) {
    const line = explainRunFailure(error);
    assert.notEqual(line, "Retry", "never the bare word above a Retry button");
    assert.ok(line.length > 20, `a sentence for ${JSON.stringify(error)}`);
  }
  assert.match(explainRunFailure("429 Too Many Requests"), /quota/);
  assert.match(explainRunFailure("fatal: could not read from remote repository"), /repository/);
  assert.match(explainRunFailure("inject failed: tab not found"), /session/);
}

console.log("feedback-tour: ok");
