/**
 * /setup must not offer "Create your admin account" once setup is done.
 *
 * Before 2026-10-01 the page was a client component that always rendered the
 * form; the API answered 409 "Setup already complete" after the visitor had
 * typed a name and two passwords. A dead end, publicly reachable.
 *
 * Pins both halves: the decision (any account → sign-in, none → the form) and
 * that the page actually asks it on the server before rendering anything.
 *
 * Run: npx tsx scripts/test/setup-redirects-when-done.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupRedirectFor } from "@/lib/setup-gate";
import { ROUTES } from "@/config/auth";

const page = readFileSync(new URL("../../src/app/setup/page.tsx", import.meta.url), "utf8");

assert.equal(setupRedirectFor(0), null, "a fresh install shows the setup form");
assert.equal(setupRedirectFor(1), ROUTES.SIGN_IN, "one account → sign-in");
assert.equal(setupRedirectFor(7), ROUTES.SIGN_IN, "many accounts → sign-in");

assert.ok(
  !/^\s*["']use client["']/m.test(page),
  "setup/page.tsx must be a server component — a client page cannot redirect before it renders the form",
);
assert.match(
  page,
  /setupRedirectFor\(await getUserCount\(\)\)/,
  "page asks the gate with the live count",
);
assert.match(page, /redirect\(/, "page redirects when the gate says so");
assert.match(
  page,
  /force-dynamic/,
  "the answer depends on the live DB, never a build-time snapshot",
);

console.log("setup-redirects-when-done: ok");
