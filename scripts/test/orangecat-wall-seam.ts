/**
 * The two rules on the Loki → OrangeCat wall seam, and the switch behind them.
 *
 * Both failed in production, four days apart, and both were invisible from
 * inside Loki — the symptom in each case is on somebody else's page.
 *
 *   1. WHERE an entry points. Every wall entry ever published carried
 *      `${LOKI_PUBLIC_ORIGIN}/projects`, a hardcoded private dashboard. A
 *      reader following "via Loki" from Heidi's OrangeCat page got a sign-in
 *      form; the owner got all 36 projects. Twelve such links on that one page.
 *
 *   2. WHETHER Loki may post at all. Publishing a project created its public
 *      page AND enrolled it in a live feed of everything its agents did, with
 *      no switch anywhere — "stop telling everyone what my agents are doing"
 *      cost you the funding page.
 *
 * Run: npx tsx scripts/test/orangecat-wall-seam.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mayPostActivity, wallLinkFor } from "@/lib/integrations/orangecat-wall-link";
import { LOKI_PUBLIC_ORIGIN } from "@/config/orangecat-publish";

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

const listed = {
  slug: "heidi",
  gitUrl: "https://github.com/bitbaum/heidi",
  name: "Heidi",
  listedPublicly: true,
  orangecatAutopost: true,
};

// ------------------------------------------------------------ where it goes --

ok(
  wallLinkFor(listed) === `${LOKI_PUBLIC_ORIGIN}/fleet/heidi`,
  "a wall entry points at the project's own public profile",
);
ok(
  !wallLinkFor(listed).includes("/projects"),
  "never the private dashboard — that is the bug this file exists for",
);
ok(
  wallLinkFor({ ...listed, slug: null }) === `${LOKI_PUBLIC_ORIGIN}/fleet/heidi`,
  "with no stored slug the repo name is the identity, as the register derives it",
);
ok(
  wallLinkFor({ ...listed, slug: null, gitUrl: null, name: "AOZ Begleitung" }) ===
    `${LOKI_PUBLIC_ORIGIN}/fleet/aoz-begleitung`,
  "...and the display name folds to a slug the same way, or the URL would 404",
);
ok(
  wallLinkFor({ ...listed, listedPublicly: false }) === `${LOKI_PUBLIC_ORIGIN}/fleet`,
  "without listing consent there is no profile page, so the catalogue answers",
);
ok(
  wallLinkFor(undefined) === `${LOKI_PUBLIC_ORIGIN}/fleet`,
  "an unreadable project still yields a public page, never a login wall",
);

// --------------------------------------------------------- whether it posts --

ok(mayPostActivity({ orangecatAutopost: true }), "an explicit yes posts");
ok(!mayPostActivity({ orangecatAutopost: false }), "an explicit no does not");
ok(
  !mayPostActivity({ orangecatAutopost: null }),
  "and neither does silence — an unanswered question is not consent",
);
ok(!mayPostActivity(undefined), "nor a project that cannot be read");

// ------------------------------------------------- the rule reaches the wire --

// The predicate is only worth having if the one call site that posts consults
// it. A pure function nobody calls is exactly how the /projects link survived
// every review it ever had.
const publish = readFileSync(join(ROOT, "src/lib/integrations/orangecat-publish.ts"), "utf8");
ok(
  /if \(!mayPostActivity\(project\)\) return "skipped";/.test(publish),
  "promoteMomentToOrangeCat refuses to post without consent",
);
ok(
  /url: wallLinkFor\(project\)/.test(publish),
  "...and every entry's back-link is built by the rule above",
);
ok(
  !/\$\{LOKI_PUBLIC_ORIGIN\}\/projects/.test(publish),
  "...with no hardcoded dashboard link left in the module",
);

// Reversible in both directions, or it is not a choice: publishing records an
// answer, PATCH changes it later, and taking the page down forgets it rather
// than leaving consent standing for a page that no longer exists.
const route = readFileSync(
  join(ROOT, "src/app/api/user-projects/[id]/publish-orangecat/route.ts"),
  "utf8",
);
ok(/export async function PATCH/.test(route), "the feed can be turned off without unpublishing");
ok(
  /setProjectOrangeCatAutopost/.test(route),
  "...through the stored decision, not a second source of truth",
);
ok(
  /orangecatAutopost: null/.test(publish),
  "unpublishing clears the feed decision with the page it was about",
);

// The migration must not read as "ask everyone, including the people already
// being served". Backfilling the already-published rows is the one inference
// here, and it is the one that changes nothing for anybody.
const migration = readFileSync(join(ROOT, "drizzle/0079_project_orangecat_autopost.sql"), "utf8");
ok(
  /UPDATE user_projects[\s\S]*SET orangecat_autopost = true[\s\S]*WHERE orangecat_project_id IS NOT NULL/.test(
    migration,
  ),
  "projects already posting keep posting — consent is introduced without a silent outage",
);

console.log(`${pass}/${pass + fail} orangecat-wall-seam cases passed`);
if (fail > 0) process.exit(1);
