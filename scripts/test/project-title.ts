/**
 * What a person reads as a project's name and one-line summary
 * (lib/project-display): the title when set; the site, not the
 * `<host>-refresh-<32 hex>` key the retired flow minted; and a website brief
 * said as a sentence, not as instructions to an agent. Also the handle a new
 * account is given when the plain one is taken (lib/onboarding-heal).
 *
 * Run: npx tsx scripts/test/project-title.ts
 */
import assert from "node:assert/strict";
import { projectHeadline, projectTitle, summarizeDescription } from "@/lib/project-display";
import { usernameCandidates } from "@/lib/onboarding-heal-decision";

const brief =
  "Develop a new version of this existing website: https://www.xhiva.art/\nRequested changes (the customer's exact words):\nHi, I would like you to…";
const legacy = "xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf";

assert.equal(
  projectTitle({ name: legacy, description: brief }),
  "Xhiva",
  "legacy key reads as the site",
);
assert.equal(projectTitle({ name: legacy }), "Xhiva", "…even without a description");
assert.equal(projectTitle({ name: legacy, title: "Xhiva Art" }), "Xhiva Art", "a title wins");
assert.equal(
  projectTitle({ name: "centersom", title: "  " }),
  "Centersom",
  "blank title is no title",
);
assert.equal(projectTitle({ name: "loki" }), "Loki", "a folder name reads as a word");
assert.equal(projectTitle({ name: "murphys-bar" }), "Murphys bar", "dashes become spaces");
assert.equal(projectTitle({ name: "orangecat-2" }), "Orangecat 2");
assert.equal(projectTitle({ name: "BiasLens" }), "BiasLens", "a name typed with capitals is kept");

assert.equal(projectHeadline(brief), "A new version of xhiva.art.");
assert.equal(summarizeDescription(brief, 145), "A new version of xhiva.art.");
assert.equal(
  summarizeDescription("Create a new, independent website inspired by: https://foo.ch/ more", 145),
  "A new website, inspired by foo.ch.",
);
assert.equal(
  projectHeadline("A bakery in Zürich."),
  "A bakery in Zürich.",
  "real descriptions untouched",
);

assert.deepEqual(usernameCandidates("ximena").slice(0, 3), ["ximena", "ximena2", "ximena3"]);
assert.ok(usernameCandidates("ximena").every((u) => /^[a-z0-9-]+$/.test(u)));

console.log("project-title: all checks passed");
