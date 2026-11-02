// The deploy's provider check (scripts/expected-auth-providers.ts) expects what
// the runtime actually mounts, and the sign-in pages show the shared sign-in
// exactly when AccountKit mounts it.
// Run: npx tsx scripts/test/deploy-expected-providers.ts
import { expectedAuthProviders } from "../expected-auth-providers";
import { getEnabledAuthProviders, PAUSED_PROVIDERS, sharedSigninLabel } from "@/lib/auth-providers";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

const ORANGECAT = {
  ORANGECAT_OAUTH_ISSUER: "https://orangecat.ch",
  ORANGECAT_OAUTH_CLIENT_ID: "loki",
  ORANGECAT_OAUTH_CLIENT_SECRET: "set",
};
const SIGNIN = {
  SIGNIN_ISSUER: "https://signin.example.test",
  SIGNIN_CLIENT_ID: "loki",
  SIGNIN_CLIENT_SECRET: "set",
};
const same = (a: string[], b: string[]) => a.join(" ") === b.join(" ");

ok(
  "Auth.js: the unpaused social providers and the password form",
  same(expectedAuthProviders({}), [
    ...(["github", "google", "x"] as const)
      .filter((p) => !PAUSED_PROVIDERS[p])
      .map((p) => (p === "x" ? "x-1a" : p)),
    "email-password",
  ]),
);
ok(
  "AccountKit, no OIDC env: the password form only",
  same(expectedAuthProviders({ AUTH_RUNTIME: "accountkit" }), ["email-password"]),
);
ok(
  "AccountKit with OrangeCat: OrangeCat is expected",
  same(expectedAuthProviders({ AUTH_RUNTIME: "accountkit", ...ORANGECAT }), [
    "email-password",
    "orangecat",
  ]),
);
ok(
  "AccountKit with both: the shared sign-in is expected too",
  same(expectedAuthProviders({ AUTH_RUNTIME: "accountkit", ...ORANGECAT, ...SIGNIN }), [
    "email-password",
    "bitbaum-signin",
    "orangecat",
  ]),
);
ok(
  "AccountKit with Loki's own GitHub app: GitHub is expected",
  same(
    expectedAuthProviders({
      AUTH_RUNTIME: "accountkit",
      ...ORANGECAT,
      GITHUB_CLIENT_ID: "loki",
      GITHUB_CLIENT_SECRET: "set",
    }),
    ["github", "email-password", "orangecat"],
  ),
);
ok(
  "AccountKit, shared sign-in without its secret: not expected",
  same(expectedAuthProviders({ AUTH_RUNTIME: "accountkit", ...SIGNIN, SIGNIN_CLIENT_SECRET: "" }), [
    "email-password",
  ]),
);

const saved = { ...process.env };
Object.assign(process.env, SIGNIN);
delete process.env.AUTH_RUNTIME;
ok("Auth.js: no shared sign-in button (nothing mounts it)", !getEnabledAuthProviders().signin);
process.env.AUTH_RUNTIME = "accountkit";
const enabled = getEnabledAuthProviders();
ok("AccountKit with SIGNIN_*: the shared sign-in button shows", enabled.signin);
ok(
  "the button uses AccountKit's own words",
  sharedSigninLabel(enabled) === "Continue with Google, Apple, GitHub, X or Facebook",
);
process.env.SIGNIN_CLIENT_SECRET = "";
ok("a missing secret hides it", sharedSigninLabel(getEnabledAuthProviders()) === null);
process.env = saved;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
