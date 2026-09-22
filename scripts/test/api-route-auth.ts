/**
 * Every API route must declare how it authenticates.
 *
 * WHY THIS EXISTS
 * ---------------
 * There is no `middleware.ts`. Every one of the 214 routes under src/app/api
 * guards itself, and it does so through one of ELEVEN different mechanisms —
 * four session getters, two private-zone wrappers, a cron secret, a runner
 * bearer, a widget token, an agent token, and shared webhook secrets. Each is
 * individually reasonable; they are layers, not duplicates.
 *
 * The problem is that the set is not knowable by inspection. An audit on
 * 2026-08-25 took SEVEN passes to enumerate it, and the first pass reported 44
 * unguarded routes — including /api/people and /api/memory — every one of them
 * a false alarm caused by a helper the grep did not know about yet. A property
 * that takes seven attempts to check by hand is a property nobody checks, and
 * the failure mode is silent: a new route ships with no guard, and looks
 * exactly like the 25 that are public on purpose.
 *
 * So the rule is not "use one helper" — collapsing genuine layers would be
 * worse. The rule is: EVERY route either names a known mechanism, or appears
 * below with a reason a human wrote down.
 *
 * This runs in `npm run verify` (globbed by scripts/test-unit.ts) and needs no
 * database, network, or server.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname, relative, sep } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const API_ROOT = join(REPO, "src", "app", "api");

/**
 * Every mechanism that establishes WHO is calling. Adding a new one is a
 * deliberate act: it means a twelfth way to answer that question, so add it
 * here only after asking whether an existing layer already fits.
 */
const GUARDS = [
  // Session — src/lib/session.ts
  "getSessionUserId",
  "getApiUserId",
  "getApiActor",
  "resolveSessionUserId",
  // Session + private-zone PIN — src/lib/private-zone-api.ts
  "requirePrivateApiAccess", // also matches ...WithBearer
  // Scheduled jobs — src/lib/cron-auth.ts
  "requireCronAuth",
  // Machine callers
  "getBearerUserId", // ck_* runner/agent token, src/lib/runner-auth.ts
  "validateAgentToken",
  "getWidgetTokenByToken", // fcw_* write-only widget token
  // Signed webhooks from other services
  "WEBHOOK_SECRET",
  "readSignedOrangeCatBody", // the OrangeCat HMAC door — verifies WEBHOOK_SECRET
  // Guards reached through a shared handler factory. These are not a twelfth
  // way to answer "who is calling" — each one wraps a mechanism already listed
  // above. They are here because the rule is that a route must NAME its
  // mechanism, and a route that delegates names the delegate.
  "entityAttrHandlers", // → requirePrivateApiAccess, in src/lib/api/entity-attrs.ts
] as const;

/**
 * Routes that are public ON PURPOSE. The reason is the point of this list: it
 * is the only place the decision is written down, and the test below fails if
 * an entry stops being true, so it cannot quietly rot into a list of things
 * nobody re-examined.
 */
