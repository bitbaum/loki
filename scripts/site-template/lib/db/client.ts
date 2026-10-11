import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * The database, built on first use rather than at import.
 *
 * `next build` evaluates route modules to collect page data, so a connection
 * opened at module scope would make the BUILD need a database. Deferring it
 * keeps CI hermetic and still fails loudly on a running server without one.
 */
let pool: Pool | null = null;
let db: Database | null = null;

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

export function getDb(): Database {
  if (db) return db;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  // A pool error is about the connection, never about a person: log the code
  // only, never the message (it can carry a connection string).
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(`[db] idle client error ${error.code ?? "unknown"}`);
  });
  db = drizzle(pool, { schema });
  return db;
}

export { schema };
