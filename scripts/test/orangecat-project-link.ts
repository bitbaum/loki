/**
 * The route OrangeCat asks before offering to build something it already has.
 *
 * OrangeCat's project page showed "Build it with Loki — one click: creates the
 * project and puts an agent on it" to owners of projects that had been
 * building in Loki for months, because nothing on that page could tell the
 * difference. This route is what it asks; these are the two properties that
 * make it safe to ask without a signature.
 *
 * Source-level, deliberately: the route reads the database, and what has to
 * hold is not a computed value but a SHAPE — consent is required, and the
 * answer for a non-consenting project is byte-identical to the answer for an
 * id nobody has ever heard of. Both are one deletion away from a leak that no
 * behavioural test on seeded data would notice.
 *
 * Run: npx tsx scripts/test/orangecat-project-link.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = readFileSync(join(ROOT, "src/app/api/orangecat/project-link/route.ts"), "utf8");
/**
 * The route WITHOUT its prose. The first version of the count below read the
 * doc comment's own example of the not-linked answer and reported two — a test
 * failing on a sentence that describes the thing it is checking.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const PROXY = readFileSync(join(ROOT, "src/proxy.ts"), "utf8");

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

// ── consent, not ownership ──────────────────────────────────────────────────
ok(
  /rows\.find\(\(r\) => r\.project\.listedPublicly\)/.test(SRC),
  "only a project whose owner consented to public listing is ever reported",
);
ok(
  /const match = /.test(SRC) && /if \(!match\)/.test(SRC),
  "...and everything else takes the not-linked exit",
);

// ── an unlisted project is indistinguishable from an unknown one ────────────
const notLinked = SRC.match(/\{ linked: false \}/g) ?? [];
ok(notLinked.length === 1, "there is exactly ONE not-linked answer, so it cannot drift apart");
ok(
  !/linked: false,\s*\n?\s*(name|reason|private|exists)/.test(SRC),
  "the not-linked answer carries no field that would distinguish private from absent",
);

// ── the destination is the reader's page, never the workspace ───────────────
ok(
  /publicProfilePath\(slug\)/.test(SRC),
  "the link returned is the public profile, built by the same helper /fleet uses",
);
ok(
  !/\/projects\//.test(SRC),
  "no workspace path is ever returned — that page is behind a sign-in, this answer is not",
);

// ── it is reachable, and the exception is written down ──────────────────────
ok(
  /api\/orangecat\//.test(PROXY),
  "the route is in the public matcher (OrangeCat asks it server-side, unauthenticated)",
);
ok(
  /project-link/.test(PROXY),
  "...and the proxy names it as the deliberate unsigned exception among the HMAC webhooks",
);

// ── a malformed id is a caller bug, not a lookup ────────────────────────────
ok(
  /UUID\.test\(projectId\)/.test(SRC) && /status: 400/.test(SRC),
  "a non-UUID is rejected before any query runs",
);

console.log(`${pass}/${pass + fail} orangecat-project-link cases passed`);
if (fail > 0) process.exit(1);