const PUBLIC: Record<string, string> = {
  // — Sign-in and account recovery. Public by definition: the caller has no
  //   session yet, which is the entire reason they are here.
  "auth/[...nextauth]": "NextAuth's own handler — owns the session it would otherwise check",
  "auth/register": "creates the account that a session would require",
  "auth/forgot-password": "pre-session recovery; guarded by emailed one-time token instead",
  "auth/reset-password": "pre-session recovery; the emailed token IS the credential",
  "auth/resend-verification":
    "pre-session; rate-limited, reveals nothing about whether the address exists",
  "x-login/start": "OAuth handshake begins before any session exists",
  "x-login/callback": "OAuth provider posts here; state parameter is the credential",

  // — Published on purpose: the fleet register is what the bitbaum showcase and
  //   the public footer derive from. Behind a session it would grow a private
  //   copy on every consumer, which is the seven-lists problem it replaces.
  //   Content is repo names, public URLs and whether a public profile exists —
  //   all already public. Scoped to the studio owner, cached 5 min.
  "fleet/register":
    "public register of the studio's projects. The payload is repo names, public URLs, who a site is for, and whether a public profile exists — all visible by opening the site itself. Commercial terms (apps.conf's plan/price) are deliberately NOT joined onto the row; buildFleetRegister omits them and scripts/test/fleet-register.ts asserts their absence, so 'nothing private here' stays a checked claim rather than a remembered intention. Scoped to the studio owner, cached 5 min.",

  "fleet/map":
    "public map of the studio's projects — the register above plus each project's purpose line, layer, hosting state, public doors, and what last moved on it (dev-log headline, last run outcome, open-run count). All of it is already published on the project pages and the register; prices, paths and tokens stay out. bitbaum renders it and the knowledge index embeds it, so a session would put a private copy on every consumer. Owner-scoped, cached 5 min.",

  "orangecat/project-link":
    'answers one question for OrangeCat\'s project page — is this OrangeCat project already being built in Loki, and where can a reader see the build record. It is asked before the page decides whether to offer "Build it with Loki" to someone who did that months ago, and it is what puts a public link to the build log in front of a funder. Nothing here is private BY CONSTRUCTION, not by intention: `linked: true` requires the Loki project to carry listed_publicly, so every field returned is already served at /fleet and /fleet/<slug>, and a project without that consent answers byte-identically to an id nobody has heard of. scripts/test/orangecat-project-link.ts holds both halves. A signature would protect nothing and would put a shared secret into a page render.',

  // — The bearer IS the credential; there is no user to look up first.
  "invitations/[token]": "unguessable invite token in the path is the credential",
  "invitations/[token]/accept": "same token; accepting is what creates the membership",
  "share/task/[token]":
    "an assignee has no account by design — the minted share token in the path IS their credential, it is looked up with revoked links excluded, and the only write it permits is accept/decline/deliver on that one assignment",

  // — Bootstrap and installers. Deliberately fetchable without an account.
  setup: "first-run only — returns 409 once any user exists (verified)",
  "agent/install": "serves the agent CLI body so a new customer can install before signing in",
  "agent/daemon": "serves the shell daemon tarball; same bootstrap reason",

  // — Operator-local surfaces. These read the BOX's own state via TOOLS_DIR,
  //   not any user's records, so there is no per-user data to scope.
  github: "runs github-status.sh against the box; no user-scoped data in the response",
  calendar: "box-local calendar tool; no user-scoped data in the response",

  // — Intentional, with the reasoning recorded at the route itself.
  "debug-log": "client error reporter — see the route's own comment on why it takes no auth",
  health: "liveness probe; must answer before anything else works",
  newsletter: "public marketing signup — email address only",
  "control/transcribe": "one-line re-export of /api/beacon/transcribe, which carries the guard",
};

// ── walk ────────────────────────────────────────────────────────────────────
function routeFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(p, out);
    else if (entry.name === "route.ts") out.push(p);
  }
  return out;
}

const files = routeFiles(API_ROOT).sort();
if (files.length === 0) {
  console.error("✗ api-route-auth: found no route files — the walk is broken, not the routes");
  process.exit(1);
}

const problems: string[] = [];
const guarded = new Set<string>();
const claimedPublic = new Set<string>();

for (const file of files) {
  const id = relative(API_ROOT, dirname(file)).split("\\").join("/");
  const src = readFileSync(file, "utf8");
  const hasGuard = GUARDS.some((g) => src.includes(g));

  if (hasGuard) {
    guarded.add(id);
    // An allowlist entry for a route that now guards itself is stale, and a
    // stale exemption is how a real hole hides later.
    if (id in PUBLIC) {
      problems.push(
        `${id} is on the PUBLIC list but now calls a guard — delete its entry (it no longer describes the route)`,
      );
    }
    continue;
  }

  if (id in PUBLIC) {
    claimedPublic.add(id);
    continue;
  }

  problems.push(
    `${id} names no known auth mechanism and is not on the PUBLIC list.\n` +
      `      Add the guard it should use, or add it to PUBLIC in this file WITH THE REASON.`,
  );
}

