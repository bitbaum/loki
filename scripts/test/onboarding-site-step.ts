// The first thing a new person does with Loki should be the whole product:
// sign up, say where their site is, put Loki on it, open it and say the first
// change from there. Pinned here as source facts, since the flow has no pure
// core: a project can be created with its website; the widget token answers
// with the one link that makes it real (the site with the owner pass); the
// onboarding has the step, with the snippet, the agent install when there is
// a repo, and a landing on the project instead of Control; and a failed
// project creation no longer advances the step in silence.
// Run: npx tsx scripts/test/onboarding-site-step.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSiteUrl } from "@/lib/site-url";

const route = readFileSync("src/app/api/user-projects/route.ts", "utf8");
assert.match(
  route,
  /liveUrl: z\.preprocess\(emptyToUndefined, z\.string\(\)\.trim\(\)\.url\(\)/,
  "a project is created with its website",
);

const token = readFileSync("src/app/api/projects/[id]/widget-token/route.ts", "utf8");
assert.match(
  token,
  /ownerSiteUrl\(up\.liveUrl, createOwnerPass\(projectId, userId\)\)/,
  "the token comes with the way onto the site, pass in the fragment",
);
assert.match(token, /openSiteUrl: await openSiteUrl\(userId, idOrResp\)/, "on create");
assert.match(
  token,
  /openSiteUrl: token \? await openSiteUrl\(userId, idOrResp\) : null/,
  "and on read",
);

const page = readFileSync("src/app/onboarding/page.tsx", "utf8");
assert.match(page, /"username" \| "project" \| "site" \| "connect"/, "the step exists");
assert.match(
  page,
  /htmlFor="onboarding-live-url"/,
  "the field is labelled the way auth-a11y expects",
);
assert.match(page, /id="onboarding-live-url"/);
assert.match(
  page,
  /if \(!res\.ok\) await throwApiError\(res, "Could not add the project"\)/,
  "a refused project no longer advances in silence",
);
assert.match(
  page,
  /\/widget-token`, \{\}\)/,
  "the token is minted right after the project, so its origin is the site's",
);
assert.match(page, /Put Loki on your site/, "the step says what it is");
assert.match(page, /Let an agent add it/, "an agent adds the line when there is a repo");
assert.match(page, /Open your site with Loki →/, "and the site opens with Loki on it");
assert.match(
  page,
  /router\.push\(site \? `\/projects\/\$\{site\.entityProjectId\}` : "\/control"\)/,
  "someone with a site lands on it, not on Control",
);
assert.match(
  page,
  /steps=\{site \? 4 : 3\}/,
  "the progress bar counts the step only when it exists",
);

// normalizeSiteUrl: what people type becomes a URL, or nothing.
assert.equal(normalizeSiteUrl("heidi.orangecat.ch"), "https://heidi.orangecat.ch/");
assert.equal(normalizeSiteUrl("  https://evig.orangecat.ch/de "), "https://evig.orangecat.ch/de");
assert.equal(normalizeSiteUrl("localhost"), null, "a bare word is not a site");
assert.equal(normalizeSiteUrl(""), null);

// Or get help: the two other doors, at the moments a build stalls.
const help = readFileSync("src/components/projects/GetHelpLine.tsx", "utf8");
assert.match(
  help,
  /BUILD_PATHS\.filter\(\(p\) => p\.id !== "yourself"\)/,
  "the same list as the landing page, minus do-it-yourself",
);
assert.match(help, /#brief=/, "the studio gets the brief, as /change hands it over");
const status = readFileSync("src/components/projects/ProjectBuildStatus.tsx", "utf8");
assert.match(
  status,
  /status\.kind === "stalled" && <GetHelpLine/,
  "offered when stalled on the owner, never while moving",
);
const kickoff = readFileSync("src/components/projects/ProjectKickoff.tsx", "utf8");
assert.match(kickoff, /<GetHelpLine brief=\{brief\} \/>/, "and when no agent could be started");

console.log("onboarding-site-step: ok");
