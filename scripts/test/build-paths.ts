// The three ways to get something built — yourself, with a partner, by the
// studio — are one list (config/build-paths.ts), and every door a newcomer
// meets ends in it. Pinned here: the list is exactly those three and each
// points at a real address; /build is public and names the site the person
// came from without trusting it; the landing page and the final CTA carry the
// doors; the tour's "Get this for your site" and the widget's "made with"
// line both land on /build; and no "Start a project" sends a newcomer to
// sign-IN (it did, on six marketing pages, for months).
// Run: npx tsx scripts/test/build-paths.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILD_PAGE, BUILD_PATHS, buildPageHref, fromHost } from "@/config/build-paths";
import { COMMISSION } from "@/config/commission";
import { ROUTES } from "@/config/auth";
import { STUDIO_DOORS } from "@/lib/widget-chat/concierge";

// ---- the list ----
assert.deepEqual(
  BUILD_PATHS.map((p) => p.id),
  ["yourself", "partner", "studio"],
  "three ways, in the order a person would try them",
);
const byId = Object.fromEntries(BUILD_PATHS.map((p) => [p.id, p]));
assert.equal(
  byId.yourself.href,
  ROUTES.SIGN_UP,
  "doing it yourself starts at sign-up, not sign-in",
);
assert.equal(
  byId.partner.href,
  "https://bitbaum.orangecat.ch/partners/",
  "the partner directory is the one list, on bitbaum",
);
assert.equal(
  byId.studio.href,
  COMMISSION.studioHireUrl,
  "hiring the studio is the commission config's address",
);
for (const p of BUILD_PATHS) {
  for (const field of ["who", "title", "body", "cta"] as const)
    assert.ok(p[field].trim(), `${p.id}.${field}`);
  assert.ok(!/\bsats?\b|crypto/i.test(p.body), "house words");
}

// ---- /build and the link to it ----
assert.equal(BUILD_PAGE.path, "/build");
assert.equal(
  buildPageHref("https://loki.test", "heidi.orangecat.ch"),
  "https://loki.test/build?from=heidi.orangecat.ch",
);
assert.equal(
  buildPageHref("https://loki.test", "https://heidi.orangecat.ch/de/situations/x"),
  "https://loki.test/build?from=heidi.orangecat.ch",
  "an origin or a URL is reduced to its host",
);
assert.equal(buildPageHref("https://loki.test", null), "https://loki.test/build");
assert.equal(
  buildPageHref("https://loki.test", "<script>"),
  "https://loki.test/build",
  "junk is dropped, not carried",
);
assert.equal(fromHost("heidi.orangecat.ch"), "heidi.orangecat.ch");
assert.equal(fromHost("evil.example/path"), null, "only a hostname is named on the page");
assert.equal(fromHost(["a.b", "c.d"]), "a.b");
assert.equal(fromHost("localhost"), null, "a bare word is not a site");

// ---- every door ends here ----
const proxy = readFileSync("src/proxy.ts", "utf8");
assert.match(proxy, /\|build\(\?:\/\|\$\)\|/, "/build is public");
const landing = readFileSync("src/app/page.tsx", "utf8");
assert.match(landing, /<BuildPaths /, "the landing page shows the three doors");
assert.match(landing, /href=\{BUILD_PAGE\.path\}/, "and the closing line names the other two ways");
const finalCta = readFileSync("src/components/public/FinalCta.tsx", "utf8");
assert.match(finalCta, /ROUTES\.SIGN_UP/, "Start a project goes to sign-up");
assert.ok(!/ROUTES\.SIGN_IN/.test(finalCta), "never to sign-in");
for (const brief of [
  "src/components/public/TakeRepoBrief.tsx",
  "src/components/public/WebsiteChangeBrief.tsx",
]) {
  const src = readFileSync(brief, "utf8");
  assert.ok(
    !/ROUTES\.SIGN_IN\}\?callbackUrl/.test(src),
    `${brief}: a stranger with a brief is sent to sign-up`,
  );
  assert.match(src, /ROUTES\.SIGN_UP\}\?callbackUrl/, `${brief}: with the brief kept`);
}
const tour = readFileSync("src/app/api/widget/tour/route.ts", "utf8");
assert.match(
  tour,
  /buildPageHref\(appUrl\(\), from\)/,
  "a viewer who watched a fix land is invited to /build, naming the site",
);
const main = readFileSync("widget/main.ts", "utf8");
assert.match(
  main,
  /\/build\?from=\$\{encodeURIComponent\(location\.hostname\)\}/,
  "the widget's made-with line lands on /build",
);
assert.match(
  main,
  /madeWith\.style\.display = ownerPass \? "none" : ""/,
  "and the owner does not see it",
);
const door = STUDIO_DOORS.find((d) => d.label === "Build something of your own");
assert.ok(door, "the concierge can hand out Loki's own door");
assert.ok(door!.url.endsWith("/build"), door!.url);
assert.equal(
  STUDIO_DOORS[STUDIO_DOORS.length - 1],
  door,
  "appended last: the concierge test addresses the others by index",
);
const page = readFileSync("src/app/build/page.tsx", "utf8");
assert.match(page, /fromHost\(from\)/, "the page names only a validated host");

console.log("build-paths: ok");