// Entries pointing at routes that no longer exist: harmless today, misleading
// tomorrow when someone re-creates the path and inherits an exemption.
for (const id of Object.keys(PUBLIC)) {
  if (!claimedPublic.has(id) && !guarded.has(id)) {
    problems.push(`${id} is on the PUBLIC list but no such route exists — delete the entry`);
  }
}

// ── a self-authenticating route must be EXEMPT from the session middleware ──
//
// THIRD occurrence of this class, so it gets a derived check rather than
// another hand-maintained list:
//
//   1. vitareba 2026-08-07 — the `/api` matcher blocked LOGIN itself.
//   2. loki 2026-08-13 — `api/solon/` missing from the matcher; the
//      Solon doorbell was unreachable from the day it shipped.
//   3. loki 2026-09-11 — the OrangeCat site door shipped at
//      `api/integrations/orangecat/site`, outside every exempt prefix.
//
// The existing pin in solon-message.ts checks that a hardcoded list of
// PREFIXES appears in the matcher. It passed all three times — occurrence 3
// included — because `api/orangecat/` was indeed exempt. What nothing checked
// is the other direction: that every route which authenticates ITSELF actually
// LIVES under one of those prefixes. A receiver put somewhere tidier deploys
// green and 401s every caller, signed or not.
//
// So this derives the receivers from the source. Any route calling an HMAC or
// shared-secret verifier is a self-authenticating route, wherever it sits, and
// its path must fall inside the matcher's exemption.
//
// Why the failure is worth a gate rather than vigilance: the middleware's 401
// is indistinguishable from the route's own 401 for a bad secret, so the first
// instinct is to suspect the credential — the one thing that was fine. Only a
// SIGNED replay tells them apart, and nobody signs a replay for a route they
// believe they just shipped correctly.
const SELF_AUTH_MARKERS = [
  "verifyOrangeCatWebhookSignature",
  "readSignedOrangeCatBody", // the same check, moved behind one door
  "verifySolonSignature",
  "stripe.webhooks.constructEvent",
  "requireCronAuth",
];

const matcherExclusion = readFileSync(join(REPO, "src", "proxy.ts"), "utf8").match(
  /"\/\(\(\?!(.+)\)\.\+\)"/,
)?.[1];
if (!matcherExclusion) {
  problems.push("src/proxy.ts: the matcher exclusion pattern could not be read at all");
} else {
  const exemptPrefixes = matcherExclusion.split("|").map((p) => p.replace(/\\\./g, "."));
  let selfAuthFound = 0;
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const marker = SELF_AUTH_MARKERS.find((m) => src.includes(m));
    if (!marker) continue;
    selfAuthFound += 1;

    // "api/orangecat/site" — the URL path, route groups and the file name gone.
    const urlPath = relative(API_ROOT, dirname(file)).split(sep).join("/");
    const full = `api/${urlPath}`;
    const exempt = exemptPrefixes.some((prefix) => prefix && full.startsWith(prefix));
    if (!exempt) {
      problems.push(
        `${urlPath} authenticates itself (${marker}) but its path is NOT exempt in the ` +
          `proxy.ts matcher — the session middleware will 401 every caller, including a ` +
          `correctly signed one, before this route runs. Move it under an exempt prefix ` +
          `(api/orangecat/, api/solon/, …) or add its prefix to the matcher.`,
      );
    }
  }

  // Finding nothing is not the same as finding nothing wrong. This check is
  // derived from markers in the source, so the day a receiver stops naming one
  // — by moving its verification behind a helper, which is exactly what
  // happened to the three OrangeCat routes — the loop above examines zero
  // routes and reports success. An empty result here means the markers are
  // stale, not that the matcher is correct.
  if (selfAuthFound === 0) {
    problems.push(
      "no route matched any SELF_AUTH_MARKERS — the markers are stale, so the " +
        "proxy-exemption check silently examined nothing. Update SELF_AUTH_MARKERS.",
    );
  }
}

if (problems.length > 0) {
  console.error("✗ api-route-auth:");
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `✓ api-route-auth: ${files.length} routes — ${guarded.size} guarded, ` +
    `${claimedPublic.size} public with a recorded reason`,
);
