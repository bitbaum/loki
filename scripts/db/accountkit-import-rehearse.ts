/**
 * Rehearse scripts/db/accountkit-import.sql against an isolated database that
 * holds an authorised snapshot. Always rolls back and prints only counts.
 * There is no apply mode until the runtime switch is ready
 * (docs/architecture/accountkit-migration.md). It takes locks even though it
 * rolls back, so never point it at the served database.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/db/accountkit-import-rehearse.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

if (process.argv.length > 2) throw new Error("This command only supports rollback rehearsals");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const ROLLBACK = Symbol("rollback");

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  const script = readFileSync(
    fileURLToPath(new URL("./accountkit-import.sql", import.meta.url)),
    "utf8",
  );
  let counts: Record<string, number> | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
      await tx.unsafe(script);
      [counts] = await tx.unsafe(`
      SELECT (SELECT count(*)::int FROM loki_accountkit_users) AS accounts,
        (SELECT count(*)::int FROM loki_accountkit_users WHERE password IS NOT NULL) AS password_accounts,
        (SELECT count(*)::int FROM loki_accountkit_users WHERE verified) AS verified_addresses,
        (SELECT count(*)::int FROM loki_accountkit_users WHERE email LIKE '%@users.invalid') AS without_address,
        (SELECT count(*)::int FROM loki_accountkit_users WHERE orangecat_actor_id IS NOT NULL) AS orangecat_links
    `);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) {
      // Constraint errors can carry addresses or hashes; keep output fixed.
      console.error("Account import rehearsal failed; transaction rolled back");
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
  if (counts) console.log(JSON.stringify({ rehearsal: "rolled_back", ...counts }));
}

void main();
