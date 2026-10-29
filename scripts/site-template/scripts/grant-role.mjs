#!/usr/bin/env node
// Give an account a role. The only way a role changes: nobody chooses their
// own (sign-up ignores it), and there is no web form for it yet.
//
//   DATABASE_URL=… pnpm run role:grant <email-or-user-id> <role>
//
// Run it where the database is (on the box: as the app, with its env). It
// prints who changed and how, never anything else about them.
import pg from "pg";

import { ROLES } from "@bitbaum/accountkit/auth";
const [who, role] = process.argv.slice(2);

if (!who || !ROLES.includes(role ?? "")) {
  console.error(`usage: role:grant <email-or-user-id> <${ROLES.join("|")}>`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(
    "update users set role = $2, updated_at = now() where id = $1 or lower(email) = lower($1) returning id",
    [who, role],
  );
  if (rows.length !== 1) {
    console.error(
      rows.length === 0 ? "no such account" : "more than one account matched — use the id",
    );
    process.exit(1);
  }
  console.warn(`account ${rows[0].id} is now ${role}`);
} finally {
  await client.end();
}
