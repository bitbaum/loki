import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { getDatabaseDirectUrl } from "./src/lib/db-url";

// drizzle-kit is not Next, so nothing loads .env.local for it. Every other
// script that needs the database does this (scripts/db/*.ts, scripts/test/*.ts);
// without it `pnpm run db:push` threw "DATABASE_URL is required" at someone who
// had just followed the README and set DATABASE_URL in .env.local. An already
// exported variable wins — `override` stays false — so CI and the box, which
// pass the URL in the environment, are unaffected.
config({ path: ".env.local" });

const url = getDatabaseDirectUrl();
if (!url) {
  throw new Error(
    "DATABASE_URL is required for drizzle-kit (direct connection, not pool URL). " +
      "Set it in the environment or in .env.local.",
  );
}

export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct URL only — connection poolers (e.g. PgBouncer) do not support DDL reliably.
    url,
  },
});
