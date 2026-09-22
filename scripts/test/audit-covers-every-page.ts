/**
 * Every page in the app is measured, or deliberately excluded with a reason.
 *
 * responsive-audit.mjs opens with the argument this enforces: "a rule enforced
 * on the pages that happened to be reachable is a rule with holes exactly
 * where nobody looked — so the list has to earn it." It could not earn it on
 * its own, because nothing compared the list to the app.
 *
 * What was missing when this was written, found by that comparison:
 *
 *   /feedback     where the operator spends the triage half of their day, with
 *                 the densest control cluster in the app. Unmeasured, and it
 *                 was clipping its own stats mid-word on a phone.
 *   /my-feedback  the REPORTER's view — the one feedback surface whose reader
 *                 may be a stranger on someone else's site, and one AGENTS.md
 *                 already records as having been forgotten once.
 *   /license      public, and already missed once: the MIT relicense fixed
 *                 LICENSE, README and Terms and left this page telling readers
 *                 they "may not" host or repackage (loki#802).
 *   /privacy /terms  the other two pages a stranger is entitled to read.
 *
 * A new page now has to be a decision — measured, or excluded and why.
 *
 * Run: npx tsx scripts/test/audit-covers-every-page.ts
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const APP = join(ROOT, "src", "app");
const AUDIT = join(ROOT, "scripts", "test", "responsive-audit.mjs");

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Every `page.tsx` in the app router, as the URL it serves. */
function pageRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) pageRoutes(p, out);
    else if (entry === "page.tsx" || entry === "page.ts") {
      const rel = relative(APP, dir);
      if (rel === "") {
        out.push("/");
        continue;
      }
      // Route groups — (app), (private) — are organisation, not URL.
      const segs = rel.split(sep).filter((s) => !(s.startsWith("(") && s.endsWith(")")));
      out.push("/" + segs.join("/"));
    }
  }
  return out;
}

/** The three lists in the audit, read from its source so they cannot drift. */
function auditLists(): { measured: Set<string>; excluded: Set<string> } {
  const src = readFileSync(AUDIT, "utf8");
  // Anchored on the array's own closing `\n];`, not on the first `]` in it.
  // The lazy `[\s\S]*?\]` form ended the array at the first bracket of any
  // sort — so a comment INSIDE the list that mentioned a route pattern like
  // /fleet/[slug] silently truncated it, and every entry below that comment
  // read as unmeasured. The parse check then still passed, because what it
  // counts is "more than twenty", which a truncated list can be.
  const arrayOf = (name: string) => {
    const m = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(src);
    return m ? [...m[1].matchAll(/"(\/[^"]*)"/g)].map((x) => x[1]) : [];
  };
  const excludedBlock = /export const NOT_MEASURED\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
  const excluded = excludedBlock
    ? [...excludedBlock[1].matchAll(/"(\/[^"]*)"\s*:\s*"([^"]+)"/g)].map((m) => m[1])
    : [];
  return {
    measured: new Set([...arrayOf("PAGES"), ...arrayOf("PUBLIC_PAGES")]),
    excluded: new Set(excluded),
  };
}

console.log("audit-covers-every-page:");

const routes = pageRoutes(APP);
const { measured, excluded } = auditLists();

check("the audit's own lists parse", () => {
  // If this regex ever stops matching, every check below passes vacuously —
  // which is the failure mode the audit itself exists to prevent.
  assert(measured.size > 20, `expected the page lists, parsed ${measured.size}`);
  assert(excluded.size > 5, `expected exclusions, parsed ${excluded.size}`);
});

check("every static page route is measured or excluded with a reason", () => {
  const statics = [...new Set(routes.filter((r) => !r.includes("[")))].sort();
  const orphans = statics.filter((r) => !measured.has(r) && !excluded.has(r));
  assert(
    orphans.length === 0,
    `page routes in neither the audit nor NOT_MEASURED:\n      ${orphans.join("\n      ")}\n` +
      `      Add each to PAGES / PUBLIC_PAGES, or to NOT_MEASURED with the reason.`,
  );
});

/**
 * A dynamic route is covered when one CONCRETE path in the audit lists matches
 * its shape — `/fleet/heidi` covers `/fleet/[slug]`.
 *
 * This is the hole the check above was written with, and it was the largest
 * one left: "dynamic segments need a real id and are out of scope" excused
 * thirteen routes, one of which (/fleet/[slug]) renders the public profile of
 * every project in the fleet and is the link target on every OrangeCat wall
 * entry. It had never been measured at any width, and was clipping 47% of
 * every roadmap line at 390px.
 *
 * Needing a parameter is a real obstacle for most of them — a token, a row id
 * — but it is an obstacle to MEASURING, not a reason the page is exempt. So
 * each one now takes the same decision as a static page: a sample that proves
 * it, or a line in NOT_MEASURED saying what it would take.
 */
function patternOf(route: string): RegExp {
  const body = route
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith("[") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^/${body}$`);
}

check("every dynamic page route is measured through a sample, or excluded", () => {
  const dynamics = [...new Set(routes.filter((r) => r.includes("[")))].sort();
  const samples = [...measured];
  const orphans = dynamics.filter(
    (r) => !excluded.has(r) && !samples.some((s) => patternOf(r).test(s)),
  );
  assert(
    orphans.length === 0,
    `dynamic page routes with no sample and no exclusion:\n      ${orphans.join("\n      ")}\n` +
      `      Add one concrete path per route to PAGES / PUBLIC_PAGES (e.g. "/fleet/heidi"),\n` +
      `      or add the route pattern to NOT_MEASURED with what it would take.`,
  );
});

check("nothing is excluded that no longer exists", () => {
  // An exclusion for a deleted page is a stale reason nobody will re-examine.
  const all = new Set(routes);
  const ghosts = [...excluded].filter((r) => !all.has(r));
  assert(ghosts.length === 0, `excluded routes with no page: ${ghosts.join(", ")}`);
});

check("a route is not in both lists", () => {
  const both = [...excluded].filter((r) => measured.has(r));
  assert(both.length === 0, `measured AND excluded: ${both.join(", ")}`);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
