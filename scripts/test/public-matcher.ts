// Pins WHICH paths the auth middleware lets through without a session.
//
// WHY THIS EARNS A TEST
// The public surface of this app is one regex in src/proxy.ts — a single
// negative lookahead listing ~45 prefixes. Every entry is a decision to serve
// someone with no account, and the list is edited by hand, by people adding one
// more prefix to make one more link work.
//
// The failure mode is not subtle, it is catastrophic and silent. The entries
// are bare prefixes, so adding `a` instead of `a/` — one character — would make
// `/approvals`, `/api/...`, `/agent`, every path beginning with that letter
// public, and nothing would look broken: the app would still work, better even,
// because nobody would be asked to log in. Exactly the direction a human
// reviewer is least likely to notice.
//
// So this asserts BOTH directions on the real regex, read from the real file:
// the things that must be reachable without a session, and — the point — the
// things that must NOT be. A test that only checked the public list would pass
// happily on a regex that made the whole app public.
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = readFileSync(join(REPO, "src", "proxy.ts"), "utf8");

// Pull the matcher out of the source rather than re-declaring it here: a copy
// of the pattern in the test is a test of the copy, which is exactly the thing
// that cannot drift with the file it guards.
//
// Anchored on the pattern's own shape rather than on `matcher: [`, because a
// long explanatory comment sits between the two. Failing to FIND the pattern
// exits hard rather than skipping — a test that quietly stops checking is the
// same silent no-op this file exists to catch.
const match = source.match(/"(\/\(\(\?!(?:[^"\\]|\\.)*)"/);
if (!match) {
  console.log("✗ could not find the matcher pattern in src/proxy.ts");
  process.exit(1);
}
// The source contains a TS string literal, so `\\.` in the file is `\.` in the
// actual regex. Un-escape exactly once to recover the pattern Next.js compiles.
const pattern = match[1].replace(/\\\\/g, "\\");
const matcher = new RegExp(`^${pattern}$`);

/** Next.js runs the auth middleware on paths the matcher MATCHES. */
const isProtected = (path: string) => matcher.test(path);

let pass = 0;
const cases: Array<[string, boolean]> = [];
const check = (name: string, cond: boolean) => {
  cases.push([name, cond]);
  if (cond) pass++;
};

// ── Public by design ────────────────────────────────────────────────────────
const TOKEN =
  "8337d0fe-1bb1-4c40-98e5-4961196b8de2.00000000-0000-0000-0000-000000000001.approve.1789735075045.16YvawjpRnp";
check("a one-tap action link is reachable without a session", !isProtected(`/a/${TOKEN}`));
check("so is a short one", !isProtected("/a/xyz"));
for (const p of [
  "/sign-in",
  "/claim-feedback",
  "/share/task/abc",
  "/api/health",
  "/api/invitations/abc",
  "/blog/some-post",
]) {
  check(`${p} stays public`, !isProtected(p));
}

// ── PROTECTED — the direction that matters ──────────────────────────────────
// Each of these begins with "a", and each would become public if the entry were
// written `a` instead of `a/`. This block is the whole reason the file exists.
for (const p of [
  "/approvals",
  "/approvals?focus=abc",
  "/api/actions/pending",
  "/api/actions/8337d0fe/decision",
  "/api/me/preferences",
  "/agent",
  "/activity",
  "/about",
]) {
  check(`${p} still requires a session`, isProtected(p));
}
// And the ordinary app is untouched.
for (const p of ["/today", "/control", "/people", "/settings"]) {
  check(`${p} still requires a session`, isProtected(p));
}
// A bare "/a" is not an action link and must not ride the exemption.
check("/a (no token) still requires a session", isProtected("/a"));

// ── The check can still fail ────────────────────────────────────────────────
// A regex that stopped matching anything would pass every "is public" assertion
// above in silence. Prove it still classifies something as protected at all.
check(
  "the matcher is not inert (it protects a random deep path)",
  isProtected("/some/deep/protected/path"),
);
check("the matcher was parsed, not empty", pattern.length > 100);

for (const [name, ok] of cases) console.log(`${ok ? "✓" : "✗"} ${name}`);
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
