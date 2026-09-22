/**
 * A rotating refresh token cannot be replayed, and a dead link has to say so.
 *
 * WHAT HAPPENED (prod, measured 2026-09-21)
 * OrangeCat rotated this account's refresh token at 2026-09-17 07:42:44 and
 * issued a replacement that is still valid and was never used. Loki kept
 * presenting the one that rotation REVOKED at that instant, so every refresh
 * afterwards answered 400, `getOrangeCatLink` returned null, and every promote
 * was skipped as "feature unavailable". The last entry to reach anyone's
 * OrangeCat wall was posted eight minutes before that access token expired —
 * across every project, for four days — and the only trace was 66
 * `console.warn` lines on the box.
 *
 * Three invariants come out of that, and none of them can be unit-tested
 * without a database and an OAuth server, so they are held here against the
 * source. That is weaker than a behavioural test and much stronger than the
 * comment they replace — each one is a line somebody could delete while
 * "simplifying", and each deletion costs another silent outage.
 *
 * Run: npx tsx scripts/test/orangecat-link-recovery.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALERT_TYPES } from "@/config/alert-types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(ROOT, "src/lib/integrations/orangecat-identity.ts"), "utf8");

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

// 1. ONE refresh at a time per account.
//
// The promote path is fire-and-forget and the backfill cron fires up to 50 at
// once. Fifty concurrent refreshes present the same token: one rotates it, the
// other forty-nine are told invalid_grant. A burst was therefore guaranteed to
// look exactly like a broken link — which is what the 09:00 log burst was.
ok(
  /const inFlight = new Map<string, Promise<OrangeCatLink \| null>>\(\)/.test(SRC),
  "refreshes in flight are tracked per user",
);
ok(
  /const running = inFlight\.get\(userId\);\s*\n\s*if \(running\) return running;/.test(SRC),
  "a second caller waits for the refresh in flight instead of racing it",
);
ok(
  /Re-read inside the critical section/.test(SRC) &&
    SRC.indexOf("async function refreshLink") < SRC.indexOf("Re-read inside the critical section"),
  "...and then re-reads the row, so the loser uses the winner's token",
);

// 2. A SPENT refresh token is never written back.
//
// `data.refresh_token ?? account.refresh_token` reads as defensive and is the
// opposite: the presented token is revoked the moment it is accepted, so the
// fallback stores a credential that can only ever fail. That one `??` is the
// difference between a hiccup and a four-day outage.
ok(
  !/refresh_token: data\.refresh_token \?\? account\.refresh_token/.test(SRC),
  "a rotation response with no new token never re-stores the old one",
);
ok(
  /if \(!data\.refresh_token\) \{[\s\S]*?markLinkBroken\(userId\)/.test(SRC),
  "...it marks the link broken instead",
);

// 3. A dead link RAISES something a human will see.
//
// Only the owner can fix this — the OAuth consent screen needs a click — so
// the one thing the failure must do is reach them. It logged, 66 times.
ok(
  /if \(res\.status === 400\) await markLinkBroken\(userId\);/.test(SRC),
  "400 (invalid_grant) retires the credential and raises the alarm",
);
ok(
  !/if \(res\.status === 401\) await markLinkBroken/.test(SRC),
  "...while 401 and 5xx leave it alone — an OrangeCat outage must not unlink a healthy account",
);
ok(
  /refreshOrInsertActiveAlert\(\{[\s\S]*?type: "orangecat_link_broken"/.test(SRC),
  "the alert is raised, once per episode",
);
ok(
  "orangecat_link_broken" in ALERT_TYPES,
  "...and the type is registered, so the sweep cannot dismiss it as an orphan",
);
ok(
  /actionUrl: "\/settings"/.test(SRC),
  "...pointing at the page where re-linking actually happens",
);

// 4. The repair is REACHABLE.
//
// An alert that points at a page with no way to act on it is a dead end with
// a notification attached — and that is what this was: a broken OrangeCat link
// listed as "Connected" in green, with Disconnect as the only button, while
// every publish silently failed. CLAUDE.md's rule is the general form: anything
// that pauses a person shows the way forward on the same screen.
const ROUTE = readFileSync(join(ROOT, "src/app/api/me/connected-accounts/route.ts"), "utf8");
const SETTINGS = readFileSync(join(ROOT, "src/components/settings/AccountSettings.tsx"), "utf8");
ok(
  /getOrangeCatLink\(userId\)/.test(ROUTE),
  "the settings page RESOLVES the link rather than reading a column that may not have been written yet",
);
ok(
  /needsReconnect: provider === "orangecat" && !orangeCatWorks/.test(ROUTE),
  "...and reports health, not the presence of a row",
);
ok(
  /needsReconnect \?/.test(SETTINGS) && /Reconnect/.test(SETTINGS),
  "...and the row offers Reconnect instead of reading Connected in green",
);

console.log(`${pass}/${pass + fail} orangecat-link-recovery cases passed`);
if (fail > 0) process.exit(1);
