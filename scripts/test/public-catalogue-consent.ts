// Loki's own public catalogue may list a project only if its owner said yes.
//
// /fleet is unauthenticated and speaks for the PRODUCT, not for a user. It used
// to resolve one account — getSelfImprovementTarget(), i.e. whoever owns the
// oldest entity named "loki" — and publish every project that account had, via
// getUserProjects. Nothing recorded a decision, because nothing asked for one:
// a project was on a public page because it existed. In a multi-tenant product
// that is backwards, and it was also a latent hand-over — reseed that entity
// and the next-oldest match's whole project list becomes Loki's front page.
//
// The rule this pins: a public surface reads CONSENT (listed_publicly), never
// ownership. Prose in a comment cannot hold that line through a refactor —
// swapping one import back is a one-word change — so the gate holds it.
//
// Run: npx tsx scripts/test/public-catalogue-consent.ts
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

const fleetPage = readFileSync(join(ROOT, "src/app/fleet/page.tsx"), "utf8");
const projectsQuery = readFileSync(join(ROOT, "src/db/queries/user-projects.ts"), "utf8");
const schema = readFileSync(join(ROOT, "src/db/schema/user-projects.ts"), "utf8");
const registerNote = readFileSync(
  join(ROOT, "src/components/projects/FleetRegisterNote.tsx"),
  "utf8",
);
const visibility = readFileSync(join(ROOT, "src/db/queries/public-visibility.ts"), "utf8");
const heroQuery = readFileSync(join(ROOT, "src/db/queries/public-fleet.ts"), "utf8");
const landing = readFileSync(join(ROOT, "src/app/page.tsx"), "utf8");
const projectRoute = readFileSync(join(ROOT, "src/app/api/projects/[id]/route.ts"), "utf8");
const profile = readFileSync(join(ROOT, "src/app/u/[username]/page.tsx"), "utf8");

// ── The column exists, and defaults to withholding consent ──────────────────
ok(
  /listedPublicly:\s*boolean\("listed_publicly"\)/.test(schema),
  "user_projects carries a listed_publicly column",
);
ok(
  /listedPublicly:\s*boolean\("listed_publicly"\)\.default\(false\)\.notNull\(\)/.test(schema),
  "listed_publicly defaults to FALSE — signing up must never enrol a tenant",
);

// ── The public catalogue reads consent, not ownership ───────────────────────
ok(/getPubliclyListedProjects/.test(fleetPage), "/fleet asks for publicly-listed projects");
ok(
  !/getUserProjects\s*\(/.test(fleetPage),
  "/fleet does NOT call getUserProjects — that published every row an account had",
);
ok(
  /eq\(userProjects\.listedPublicly,\s*true\)/.test(projectsQuery),
  "getPubliclyListedProjects filters on the consent column itself",
);

// A consenting-but-retired project should not linger in the shop window.
ok(
  /eq\(userProjects\.isActive,\s*true\)/.test(visibility),
  "the public catalogue tier is also scoped to active projects",
);

// ── The box register is not every tenant's business ─────────────────────────
// apps.conf describes ONE box and is a file in this repo. Rendered unscoped it
// told a brand-new account "19 sites are hosted on the box with no project
// here" about sites it does not own.
ok(
  /getSelfImprovementTarget/.test(registerNote) &&
    /owner\.userId\s*!==\s*userId/.test(registerNote),
  "the box-register note is shown only to the account that operates that box",
);

// ── The showcase is the catalogue narrowed, never a second opinion ─────────
// The one property worth a gate of its own: withdrawing consent must drop a
// project off the homepage even while it is still featured. That only holds
// while the showcase predicate is BUILT ON the catalogue predicate — written
// as isNotNull(featuredAt) alone it would silently invert.
ok(
  /featuredAt:\s*timestamp\("featured_at"/.test(schema),
  "user_projects carries a featured_at stamp for the operator's pick",
);
ok(
  /PUBLIC_SHOWCASE_WHERE[\s\S]{0,240}PUBLIC_CATALOGUE_WHERE/.test(visibility),
  "the showcase predicate is built ON the catalogue predicate — featuring cannot bypass consent",
);
ok(
  /isNotNull\(userProjects\.featuredAt\)/.test(visibility),
  "the showcase predicate also requires an actual feature decision",
);

// ── The landing speaks for the product, not for one account ────────────────
ok(
  /export async function getHeroFleetSnapshot\(\)/.test(heroQuery),
  "the hero snapshot takes NO userId — it is fleet-wide, not one account's",
);
ok(!/getPublicProjects/.test(heroQuery), "the hero does not read one account's public projects");
ok(/getShowcaseProjects/.test(heroQuery), "the hero reads the showcase tier");
ok(
  !/getHeroFleetSnapshot\([^)]+\)/.test(landing),
  "the landing calls the hero snapshot with no owner argument",
);
ok(
  !/const FLAGSHIPS/.test(heroQuery) && !/const FLAGSHIPS/.test(profile),
  "no page hardcodes a flagship name list — featuring is per project and stored",
);

// ── Featuring is the operator's, and only the operator's ───────────────────
ok(
  /isSiteOperator/.test(projectRoute) && /403/.test(projectRoute),
  "the project route refuses to feature unless the caller runs this instance",
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
