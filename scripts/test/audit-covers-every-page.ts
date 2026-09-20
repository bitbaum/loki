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
  const arrayOf = (name: string) => {
    const m = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(src);
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
  // Dynamic segments need a real id to render and are out of scope.
  const statics = [...new Set(routes.filter((r) => !r.includes("[")))].sort();
  const orphans = statics.filter((r) => !measured.has(r) && !excluded.has(r));
  assert(
    orphans.length === 0,
    `page routes in neither the audit nor NOT_MEASURED:\n      ${orphans.join("\n      ")}\n` +
      `      Add each to PAGES / PUBLIC_PAGES, or to NOT_MEASURED with the reason.`,
  );
});

check("nothing is excluded that no longer exists", () => {
  // An exclusion for a deleted page is a stale reason nobody will re-examine.
  const statics = new Set(routes.filter((r) => !r.includes("[")));
  const ghosts = [...excluded].filter((r) => !statics.has(r));
  assert(ghosts.length === 0, `excluded routes with no page: ${ghosts.join(", ")}`);
});

check("a route is not in both lists", () => {
  const both = [...excluded].filter((r) => measured.has(r));
  assert(both.length === 0, `measured AND excluded: ${both.join(", ")}`);
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
