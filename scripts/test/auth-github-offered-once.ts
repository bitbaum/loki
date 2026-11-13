/**
 * The first sign-in screen offers GitHub through one door. With Loki's own
 * GitHub app mounted, the shared sign-in's button stops naming GitHub.
 * Run: npx tsx scripts/test/auth-github-offered-once.ts
 */
import assert from "node:assert/strict";
import type { SignInMethods } from "@bitbaum/accountkit/auth";
import { offerGithubOnce } from "../../src/lib/auth/shared/screens";

const base: SignInMethods = {
  password: true,
  passkey: true,
  twoFactor: true,
  magicLink: true,
  verifyEmail: false,
  signin: true,
  signinProviders: ["Google", "GitHub"],
  orangecat: true,
  github: true,
} as SignInMethods;

// Loki's own GitHub button is mounted: the shared button names only Google.
const once = offerGithubOnce(base);
assert.deepEqual(once.signinProviders, ["Google"]);
assert.equal(once.signin, true);
assert.equal(once.github, true);
assert.deepEqual(base.signinProviders, ["Google", "GitHub"], "input is not mutated");

// Without Loki's own GitHub app, the shared button keeps GitHub.
assert.deepEqual(offerGithubOnce({ ...base, github: false }).signinProviders, ["Google", "GitHub"]);

// GitHub is all the shared service publishes: nothing is hidden, so accounts
// that came in that way are never stranded.
const onlyGithub = offerGithubOnce({ ...base, signinProviders: ["GitHub"] });
assert.equal(onlyGithub.signin, true);
assert.deepEqual(onlyGithub.signinProviders, ["GitHub"]);

// No published list yet: untouched.
assert.deepEqual(offerGithubOnce({ ...base, signinProviders: [] }).signinProviders, []);

console.log("✓ GitHub is offered once on the sign-in screens");
