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
