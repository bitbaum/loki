/**
 * One-off: teach the Atlas where the already-deployed fleet sites live.
 *
 * Why a script and not a migration: which host serves which project is DATA
 * about one operator's box, not product schema. Baking it into a migration
 * would ship one person's deployment map to every Loki install.
 *
 * Only fills rows where live_url IS NULL — a URL the user has edited is the
 * SSOT and must never be overwritten by a seed. Safe to re-run.
 *
 * The map is DERIVED from scripts/hetzner/apps.conf, the hosting register —
 * the same source the public footer is generated from. It used to be a
 * hand-typed copy "read 2026-08-06", and by 2026-09-15 two of its fifteen
 * entries pointed at retired hosts (aoz-wohnen.orangecat.ch, revampit.orangecat.ch):
 * running it would have written stale URLs into every empty live_url.
 *
 * Run: DATABASE_URL=... npx tsx scripts/seed-fleet-site-urls.ts [--apply]
 */
import { isNull, and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { userProjects } from "../src/db/schema";
import { readAppsConf, hostedUrl } from "../src/lib/register/apps-conf";
import { canonicalSlug } from "../src/lib/register/build";

/** Canonical project slug → the URL the box actually serves it at. */
const SITES: Record<string, string> = Object.fromEntries(
  readAppsConf().flatMap((app) => {
    const url = hostedUrl(app);
    return url ? [[canonicalSlug(app.name), url]] : [];
  }),
);

const apply = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({ id: userProjects.id, name: userProjects.name, liveUrl: userProjects.liveUrl })
    .from(userProjects);

  let filled = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    const url = SITES[row.name.toLowerCase()];
    if (!url) {
      if (!row.liveUrl) unmatched.push(row.name);
      continue;
    }
    if (row.liveUrl) {
      skipped++;
      continue;
    }
    console.log(`${apply ? "set" : "would set"} ${row.name} → ${url}`);
    if (apply) {
      await db
        .update(userProjects)
        .set({ liveUrl: url, updatedAt: new Date() })
        .where(and(eq(userProjects.id, row.id), isNull(userProjects.liveUrl)));
    }
    filled++;
  }

  console.log(`\n${filled} filled, ${skipped} already set.`);
  if (unmatched.length) console.log(`No known site (left empty): ${unmatched.join(", ")}`);
  if (!apply) console.log("\nDry run — re-run with --apply to write.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
