/**
 * Deleting an account must clear every table that would block it.
 * Run: npx tsx scripts/test/account-deletion-covers-every-table.ts
 *
 * The class this closes: `deleteUserAccount` has to hand-clear every table
 * whose user FK is NOT onDelete:"cascade", because the users row cannot go
 * while such a row points at it. That list was a hand-written sequence of
 * seventeen `tx.delete(...)` calls with a comment asking the next person to
 * remember. Nothing checked it.
 *
 * So adding a table with a plain `references(() => users.id)` broke account
 * deletion SILENTLY. tsc is happy — the new table is simply not mentioned.
 * Every test is happy — nothing exercises the path. The failure surfaces only
 * when a real person opens Settings → Danger zone, types their email to
 * confirm, and gets a 500 on the one action they cannot retry their way out
 * of. Measured 2026-09-22: seventeen tables needed clearing and all seventeen
 * were handled, so this gate goes in green — it is here to keep that true, not
 * to fix a present break.
 *
 * WHAT THIS CHECKS, in both directions:
 *   - every non-cascading user FK in the schema is covered (purged or
 *     deliberately detached) — a new table cannot slip past
 *   - every covered entry still HAS a non-cascading user FK — so an entry left
 *     behind after a table gains onDelete:"cascade" is reported too, rather
 *     than sitting there as a no-op that reads like protection
 *
 * The truth comes from drizzle's own table metadata, never from parsing the
 * source: the schema is the thing the database is built from, so a check that
 * reads it cannot disagree with production. A regex over `.references(` would
 * have been a second, weaker description of the same fact.
 */
import assert from "node:assert/strict";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema";
import { USER_DETACHED_COLUMNS, USER_PURGE_ORDER } from "../../src/db/queries/user-purge-tables";

/** A FK is safe to leave alone only if the database itself clears it. */
const SELF_CLEARING = new Set(["cascade", "set null", "set default"]);

const usersTableName = getTableConfig(schema.users as PgTable).name;

/** Every (table, column) in the schema whose user FK would block a delete. */
function blockingUserFks(): Array<{ table: string; column: string }> {
  const found: Array<{ table: string; column: string }> = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getTableConfig(value);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable as PgTable).name !== usersTableName) continue;
      if (SELF_CLEARING.has((fk.onDelete ?? "").toLowerCase())) continue;
      for (const column of ref.columns) found.push({ table: cfg.name, column: column.name });
    }
  }
  return found;
}

const key = (t: string, c: string) => `${t}.${c}`;

const blocking = new Set(blockingUserFks().map((f) => key(f.table, f.column)));

const covered = new Set<string>();
for (const table of USER_PURGE_ORDER) {
  const cfg = getTableConfig(table as unknown as PgTable);
  // The purge deletes by user_id, so that is the column it covers.
  covered.add(key(cfg.name, "user_id"));
}
for (const entry of USER_DETACHED_COLUMNS) {
  covered.add(key(getTableConfig(entry.table as unknown as PgTable).name, entry.column));
}

const uncovered = [...blocking].filter((k) => !covered.has(k)).sort();
const stale = [...covered].filter((k) => !blocking.has(k)).sort();

const problems: string[] = [];
if (uncovered.length > 0) {
  problems.push(
    `${uncovered.length} table(s) would BLOCK account deletion and nothing clears them:\n` +
      uncovered.map((k) => `    ${k}`).join("\n") +
      `\n\n  Fix in src/db/queries/users.ts: add the table to USER_PURGE_ORDER (it is\n` +
      `  deleted by user_id), or to USER_DETACHED_COLUMNS with the reason it must\n` +
      `  survive the user. Alternatively give the column onDelete:"cascade" in the\n` +
      `  schema and let the database do it — then nothing needs listing here.`,
  );
}
if (stale.length > 0) {
  problems.push(
    `${stale.length} covered entr(y/ies) no longer has a blocking user FK:\n` +
      stale.map((k) => `    ${k}`).join("\n") +
      `\n\n  The column probably gained onDelete:"cascade". Drop it from the list in\n` +
      `  src/db/queries/users.ts — a delete that clears nothing reads like cover it\n` +
      `  does not provide.`,
  );
}

assert.equal(problems.length, 0, `\n\n${problems.join("\n\n")}\n`);

console.log(
  `✓ account deletion: ${blocking.size} blocking user FK(s), all covered ` +
    `(${USER_PURGE_ORDER.length} purged, ${USER_DETACHED_COLUMNS.length} detached)`,
);
