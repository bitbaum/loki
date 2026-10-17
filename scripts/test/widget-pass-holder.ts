/**
 * Who may act as the site's owner in its widget: the owner and the project's
 * editors — nobody else, and never for another project.
 *
 * Run: npx tsx scripts/test/widget-pass-holder.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passAllows } from "../../src/lib/feedback/pass-rule";

const site = { projectId: "p1", userId: "owner" };
assert.ok(passAllows({ projectId: "p1", userId: "owner" }, site, false), "the owner");
assert.ok(passAllows({ projectId: "p1", userId: "editor" }, site, true), "an editor");
assert.ok(!passAllows({ projectId: "p1", userId: "viewer" }, site, false), "not a viewer");
assert.ok(
  !passAllows({ projectId: "p2", userId: "owner" }, site, true),
  "not another project's pass",
);
assert.ok(!passAllows(null, site, true), "not without a pass");

// Every route that honours a pass asks the same question.
for (const route of [
  "src/app/api/feedback/route.ts",
  "src/app/api/widget/advise/route.ts",
  "src/app/api/widget/self-report/route.ts",
  "src/app/api/widget/owner/changes/route.ts",
]) {
  assert.match(readFileSync(route, "utf8"), /passHolder\(/, `${route} uses passHolder`);
}
assert.match(
  readFileSync("src/app/api/widget/owner/route.ts", "utf8"),
  /canActForSite\(/,
  "issuing a pass uses the same rule",
);

console.log("widget-pass-holder: ok");

// Who is handed a pass on the project page — the rule behind "a Builder's
// note on the site builds at once; a viewer's waits for the owner".
import { mayHoldPass } from "../../src/lib/feedback/pass-rule";
assert.ok(mayHoldPass("owner"));
assert.ok(mayHoldPass("editor"), "a Builder holds a pass");
assert.ok(!mayHoldPass("viewer"));
assert.ok(!mayHoldPass("client"));
assert.ok(!mayHoldPass(null));
assert.match(
  readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8"),
  /mayHoldPass\(dossier\.viewerRole\)/,
  "the project page issues passes by that rule",
);
// Who asked is recorded from the pass, so the owner's inbox and the Builder's
// own list both know it without a claim.
assert.match(
  readFileSync("src/app/api/feedback/route.ts", "utf8"),
  /reporterUserId: holder\?\.userId/,
  "ingest records the pass holder as the reporter",
);
