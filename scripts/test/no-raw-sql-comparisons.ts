/**
 * Compare columns with drizzle's lt/gt/lte/gte, never with a raw sql`a < ${b}`.
 *
 * postgres-js cannot serialise a JS Date inside a raw fragment: it throws
 * ERR_INVALID_ARG_TYPE at query time. closeStaleAgentTurns did exactly that on
 * every hourly reap (seen 2026-10-01), and the same shape sat in the calendar
 * overlap and the digest's previous-window count — failing quietly, because a
 * thrown query in a background job looks like "no data". The typed helpers
 * map the value through the column, so a Date is always encoded correctly.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAW_COMPARE = /sql`\$\{[^}]+\}\s*(<=|>=|<|>)\s*\$\{[^}]+\}`/;
const offenders: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_COMPARE.test(line)) offenders.push(`${p}:${i + 1}: ${line.trim()}`);
        });
    }
  }
}
walk("src");
assert.equal(
  offenders.length,
  0,
  `raw sql comparisons (use lt/gt/lte/gte from drizzle-orm):\n${offenders.join("\n")}`,
);
console.log("no-raw-sql-comparisons: ok");
