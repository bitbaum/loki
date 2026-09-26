/**
 * The owner says what to change on their own site, and it gets built.
 *
 * Before this, the widget could not tell the owner from a stranger: every note
 * waited in /feedback for the owner to return to Loki and press Implement, then
 * merge, on their own words. The owner's link now carries a signed pass; a note
 * sent with it starts the fix at ingest and merges itself once green.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createOwnerPass,
  verifyOwnerPass,
  ownerSiteUrl,
  OWNER_PASS_HASH_KEY,
} from "../../src/lib/feedback/owner-pass";
import { effectiveAutoShip } from "../../src/lib/feedback/auto-ship";
import { composeFeedbackFixPrompt } from "../../src/lib/feedback/compose-dispatch";
import { hashWithoutPass, passFromHash } from "../../widget/owner-pass";
import { FEEDBACK_SELF_ASSERTED_SOURCES, FEEDBACK_SOURCE } from "../../src/lib/constants/statuses";

// Read when a pass is signed, not at import.
process.env.AUTH_SECRET ??= "test-secret-for-owner-pass";

const project = "8d96d258-36f2-4b47-a897-9a5baeb6c296";
const owner = "11111111-2222-4333-8444-555555555555";
const now = Date.parse("2026-09-26T08:00:00Z");

// The pass proves exactly one project and one owner, and it expires.
const pass = createOwnerPass(project, owner, now);
assert.deepEqual(verifyOwnerPass(pass, now), { projectId: project, userId: owner });
assert.equal(verifyOwnerPass(pass, now + 91 * 24 * 60 * 60 * 1000), null, "expired pass");
const [p, u, exp, sig] = pass.split(".");
assert.equal(verifyOwnerPass(`${p}.${u}.${Number(exp) + 1}.${sig}`, now), null, "tampered expiry");
assert.equal(
  verifyOwnerPass(`${p}.99999999-2222-4333-8444-555555555555.${exp}.${sig}`, now),
  null,
  "a pass cannot be moved to another person",
);
assert.equal(verifyOwnerPass("garbage", now), null);

// The link puts the pass in the FRAGMENT, which browsers never send to a server.
const url = ownerSiteUrl("https://farmhouse.orangecat.ch/#old", pass);
assert.ok(url.startsWith("https://farmhouse.orangecat.ch/#"), url);
assert.ok(url.includes(`${OWNER_PASS_HASH_KEY}=`), url);
assert.ok(!url.includes("?"), "never a query string");

// Owner is earned, never asserted: the widget body may not claim it.
assert.ok(!(FEEDBACK_SELF_ASSERTED_SOURCES as readonly string[]).includes(FEEDBACK_SOURCE.OWNER));
const ingest = readFileSync("src/app/api/feedback/route.ts", "utf8");
assert.match(
  ingest,
  /z\.enum\(FEEDBACK_SELF_ASSERTED_SOURCES\)/,
  "body source uses the restricted list",
);
assert.match(ingest, /pass\.projectId === token\.projectId && pass\.userId === token\.userId/);
assert.match(ingest, /implementFeedback\(ownerUserId, feedbackId\)/, "owner notes start the fix");

// Owner notes merge themselves unless the project explicitly turned that off.
assert.equal(effectiveAutoShip(null, FEEDBACK_SOURCE.OWNER), true);
assert.equal(effectiveAutoShip(undefined, FEEDBACK_SOURCE.OWNER), true);
assert.equal(effectiveAutoShip(false, FEEDBACK_SOURCE.OWNER), false, "explicit off wins");
assert.equal(effectiveAutoShip(null, FEEDBACK_SOURCE.VISITOR), null, "strangers still wait");
assert.equal(effectiveAutoShip(true, FEEDBACK_SOURCE.VISITOR), true);
const attach = readFileSync("src/lib/feedback/attach-work.ts", "utf8");
assert.match(attach, /autoShip: effectiveAutoShip\(project\?\.autoShip, item\.source\)/);

// The Implement button and the owner note share one path.
const route = readFileSync("src/app/api/feedback/[id]/dispatch/route.ts", "utf8");
assert.match(route, /implementFeedback\(userId, idOrResp/);
assert.ok(!route.includes("injectPrompt"), "the route must not keep its own copy");

// The widget lifts the pass out of the fragment and leaves the rest intact, so
// a link copied from the address bar afterwards does not carry it.
assert.equal(passFromHash(new URL(url).hash), pass);
assert.equal(passFromHash("#section-2"), null);
assert.equal(hashWithoutPass(`#${OWNER_PASS_HASH_KEY}=abc`), "");
assert.equal(hashWithoutPass(`#tab=plan&${OWNER_PASS_HASH_KEY}=abc`), "#tab=plan");
const widget = readFileSync("widget/main.ts", "utf8");
assert.match(widget, /ownerPass: ownerPass \?\? undefined/, "the widget sends the pass");
assert.match(widget, /if \(ownerState\.arrived\) pendingReport = \{\}/, "arriving opens the note");

// Loki hands the pass only to the owner, on the Live link.
const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
assert.match(
  page,
  /dossier\.ownerId === session\.user\.id \? createOwnerPass\(id, session\.user\.id\) : null/,
);

// The agent is told the owner asked for it — a request to build, not a report.
const ownerFields = {
  suggestion: "Add a Back to top link",
  duplicateCount: 1,
  url: "https://farmhouse.orangecat.ch/",
  page: "/",
  scope: null,
  selectedElements: null,
};
assert.match(
  composeFeedbackFixPrompt({ ...ownerFields, source: "owner" }, "Farmhouse"),
  /^The owner of Farmhouse asked for this change/,
);
assert.match(composeFeedbackFixPrompt(ownerFields, "Farmhouse"), /^Fix this visitor feedback/);

console.log("owner-note-builds: ok");
