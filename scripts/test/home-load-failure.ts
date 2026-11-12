/**
 * Home says why it is empty instead of loading forever.
 *
 * QA's seat (2026-11-12) opened /control with a session that could not read
 * Home: /api/control answered 401, `data` stayed null, and Home showed its
 * skeleton cards for as long as the page was open.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { homeLoadFailure } from "../../src/components/control/home-parts";

const unauth = homeLoadFailure("HTTP 401");
assert.equal(unauth.action, "sign-in");
assert.match(unauth.body, /not signed in/);
assert.equal(homeLoadFailure("HTTP 403").action, "sign-in");
const broken = homeLoadFailure("HTTP 500");
assert.equal(broken.action, "retry");
assert.match(broken.body, /HTTP 500/);
const offline = homeLoadFailure("Failed to fetch");
assert.equal(offline.action, "retry");
assert.match(offline.body, /could not be reached \(Failed to fetch\)/);

const panel = fs.readFileSync("src/components/control/ControlPanel.tsx", "utf8");
assert.match(
  panel,
  /if \(!data\)\s*return error \? \(\s*<HomeLoadFailed error=\{error\}/,
  "a failed read shows the failure, not the skeleton",
);
assert.match(
  fs.readFileSync("src/components/control/home-parts.tsx", "utf8"),
  /href="\/sign-in\?callbackUrl=%2Fcontrol"/,
  "sign-in comes back to Home",
);
console.log("home-load-failure ok");
