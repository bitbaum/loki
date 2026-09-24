/**
 * "The latest run per path" fetches one row per path, not every run.
 *
 * getLatestRunsByProjectPaths used to SELECT every run for every path and keep
 * the first per path in JS. Measured on production 2026-09-24: 699 rows at
 * ~1.26 KB (~880 KB, mostly `summary` JSON) parsed to keep 32 — on every
 * Control poll and, since #863, on every /today load, growing with every run.
 *
 * TWO RULES:
 *   1. It asks Postgres for one row per path (DISTINCT ON), so the transfer is
 *      bounded by the number of projects, not the number of runs ever made.
 *   2. The DISTINCT ON column LEADS the ORDER BY. Postgres rejects the query at
 *      RUNTIME otherwise ("SELECT DISTINCT ON expressions must match initial
 *      ORDER BY expressions") — tsc cannot see it, and both callers swallow the
 *      error into an empty map, so it would fail as silence: Control and the
 *      front door would quietly stop reporting run health.
 *
 * Run: npx tsx scripts/test/latest-run-is-one-row-per-path.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(process.cwd(), "src/db/queries/orchestration-runs.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

const at = src.indexOf("export async function getLatestRunsByProjectPaths");
const end = src.indexOf("\nexport ", at + 1);
const fn = at === -1 ? "" : src.slice(at, end === -1 ? undefined : end);

let failures = 0;
function check(name: string, fn_: () => void) {
  try {
    fn_();
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

console.log("latest-run-is-one-row-per-path:");

check("the function exists (re-point this gate if it moved)", () => {
  assert(fn.length > 0, "getLatestRunsByProjectPaths not found in orchestration-runs.ts");
});

check("RULE 1: it fetches one row per path, not every run", () => {
  assert(
    /\.selectDistinctOn\(\s*\[\s*orchestrationRuns\.projectPath\s*\]/.test(fn),
    "it no longer asks for DISTINCT ON (project_path) — every run for every path comes back again",
  );
  assert(
    !/for\s*\(const row of rows\)[\s\S]*?latest\.has/.test(fn),
    "the JS reduce is back, which only makes sense if every run is being fetched",
  );
});

check("RULE 2: the DISTINCT ON column leads the ORDER BY", () => {
  assert(
    /\.orderBy\(\s*orchestrationRuns\.projectPath\s*,\s*desc\(\s*orchestrationRuns\.startedAt\s*\)/.test(
      fn,
    ),
    "ORDER BY must start with project_path, then started_at DESC — Postgres rejects the query otherwise, and both callers turn that into an empty map",
  );
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
