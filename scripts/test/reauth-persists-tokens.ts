/**
 * A re-authorization has to REPAIR the link, or it is a door that does not open.
 *
 * `DrizzleAdapter.linkAccount` writes an account's token set exactly once — on
 * the first connect. Every sign-in after that authenticates the person and
 * leaves the stored tokens alone. So the remedy every broken-link message
 * points at ("sign in with OrangeCat again", and the Reconnect button that
 * triggers it) could complete perfectly and change nothing.
 *
 * Measured on prod 2026-09-22, minutes after the owner pressed Reconnect:
 * OrangeCat had issued FIVE fresh token sets that day, none revoked, while
 * Loki's accounts row still held a null refresh token and an access token five
 * days expired. Both halves worked; the join between them did not exist.
 *
 * Run: npx tsx scripts/test/reauth-persists-tokens.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { carriesTokens } from "@/lib/auth/oauth-token-set";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUTH = readFileSync(join(ROOT, "src/auth.ts"), "utf8");
const LIB = readFileSync(join(ROOT, "src/lib/auth/persist-oauth-tokens.ts"), "utf8");

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// ── what counts as a token set worth storing ────────────────────────────────
const full = {
  provider: "orangecat",
  providerAccountId: "c9e52937-6020-4cc0-9bf5-5b41538248e5",
  access_token: "at",
  refresh_token: "rt",
  expires_at: 1_800_000_000,
};
ok(carriesTokens(full), "a complete OAuth account is stored");
ok(
  !carriesTokens({ provider: "credentials", providerAccountId: "u1" }),
  "a credentials sign-in carries nothing to act with, and writes nothing",
);
ok(
  !carriesTokens({ ...full, access_token: null }),
  "a set with no access token is not a set — writing it would empty a working link",
);
ok(!carriesTokens(undefined), "no account at all is not an error, just nothing to do");
ok(
  !carriesTokens({ ...full, providerAccountId: undefined }),
  "without the key half of the primary key there is no row to address",
);

// ── the write itself ────────────────────────────────────────────────────────
ok(
  /await persistOAuthTokens\(account as OAuthTokenSet, message\.user\.id\)/.test(AUTH),
  "events.signIn persists the set on EVERY sign-in, not only the first",
);
ok(
  /refresh_token: account\.refresh_token \?\? undefined/.test(LIB),
  "a provider that re-issues no refresh token does not cost us the one we hold",
);
ok(
  /expires_at: account\.expires_at \?\? null/.test(LIB),
  "...while an absent expiry IS written as null, so a stale one cannot outlive its token",
);
ok(
  !/provider === "orangecat"[\s\S]{0,80}return;/.test(LIB),
  "every provider is stored — a stale token is never the better answer for any of them",
);

// ── the alarm goes down with the fault ──────────────────────────────────────
ok(
  /dismissActiveAlertsByType\(userId, "orangecat_link_broken"\)/.test(LIB),
  "a repaired link dismisses the alert that reported it broken",
);

console.log(`${pass}/${pass + fail} reauth-persists-tokens cases passed`);
if (fail > 0) process.exit(1);
